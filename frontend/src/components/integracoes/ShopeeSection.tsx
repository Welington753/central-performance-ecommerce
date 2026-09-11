"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import {
  connectShopee,
  createMarketplaceAccount,
  redirectTo,
} from "@/lib/api";
import { isAllowedShopeeAuthorizationUrl } from "@/lib/shopee-authorization-url.validator";
import type { MarketplaceAccountDto, MarketplaceCardData } from "@/types/marketplace";
import { accountLabel } from "./marketplace-account-label";

const STATUS_LABELS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Não conectado",
  CONNECTED: "Conectado",
  TOKEN_EXPIRED: "Token expirado — reconexão necessária",
  ERROR: "Erro — reconexão necessária",
};

const STATUS_DESCRIPTIONS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Conexão OAuth segura com a Shopee.",
  CONNECTED: "Conta conectada e pronta para uso.",
  TOKEN_EXPIRED: "A sessão expirou. Reconecte para continuar.",
  ERROR: "Houve um problema com esta conta. Reconecte para tentar novamente.",
};

// Vocabulário público fechado (mesmo do backend, shopee-callback-reason.mapper.ts)
// — nunca deriva mensagem de um `reason` fora desta lista.
const REASON_MESSAGES: Record<string, string> = {
  OAUTH_CALLBACK_INVALID:
    "O link de retorno da Shopee é inválido ou expirou. Tente conectar novamente.",
  CONNECTION_FAILED:
    "Não foi possível concluir a conexão com a Shopee agora. Tente novamente.",
  CONNECTION_BUSY:
    "Esta conta está processando outra operação agora. Tente novamente em instantes.",
};

// CP2E-R1: `shopee=error` com `reason` fora do vocabulário fechado (ou
// ausente) nunca mostra o valor bruto — cai nesta mensagem genérica fixa.
const GENERIC_ERROR_MESSAGE =
  "Não foi possível conectar a conta da Shopee. Tente novamente.";

