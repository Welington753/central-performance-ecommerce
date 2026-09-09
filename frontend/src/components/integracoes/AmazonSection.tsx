"use client";

import { useRef, useState } from "react";
import {
  AmazonConnectionModal,
  type AmazonConnectionModalMode,
} from "@/components/AmazonConnectionModal";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import { syncAmazonOrders } from "@/lib/api";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto, MarketplaceCardData } from "@/types/marketplace";
import { accountLabel } from "./marketplace-account-label";

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

export function AmazonSection({
  amazonStatus,
  amazonLoadError,
  onRefresh,
  renamePropsFor,
}: {
  amazonStatus: AmazonSetupStatusDto | null;
  amazonLoadError: boolean;
  onRefresh: () => Promise<void>;
  renamePropsFor: (
    account: MarketplaceAccountDto,
  ) => NonNullable<MarketplaceCardData["rename"]>;
}) {
  const [amazonModal, setAmazonModal] =
    useState<AmazonConnectionModalMode | null>(null);
  const [amazonSyncingIds, setAmazonSyncingIds] = useState<Set<string>>(
    new Set(),
  );
  const [amazonActionError, setAmazonActionError] = useState<string | null>(
    null,
  );
  const amazonSyncingRef = useRef<Set<string>>(new Set());

  async function handleAmazonSync(accountId: string) {
    if (amazonSyncingRef.current.has(accountId)) return; // trava síncrona, mesmo padrão do Mercado Livre
    amazonSyncingRef.current.add(accountId);
    setAmazonActionError(null);
    setAmazonSyncingIds((prev) => new Set(prev).add(accountId));
    try {
      await syncAmazonOrders(accountId);
      await onRefresh();
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

  return (
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

      {amazonModal ? (
        <AmazonConnectionModal
          mode={amazonModal}
          onClose={() => setAmazonModal(null)}
          onRefresh={() => void onRefresh()}
        />
      ) : null}
    </section>
  );
}
