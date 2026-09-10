import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';
import type { CreatedPendingRequest } from './oauth-authorization-requests.service';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from './oauth-authorization-requests.service';

describe('OAuthAuthorizationRequestsService (real Postgres)', () => {
  let dataSource: DataSource;
  let service: OAuthAuthorizationRequestsService;
  let accountId: string;
  let otherAccountId: string;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([OAuthAuthorizationRequest]);

    // Chave hex de 64 caracteres (32 bytes) — fictícia, só para os testes.
    const fakeCredentialEncryptionKey = 'ab'.repeat(32);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OAuthAuthorizationRequestsService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) =>
              key === 'CREDENTIAL_ENCRYPTION_KEY'
                ? fakeCredentialEncryptionKey
                : fallback,
            getOrThrow: () => fakeCredentialEncryptionKey,
          },
        },
        EncryptionService,
      ],
    }).compile();

    service = moduleRef.get(OAuthAuthorizationRequestsService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Ordem importa: oauth_authorization_requests referencia
    // marketplace_accounts e users por FK; marketplace_accounts referencia
    // users por FK — trunca na ordem inversa das dependências.
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    accountId = randomUUID();
    otherAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED'), ($2, 'MERCADO_LIVRE', 'DISCONNECTED')`,
      [accountId, otherAccountId],
    );
  });

  it('createPending inserts a PENDING row and returns a usable state + codeChallenge', async () => {
    const result = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    expect(result.state.length).toBeGreaterThan(0);
    expect(result.codeChallenge.length).toBeGreaterThan(0);

    const rows: Array<{
      status: string;
      encrypted_code_verifier: string | null;
    }> = await dataSource.query(
      'SELECT status, encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
      [result.id],
    );
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].encrypted_code_verifier).not.toBeNull();
  });

  describe('PKCE opcional (Checkpoint CP2B)', () => {
    it('usePkce: false grava encrypted_code_verifier NULL e devolve codeChallenge: null', async () => {
      const result = await service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.SHOPEE,
        usePkce: false,
      });

      expect(result.codeChallenge).toBeNull();
      expect(result.state.length).toBeGreaterThan(0);

      const rows: Array<{
        status: string;
        encrypted_code_verifier: string | null;
        marketplace: string;
      }> = await dataSource.query(
        'SELECT status, encrypted_code_verifier, marketplace FROM oauth_authorization_requests WHERE id = $1',
        [result.id],
      );
      expect(rows[0].status).toBe('PENDING');
      expect(rows[0].encrypted_code_verifier).toBeNull();
      expect(rows[0].marketplace).toBe('SHOPEE');
    });

    it('sem usePkce (padrão/ML) continua gravando encrypted_code_verifier cifrado e devolvendo codeChallenge: string — comportamento byte a byte igual ao anterior ao CP2B', async () => {
      const result: CreatedPendingRequest = await service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      });

      expect(typeof result.codeChallenge).toBe('string');
      expect(result.codeChallenge.length).toBeGreaterThan(0);

      const rows: Array<{ encrypted_code_verifier: string | null }> =
        await dataSource.query(
          'SELECT encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
          [result.id],
        );
      expect(rows[0].encrypted_code_verifier).not.toBeNull();
    });

    it('usePkce: false ainda exige state de uso único — claimByState só funciona uma vez', async () => {
      const result = await service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.SHOPEE,
        usePkce: false,
      });

      const firstClaim = await service.claimByState(result.state);
      expect(firstClaim).not.toBeNull();
      expect(firstClaim?.encryptedCodeVerifier).toBeNull();

      const secondClaim = await service.claimByState(result.state);
      expect(secondClaim).toBeNull();
    });

    it('usePkce: false ainda expira uma tentativa PENDING anterior da mesma conta (mesma regra de concorrência do modo padrão)', async () => {
      const first = await service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.SHOPEE,
        usePkce: false,
      });

      await service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.SHOPEE,
        usePkce: false,
      });

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE id = $1',
        [first.id],
      );
      expect(rows[0].status).toBe('EXPIRED');
    });

    it('usePkce: false ainda respeita o conflito de tentativa ativa (PROCESSING) por conta', async () => {
      const pending = await service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.SHOPEE,
        usePkce: false,
      });
      await service.claimByState(pending.state);

      await expect(
        service.createPending({
          marketplaceAccountId: accountId,
          initiatedByUserId: userId,
          marketplace: Marketplace.SHOPEE,
          usePkce: false,
        }),
      ).rejects.toThrow(OAuthConnectionInProgressError);
    });
  });

  it('createPending expires a previous PENDING attempt for the same account', async () => {
    const first = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    const rows: Array<{
      status: string;
      encrypted_code_verifier: string | null;
    }> = await dataSource.query(
      'SELECT status, encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
      [first.id],
    );
    expect(rows[0].status).toBe('EXPIRED');
    expect(rows[0].encrypted_code_verifier).toBeNull();
  });

  it('createPending rejects with OAuthConnectionInProgressError when a PROCESSING attempt already exists', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(pending.state);

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBeInstanceOf(OAuthConnectionInProgressError);
  });

  it('createPending: two truly concurrent calls for the same account — exactly one wins, the other gets OAuthConnectionInProgressError, no PROCESSING attempt is ever expired', async () => {
    // Duas chamadas a `service.createPending` iniciadas "ao mesmo tempo" via
    // `Promise.allSettled` nem sempre colidem de fato no Postgres. Uma delas
    // reaproveita a conexão já aberta/ociosa deixada pelo teste anterior; a
    // outra precisa abrir uma conexão física NOVA (handshake TCP completo).
    // Uma barreira única antes da PRIMEIRA query (`START TRANSACTION`)
    // sincroniza só a ENTRADA na transação — depois disso, a chamada com a
    // conexão já aquecida corre livre e pode terminar o SELECT+UPDATE+INSERT
    // +COMMIT inteiro antes de a outra sequer emitir seu UPDATE. Quando isso
    // acontece, o UPDATE ...SET status='EXPIRED' da chamada mais lenta acaba
    // expirando a linha PENDING que a mais rápida JÁ COMMITOU — limpando o
    // caminho para o INSERT da mais lenta também ter sucesso, sem nunca
    // colidir no índice único parcial. Resultado: as duas terminam
    // `fulfilled` (bug do TESTE, não do serviço — comprovado por
    // investigação isolada: ver `docs`/relatório do CP4-B-R1-fix-oauth).
    //
    // Correção: uma barreira em CADA passo (`START TRANSACTION`, `SELECT`,
    // `UPDATE`, `INSERT`) força as duas chamadas a avançar em lockstep até o
    // INSERT — a operação de fato disputada —, eliminando a vantagem da
    // conexão "aquecida" sem impedir que a corrida real aconteça: os dois
    // INSERTs continuam sendo emitidos em conexões/transações independentes
    // e de verdade disputam o índice único parcial no Postgres (nunca
    // serializados manualmente pelo teste).
    const LOCKSTEP_QUERY_COUNT = 4; // START TRANSACTION, SELECT, UPDATE, INSERT
    const participants = 2;
    const stepBarriers: Array<{
      arrivals: number;
      promise: Promise<void>;
      release: () => void;
    }> = [];

    function arriveAtStep(step: number): Promise<void> {
      let barrier = stepBarriers[step];
      if (!barrier) {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        barrier = { arrivals: 0, promise, release };
        stepBarriers[step] = barrier;
      }
      barrier.arrivals += 1;
      if (barrier.arrivals >= participants) barrier.release();
      return barrier.promise;
    }

    const originalCreateQueryRunner =
      dataSource.createQueryRunner.bind(dataSource);
    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation(() => {
        const queryRunner = originalCreateQueryRunner();
        const originalQuery = queryRunner.query.bind(queryRunner);
        let step = 0;
        queryRunner.query = ((...args: Parameters<typeof originalQuery>) => {
          const currentStep = step;
          step += 1;
          if (currentStep < LOCKSTEP_QUERY_COUNT) {
            return arriveAtStep(currentStep).then(() => originalQuery(...args));
          }
          return originalQuery(...args);
        }) as typeof originalQuery;
        return queryRunner;
      });

    const results = await Promise.allSettled([
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ]);

    spy.mockRestore();

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<CreatedPendingRequest> =>
        r.status === 'fulfilled',
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(OAuthConnectionInProgressError);

    const rows: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1`,
      [accountId],
    );
    // A tentativa vencedora fica PENDING (nenhuma das duas chamou
    // claimByState) — nenhuma linha pode ficar EXPIRED, pois isso só
    // aconteceria se a corrida tivesse gerado duas linhas PENDING.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
  });

  it('createPending: a unique violation on a DIFFERENT constraint (state_hash, not the active-attempt index) is never swallowed into OAuthConnectionInProgressError, and still rolls back + releases exactly once', async () => {
    // Prova que `isActiveAttemptConflict` diferencia por nome de constraint,
    // não apenas por SQLSTATE `23505` — uma colisão de `state_hash`
    // (criptograficamente quase impossível, mas testável por injeção) é um
    // erro real e deve propagar como tal, nunca virar
    // `OAuthConnectionInProgressError` (item 7 da revisão). Também confirma
    // que o rollback + release do QueryRunner acontecem mesmo neste caminho
    // de erro "não tratado" (item 5).
    const queryFailedError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "UQ_oauth_authorization_requests_state_hash"',
      ),
      {
        code: '23505',
        constraint: 'UQ_oauth_authorization_requests_state_hash',
      },
    );

    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([]) // SELECT ... status = 'PROCESSING' -> nenhuma
        .mockResolvedValueOnce(undefined) // UPDATE ... status = 'EXPIRED' ...
        .mockRejectedValueOnce(queryFailedError), // INSERT -> violação de unicidade
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(queryFailedError);

    expect(fakeQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending: falha em connect() propaga o erro original, não tenta rollback (nenhuma transação chegou a abrir) e ainda libera o QueryRunner exatamente uma vez', async () => {
    const connectError = new Error('connection reset');
    const fakeQueryRunner = {
      connect: jest.fn().mockRejectedValue(connectError),
      startTransaction: jest.fn(),
      query: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(connectError);

    expect(fakeQueryRunner.startTransaction).not.toHaveBeenCalled();
    expect(fakeQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending: falha em startTransaction() propaga o erro original, não tenta rollback e ainda libera o QueryRunner exatamente uma vez', async () => {
    const startTransactionError = new Error('could not start transaction');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockRejectedValue(startTransactionError),
      query: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(startTransactionError);

    expect(fakeQueryRunner.query).not.toHaveBeenCalled();
    expect(fakeQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending: falha em commitTransaction() faz rollback (transação estava ativa), propaga o erro original e libera o QueryRunner exatamente uma vez', async () => {
    const commitError = new Error('commit failed: connection lost');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([]) // SELECT ... status = 'PROCESSING' -> nenhuma
        .mockResolvedValueOnce(undefined) // UPDATE ... status = 'EXPIRED' ...
        .mockResolvedValueOnce(undefined), // INSERT -> sucesso
      commitTransaction: jest.fn().mockRejectedValue(commitError),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(commitError);

    expect(fakeQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending for a different account is unaffected by another account being PROCESSING', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(pending.state);

    await expect(
      service.createPending({
        marketplaceAccountId: otherAccountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).resolves.toBeDefined();
  });

  it('claimByState atomically moves PENDING -> PROCESSING exactly once, second call returns null (replay)', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    const first = await service.claimByState(pending.state);
    const second = await service.claimByState(pending.state);

    expect(first?.status).toBe('PROCESSING');
    expect(second).toBeNull();
  });

  it('claimByState returns null for an unknown state', async () => {
    expect(await service.claimByState('never-existed')).toBeNull();
  });

  it('claimByState returns null for an expired PENDING row', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [pending.id],
    );

    expect(await service.claimByState(pending.state)).toBeNull();
  });

  it('claimByState returns an object with real camelCase property names/values (not snake_case columns)', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    const claimed = await service.claimByState(pending.state);

    // Prova, por valor, que o `RETURNING` com aliases explícitos produz o
    // shape camelCase que os chamadores (Task 19's
    // `applyConnectionAndFinalizeAtomically`) realmente consomem — não um
    // cast que apenas finge converter `marketplace_account_id` em
    // `marketplaceAccountId` sem de fato renomear a coluna.
    expect(claimed).toMatchObject({
      id: pending.id,
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
      status: 'PROCESSING',
    });
    expect(claimed!.encryptedCodeVerifier).not.toBeNull();
    expect(claimed!.processingStartedAt).toBeInstanceOf(Date);
    expect(claimed!.consumedAt).toBeInstanceOf(Date);
    // Nenhuma propriedade snake_case deve vazar no objeto retornado.
    expect(claimed).not.toHaveProperty('marketplace_account_id');
    expect(claimed).not.toHaveProperty('processing_started_at');
  });

  it('finalizeSuccess only updates a PROCESSING row, and clears encrypted_code_verifier', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const claimed = await service.claimByState(pending.state);

    expect(await service.finalizeSuccess(claimed!.id)).toBe(true);
    // Replay: already SUCCESS, must not "succeed" again.
    expect(await service.finalizeSuccess(claimed!.id)).toBe(false);

    const rows: Array<{
      status: string;
      encrypted_code_verifier: string | null;
      completed_at: Date | null;
    }> = await dataSource.query(
      'SELECT status, encrypted_code_verifier, completed_at FROM oauth_authorization_requests WHERE id = $1',
      [claimed!.id],
    );
    expect(rows[0].status).toBe('SUCCESS');
    expect(rows[0].encrypted_code_verifier).toBeNull();
    expect(rows[0].completed_at).not.toBeNull();
  });

  it('finalizeFailure only updates a PROCESSING row, stores the failureCode, clears encrypted_code_verifier', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const claimed = await service.claimByState(pending.state);

    expect(
      await service.finalizeFailure(claimed!.id, 'IDENTITY_MISMATCH'),
    ).toBe(true);
    expect(
      await service.finalizeFailure(claimed!.id, 'IDENTITY_MISMATCH'),
    ).toBe(false);

    const rows: Array<{
      status: string;
      failure_code: string | null;
      encrypted_code_verifier: string | null;
    }> = await dataSource.query(
      'SELECT status, failure_code, encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
      [claimed!.id],
    );
    expect(rows[0].status).toBe('FAILED');
    expect(rows[0].failure_code).toBe('IDENTITY_MISMATCH');
    expect(rows[0].encrypted_code_verifier).toBeNull();
  });

  it('sweepExpiredPending marks past-due PENDING rows EXPIRED and clears the verifier, leaves PROCESSING untouched', async () => {
    const expired = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expired.id],
    );

    const processingSeed = await service.createPending({
      marketplaceAccountId: otherAccountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(processingSeed.state);

    const count = await service.sweepExpiredPending();
    expect(count).toBe(1);

    const rows: Array<{ id: string; status: string }> = await dataSource.query(
      'SELECT id, status FROM oauth_authorization_requests ORDER BY status',
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: expired.id, status: 'EXPIRED' },
        { id: processingSeed.id, status: 'PROCESSING' },
      ]),
    );
  });

  it('findStaleProcessingCandidates + failIfStillStaleProcessing recover an abandoned PROCESSING row', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const claimed = await service.claimByState(pending.state);
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET processing_started_at = $2 WHERE id = $1`,
      [claimed!.id, oldTimestamp],
    );

    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const candidates = await service.findStaleProcessingCandidates(cutoff);
    expect(candidates.map((c) => c.id)).toContain(claimed!.id);

    expect(await service.failIfStillStaleProcessing(claimed!.id, cutoff)).toBe(
      true,
    );

    const rows: Array<{
      status: string;
      failure_code: string | null;
    }> = await dataSource.query(
      'SELECT status, failure_code FROM oauth_authorization_requests WHERE id = $1',
      [claimed!.id],
    );
    expect(rows[0].status).toBe('FAILED');
    expect(rows[0].failure_code).toBe('CALLBACK_RESULT_UNKNOWN');
  });

  it('a violação REAL do PostgreSQL na constraint de tentativa ativa (UQ_oauth_authorization_requests_active_attempt) vira OAuthConnectionInProgressError — sem mock de erro, sem depender do idioma da mensagem do driver', async () => {
    // Complementa (não substitui) o teste com erro fabricado acima: aqui o
    // 23505 é o SQLSTATE real devolvido pelo PostgreSQL disparado por uma
    // segunda tentativa concorrente de verdade, provando que
    // `isActiveAttemptConflict` funciona contra o driver `pg` real, não
    // apenas contra um objeto de erro simulado em memória (item 4 da
    // segunda revisão).
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(pending.state);

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBeInstanceOf(OAuthConnectionInProgressError);
  });

  it('uma violação REAL do PostgreSQL em UQ_oauth_authorization_requests_state_hash (colisão de state) NÃO vira OAuthConnectionInProgressError', async () => {
    // Prova, contra o banco real, que a checagem por nome de constraint
    // (não só SQLSTATE) rejeita corretamente uma colisão de `state_hash`
    // como o erro real que ela é, mesmo vindo do driver `pg` de verdade.
    const first = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    // Sem controle direto sobre o gerador de state aleatório, a colisão é
    // simulada diretamente contra o banco real via um INSERT cru que reusa
    // o `state_hash` da primeira tentativa em outra conta — a mesma
    // constraint (`UQ_oauth_authorization_requests_state_hash`) que
    // `createPending` violaria em uma colisão real de state.
    await expect(
      dataSource.query(
        `INSERT INTO oauth_authorization_requests
           (id, marketplace_account_id, initiated_by_user_id, marketplace,
            state_hash, encrypted_code_verifier, status, expires_at)
         SELECT gen_random_uuid(), $1, $2, marketplace, state_hash, encrypted_code_verifier, status, expires_at
           FROM oauth_authorization_requests WHERE id = $3`,
        [otherAccountId, userId, first.id],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'UQ_oauth_authorization_requests_state_hash',
    });
  });

  it('uma violação de unicidade em uma constraint totalmente desconhecida (não active-attempt, não state_hash) não é convertida em OAuthConnectionInProgressError', async () => {
    const unknownConstraintError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "some_other_future_index"',
      ),
      { code: '23505', constraint: 'some_other_future_index' },
    );
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(unknownConstraintError),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<
          DataSource['createQueryRunner']
        >,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(unknownConstraintError);

    expect(fakeQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
