"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AmazonConnectionModal,
  type AmazonConnectionModalMode,
} from "@/components/AmazonConnectionModal";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import {
  connectMercadoLivre,
  createMarketplaceAccount,
  fetchAmazonSetupStatus,
  fetchMarketplaceAccounts,
  recoverMercadoLivreConnection,
  redirectTo,
  renameMarketplaceAccount,
  syncAmazonOrders,
} from "@/lib/api";
import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";

const AMAZON_STATUS_LABELS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Aguardando credenciais",
  CONNECTED: "Conectado",
  TOKEN_EXPIRED: "Erro — reconexão necessária",
  ERROR: "Erro — reconexão necessária",
};

const AMAZON_STATUS_DESCRIPTIONS: Record<
  MarketplaceAccountDto["status"],
  string
> = {
  DISCONNECTED:
    "Conta criada, aguardando Selling Partner ID e refresh token.",
  CONNECTED: "Conta conectada e pronta para sincronizar.",
  TOKEN_EXPIRED:
    "Houve um problema com esta conta. Reconfigure para tentar novamente.",
  ERROR: "Houve um problema com esta conta. Reconfigure para tentar novamente.",
};

// Mensagens públicas FIXAS (design §7): nunca derivadas de failureCode ou
// errorSummary internos, que o DTO do backend (Task 14) nem expõe.
const REASON_MESSAGES: Record<string, string> = {
  OAUTH_CALLBACK_INVALID:
    "O link de retorno do Mercado Livre é inválido ou expirou. Tente conectar novamente.",
  AUTHORIZATION_DENIED: "A autorização foi cancelada no Mercado Livre.",
  IDENTITY_MISMATCH:
    "A conta autorizada no Mercado Livre não corresponde à conta esperada.",
  ACCOUNT_ALREADY_CONNECTED:
    "Esta conta do Mercado Livre já está conectada em outro registro.",
  TRY_AGAIN_LATER:
    "Não foi possível concluir a conexão agora. Tente novamente em instantes.",
};

const STATUS_LABELS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Não conectado",
  CONNECTED: "Conectado",
  TOKEN_EXPIRED: "Token expirado — reconexão necessária",
  ERROR: "Erro — reconexão necessária",
};

const STATUS_DESCRIPTIONS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Conexão OAuth segura com o Mercado Livre.",
  CONNECTED: "Conta conectada e pronta para uso.",
  TOKEN_EXPIRED: "A sessão expirou. Reconecte para continuar.",
  ERROR: "Houve um problema com esta conta. Reconecte para tentar novamente.",
};

