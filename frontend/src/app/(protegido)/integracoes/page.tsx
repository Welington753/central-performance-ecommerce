"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import {
  connectMercadoLivre,
  createMarketplaceAccount,
  fetchMarketplaceAccounts,
  redirectTo,
} from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";

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

  const loadAccounts = useCallback(async () => {
    try {
      const all = await fetchMarketplaceAccounts();
      setAccounts(all);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadAccounts();
    })();
  }, [loadAccounts]);

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
                  statusLabel: STATUS_LABELS[account.status],
                  description: STATUS_DESCRIPTIONS[account.status],
                  cta: {
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
        <h2 className="text-lg font-semibold">Outros marketplaces</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <MarketplaceCard
            card={{
              id: "amazon",
              name: "Amazon",
              statusLabel: "Disponível futuramente",
              description:
                "Integração planejada para uma etapa futura do roadmap multi-marketplace.",
            }}
          />
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
