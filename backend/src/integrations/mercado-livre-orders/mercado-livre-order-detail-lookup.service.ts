import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MercadoLivreOrderDetailClient,
  type FetchOrderShipmentIdOutcome,
} from './mercado-livre-order-detail.client';
import {
  ML_SHIPMENT_RETRY_SLEEP,
  type ShipmentRetrySleep,
} from './mercado-livre-shipment-lookup.service';

export interface OrderDetailLookupResult {
  outcome: FetchOrderShipmentIdOutcome;
  attempts: number;
}

/**
 * Mesma política de retry de `mercado-livre-shipment-lookup.service.ts`
 * (mesmo provedor, mesma semântica de falha transitória) — reaproveita
 * deliberadamente as MESMAS chaves de configuração (`ML_SHIPMENT_MAX_ATTEMPTS`
 * / `ML_SHIPMENT_RETRY_BASE_DELAY_MS` / `ML_SHIPMENT_RETRY_MAX_DELAY_MS`) e o
 * MESMO token de sleep injetável, para não duplicar variáveis de ambiente
 * para um comportamento idêntico.
 */
const RETRYABLE_OUTCOME_KINDS: ReadonlySet<
  FetchOrderShipmentIdOutcome['kind']
> = new Set(['rate_limited', 'provider_unavailable']);

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;
const HARD_ATTEMPT_CAP = 6;

/**
 * Consulta de `shipping.id` do pedido (fallback de recuperação, apenas
 * `--apply`) COM o mesmo retry limitado do lookup de envio: só repete
 * `rate_limited`/`provider_unavailable`, nunca 401/403/404/resposta
 * inválida, nunca espera infinita.
 */
@Injectable()
export class MercadoLivreOrderDetailLookupService {
  constructor(
    private readonly orderDetailClient: MercadoLivreOrderDetailClient,
    private readonly configService: ConfigService,
    @Inject(ML_SHIPMENT_RETRY_SLEEP)
    private readonly sleep: ShipmentRetrySleep,
  ) {}

  async lookup(
    accessToken: string,
    externalOrderId: string,
  ): Promise<OrderDetailLookupResult> {
    const maxAttempts = this.maxAttempts();
    let attempts = 0;
    let outcome: FetchOrderShipmentIdOutcome = { kind: 'provider_unavailable' };

    while (attempts < maxAttempts) {
      outcome = await this.orderDetailClient.fetchOrderShipmentId(
        accessToken,
        externalOrderId,
      );
      attempts += 1;

      if (!RETRYABLE_OUTCOME_KINDS.has(outcome.kind)) break;
      if (attempts >= maxAttempts) break;

      await this.sleep(this.delayForAttempt(attempts, outcome));
    }

    return { outcome, attempts };
  }

  private maxAttempts(): number {
    const configured = this.configService.get<number>(
      'ML_SHIPMENT_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
    );
    if (!Number.isFinite(configured) || configured < 1) {
      return DEFAULT_MAX_ATTEMPTS;
    }
    return Math.min(Math.floor(configured), HARD_ATTEMPT_CAP);
  }

  private delayForAttempt(
    attemptsSoFar: number,
    outcome: FetchOrderShipmentIdOutcome,
  ): number {
    const maxDelayMs = this.positiveNumber(
      'ML_SHIPMENT_RETRY_MAX_DELAY_MS',
      DEFAULT_MAX_DELAY_MS,
    );

    if (outcome.kind === 'rate_limited' && outcome.retryAfterMs !== null) {
      return Math.min(outcome.retryAfterMs, maxDelayMs);
    }

    const baseDelayMs = this.positiveNumber(
      'ML_SHIPMENT_RETRY_BASE_DELAY_MS',
      DEFAULT_BASE_DELAY_MS,
    );
    return Math.min(baseDelayMs * 2 ** (attemptsSoFar - 1), maxDelayMs);
  }

  private positiveNumber(key: string, fallback: number): number {
    const value = this.configService.get<number>(key, fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
