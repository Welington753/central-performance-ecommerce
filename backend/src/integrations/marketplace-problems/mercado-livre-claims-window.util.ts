import type { ClaimsHttpOutcome } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import {
  classifySearchOutcome,
  type SearchOutcomeClassification,
} from './mercado-livre-claim-enrichment.util';

/** Sobreposição aplicada em toda divisão/continuação de janela (item 4 do
 * plano CP2-B) — suposição conservadora sobre a precisão de milissegundo de
 * `after`/`before` do Mercado Livre, não confirmada por chamada real. */
export const WINDOW_SPLIT_OVERLAP_MS = 1000;

const PAGE_LIMIT = 100;
const MAX_OFFSET_PLUS_LIMIT = 10000;

export interface WindowRange {
  from: Date;
  to: Date;
}

export interface SearchPageResult {
  ids: string[];
  total: number;
}

export type FetchWindowPage = (
  range: WindowRange,
  offset: number,
  limit: number,
) => Promise<ClaimsHttpOutcome<SearchPageResult>>;

export type CommitSafeSubWindowResult =
  | { kind: 'committed'; range: WindowRange; ids: string[]; callsUsed: number }
  | { kind: 'safety_limit_reached'; range: WindowRange; callsUsed: number }
  | { kind: 'claim_budget_exhausted'; callsUsed: number }
  | { kind: 'call_budget_exhausted'; callsUsed: number }
  | {
      kind: 'search_error';
      classification: SearchOutcomeClassification;
      callsUsed: number;
    };

/**
 * Encolhe `window` até uma sub-janela que cabe INTEIRA no orçamento de
 * claims E na reserva de chamadas (páginas de busca restantes + 1
 * `fetchClaim` por candidato deduplicado — regra 1 do ajuste final do CP2-B)
 * antes de paginar por completo; nunca commita uma sub-janela parcial. Ao
 * dividir, sempre tenta a metade ESQUERDA primeiro (progresso cronológico
 * determinístico), com `WINDOW_SPLIT_OVERLAP_MS` de sobreposição para nunca
 * perder um claim exatamente no ponto de divisão.
 */
export async function commitSafeSubWindow(
  fetchPage: FetchWindowPage,
  window: WindowRange,
  remainingClaimBudget: number,
  remainingHttpCallBudget: number,
  minSplitMs: number,
): Promise<CommitSafeSubWindowResult> {
  let candidate = window;
  let remainingCalls = remainingHttpCallBudget;
  let callsUsed = 0;

  for (;;) {
    if (remainingCalls < 1) {
      return { kind: 'call_budget_exhausted', callsUsed };
    }

    const probe = await fetchPage(candidate, 0, PAGE_LIMIT);
    remainingCalls -= 1;
    callsUsed += 1;

    if (probe.kind !== 'success') {
      return {
        kind: 'search_error',
        classification: classifySearchOutcome(probe),
        callsUsed,
      };
    }

    const total = probe.data.total;
    const pagesNeeded = total > 0 ? Math.ceil(total / PAGE_LIMIT) : 0;
    const additionalSearchCalls = Math.max(pagesNeeded - 1, 0);
    const fitsCap = total <= MAX_OFFSET_PLUS_LIMIT - PAGE_LIMIT;
    const fitsClaimBudget = total <= remainingClaimBudget;
    const fitsCallReservation = additionalSearchCalls + total <= remainingCalls;

    if (fitsCap && fitsClaimBudget && fitsCallReservation) {
      const ids = new Set<string>(probe.data.ids);
      let offset = PAGE_LIMIT;
      while (offset < total) {
        const page = await fetchPage(candidate, offset, PAGE_LIMIT);
        remainingCalls -= 1;
        callsUsed += 1;
        if (page.kind !== 'success') {
          return {
            kind: 'search_error',
            classification: classifySearchOutcome(page),
            callsUsed,
          };
        }
        for (const id of page.data.ids) ids.add(id);
        offset += PAGE_LIMIT;
      }
      // Confirmação defensiva (sempre verdadeira por construção: a reserva
      // acima já garantiu `total` chamadas de fetchClaim disponíveis após a
      // paginação, e `ids.size <= total` por causa da deduplicação).
      if (remainingCalls < ids.size) {
        return { kind: 'call_budget_exhausted', callsUsed };
      }
      return { kind: 'committed', range: candidate, ids: [...ids], callsUsed };
    }

    const windowSizeMs = candidate.to.getTime() - candidate.from.getTime();
    if (windowSizeMs <= minSplitMs) {
      if (!fitsCap) {
        return { kind: 'safety_limit_reached', range: candidate, callsUsed };
      }
      if (!fitsClaimBudget) {
        return { kind: 'claim_budget_exhausted', callsUsed };
      }
      return { kind: 'call_budget_exhausted', callsUsed };
    }

    const midMs = candidate.from.getTime() + windowSizeMs / 2;
    candidate = {
      from: candidate.from,
      to: new Date(midMs + WINDOW_SPLIT_OVERLAP_MS),
    };
  }
}

/**
 * Próxima fronteira ao avançar (só chamada pelo serviço quando TODOS os
 * cores da janela commitada foram cobertos, ver item 3 do plano) — recua
 * `WINDOW_SPLIT_OVERLAP_MS` a partir do fim da janela commitada para que um
 * claim exatamente na fronteira ENTRE duas execuções não desapareça. Clamp
 * defensivo: nunca devolve um valor `<= originalFrom` (garante avanço real),
 * mesmo que a validação de entrada (`minSplitMs > 2*overlap`, no serviço
 * público) já deva impedir esse caso.
 */
export function computeAdvancedWindowFrom(
  committedRangeTo: Date,
  originalFrom: Date,
): string {
  const candidateMs = committedRangeTo.getTime() - WINDOW_SPLIT_OVERLAP_MS;
  return candidateMs > originalFrom.getTime()
    ? new Date(candidateMs).toISOString()
    : committedRangeTo.toISOString();
}
