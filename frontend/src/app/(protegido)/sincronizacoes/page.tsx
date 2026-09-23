"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiFetchError,
  apiFetch,
  fetchAmazonSetupStatus,
  fetchBackfillStatus,
  fetchMarketplaceAccounts,
  fetchMlLogisticsReclassificationStatus,
  pauseBackfill,
  pauseMlLogisticsReclassification,
  resumeBackfill,
  resumeMlLogisticsReclassification,
  startAllMlLogisticsReclassification,
  startBackfill,
  startMlLogisticsReclassification,
  syncAmazonOrders,
  syncMercadoLivreOrders,
  syncShopeeOrders,
} from "@/lib/api";
import { SyncTable } from "@/components/SyncTable";
import { BackfillAccountPanel } from "@/components/BackfillAccountPanel";
import {
  ACTIVE_ML_RECLASSIFICATION_STATUSES,
  MlLogisticsReclassificationPanel,
} from "@/components/MlLogisticsReclassificationPanel";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { BackfillStatusDto } from "@/types/marketplace-backfill";
import type { MlLogisticsReclassificationAccountStatusDto } from "@/types/ml-logistics-reclassification";
import type { SyncRun } from "@/types/sync-run";

/** Estados do job em que ele ainda está "andando" (worker do backend). */
const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "RETRY_WAIT"];

// Acompanhamento leve (Fase 4, "Backfill durável") — o worker do BACKEND
// processa o job; esta página só faz polling do status para refletir o
// progresso na tela, nunca dirige o processamento (nenhum loop client-side
// chamando next-chunk). Fechar a aba nunca pausa o job.
const BACKFILL_POLL_INTERVAL_MS = 4000;

// Resiliência a cold start do Render/falha temporária de rede (fechamento
// frontend, correção Full ML) — intervalo normal do polling da
// reclassificação Full ML e sequência de backoff usada SÓ enquanto a última
// consulta falhou (rede/timeout/5xx). Nunca aplicado ao backfill acima —
// escopo estritamente da seção "Corrigir histórico Full do Mercado Livre".
const ML_RECLASS_POLL_INTERVAL_MS = 4000;
const ML_RECLASS_RETRY_BACKOFF_MS = [4000, 8000, 15000, 30000];

function isSyncRunArray(value: unknown): value is SyncRun[] {
  return Array.isArray(value);
}

// Mesmas mensagens do dashboard (ver dashboard/page.tsx) — nunca o código
// cru nem qualquer detalhe interno do backend.
const SYNC_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_CONNECTED:
    "Esta conta não está mais conectada. Reconecte-a em Integrações.",
  SYNC_ALREADY_RUNNING:
    "Já existe uma sincronização em andamento para esta conta.",
  TOKEN_EXPIRED: "O marketplace encerrou o acesso desta conta. Reconecte-a.",
  ACCOUNT_BUSY:
    "Esta conta está processando outra operação agora. Tente novamente em instantes.",
  PROVIDER_RATE_LIMITED:
    "O marketplace limitou as requisições no momento. Tente novamente em alguns minutos.",
  INVALID_PROVIDER_RESPONSE:
    "O marketplace retornou uma resposta inesperada. Tente novamente mais tarde.",
  PROVIDER_UNAVAILABLE:
    "O marketplace está indisponível no momento. Tente novamente mais tarde.",
  AMAZON_NOT_CONFIGURED: "Integração Amazon não configurada no servidor.",
  // Vocabulário fechado da Shopee (ver ShopeeOrdersSyncErrorCode no
  // backend) — códigos exatos devolvidos por
  // POST /marketplace-accounts/:id/shopee/sync-orders.
  NOT_CONNECTED: "Esta conta não está mais conectada. Reconecte-a em Integrações.",
  CONNECTION_BUSY:
    "Esta conta está processando outra operação agora. Tente novamente em instantes.",
  NOT_CONFIGURED: "Integração Shopee não configurada no servidor.",
  DATA_UNAVAILABLE:
    "O marketplace retornou uma resposta inesperada. Tente novamente mais tarde.",
  TEMPORARILY_UNAVAILABLE:
    "O marketplace está indisponível no momento. Tente novamente mais tarde.",
  SYNC_FAILED: "Falha ao consultar o marketplace. Tente novamente.",
};

