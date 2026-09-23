import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { fetchScopeOutcome } from "@/hooks/analytics-scope/fetch";
import type { ScopeSlotState } from "@/hooks/analytics-scope/key";
import type {
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

/**
 * Carrega um slot de escopo (busca + geração monotônica de requisição +
 * atualização de estado) — mesmo comportamento usado tanto pelo slot "sem
 * conta" quanto pelo slot "com conta" do hook de orquestração, só extraído
 * para não duplicar o corpo entre os dois.
 */
export async function loadSlotData(params: {
  key: string;
  seqRef: MutableRefObject<number>;
  setSlot: Dispatch<SetStateAction<ScopeSlotState>>;
  from: string | null;
  to: string | null;
  marketplace: MarketplaceFilter;
  accountId?: string;
  allTime: boolean;
  logisticsScope: LogisticsScopeValue;
}): Promise<void> {
  const { key, seqRef, setSlot } = params;
  const seq = ++seqRef.current;
  setSlot((prev) => ({ ...prev, pendingKey: key }));

  const outcome = await fetchScopeOutcome({
    from: params.from,
    to: params.to,
    marketplace: params.marketplace,
    accountId: params.accountId,
    allTime: params.allTime,
    logisticsScope: params.logisticsScope,
  });

  // Uma requisição mais nova já começou enquanto esta estava em voo — esta
  // resposta chegou tarde demais e nunca pode substituir o escopo atual
  // (nem sucesso, nem erro, nem a chave de carregamento).
  if (seqRef.current !== seq) return;

  if ("data" in outcome) {
    setSlot((prev) => ({
      ...prev,
      data: outcome.data,
      dataKey: key,
      dataLoadedAt: new Date().toISOString(),
      lastRequestKey: key,
      lastRequestFailed: false,
      lastRequestAuthError: false,
      pendingKey: null,
    }));
  } else {
    // Nunca zera `data`/`dataKey` já carregados com sucesso — uma recarga
    // que falha deve manter o último retrato bom na tela com um aviso
    // pontual, nunca apagar painéis/filtros/controles por trás de uma tela
    // de erro em branco. 401/403 é a exceção: nunca deve parecer que a
    // sessão continua válida.
    setSlot((prev) => ({
      ...prev,
      lastRequestKey: key,
      lastRequestFailed: true,
      lastRequestAuthError: outcome.authError,
      pendingKey: null,
    }));
  }
}
