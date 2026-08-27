"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SyncTable } from "@/components/SyncTable";
import type { SyncRun } from "@/types/sync-run";

function isSyncRunArray(value: unknown): value is SyncRun[] {
  return Array.isArray(value);
}

export default function SincronizacoesPage() {
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadSyncRuns() {
      try {
        const response = await apiFetch("/sync-runs", { method: "GET" });

        if (!isActive) {
          return;
        }

        if (!response.ok) {
          setSyncRuns([]);
          return;
        }

        const data: unknown = await response.json();
        setSyncRuns(isSyncRunArray(data) ? data : []);
      } catch {
        // Backend indisponível ou erro de rede: mantemos o estado vazio,
        // sem inventar linhas de exemplo.
        if (isActive) {
          setSyncRuns([]);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadSyncRuns();

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sincronizações
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          Histórico de execuções de sincronização com marketplaces conectados.
        </p>
      </div>

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