type AccountOutcome = "PENDING" | "SKIPPED" | "SUCCESS" | "FAILED";

interface AccountSyncRow {
  accountId: string;
  marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
  label: string;
  outcome: AccountOutcome;
  reason: string | null;
}

function accountLabel(account: MarketplaceAccountDto): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.id.slice(0, 8)}`;
}

const OUTCOME_LABELS: Record<AccountOutcome, string> = {
  PENDING: "Aguardando",
  SKIPPED: "Ignorada",
  SUCCESS: "Sincronizada",
  FAILED: "Falhou",
};

export default function SincronizacoesPage() {
  const router = useRouter();
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [rows, setRows] = useState<AccountSyncRow[] | null>(null);
  const [rowsLoadError, setRowsLoadError] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const runningRef = useRef(false);

  // "Completar histórico" (Fase 4) — Mercado Livre e Shopee, nesta ordem;
  // Amazon fica de fora por design (sem backfill implementado ainda para
  // esse marketplace).
  const [backfillAccounts, setBackfillAccounts] = useState<
    Array<{ accountId: string; label: string }>
  >([]);
  const [backfillStatuses, setBackfillStatuses] = useState<
    Record<string, BackfillStatusDto | null>
  >({});
  const [backfillLoadErrors, setBackfillLoadErrors] = useState<
    Record<string, boolean>
  >({});
  const [backfillErrors, setBackfillErrors] = useState<
    Record<string, string | null>
  >({});
  // Ação (start/pause/resume) em voo por conta — só bloqueia clique duplo NA
  // MESMA conta; o worker do backend processa cada job de forma
  // independente, então nunca precisa de uma guarda "uma ação por vez"
  // global como o loop antigo tinha.
  const [backfillActionPending, setBackfillActionPending] = useState<
    Record<string, boolean>
  >({});
  const [runningAllBackfill, setRunningAllBackfill] = useState(false);
  const backfillActionPendingRef = useRef<Record<string, boolean>>({});

  // "Corrigir histórico Full do Mercado Livre" (correção da auditoria Full,
  // "Render free sem Shell") — seção SEPARADA de "Completar histórico":
  // nunca dispara `syncMercadoLivreOrders`/backfill, nunca compartilha
  // estado com eles. Só contas Mercado Livre conectadas.
  const [mlReclassAccounts, setMlReclassAccounts] = useState<
    Array<{ accountId: string; label: string }>
  >([]);
  const [mlReclassStatuses, setMlReclassStatuses] = useState<
    Record<string, MlLogisticsReclassificationAccountStatusDto | null>
  >({});
  const [mlReclassLoadErrors, setMlReclassLoadErrors] = useState<
    Record<string, boolean>
  >({});
  const [mlReclassErrors, setMlReclassErrors] = useState<
    Record<string, string | null>
  >({});
  const [mlReclassActionPending, setMlReclassActionPending] = useState<
    Record<string, boolean>
  >({});
  const [runningAllMlReclass, setRunningAllMlReclass] = useState(false);
  const mlReclassActionPendingRef = useRef<Record<string, boolean>>({});
  // Aviso NÃO bloqueante (fechamento frontend, resiliência a cold start) —
  // último status válido continua na tela; isto só soma um banner acima
  // dele. Nunca confundido com `mlReclassLoadErrors` (que só bloqueia a
  // primeira carga, quando ainda não existe nenhum status para mostrar).
  const [mlReclassConnectionError, setMlReclassConnectionError] =
    useState(false);
  const mlReclassPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mlReclassBackoffIndexRef = useRef(0);

  const loadBackfillStatus = useCallback(async (accountId: string) => {
    try {
      const status = await fetchBackfillStatus(accountId);
      setBackfillStatuses((prev) => ({ ...prev, [accountId]: status }));
      setBackfillLoadErrors((prev) => ({ ...prev, [accountId]: false }));
      return status;
    } catch {
      setBackfillLoadErrors((prev) => ({ ...prev, [accountId]: true }));
      return null;
    }
  }, []);

  const setActionPending = useCallback((accountId: string, pending: boolean) => {
    backfillActionPendingRef.current = {
      ...backfillActionPendingRef.current,
      [accountId]: pending,
    };
    setBackfillActionPending(backfillActionPendingRef.current);
  }, []);

  // Corpo comum de start/pause/resume: aplica a ação, guarda de reentrância
  // síncrona (lida/escrita na ref, nunca no estado — clique duplo muito
  // rápido não abre uma segunda janela antes do botão desabilitar
  // visualmente), erro isolado por conta (nunca derruba outra conta nem a
  // página).
  const runBackfillAction = useCallback(
    async (
      accountId: string,
      action: (id: string) => Promise<BackfillStatusDto>,
    ) => {
      if (backfillActionPendingRef.current[accountId]) return;
      setActionPending(accountId, true);
      setBackfillErrors((prev) => ({ ...prev, [accountId]: null }));
      try {
        const status = await action(accountId);
        setBackfillStatuses((prev) => ({ ...prev, [accountId]: status }));
        setBackfillLoadErrors((prev) => ({ ...prev, [accountId]: false }));
      } catch (error) {
        const message =
          error instanceof ApiFetchError
            ? error.message
            : "Não foi possível iniciar o histórico.";
        setBackfillErrors((prev) => ({ ...prev, [accountId]: message }));
      } finally {
        setActionPending(accountId, false);
      }
    },
    [setActionPending],
  );

  const handleStartBackfill = useCallback(
    (accountId: string) => runBackfillAction(accountId, startBackfill),
    [runBackfillAction],
  );
  const handlePauseBackfill = useCallback(
    (accountId: string) => runBackfillAction(accountId, pauseBackfill),
    [runBackfillAction],
  );
  const handleResumeBackfill = useCallback(
    (accountId: string) => runBackfillAction(accountId, resumeBackfill),
    [runBackfillAction],
  );

  // "Completar histórico de todas as lojas": só ENFILEIRA (chama `start`)
  // para as contas elegíveis (Mercado Livre + Shopee conectadas) — o worker
  // do backend decide como processar cada job de forma controlada. Nunca
  // executa chunks aqui; nunca deixa uma conta com erro bloquear a outra
  // (`Promise.allSettled`).
  async function handleCompleteAllHistory() {
    if (backfillAccounts.length === 0) return;
    setRunningAllBackfill(true);
    try {
      await Promise.allSettled(
        backfillAccounts.map((account) =>
          handleStartBackfill(account.accountId),
        ),
      );
    } finally {
      setRunningAllBackfill(false);
    }
  }

  // Polling leve só para acompanhamento (Fase 4, "Backfill durável") —
  // nunca dirige o processamento. Continua enquanto QUALQUER conta elegível
  // tiver um job em andamento; desmontar o componente só limpa o timer,
  // nunca pausa o job (ele roda no backend, independente da aba).
  const anyJobActive = backfillAccounts.some((account) => {
    const job = backfillStatuses[account.accountId]?.job;
    return job !== null && job !== undefined && ACTIVE_JOB_STATUSES.includes(job.status);
  });

  useEffect(() => {
    if (!anyJobActive || backfillAccounts.length === 0) return;
    const intervalId = setInterval(() => {
      backfillAccounts.forEach((account) => {
        void loadBackfillStatus(account.accountId);
      });
    }, BACKFILL_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [anyJobActive, backfillAccounts, loadBackfillStatus]);

  // Resultado tipado (fechamento frontend, resiliência a cold start) — o
  // chamador (polling) precisa distinguir sessão expirada (fluxo dedicado,
  // nunca retry infinito) de falha transitória (retry com backoff) sem
  // depender de checar `mlReclassLoadErrors` depois (que é só para a UI).
  type MlReclassLoadOutcome =
    | { outcome: "SUCCESS"; status: MlLogisticsReclassificationAccountStatusDto }
    | { outcome: "UNAUTHENTICATED" }
    | { outcome: "FAILURE" };

  const loadMlReclassStatus = useCallback(
    async (accountId: string): Promise<MlReclassLoadOutcome> => {
      try {
        const status = await fetchMlLogisticsReclassificationStatus(accountId);
        setMlReclassStatuses((prev) => ({ ...prev, [accountId]: status }));
        setMlReclassLoadErrors((prev) => ({ ...prev, [accountId]: false }));
        return { outcome: "SUCCESS", status };
      } catch (error) {
        if (error instanceof ApiFetchError && error.code === "UNAUTHENTICATED") {
          return { outcome: "UNAUTHENTICATED" };
        }
        setMlReclassLoadErrors((prev) => ({ ...prev, [accountId]: true }));
        return { outcome: "FAILURE" };
      }
    },
    [],
  );

  const setMlReclassActionPendingFor = useCallback(
    (accountId: string, pending: boolean) => {
      mlReclassActionPendingRef.current = {
        ...mlReclassActionPendingRef.current,
        [accountId]: pending,
      };
      setMlReclassActionPending(mlReclassActionPendingRef.current);
    },
    [],
  );

  const runMlReclassAction = useCallback(
    async (
      accountId: string,
      action: (
        id: string,
      ) => Promise<MlLogisticsReclassificationAccountStatusDto>,
    ) => {
      if (mlReclassActionPendingRef.current[accountId]) return;
      setMlReclassActionPendingFor(accountId, true);
      setMlReclassErrors((prev) => ({ ...prev, [accountId]: null }));
      try {
        const status = await action(accountId);
        setMlReclassStatuses((prev) => ({ ...prev, [accountId]: status }));
        setMlReclassLoadErrors((prev) => ({ ...prev, [accountId]: false }));
      } catch (error) {
        const message =
          error instanceof ApiFetchError
            ? error.message
            : "Não foi possível atualizar a correção de histórico Full.";
        setMlReclassErrors((prev) => ({ ...prev, [accountId]: message }));
      } finally {
        setMlReclassActionPendingFor(accountId, false);
      }
    },
    [setMlReclassActionPendingFor],
  );

  const handleStartMlReclass = useCallback(
    (accountId: string) =>
      runMlReclassAction(accountId, startMlLogisticsReclassification),
    [runMlReclassAction],
  );
  const handlePauseMlReclass = useCallback(
    (accountId: string) =>
      runMlReclassAction(accountId, pauseMlLogisticsReclassification),
    [runMlReclassAction],
  );
  const handleResumeMlReclass = useCallback(
    (accountId: string) =>
      runMlReclassAction(accountId, resumeMlLogisticsReclassification),
    [runMlReclassAction],
  );

  // "Corrigir histórico Full de todas as lojas": só ENFILEIRA (chama
  // `startAll`) — o worker do backend decide como processar cada conta.
  async function handleStartAllMlReclass() {
    if (mlReclassAccounts.length === 0) return;
    setRunningAllMlReclass(true);
    try {
      const statuses = await startAllMlLogisticsReclassification();
      setMlReclassStatuses((prev) => {
        const next = { ...prev };
        for (const status of statuses) next[status.accountId] = status;
        return next;
      });
    } catch {
      // Erro global não bloqueia o painel individual — cada conta continua
      // com seus próprios botões/erros.
    } finally {
      setRunningAllMlReclass(false);
    }
  }

  // Polling leve só para acompanhamento — nunca dirige o processamento (o
  // worker roda no backend). Continua enquanto QUALQUER conta tiver
  // RUNNING/WAITING_RETRY; fechar a aba nunca pausa o job.
  const anyMlReclassActive = mlReclassAccounts.some((account) => {
    const status = mlReclassStatuses[account.accountId];
    return (
      status !== null &&
      status !== undefined &&
      ACTIVE_ML_RECLASSIFICATION_STATUSES.includes(status.status)
    );
  });

  const clearMlReclassPollTimeout = useCallback(() => {
    if (mlReclassPollTimeoutRef.current !== null) {
      clearTimeout(mlReclassPollTimeoutRef.current);
      mlReclassPollTimeoutRef.current = null;
    }
  }, []);

  /**
   * Um ciclo de polling da reclassificação Full ML (fechamento frontend,
   * resiliência a cold start do Render) — SEMPRE consulta todas as contas e
   * decide sozinho se/quando reagenda o próximo ciclo, em vez de depender de
   * um `setInterval` fixo:
   * - 401 em qualquer conta: sessão expirada de verdade — nunca fica
   *   tentando de novo, segue o mesmo fluxo de `useAuthGuard` (`/login`).
   * - Falha de rede/timeout/5xx em qualquer conta: último status válido
   *   permanece na tela (nunca limpo aqui), liga o aviso não bloqueante e
   *   reagenda com backoff limitado (4s/8s/15s, teto 30s) — nunca dispara
   *   start/resume, só relê o status.
   * - Sucesso completo: desliga o aviso, zera o backoff; só reagenda se
   *   ainda houver conta RUNNING/WAITING_RETRY (senão, o polling encerra
   *   sozinho, igual ao comportamento anterior baseado em `anyMlReclassActive`).
   * Único ponto que grava `mlReclassPollTimeoutRef` — nunca dois timers
   * concorrentes, mesmo entre reagendamentos recursivos e o efeito de
   * `visibilitychange`/foco abaixo (que sempre limpa antes de chamar de
   * novo).
   */
  // Indireção via ref (nunca a `const` referenciando a si mesma dentro do
  // próprio corpo) — só assim o reagendamento recursivo abaixo sempre chama
  // a versão MAIS RECENTE da função, sem o lint de hooks acusar uma
  // referência insegura a uma variável ainda em inicialização.
  const pollMlReclassStatusesRef = useRef<() => Promise<void>>(async () => {});

  const pollMlReclassStatuses = useCallback(async () => {
    if (mlReclassAccounts.length === 0) return;
    const results = await Promise.all(
      mlReclassAccounts.map((account) => loadMlReclassStatus(account.accountId)),
    );

    if (results.some((result) => result.outcome === "UNAUTHENTICATED")) {
      router.replace("/login");
      return;
    }

    const anyFailure = results.some((result) => result.outcome === "FAILURE");
    setMlReclassConnectionError(anyFailure);

    if (anyFailure) {
      const index = mlReclassBackoffIndexRef.current;
      const delay =
        ML_RECLASS_RETRY_BACKOFF_MS[
          Math.min(index, ML_RECLASS_RETRY_BACKOFF_MS.length - 1)
        ];
      mlReclassBackoffIndexRef.current = Math.min(
        index + 1,
        ML_RECLASS_RETRY_BACKOFF_MS.length - 1,
      );
      mlReclassPollTimeoutRef.current = setTimeout(
        () => void pollMlReclassStatusesRef.current(),
        delay,
      );
      return;
    }

    mlReclassBackoffIndexRef.current = 0;
    const stillActive = results.some(
      (result) =>
        result.outcome === "SUCCESS" &&
        ACTIVE_ML_RECLASSIFICATION_STATUSES.includes(result.status.status),
    );
    if (!stillActive) return;

    mlReclassPollTimeoutRef.current = setTimeout(
      () => void pollMlReclassStatusesRef.current(),
      ML_RECLASS_POLL_INTERVAL_MS,
    );
  }, [mlReclassAccounts, loadMlReclassStatus, router]);

  useEffect(() => {
    pollMlReclassStatusesRef.current = pollMlReclassStatuses;
  }, [pollMlReclassStatuses]);

  useEffect(() => {
    if (!anyMlReclassActive || mlReclassAccounts.length === 0) return;
    mlReclassBackoffIndexRef.current = 0;
    mlReclassPollTimeoutRef.current = setTimeout(
      () => void pollMlReclassStatuses(),
      ML_RECLASS_POLL_INTERVAL_MS,
    );
    return clearMlReclassPollTimeout;
  }, [
    anyMlReclassActive,
    mlReclassAccounts,
    pollMlReclassStatuses,
    clearMlReclassPollTimeout,
  ]);

  // Ao voltar para a aba ou focar a janela, consulta IMEDIATAMENTE em vez de
  // esperar o próximo passo do backoff/intervalo — cancela qualquer timer
  // pendente antes, para nunca deixar dois em voo ao mesmo tempo.
  useEffect(() => {
    if (mlReclassAccounts.length === 0) return;

    function pollNow() {
      if (document.visibilityState !== "visible") return;
      clearMlReclassPollTimeout();
      void pollMlReclassStatuses();
    }

    document.addEventListener("visibilitychange", pollNow);
    window.addEventListener("focus", pollNow);
    return () => {
      document.removeEventListener("visibilitychange", pollNow);
      window.removeEventListener("focus", pollNow);
    };
  }, [mlReclassAccounts, pollMlReclassStatuses, clearMlReclassPollTimeout]);

  const loadSyncRuns = useCallback(async () => {
    try {
      const response = await apiFetch("/sync-runs", { method: "GET" });
      if (!response.ok) {
        setSyncRuns([]);
        return;
      }
      const data: unknown = await response.json();
      setSyncRuns(isSyncRunArray(data) ? data : []);
    } catch {
      setSyncRuns([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const [accounts, amazonStatus] = await Promise.all([
        fetchMarketplaceAccounts(),
        fetchAmazonSetupStatus(),
      ]);

      const next: AccountSyncRow[] = [];
      for (const account of accounts) {
        if (account.marketplace !== "MERCADO_LIVRE") continue;
        const eligible = account.status === "CONNECTED";
        next.push({
          accountId: account.id,
          marketplace: "MERCADO_LIVRE",
          label: `Mercado Livre — ${accountLabel(account)}`,
          outcome: eligible ? "PENDING" : "SKIPPED",
          reason: eligible ? null : "Conta não conectada ao Mercado Livre.",
        });
      }
      for (const account of accounts) {
        if (account.marketplace !== "SHOPEE") continue;
        const eligible = account.status === "CONNECTED";
        next.push({
          accountId: account.id,
          marketplace: "SHOPEE",
          label: `Shopee — ${accountLabel(account)}`,
          outcome: eligible ? "PENDING" : "SKIPPED",
          reason: eligible ? null : "Conta não conectada à Shopee.",
        });
      }
      for (const account of amazonStatus.accounts) {
        const eligible =
          account.status === "CONNECTED" && amazonStatus.applicationConfigured;
        next.push({
          accountId: account.id,
          marketplace: "AMAZON",
          label: `Amazon — ${accountLabel(account)}`,
          outcome: eligible ? "PENDING" : "SKIPPED",
          reason: !amazonStatus.applicationConfigured
            ? "Integração Amazon não configurada no servidor."
            : eligible
              ? null
              : "Conta não conectada à Amazon.",
        });
      }

      setRows(next);
      setRowsLoadError(false);

      // "Completar histórico" (Fase 4): Mercado Livre primeiro, depois
      // Shopee — mesma ordem em que aparecem na lista de sincronização
      // acima. Só contas CONNECTED entram; Amazon fica de fora (sem
      // backfill implementado ainda para esse marketplace).
      const connectedMl = accounts.filter(
        (item) =>
          item.marketplace === "MERCADO_LIVRE" && item.status === "CONNECTED",
      );
      const connectedShopee = accounts.filter(
        (item) => item.marketplace === "SHOPEE" && item.status === "CONNECTED",
      );
      // Rótulo do Mercado Livre permanece igual ao de sempre (sem prefixo de
      // marketplace) — preserva integralmente os testes/UX já existentes do
      // backfill ML. Shopee ganha o prefixo "Shopee — " porque, ao contrário
      // do ML (cujo apelido já costuma dizer "Mercado Livre ..."), o apelido
      // Shopee não se autoidentifica, e agora os dois aparecem juntos nesta
      // lista.
      const nextBackfillAccounts = [
        ...connectedMl.map((item) => ({
          accountId: item.id,
          label: accountLabel(item),
        })),
        ...connectedShopee.map((item) => ({
          accountId: item.id,
          label: `Shopee — ${accountLabel(item)}`,
        })),
      ];
      setBackfillAccounts(nextBackfillAccounts);
      await Promise.all(
        nextBackfillAccounts.map((item) => loadBackfillStatus(item.accountId)),
      );

      // "Corrigir histórico Full do Mercado Livre": só contas ML conectadas
      // (o recurso não existe para Shopee/Amazon) — rótulo sem prefixo,
      // igual ao painel de backfill do ML.
      const nextMlReclassAccounts = connectedMl.map((item) => ({
        accountId: item.id,
        label: accountLabel(item),
      }));
      setMlReclassAccounts(nextMlReclassAccounts);
      await Promise.all(
        nextMlReclassAccounts.map((item) => loadMlReclassStatus(item.accountId)),
      );
    } catch {
      setRowsLoadError(true);
    }
  }, [loadBackfillStatus, loadMlReclassStatus]);

  useEffect(() => {
    void (async () => {
      await loadSyncRuns();
    })();
  }, [loadSyncRuns]);

  useEffect(() => {
    void (async () => {
      await loadAccounts();
    })();
  }, [loadAccounts]);

  const pendingCount = rows?.filter((row) => row.outcome === "PENDING").length ?? 0;

  async function handleSyncAll() {
    if (!rows || runningRef.current || pendingCount === 0) return;
    runningRef.current = true;
    setRunning(true);

    const next = [...rows];
    const pendingIndexes = next.reduce<number[]>((acc, row, index) => {
      if (row.outcome === "PENDING") acc.push(index);
      return acc;
    }, []);

    for (let step = 0; step < pendingIndexes.length; step += 1) {
      const index = pendingIndexes[step];
      setProgress({ done: step, total: pendingIndexes.length });
      const row = next[index];
      try {
        if (row.marketplace === "MERCADO_LIVRE") {
          await syncMercadoLivreOrders(row.accountId);
        } else if (row.marketplace === "SHOPEE") {
          await syncShopeeOrders(row.accountId);
        } else {
          await syncAmazonOrders(row.accountId);
        }
        next[index] = { ...row, outcome: "SUCCESS", reason: null };
      } catch (error) {
        const message =
          error instanceof ApiFetchError
            ? (error.code && SYNC_ERROR_MESSAGES[error.code]) || error.message
            : "Não foi possível sincronizar agora.";
        next[index] = { ...row, outcome: "FAILED", reason: message };
      }
      setRows([...next]);
    }

    setProgress({ done: pendingIndexes.length, total: pendingIndexes.length });
    runningRef.current = false;
    setRunning(false);
    // Painel consolidado só é atualizado ao final do lote inteiro — nunca
    // durante, e nunca por conta individual.
    await loadSyncRuns();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sincronizações
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          Sincronize todas as lojas de uma vez ou acompanhe o histórico de
          execuções.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Sincronizar todas as lojas</h2>
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            disabled={running || !rows || pendingCount === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
          >
            {running
              ? `Sincronizando ${Math.min(
                  (progress?.done ?? 0) + 1,
                  progress?.total ?? 1,
                )} de ${progress?.total ?? 0}`
              : "Sincronizar todas as lojas"}
          </button>
        </div>

        {rowsLoadError ? (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
          >
            Não foi possível carregar as contas de marketplace. Tente
            novamente mais tarde.
          </div>
        ) : !rows ? (
          <p className="text-sm text-foreground/60">Carregando contas...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-foreground/60">
            Nenhuma conta de marketplace cadastrada ainda.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {rows.map((row) => (
              <li
                key={row.accountId}
                data-testid={`sync-all-row-${row.accountId}`}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span className="font-medium">{row.label}</span>
                <span className="flex items-center gap-2 text-foreground/70">
                  <span
                    className={
                      row.outcome === "SUCCESS"
                        ? "text-green-700"
                        : row.outcome === "FAILED"
                          ? "text-red-700"
                          : row.outcome === "SKIPPED"
                            ? "text-foreground/50"
                            : "text-foreground/70"
                    }
                  >
                    {OUTCOME_LABELS[row.outcome]}
                  </span>
                  {row.reason ? (
                    <span className="text-xs text-foreground/50">
                      — {row.reason}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Completar histórico</h2>
            <p className="mt-1 text-sm text-foreground/60">
              Busca vendas antigas até o primeiro período disponível de cada
              conta, nos marketplaces compatíveis (Mercado Livre e Shopee) —
              diferente de &quot;Sincronizar agora&quot;, que atualiza somente
              vendas recentes e alterações.
            </p>
          </div>
          {backfillAccounts.length > 1 ? (
            <button
              type="button"
              onClick={() => void handleCompleteAllHistory()}
              disabled={runningAllBackfill}
              className="rounded-md border border-brand bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runningAllBackfill
                ? "Enfileirando..."
                : "Completar histórico de todas as lojas"}
            </button>
          ) : null}
        </div>

        {backfillAccounts.length === 0 ? (
          <p className="text-sm text-foreground/60">
            Nenhuma conta do Mercado Livre ou da Shopee conectada ainda.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {backfillAccounts.map((backfillAccount) => (
              <BackfillAccountPanel
                key={backfillAccount.accountId}
                label={backfillAccount.label}
                status={backfillStatuses[backfillAccount.accountId] ?? null}
                loadError={
                  backfillLoadErrors[backfillAccount.accountId] ?? false
                }
                actionPending={
                  backfillActionPending[backfillAccount.accountId] ?? false
                }
                disabled={runningAllBackfill}
                errorMessage={backfillErrors[backfillAccount.accountId] ?? null}
                onStart={() =>
                  void handleStartBackfill(backfillAccount.accountId)
                }
                onPause={() =>
                  void handlePauseBackfill(backfillAccount.accountId)
                }
                onResume={() =>
                  void handleResumeBackfill(backfillAccount.accountId)
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              Corrigir histórico Full do Mercado Livre
            </h2>
            <p className="mt-1 text-sm text-foreground/60">
              Classifica retroativamente pedidos com modalidade logística
              ainda não identificada (UNKNOWN) — diferente de &quot;Completar
              histórico&quot;, nunca busca vendas novas nem dispara uma
              sincronização; os pedidos já existem, só a classificação Full é
              corrigida.
            </p>
          </div>
          {mlReclassAccounts.length > 1 ? (
            <button
              type="button"
              onClick={() => void handleStartAllMlReclass()}
              disabled={runningAllMlReclass}
              className="rounded-md border border-brand bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runningAllMlReclass
                ? "Iniciando..."
                : "Corrigir histórico Full de todas as lojas"}
            </button>
          ) : null}
        </div>

        {mlReclassAccounts.length === 0 ? (
          <p className="text-sm text-foreground/60">
            Nenhuma conta do Mercado Livre conectada ainda.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {mlReclassConnectionError ? (
              <p
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700"
              >
                Conexão temporariamente indisponível. Tentando novamente...
              </p>
            ) : null}
            {mlReclassAccounts.map((mlReclassAccount) => (
              <MlLogisticsReclassificationPanel
                key={mlReclassAccount.accountId}
                label={mlReclassAccount.label}
                status={mlReclassStatuses[mlReclassAccount.accountId] ?? null}
                // Só bloqueia com "não foi possível carregar" quando NUNCA
                // houve um status válido para esta conta — se já existe um
                // (mesmo desatualizado), ele continua na tela e o aviso vira
                // o banner não bloqueante acima (fechamento frontend,
                // resiliência a cold start/polling instável).
                loadError={
                  (mlReclassLoadErrors[mlReclassAccount.accountId] ?? false) &&
                  !mlReclassStatuses[mlReclassAccount.accountId]
                }
                actionPending={
                  mlReclassActionPending[mlReclassAccount.accountId] ?? false
                }
                disabled={runningAllMlReclass}
                errorMessage={
                  mlReclassErrors[mlReclassAccount.accountId] ?? null
                }
                onStart={() =>
                  void handleStartMlReclass(mlReclassAccount.accountId)
                }
                onPause={() =>
                  void handlePauseMlReclass(mlReclassAccount.accountId)
                }
                onResume={() =>
                  void handleResumeMlReclass(mlReclassAccount.accountId)
                }
              />
            ))}
          </div>
        )}
      </section>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label="Carregando sincronizações"
          />
          <p className="text-sm text-foreground/60">
            Carregando sincronizações...
          </p>
        </div>
      ) : (
        <SyncTable syncRuns={syncRuns} />
      )}
    </div>
  );
}
