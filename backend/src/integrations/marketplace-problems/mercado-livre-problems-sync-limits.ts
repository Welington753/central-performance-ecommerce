import type { ConfigService } from '@nestjs/config';
import { assertPositiveIntegerSync } from './mercado-livre-claim-enrichment.util';
import { WINDOW_SPLIT_OVERLAP_MS } from './mercado-livre-claims-window.util';

const DEFAULT_MAX_CLAIMS = 200;
const HARD_MAX_CLAIMS = 2000;
const DEFAULT_MAX_HTTP_CALLS = 800;
const HARD_MAX_HTTP_CALLS = 5000;
// Bem acima de 2 * WINDOW_SPLIT_OVERLAP_MS (2000ms) — a recursão de divisão
// de `commitSafeSubWindow` converge para esse ponto fixo, nunca abaixo dele.
const DEFAULT_MIN_SPLIT_MS = 5 * 60 * 1000;
const DEFAULT_REASON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SEARCH_PAGE_LIMIT = 100;
export const MAX_OFFSET_PLUS_LIMIT = 10000;

/**
 * Leitura e validação de limites/config do sync. Lê o `ConfigService` a cada
 * chamada (sem cache) — mesma semântica de leitura preguiçosa de antes.
 */
export class ProblemsSyncLimits {
  constructor(private readonly configService: ConfigService) {}

  get minSplitMs(): number {
    const configured = this.configService.get<number>(
      'PROBLEMS_SYNC_MIN_WINDOW_SPLIT_MS',
      DEFAULT_MIN_SPLIT_MS,
    );
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_MIN_SPLIT_MS;
  }

  get reasonCacheTtlMs(): number {
    const configured = this.configService.get<number>(
      'PROBLEMS_SYNC_REASON_CACHE_TTL_MS',
      DEFAULT_REASON_CACHE_TTL_MS,
    );
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_REASON_CACHE_TTL_MS;
  }

  resolveMaxClaims(value: number | undefined): number {
    if (value === undefined) {
      return this.configService.get<number>(
        'PROBLEMS_SYNC_MAX_CLAIMS_PER_RUN',
        DEFAULT_MAX_CLAIMS,
      );
    }
    assertPositiveIntegerSync(value, 'budget.maxClaims');
    return Math.min(value, HARD_MAX_CLAIMS);
  }

  resolveMaxHttpCalls(value: number | undefined): number {
    if (value === undefined) {
      return this.configService.get<number>(
        'PROBLEMS_SYNC_MAX_HTTP_CALLS_PER_RUN',
        DEFAULT_MAX_HTTP_CALLS,
      );
    }
    assertPositiveIntegerSync(value, 'budget.maxHttpCalls');
    return Math.min(value, HARD_MAX_HTTP_CALLS);
  }

  assertMinSplitInvariant(): void {
    if (this.minSplitMs <= 2 * WINDOW_SPLIT_OVERLAP_MS) {
      throw new Error(
        'minSplitMs precisa ser maior que 2 * WINDOW_SPLIT_OVERLAP_MS.',
      );
    }
  }
}
