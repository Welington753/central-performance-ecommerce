"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { AmazonSection } from "@/components/integracoes/AmazonSection";
import { MercadoLivreSection } from "@/components/integracoes/MercadoLivreSection";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import {
  fetchAmazonSetupStatus,
  fetchMarketplaceAccounts,
  renameMarketplaceAccount,
} from "@/lib/api";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";

function IntegracoesContent() {
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState(false);
  const [amazonStatus, setAmazonStatus] = useState<AmazonSetupStatusDto | null>(
    null,
  );
  const [amazonLoadError, setAmazonLoadError] = useState(false);

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

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Conecte marketplaces à Central de Performance.
        </p>
      </div>

      <MercadoLivreSection
        accounts={accounts}
        loadError={loadError}
        onRefresh={loadAccounts}
        renamePropsFor={renamePropsFor}
      />

      <AmazonSection
        amazonStatus={amazonStatus}
        amazonLoadError={amazonLoadError}
        onRefresh={loadAmazonStatus}
        renamePropsFor={renamePropsFor}
      />

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