function accountLabel(account: MarketplaceAccountDto): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.id.slice(0, 8)}`;
}

// Correção de resiliência OAuth (Fase 4): uma falha RECUPERÁVEL de
// renovação nunca mostra "Reconectar" como ação principal — só uma falha
// confirmada (invalid_grant/TOKEN_EXPIRED) ou qualquer outro ERROR sem
// recoveryHint específico pede reconexão de verdade.
function mlStatusLabel(account: MarketplaceAccountDto): string {
  if (account.recoveryHint === "TEMPORARY_RETRY") {
    return "Conexão temporariamente indisponível";
  }
  if (account.recoveryHint === "CONFIGURATION_ERROR") {
    return "Configuração da aplicação inválida";
  }
  return STATUS_LABELS[account.status];
}

function mlStatusDescription(account: MarketplaceAccountDto): string {
  if (account.recoveryHint === "TEMPORARY_RETRY") {
    const retryLabel = account.nextRetryAt
      ? formatDateTimeSaoPaulo(account.nextRetryAt)
      : null;
    return retryLabel
      ? `Nova tentativa automática em ${retryLabel}.`
      : "Nova tentativa automática em breve.";
  }
  if (account.recoveryHint === "CONFIGURATION_ERROR") {
    return "Verifique as credenciais da aplicação Mercado Livre no servidor. Reconectar esta conta não resolve.";
  }
  return STATUS_DESCRIPTIONS[account.status];
}

function IntegracoesContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [connectingAccountIds, setConnectingAccountIds] = useState<
    Set<string>
  >(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  // Trava síncrona (useRef), não apenas o `useState` acima: uma atualização
  // de estado React não é garantida como visível a um segundo evento
  // disparado antes do próximo render — dois cliques reais no mesmo tick
  // podem, ambos, ler o mesmo `connectingAccountIds` "stale" e passar pelo
  // `if (...) return`. `useRef` é mutado de forma síncrona e imediata,
  // fechando essa janela por completo.
  const connectingRef = useRef<Set<string>>(new Set());
  const creatingRef = useRef(false);
  const [recoveringAccountIds, setRecoveringAccountIds] = useState<
    Set<string>
  >(new Set());
  const recoveringRef = useRef<Set<string>>(new Set());

  const [amazonStatus, setAmazonStatus] = useState<AmazonSetupStatusDto | null>(
    null,
  );
  const [amazonLoadError, setAmazonLoadError] = useState(false);
  const [amazonModal, setAmazonModal] =
    useState<AmazonConnectionModalMode | null>(null);
  const [amazonSyncingIds, setAmazonSyncingIds] = useState<Set<string>>(
    new Set(),
  );
  const [amazonActionError, setAmazonActionError] = useState<string | null>(
    null,
  );
  const amazonSyncingRef = useRef<Set<string>>(new Set());

  const loadAccounts = useCallback(async () => {
    try {
      const all = await fetchMarketplaceAccounts();
      setAccounts(all);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  const loadAmazonStatus = useCallback(async () => {
    try {
      const status = await fetchAmazonSetupStatus();
      setAmazonStatus(status);
      setAmazonLoadError(false);
    } catch {
      setAmazonLoadError(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadAccounts();
    })();
  }, [loadAccounts]);

  useEffect(() => {
    void (async () => {
      await loadAmazonStatus();
    })();
  }, [loadAmazonStatus]);

  const ml = searchParams.get("ml");
  const reason = searchParams.get("reason");
  // Sucesso só quando AMBOS ml=success E reason=success — nunca inferido de
  // um dos dois isoladamente.
  const bannerIsSuccess = ml === "success" && reason === "success";
  // Erro só quando AMBOS ml=error E reason está na lista pública conhecida
  // (REASON_MESSAGES) — um `reason` isolado (sem ml=error, ou combinado com
  // ml=success por um link malformado/manipulado) nunca deve, sozinho,
  // acionar o banner de erro.
  const bannerIsError =
    ml === "error" && reason !== null && Object.hasOwn(REASON_MESSAGES, reason);
  const bannerMessage = bannerIsSuccess
    ? "Conta do Mercado Livre conectada com sucesso."
    : bannerIsError
      ? REASON_MESSAGES[reason as string]
      : null;

  async function handleConnect(accountId: string) {
    if (connectingRef.current.has(accountId)) return; // impede clique duplo na MESMA conta (trava síncrona)
    connectingRef.current.add(accountId);
    setActionError(null);
    setConnectingAccountIds((prev) => new Set(prev).add(accountId));
    try {
      const { authorizationUrl } = await connectMercadoLivre(accountId);
      redirectTo(authorizationUrl);
    } catch {
      setActionError(
        "Não foi possível iniciar a conexão com o Mercado Livre. Tente novamente.",
      );
      connectingRef.current.delete(accountId);
      setConnectingAccountIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }

  // "Tentar agora" (falha temporária/ambígua de renovação) — nunca uma
  // reconexão OAuth completa; uma única tentativa controlada no backend.
  // Sempre recarrega a lista ao final: `recoveryHint`/`status` podem ter
  // mudado (RECOVERED volta a CONNECTED, RECONNECT_REQUIRED/
  // CONFIGURATION_ERROR trocam a ação exibida) sem exigir reload da página.
  async function handleRecover(accountId: string) {
    if (recoveringRef.current.has(accountId)) return;
    recoveringRef.current.add(accountId);
    setActionError(null);
    setRecoveringAccountIds((prev) => new Set(prev).add(accountId));
    try {
      const result = await recoverMercadoLivreConnection(accountId);
      await loadAccounts();
      if (result.outcome === "RECONNECT_REQUIRED") {
        setActionError(
          "Esta conta precisa ser reconectada — a autorização foi revogada ou expirou de verdade.",
        );
      } else if (result.outcome === "CONFIGURATION_ERROR") {
        setActionError(
          "Verifique as credenciais da aplicação Mercado Livre no servidor. Reconectar esta conta não resolve.",
        );
      }
    } catch {
      setActionError(
        "Não foi possível verificar a conexão agora. Tente novamente.",
      );
    } finally {
      recoveringRef.current.delete(accountId);
      setRecoveringAccountIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }

  async function handleAddAccount() {
    if (creatingRef.current) return; // impede criar duas linhas por clique duplo (trava síncrona)
    creatingRef.current = true;
    setActionError(null);
    setCreatingAccount(true);
    try {
      const account = await createMarketplaceAccount("MERCADO_LIVRE");
      await loadAccounts();
      await handleConnect(account.id);
    } catch {
      setActionError("Não foi possível criar a nova conta. Tente novamente.");
    } finally {
      creatingRef.current = false;
      setCreatingAccount(false);
    }
  }

  async function handleRename(accountId: string, nickname: string | null) {
    const updated = await renameMarketplaceAccount(accountId, nickname);
    setAccounts((prev) =>
      prev ? prev.map((a) => (a.id === accountId ? updated : a)) : prev,
    );
    setAmazonStatus((prev) =>
      prev
        ? {
            ...prev,
            accounts: prev.accounts.map((a) =>
              a.id === accountId ? updated : a,
            ),
          }
        : prev,
    );
  }

  function renamePropsFor(account: MarketplaceAccountDto) {
    return {
      currentNickname: account.nickname,
      secondaryLabel: account.externalSellerId
        ? `ID: ${account.externalSellerId}`
        : `ID interno: ${account.id.slice(0, 8)}`,
      onSave: (nickname: string | null) => handleRename(account.id, nickname),
    };
  }

  async function handleAmazonSync(accountId: string) {
    if (amazonSyncingRef.current.has(accountId)) return; // trava síncrona, mesmo padrão do Mercado Livre
    amazonSyncingRef.current.add(accountId);
    setAmazonActionError(null);
    setAmazonSyncingIds((prev) => new Set(prev).add(accountId));
    try {
      await syncAmazonOrders(accountId);
      await loadAmazonStatus();
    } catch {
      setAmazonActionError(
        "Não foi possível sincronizar agora. Tente novamente.",
      );
    } finally {
      amazonSyncingRef.current.delete(accountId);
      setAmazonSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }

  const loading = accounts === null && !loadError;
  const mercadoLivreAccounts =
    accounts?.filter((a) => a.marketplace === "MERCADO_LIVRE") ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Conecte marketplaces à Central de Performance.
        </p>
      </div>

      {bannerMessage ? (
        <div
          role="status"
          className={`rounded-md border p-4 text-sm ${
            bannerIsSuccess
              ? "border-green-500/40 bg-green-500/10 text-green-700"
              : "border-red-500/40 bg-red-500/10 text-red-700"
          }`}
        >
          {bannerMessage}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
        >
          {actionError}
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
        >
          Não foi possível carregar suas contas de marketplace. Tente
          novamente mais tarde.
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Mercado Livre</h2>
          {!loading && !loadError && mercadoLivreAccounts.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleAddAccount()}
              disabled={creatingAccount}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingAccount ? "Adicionando..." : "Adicionar outra conta"}
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <p className="text-sm text-foreground/60">Carregando...</p>
          ) : loadError ? null : mercadoLivreAccounts.length === 0 ? (
            <MarketplaceCard
              card={{
                id: "mercado-livre-empty",
                name: "Mercado Livre",
                statusLabel: "Não conectado",
                description: STATUS_DESCRIPTIONS.DISCONNECTED,
                cta: {
                  label: "Conectar Mercado Livre",
                  disabled: creatingAccount,
                  onClick: () => void handleAddAccount(),
                },
              }}
            />
          ) : (
            mercadoLivreAccounts.map((account) => (
              <MarketplaceCard
                key={account.id}
                card={{
                  id: account.id,
                  name: `Mercado Livre — ${accountLabel(account)}`,
                  statusLabel: mlStatusLabel(account),
                  description: mlStatusDescription(account),
                  rename: renamePropsFor(account),
                  cta:
                    account.recoveryHint === "TEMPORARY_RETRY"
                      ? {
                          label: recoveringAccountIds.has(account.id)
                            ? "Verificando..."
                            : "Tentar agora",
                          disabled: recoveringAccountIds.has(account.id),
                          onClick: () => void handleRecover(account.id),
                        }
                      : account.recoveryHint === "CONFIGURATION_ERROR"
                        ? undefined
                        : {
                            label:
                              account.status === "DISCONNECTED"
                                ? "Conectar"
                                : "Reconectar",
                            disabled: connectingAccountIds.has(account.id),
                            onClick: () => void handleConnect(account.id),
                          },
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Amazon</h2>
          {amazonStatus?.applicationConfigured &&
          (amazonStatus.accounts.length ?? 0) > 0 ? (
            <button
              type="button"
              onClick={() => setAmazonModal({ kind: "create" })}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
            >
              Adicionar outra conta
            </button>
          ) : null}
        </div>

        {amazonActionError ? (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
          >
            {amazonActionError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {amazonLoadError ? (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 sm:col-span-2 lg:col-span-3"
            >
              Não foi possível carregar o status da configuração Amazon. Tente
              novamente mais tarde.
            </div>
          ) : amazonStatus === null ? (
            <p className="text-sm text-foreground/60">Carregando...</p>
          ) : !amazonStatus.applicationConfigured ? (
            <MarketplaceCard
              card={{
                id: "amazon-config-pending",
                name: "Amazon",
                statusLabel: "Configuração do servidor pendente",
                description:
                  amazonStatus.missingConfigurationKeys.length > 0
                    ? `Variáveis ausentes no servidor: ${amazonStatus.missingConfigurationKeys.join(", ")}.`
                    : "Configuração do servidor pendente.",
              }}
            />
          ) : amazonStatus.accounts.length === 0 ? (
            <MarketplaceCard
              card={{
                id: "amazon-empty",
                name: "Amazon",
                statusLabel: "Conta Amazon ainda não configurada",
                description:
                  "Conecte sua conta Amazon para sincronizar pedidos.",
                cta: {
                  label: "Configurar Amazon",
                  disabled: false,
                  onClick: () => setAmazonModal({ kind: "create" }),
                },
              }}
            />
          ) : (
            amazonStatus.accounts.map((account) => (
              <MarketplaceCard
                key={account.id}
                card={{
                  id: account.id,
                  name: `Amazon — ${accountLabel(account)}`,
                  statusLabel: AMAZON_STATUS_LABELS[account.status],
                  description: AMAZON_STATUS_DESCRIPTIONS[account.status],
                  rename: renamePropsFor(account),
                  cta:
                    account.status === "CONNECTED"
                      ? {
                          label: amazonSyncingIds.has(account.id)
                            ? "Sincronizando..."
                            : "Sincronizar agora",
                          disabled: amazonSyncingIds.has(account.id),
                          onClick: () => void handleAmazonSync(account.id),
                        }
                      : {
                          label:
                            account.status === "DISCONNECTED"
                              ? "Continuar configuração"
                              : "Reconfigurar",
                          disabled: false,
                          onClick: () =>
                            setAmazonModal({
                              kind: "credentials",
                              accountId: account.id,
                            }),
                        },
                  secondaryCta:
                    account.status === "CONNECTED"
                      ? {
                          label: "Reconfigurar credenciais",
                          disabled: false,
                          onClick: () =>
                            setAmazonModal({
                              kind: "credentials",
                              accountId: account.id,
                            }),
                        }
                      : undefined,
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Outros marketplaces</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <MarketplaceCard
            card={{
              id: "shopee",
              name: "Shopee",
              statusLabel: "Disponível futuramente",
              description:
                "Integração planejada para uma etapa futura do roadmap multi-marketplace.",
            }}
          />
        </div>
      </section>

      {amazonModal ? (
        <AmazonConnectionModal
          mode={amazonModal}
          onClose={() => setAmazonModal(null)}
          onRefresh={() => void loadAmazonStatus()}
        />
      ) : null}
    </div>
  );
}

export default function IntegracoesPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-foreground/60">Carregando…</p>}
    >
      <IntegracoesContent />
    </Suspense>
  );
}
