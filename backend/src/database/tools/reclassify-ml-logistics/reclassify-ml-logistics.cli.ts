import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { MercadoLivreLogisticsReclassificationService } from '../../../integrations/mercado-livre-orders/mercado-livre-logistics-reclassification.service';
import {
  ReclassifyAbortedError,
  formatAbortLine,
  formatApplyReport,
  formatPlanReport,
  hasFailureOutcome,
  parseReclassifyArgs,
} from './reclassify-ml-logistics.args';

/**
 * CLI operacional de reclassificação logística do Mercado Livre (correção da
 * auditoria Full). NUNCA roda sozinha: não é agendada, não é acionada por
 * deploy, nenhum controller a expõe e nada no boot do backend a invoca —
 * a única forma de executá-la é este arquivo, chamado diretamente.
 *
 * Modos:
 *   npm run reclassify:ml-logistics -- --plan
 *     Somente leitura do banco. NENHUMA chamada ao Mercado Livre, nenhuma
 *     escrita. É o padrão: sem `--apply`, é sempre isto que acontece.
 *
 *   npm run reclassify:ml-logistics -- --apply --confirm RECLASSIFY_ML_LOGISTICS
 *     Autoriza as consultas a `GET /shipments/{id}` e as escritas
 *     condicionais. A confirmação literal é obrigatória e exata.
 *
 * Argumentos opcionais: `--account-id <uuid>`, `--batch-size <n>`,
 * `--max-requests <n>`.
 *
 * ATENÇÃO OPERACIONAL: o `--apply` deve ser executado no ambiente que detém
 * os refresh tokens válidos (Render). Rodá-lo localmente enquanto o Render
 * mantém os mesmos tokens faz os dois ambientes disputarem a renovação e
 * pode invalidar a conexão da conta.
 */
async function main(): Promise<void> {
  const args = parseReclassifyArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const service = app.get(MercadoLivreLogisticsReclassificationService);

    if (args.mode === 'plan') {
      // `--batch-size` também é aceito em `--plan` — só afeta a estimativa
      // de lotes exibida, nunca dispara nenhuma leitura em lote de verdade.
      const report = await service.plan(
        args.accountId,
        args.batchSize ?? undefined,
      );
      writeLines(formatPlanReport(report));
      return;
    }

    const reports = await service.apply({
      accountId: args.accountId,
      batchSize: args.batchSize ?? undefined,
      maxRequestsPerAccount: args.maxRequestsPerAccount ?? undefined,
    });
    writeLines(formatApplyReport(reports));

    if (hasFailureOutcome(reports)) {
      throw new ReclassifyAbortedError('EXECUTION_FAILED');
    }
  } finally {
    await app.close();
  }
}

function writeLines(lines: string[]): void {
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

/**
 * `require.main === module` mantém o arquivo importável pelos testes sem
 * abrir conexão nenhuma — a reclassificação só roda por execução direta.
 */
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${formatAbortLine(error)}\n`);
    process.exitCode = 1;
  });
}
