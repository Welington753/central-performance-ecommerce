import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { deriveAdvisoryLockKey } from './advisory-lock.util';

export interface AdvisoryLockHandle {
  release(): Promise<void>;
}

const POLL_INTERVAL_MS = 100;

/**
 * Advisory lock por conta, coordenando callback e refresh mesmo com
 * múltiplas instâncias do backend (design §3). Uma conexão DEDICADA
 * (QueryRunner) é usada para adquirir e liberar o mesmo lock — nunca a
 * conexão compartilhada do pool de repositórios.
 */
@Injectable()
export class AdvisoryLockService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async tryAcquire(accountId: string): Promise<AdvisoryLockHandle | null> {
    const waitMs = this.configService.get<number>(
      'ML_ACCOUNT_LOCK_WAIT_MS',
      3000,
    );
    const key = deriveAdvisoryLockKey(accountId).toString();
    const queryRunner = this.dataSource.createQueryRunner();

    // Helper de liberação IDEMPOTENTE, compartilhado por TODOS os caminhos
    // que podem liberar esta mesma conexão física: timeout (`return null`),
    // falha de `connect`/`query`/polling (`catch` abaixo) e o
    // `AdvisoryLockHandle.release()` retornado em caso de sucesso. O estado
    // "liberação iniciada" (`releaseStarted`) é marcado ANTES da primeira
    // tentativa de `queryRunner.release()` — não depois dela ter sucesso —
    // então mesmo que essa primeira tentativa lance, nenhum caminho
    // seguinte tenta liberar a mesma conexão de novo. Isto corrige um bug
    // real da versão anterior: se `queryRunner.release()` no ramo de
    // timeout lançasse, a exceção caía no `catch` externo, que chamava
    // `queryRunner.release()` uma SEGUNDA vez sobre a mesma conexão.
    let releaseStarted = false;
    const releaseQueryRunnerOnce = async (): Promise<void> => {
      if (releaseStarted) return;
      releaseStarted = true;
      await queryRunner.release();
    };

    // `connect()` fica DENTRO do `try`: se ele lançar (ex.: pool
    // esgotado), o `catch` abaixo ainda libera o `QueryRunner` — evitando
    // vazamento de conexão que existiria se `connect()` ficasse fora da
    // estrutura try/catch.
    try {
      await queryRunner.connect();
      const deadline = Date.now() + waitMs;

      while (Date.now() < deadline) {
        const rows = (await queryRunner.query(
          'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
          [key],
        )) as Array<{ acquired: boolean }>;

        if (rows[0]?.acquired) {
          // `handleReleaseStarted` trava o HANDLE (não a conexão física —
          // essa já é protegida por `releaseStarted`/`releaseQueryRunnerOnce`
          // acima) após a primeira chamada a `release()`: uma segunda
          // chamada ao mesmo handle não tenta reenviar `pg_advisory_unlock`
          // nem chamar `queryRunner.release()` de novo — mesmo que a
          // primeira tentativa de liberação tenha falhado (idempotência não
          // depende de sucesso).
          let handleReleaseStarted = false;
          return {
            release: async () => {
              if (handleReleaseStarted) return;
              handleReleaseStarted = true;

              // O erro do UNLOCK lógico (`pg_advisory_unlock`) é o erro
              // PRIMÁRIO desta operação — se ele e a liberação da conexão
              // (`queryRunner.release()`) falharem juntos, é o erro do
              // unlock que deve ser propagado, nunca mascarado pelo erro
              // secundário de cleanup da conexão.
              let primaryError: Error | undefined;
              try {
                await queryRunner.query(
                  'SELECT pg_advisory_unlock($1::bigint)',
                  [key],
                );
              } catch (unlockError) {
                primaryError = unlockError as Error;
              }

              try {
                await releaseQueryRunnerOnce();
              } catch (releaseError) {
                if (primaryError === undefined) {
                  primaryError = releaseError as Error;
                }
              }

              if (primaryError !== undefined) throw primaryError;
            },
          };
        }

        await this.sleep(POLL_INTERVAL_MS);
      }

      await releaseQueryRunnerOnce();
      return null;
    } catch (error) {
      // Aquisição, consulta ou o sleep entre tentativas falhou (ex.: conexão
      // caiu no meio do polling), OU a liberação no ramo de timeout acima
      // lançou. Em qualquer caso, o erro PRIMÁRIO é `error` — uma falha
      // secundária de `releaseQueryRunnerOnce()` aqui é apenas engolida
      // (a conexão já está marcada como "liberação iniciada", então nenhum
      // outro caminho tentará de novo) para nunca mascarar a causa raiz.
      try {
        await releaseQueryRunnerOnce();
      } catch {
        // Erro secundário de cleanup — intencionalmente descartado, ver
        // comentário acima. `releaseStarted` já garante que a conexão
        // nunca será liberada mais de uma vez.
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
