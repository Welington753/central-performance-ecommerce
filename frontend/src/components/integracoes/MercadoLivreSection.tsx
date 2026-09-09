"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import {
  connectMercadoLivre,
  createMarketplaceAccount,
  recoverMercadoLivreConnection,
  redirectTo,
} from "@/lib/api";
import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type { MarketplaceAccountDto, MarketplaceCardData } from "@/types/marketplace";
import { accountLabel } from "./marketplace-account-label";

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

export function MercadoLivreSection({
  accounts,
  loadError,
  onRefresh,
  renamePropsFor,
}: {
  accounts: MarketplaceAccountDto[] | null;
  loadError: boolean;
  onRefresh: () => Promise<void>;
  renamePropsFor: (
    account: MarketplaceAccountDto,
  ) => NonNullable<MarketplaceCardData["rename"]>;
}) {
  const searchParams = useSearchParams();
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
      await onRefresh();
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
      await onRefresh();
      await handleConnect(account.id);
    } catch {
      setActionError("Não foi possível criar a nova conta. Tente novamente.");
    } finally {
      creatingRef.current = false;
      setCreatingAccount(false);
    }
  }

  const loading = accounts === null && !loadError;
  const mercadoLivreAccounts =
    accounts?.filter((a) => a.marketplace === "MERCADO_LIVRE") ?? [];

  return (
    <>
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
    </>
  );
}
