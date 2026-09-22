import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MercadoLivreShipmentClient,
  type FetchShipmentOutcome,
} from './mercado-livre-shipment.client';

/**
 * Função de espera injetável — existe para que os testes provem o
 * comportamento de retry SEM nenhum atraso real (e sem `jest.useFakeTimers`
 * espalhado pelas suítes). A implementação padrão de produção é registrada
 * no módulo (`mercado-livre-orders.module.ts`).
 */
export const ML_SHIPMENT_RETRY_SLEEP = Symbol('ML_SHIPMENT_RETRY_SLEEP');

export type ShipmentRetrySleep = (delayMs: number) => Promise<void>;

/**
 * Resultado FINAL de uma consulta de envio, já com o retry consumido.
 * `attempts` conta todas as tentativas HTTP realizadas (sempre `>= 1`) e
 * existe exclusivamente para o diagnóstico sanitizado por execução — nunca
 * carrega identificador de envio, de pedido ou de comprador.
 */
export interface ShipmentLookupResult {
  outcome: FetchShipmentOutcome;
  attempts: number;
}

/**
 * Apenas estes dois resultados são TRANSITÓRIOS e valem uma nova tentativa:
 * limite de taxa e indisponibilidade do provedor (inclui timeout/erro de
 * rede e 5xx — ver `mercado-livre-shipment.client.ts`).
 *
 * `not_found` (404), `unauthorized` (401/403) e `invalid_response` NUNCA são
 * repetidos: a resposta é determinística e repetir só queima cota da API.
 * `success` obviamente também não.
 */
const RETRYABLE_OUTCOME_KINDS: ReadonlySet<FetchShipmentOutcome['kind']> =
  new Set(['rate_limited', 'provider_unavailable']);

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 5000;

/**
 * Teto absoluto de tentativas, independente do que o ambiente configure —
 * nem uma variável de ambiente errada pode transformar a classificação
 * logística numa espera sem fim.
 */
const HARD_ATTEMPT_CAP = 6;

/**
 * Consulta de envio COM retry limitado (correção da auditoria Full): antes,
 * um único 429/timeout deixava o pedido `UNKNOWN` em silêncio e sem segunda
 * chance. O cliente HTTP (`MercadoLivreShipmentClient`) continua sendo a
 * primitiva de UMA tentativa — toda a política de repetição vive aqui.
 *
 * Garantias:
 * - nunca repete 401/403/404/resposta inválida;
 * - respeita `Retry-After` quando o provedor o envia (já limitado pelo
 *   cliente), caindo no backoff exponencial próprio quando ausente;
 * - número de tentativas limitado por configuração E por um teto absoluto —
 *   espera infinita é impossível;
 * - falha após o último retry NUNCA vira `SELLER_FULFILLED`: o chamador
 *   continua gravando `UNKNOWN` (ver `mercado-livre-logistics.util.ts`).
 */
@Injectable()
export class MercadoLivreShipmentLookupService {
  constructor(
    private readonly shipmentClient: MercadoLivreShipmentClient,
    private readonly configService: ConfigService,
    @Inject(ML_SHIPMENT_RETRY_SLEEP)
    private readonly sleep: ShipmentRetrySleep,
  ) {}

  async lookup(
    accessToken: string,
    shipmentId: string,
  ): Promise<ShipmentLookupResult> {
    const maxAttempts = this.maxAttempts();
    let attempts = 0;
    let outcome: FetchShipmentOutcome = { kind: 'provider_unavailable' };

    while (attempts < maxAttempts) {
      outcome = await this.shipmentClient.fetchShipment(
        accessToken,
        shipmentId,
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

  /**
   * `Retry-After` do provedor tem precedência; sem ele, backoff exponencial
   * `base * 2^(n-1)` limitado por `ML_SHIPMENT_RETRY_MAX_DELAY_MS`. O teto
   * também se aplica ao `Retry-After` recebido, então nenhuma espera pode
   * crescer indefinidamente.
   */
  private delayForAttempt(
    attemptsSoFar: number,
    outcome: FetchShipmentOutcome,
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
