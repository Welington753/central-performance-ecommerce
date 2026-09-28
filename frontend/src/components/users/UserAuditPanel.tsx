"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiFetchError } from "@/lib/api";
import { getUserAudit } from "@/lib/users-api";
import {
  AUDIT_ACTIONS_WITHOUT_VISIBLE_FIELDS,
  AUDIT_ACTION_LABELS,
  AUDIT_FIELD_LABELS,
} from "@/lib/users-permission-labels";
import type { AuditLogItemDto, Paginated } from "@/types/users";

interface UserAuditPanelProps {
  userId: string;
  userName: string;
  onClose: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

/**
 * Nunca mostra `passwordHash`/`mustChangePassword` nem qualquer outro nome
 * de campo interno — só as chaves conhecidas de `AUDIT_FIELD_LABELS`, e
 * nunca para ações de senha (só carregam campos internos).
 */
function visibleFieldLabels(item: AuditLogItemDto): string[] {
  if (AUDIT_ACTIONS_WITHOUT_VISIBLE_FIELDS.has(item.action)) return [];
  const fields = item.changes.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field) => AUDIT_FIELD_LABELS[field])
    .filter((label): label is string => typeof label === "string");
}

export function UserAuditPanel({ userId, userName, onClose }: UserAuditPanelProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AuditLogItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getUserAudit(userId, { page, limit: 20 }, signal);
        setData(result);
      } catch (caught) {
        if (signal.aborted) return;
        setError(
          caught instanceof ApiFetchError
            ? caught.message
            : "Não foi possível carregar a auditoria agora.",
        );
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    },
    [userId, page],
  );

  // Aborta a leitura em andamento ao desmontar/trocar de página — o cliente
  // atual (`apiFetch`) suporta `AbortSignal`.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await load(controller.signal);
    })();
    return () => controller.abort();
  }, [load]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-audit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 id="user-audit-title" className="text-lg font-semibold">
            Auditoria de {userName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md px-2 py-1 text-sm text-foreground/60 hover:bg-foreground/5"
          >
            Fechar
          </button>
        </div>

        {isLoading ? (
          <p className="text-sm text-foreground/60">Carregando auditoria...</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : data && data.items.length === 0 ? (
          <p className="text-sm text-foreground/60">
            Nenhum evento de auditoria registrado ainda.
          </p>
        ) : data ? (
          <>
            <ul className="flex flex-col divide-y divide-border-subtle">
              {data.items.map((item) => {
                const fields = visibleFieldLabels(item);
                return (
                  <li key={item.id} className="py-2 text-sm">
                    <p className="font-medium">
                      {AUDIT_ACTION_LABELS[item.action] ?? item.action}
                    </p>
                    <p className="text-xs text-foreground/50">
                      {formatDateTime(item.createdAt)}
                    </p>
                    {fields.length > 0 ? (
                      <p className="mt-1 text-xs text-foreground/60">
                        Campos alterados: {fields.join(", ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <nav
              aria-label="Paginação de auditoria"
              className="flex items-center justify-between text-sm"
            >
              <span className="text-foreground/60">
                página {data.page} de{" "}
                {Math.max(1, Math.ceil(data.total / data.limit))}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page >= Math.ceil(data.total / data.limit)}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </nav>
          </>
        ) : null}
      </div>
    </div>
  );
}