export function ShopeeSection({
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [connectingAccountIds, setConnectingAccountIds] = useState<
    Set<string>
  >(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  // Mesma trava síncrona do MercadoLivreSection: um `useState` não garante
  // visibilidade imediata a um segundo clique disparado antes do próximo
  // render — `useRef` fecha essa janela.
  const connectingRef = useRef<Set<string>>(new Set());
  const creatingRef = useRef(false);
  const callbackHandledRef = useRef(false);
  // CP2E-R1: guarda o `id` de uma conta recém-criada cujo `connect` (ou a
  // validação da `authorizationUrl`) ainda não foi confirmado como
  // bem-sucedido — enquanto isso, uma nova tentativa REUTILIZA este id em
  // vez de criar outra `MarketplaceAccount` vazia. Limpo assim que a conta
  // aparece de fato em `accounts` (efeito abaixo), momento em que um clique
  // subsequente em "Adicionar outra conta" volta a criar uma conta nova de
  // verdade — a intenção explícita de segunda conta nunca fica bloqueada.
  const pendingAccountIdRef = useRef<string | null>(null);

  const shopeeParam = searchParams.get("shopee");
  const reasonParam = searchParams.get("reason");
  const bannerIsSuccess = shopeeParam === "success";
  const bannerIsError = shopeeParam === "error";
  const knownReasonMessage =
    reasonParam !== null && Object.hasOwn(REASON_MESSAGES, reasonParam)
      ? REASON_MESSAGES[reasonParam]
      : null;
  // `reason` ausente ou fora do vocabulário fechado (nunca o valor bruto)
  // cai na mensagem genérica — nunca some sem feedback nenhum.
  const bannerMessage = bannerIsSuccess
    ? "Conta da Shopee conectada com sucesso."
    : bannerIsError
      ? (knownReasonMessage ?? GENERIC_ERROR_MESSAGE)
      : null;

  // Processa o callback (`shopee`/`reason`) uma única vez: recarrega as
  // contas em caso de sucesso e sempre remove esses dois parâmetros da URL
  // ao final, preservando qualquer outro parâmetro legítimo já presente.
  // Nunca usa `returnUrl` da query — o destino é sempre a própria rota atual.
  useEffect(() => {
    if (callbackHandledRef.current) return;
    if (shopeeParam === null) return;
    callbackHandledRef.current = true;

    const cleanup = async () => {
      if (bannerIsSuccess) {
        await onRefresh();
      }
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("shopee");
      nextParams.delete("reason");
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    };
    void cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopeeParam]);

  // Assim que a conta pendente aparece de fato na lista (refresh confirmado
  // — sucesso ou não da conexão em si, tanto faz), ela deixa de ser
  // "pendente de confirmação de existência": a partir daqui, um novo clique
  // em "Adicionar outra conta" cria uma conta genuinamente nova.
  useEffect(() => {
    if (
      pendingAccountIdRef.current !== null &&
      accounts?.some((a) => a.id === pendingAccountIdRef.current)
    ) {
      pendingAccountIdRef.current = null;
    }
  }, [accounts]);

  async function handleConnect(accountId: string) {
    if (connectingRef.current.has(accountId)) return;
    connectingRef.current.add(accountId);
    setActionError(null);
    setConnectingAccountIds((prev) => new Set(prev).add(accountId));
    try {
      const { authorizationUrl } = await connectShopee(accountId);
      if (!isAllowedShopeeAuthorizationUrl(authorizationUrl)) {
        throw new Error("SHOPEE_AUTHORIZATION_URL_REJECTED");
      }
      redirectTo(authorizationUrl);
    } catch {
      setActionError(
        "Não foi possível iniciar a conexão com a Shopee. Tente novamente.",
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
    if (creatingRef.current) return;
    creatingRef.current = true;
    setActionError(null);
    setCreatingAccount(true);
    try {
      // Reutiliza a conta já criada numa tentativa anterior cujo `connect`
      // (ou a validação da URL) falhou — nunca cria uma segunda
      // `MarketplaceAccount` vazia só porque a conexão anterior não
      // completou.
      let accountId = pendingAccountIdRef.current;
      if (accountId === null) {
        const account = await createMarketplaceAccount("SHOPEE");
        accountId = account.id;
        pendingAccountIdRef.current = accountId;
      }
      try {
        await onRefresh();
      } catch {
        // Falha ao recarregar não desfaz a criação já persistida no
        // backend — `pendingAccountIdRef` continua apontando para ela, e a
        // conexão é tentada mesmo assim com o id já conhecido.
      }
      await handleConnect(accountId);
    } catch {
      setActionError("Não foi possível criar a nova conta. Tente novamente.");
    } finally {
      creatingRef.current = false;
      setCreatingAccount(false);
    }
  }

  const loading = accounts === null && !loadError;
  const shopeeAccounts = accounts?.filter((a) => a.marketplace === "SHOPEE") ?? [];

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
          <h2 className="text-lg font-semibold">Shopee</h2>
          {!loading && !loadError && shopeeAccounts.length > 0 ? (
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
          ) : loadError ? null : shopeeAccounts.length === 0 ? (
            <MarketplaceCard
              card={{
                id: "shopee-empty",
                name: "Shopee",
                statusLabel: "Não conectado",
                description: STATUS_DESCRIPTIONS.DISCONNECTED,
                cta: {
                  label: "Conectar Shopee",
                  disabled: creatingAccount,
                  onClick: () => void handleAddAccount(),
                },
              }}
            />
          ) : (
            shopeeAccounts.map((account) => (
              <MarketplaceCard
                key={account.id}
                card={{
                  id: account.id,
                  name: `Shopee — ${accountLabel(account)}`,
                  statusLabel: STATUS_LABELS[account.status],
                  description: STATUS_DESCRIPTIONS[account.status],
                  rename: renamePropsFor(account),
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
    </>
  );
}
