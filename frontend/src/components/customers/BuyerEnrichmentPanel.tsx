"use client";

import { useCallback, useEffect, useState } from "react";
import {
  changeBuyerEnrichment,
  fetchBuyerEnrichmentStatus,
  startBuyerEnrichment,
} from "@/lib/customers-api";
import { formatDateOrNA } from "@/lib/customer-format";
import type {
  BuyerEnrichmentAccountStatusDto,
  BuyerEnrichmentStatusDto,
} from "@/types/customers";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Na fila",
  RUNNING: "Processando",
  RETRY_WAIT: "Aguardando nova tentativa",
  PAUSED: "Pausado",
  FAILED: "Falhou",
  COMPLETED: "Concluído",
};

const ERROR_LABEL: Record<string, string> = {
  ENRICHMENT_WINDOW_INCOMPLETE:
    "Mais pedidos numa única hora do que o marketplace permite listar — processamento parado nesta data; use Retomar para tentar de novo.",
  TOKEN_EXPIRED: "Acesso expirado — reconecte a conta em Integrações.",
  ACCOUNT_NOT_CONNECTED: "Conta desconectada — reconecte em Integrações.",
};

function statusText(account: BuyerEnrichmentAccountStatusDto): string {
  if (account.lastStartOutcome === "MODE_CONFLICT") {
    return "Completar histórico está em andamento nesta conta — tente depois que ele terminar";
  }
  if (!account.jobStatus) return account.connected ? "Não iniciado" : "Conta desconectada";
  return STATUS_LABEL[account.jobStatus] ?? account.jobStatus;
}

export function BuyerEnrichmentPanel() {
  const [status, setStatus] = useState<BuyerEnrichmentStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<BuyerEnrichmentStatusDto>) => {
    setBusy(true);
    try {
      setStatus(await action());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchBuyerEnrichmentStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Falha ao carregar.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      aria-label="Enriquecimento histórico de clientes"
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Enriquecimento histórico</h2>
          <p className="text-xs text-foreground/60">
            Reprocessa pedidos antigos do Mercado Livre e da Shopee para identificar os
            compradores. Roda em segundo plano, conta por conta.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(fetchBuyerEnrichmentStatus)}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Atualizar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => startBuyerEnrichment())}
            className="rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand disabled:opacity-40"
          >
            Enriquecer todas as contas
          </button>
        </div>
      </div>

      {status && !status.workerEnabled ? (
        <p role="status" className="text-xs text-amber-800">
          O processamento em segundo plano está desligado neste servidor — os pedidos
          ficam na fila até ele ser ativado.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {status ? (
        <ul className="flex flex-col gap-2 text-sm">
          {status.accounts.map((account) => (
            <li
              key={account.accountId}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2"
            >
              <span>
                <strong>{account.nickname ?? account.accountId.slice(0, 8)}</strong>{" "}
                <span className="text-foreground/60">· {statusText(account)}</span>
                {account.cursorBefore && account.jobStatus !== "COMPLETED" ? (
                  <span className="block text-xs text-foreground/50">
                    Processado até {formatDateOrNA(account.cursorBefore)}
                  </span>
                ) : null}
                {account.lastErrorCode ? (
                  <span className="block text-xs text-red-700">
                    {ERROR_LABEL[account.lastErrorCode] ?? "Falha temporária ao consultar o marketplace."}
                  </span>
                ) : null}
              </span>
              {account.jobStatus === "PAUSED" || account.jobStatus === "FAILED" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => changeBuyerEnrichment(account.accountId, "resume"))}
                  className="rounded-md border border-border-subtle px-2 py-1 text-xs disabled:opacity-40"
                >
                  Retomar
                </button>
              ) : account.jobStatus && account.jobStatus !== "COMPLETED" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => changeBuyerEnrichment(account.accountId, "pause"))}
                  className="rounded-md border border-border-subtle px-2 py-1 text-xs disabled:opacity-40"
                >
                  Pausar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
