import { Injectable, Logger } from '@nestjs/common';
import { PassThrough, type Readable } from 'stream';
import { utcInstantToSaoPauloDateString } from '../integrations/marketplace-orders/period.util';
import {
  CustomersExportAbortedError,
  writeCustomersWorkbook,
  type CustomersWorkbookSource,
} from './customers-workbook';
import type { CustomersFilter } from './customers-query';
import {
  CustomersRepository,
  type CustomersExportSession,
} from './customers.repository';
import { CustomersService } from './customers.service';

export interface CustomersExportStream {
  stream: Readable;
  filename: string;
  /** Resolve quando a geração termina (sucesso, erro ou aborto) e tudo foi liberado. */
  done: Promise<void>;
}

const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
// Buffer de saída entre o zip e a resposta HTTP — acima disso a geração espera.
const OUTPUT_HIGH_WATER_MARK = 1024 * 1024;

export function buildCustomersExportFilename(
  filter: CustomersFilter,
  now: Date,
): string {
  const period = filter.period
    ? `${filter.period.fromLabel}_a_${filter.period.toLabel}`
    : 'todo-o-periodo';
  const local = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  const hhmm = `${String(local.getUTCHours()).padStart(2, '0')}${String(local.getUTCMinutes()).padStart(2, '0')}`;
  // Rótulos de período já validados como `YYYY-MM-DD`; a whitelist abaixo é
  // defesa extra para o header `Content-Disposition`.
  return `clientes_${period}_gerado-${utcInstantToSaoPauloDateString(now)}_${hhmm}.xlsx`.replace(
    /[^A-Za-z0-9._-]/g,
    '_',
  );
}

/**
 * Filtros registrados na auditoria — nunca o texto de busca/produto (pode
 * conter nome/e-mail/telefone de pessoa), só se foi aplicado.
 */
export function toAuditFilters(
  filter: CustomersFilter,
): Record<string, unknown> {
  return {
    marketplace: filter.marketplace,
    accountId: filter.accountId,
    allTime: filter.period === null,
    from: filter.period?.fromLabel ?? null,
    to: filter.period?.toLabel ?? null,
    customerType: filter.customerType,
    searchApplied: filter.search !== null,
    productApplied: filter.product !== null,
    onlyWithEmail: filter.onlyWithEmail,
    onlyWithRecipientPhone: filter.onlyWithRecipientPhone,
  };
}

@Injectable()
export class CustomersExportService {
  private readonly logger = new Logger(CustomersExportService.name);

  constructor(
    private readonly repository: CustomersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Registra a auditoria (só metadados) e abre a leitura por cursor ANTES de
   * devolver o stream — falha de banco aqui vira erro HTTP normal. A
   * planilha é então gerada em segundo plano direto no stream, lote a lote;
   * `signal` (resposta fechada) interrompe a geração e libera a conexão.
   * Contagens/`completed_at` da auditoria só são gravados se o arquivo foi
   * gerado por inteiro.
   */
  async export(
    filter: CustomersFilter,
    includePersonalData: boolean,
    userId: string,
    now: Date,
    signal?: AbortSignal,
  ): Promise<CustomersExportStream> {
    const auditId = await this.repository.insertExportAudit({
      userId,
      filters: toAuditFilters(filter),
      includedPersonalData: includePersonalData,
    });
    const session = await this.repository.openExportSession(filter);
    const output = new PassThrough({ highWaterMark: OUTPUT_HIGH_WATER_MARK });

    const done = writeCustomersWorkbook(this.toSource(session), output, {
      includePersonalData,
      signal,
    })
      .then((counts) => this.repository.completeExportAudit(auditId, counts))
      .catch((error: unknown) => {
        if (!(error instanceof CustomersExportAbortedError)) {
          // Só o tipo do erro — nunca mensagem/valores (podem conter PII).
          this.logger.error('CUSTOMERS_EXPORT_FAILED', {
            auditId,
            errorName: error instanceof Error ? error.name : typeof error,
          });
        }
        output.destroy(
          error instanceof Error ? error : new CustomersExportAbortedError(),
        );
      })
      .finally(() => session.close());

    return {
      stream: output,
      filename: buildCustomersExportFilename(filter, now),
      done,
    };
  }

  private toSource(session: CustomersExportSession): CustomersWorkbookSource {
    return {
      nextCustomers: async () => {
        const rows = await session.fetchBuyers();
        if (rows.length === 0) return [];
        const top = await session.findTopProducts(
          rows.map((row) => row.buyer_id),
        );
        return this.customers.toRecords(rows, top);
      },
      nextDetails: () => session.fetchDetails(),
      coverage: () => session.findAccountCoverage(),
    };
  }
}
