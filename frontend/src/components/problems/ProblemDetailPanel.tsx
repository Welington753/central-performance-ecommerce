"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fetchProblemDetail, updateProblemResponsibility } from "@/lib/problems-api";
import {
  MANUAL_RESPONSIBILITY_OPTIONS,
  RESPONSIBILITY_LABELS,
  accountDisplayName,
  actionLabel,
  dueLabel,
  formatDate,
  formatDateTime,
  impactLabel,
  marketplaceLabel,
  stageLabel,
  statusLabel,
  typeLabel,
} from "@/lib/problems-format";
import type { ManualProblemResponsibility, ProblemDetailDto } from "@/types/problems";

interface ProblemDetailPanelProps {
  problemId: string;
  /** Só `problems.manage` vê o formulário de correção manual (o backend revalida). */
  canManage: boolean;
  onClose: () => void;
  /** Depois de uma correção salva: a página recarrega lista e resumo. */
  onChanged: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-foreground/60">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function ResponsibilityForm({
  problem,
  onSaved,
}: {
  problem: ProblemDetailDto;
  onSaved: (updated: ProblemDetailDto) => void;
}) {
  const [responsibility, setResponsibility] = useState<ManualProblemResponsibility>(
    problem.responsibility === "UNKNOWN" ? "SELLER" : problem.responsibility,
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError("Informe o motivo da alteração (mínimo de 3 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateProblemResponsibility(problem.id, { responsibility, reason: reason.trim() }));
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Corrigir responsabilidade" className="flex flex-col gap-3 rounded-md border border-border-subtle px-3 py-3">
      <h3 className="text-sm font-semibold">Corrigir responsabilidade</h3>
      <label className="flex flex-col gap-1 text-sm">
        Responsável
        <select
          value={responsibility}
          onChange={(e) => setResponsibility(e.target.value as ManualProblemResponsibility)}
          className="rounded-md border border-border-subtle bg-background px-2 py-1.5"
        >
          {MANUAL_RESPONSIBILITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {RESPONSIBILITY_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Motivo da alteração
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          className="rounded-md border border-border-subtle bg-background px-2 py-1.5"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="self-end rounded-md border border-brand bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Salvar correção"}
      </button>
    </form>
  );
}

export function ProblemDetailPanel({ problemId, canManage, onClose, onChanged }: ProblemDetailPanelProps) {
  const [problem, setProblem] = useState<ProblemDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let active = true;
    fetchProblemDetail(problemId)
      .then((next) => {
        if (!active) return;
        setProblem(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar o detalhe.");
      });
    return () => {
      active = false;
    };
  }, [problemId, reloadKey]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes do problema"
        className="flex h-full w-full max-w-xl flex-col gap-4 overflow-y-auto bg-background px-5 py-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">Detalhes do problema</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-border-subtle px-2 py-1 text-sm">
            Fechar
          </button>
        </div>

        {error ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm text-red-700">
            {error}
            <button type="button" onClick={load} className="self-start rounded-md border border-red-500/40 px-2 py-1">
              Tentar novamente
            </button>
          </div>
        ) : null}
        {!problem && !error ? <p role="status" className="text-sm text-foreground/60">Carregando detalhes...</p> : null}

        {problem ? (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Marketplace / conta" value={`${marketplaceLabel(problem.marketplace)} · ${accountDisplayName(problem.accountNickname, problem.marketplace)}`} />
              <Field label="Nº da reclamação" value={problem.externalClaimId} />
              <Field label="Criado em" value={formatDateTime(problem.dateCreated)} />
              <Field label="Última atualização" value={formatDateTime(problem.lastUpdated)} />
              <Field label="Status / etapa" value={`${statusLabel(problem.status)} · ${stageLabel(problem.stage)}`} />
              <Field label="Tipo" value={typeLabel(problem.type)} />
              <Field label="Encerrado em" value={formatDate(problem.resolutionDate)} />
              <Field label="Motivo do encerramento" value={problem.resolutionReason ?? "—"} />
            </dl>

            <section aria-label="Motivo" className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Motivo</h3>
              <p className="text-sm">{problem.reasonLabel ?? "Motivo não informado"}</p>
              {problem.reasonId ? <p className="text-[11px] text-foreground/60">Código do motivo: {problem.reasonId}</p> : null}
              {problem.reasonDetail ? <p className="text-sm text-foreground/60">{problem.reasonDetail}</p> : null}
              {problem.detailTitle ? <p className="text-sm">{problem.detailTitle}</p> : null}
              {problem.detailProblem ? <p className="text-sm text-foreground/60">{problem.detailProblem}</p> : null}
            </section>

            <section aria-label="Impacto na reputação" className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Impacto na reputação</h3>
              <p className="text-sm">{impactLabel(problem.reputationImpact)}</p>
              {problem.reputationDueDate ? (
                <p className="text-sm text-foreground/60">Prazo: {formatDate(problem.reputationDueDate)}</p>
              ) : null}
            </section>

            <section aria-label="Pedido" className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Pedido</h3>
              {problem.order ? (
                <p className="text-sm">Pedido {problem.order.externalOrderId} · {problem.order.status}</p>
              ) : (
                <p className="text-sm text-foreground/60">
                  {problem.orderExternalId ? `Pedido ${problem.orderExternalId} (ainda não sincronizado)` : "Sem pedido associado."}
                </p>
              )}
            </section>

            <section aria-label="Ações" className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Ações</h3>
              {problem.actions.length === 0 ? (
                <p className="text-sm text-foreground/60">Nenhuma ação disponível.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {problem.actions.map((action, index) => {
                    const due = dueLabel(action.dueDate);
                    return (
                      <li key={`${action.actionCode}-${index}`} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {actionLabel(action.actionCode)}
                          {action.mandatory ? " (obrigatória)" : ""}
                        </span>
                        <span className={due.overdue ? "font-medium text-red-700" : "text-foreground/60"}>{due.text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-label="Responsabilidade" className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Responsabilidade</h3>
              <p className="text-sm">
                {RESPONSIBILITY_LABELS[problem.responsibility]}
                {problem.responsibilityConfidence === "MANUAL" ? " · definida manualmente" : ""}
              </p>
              {problem.responsibilityOverriddenAt ? (
                <p className="text-sm text-foreground/60">
                  Última correção em {formatDateTime(problem.responsibilityOverriddenAt)}
                  {problem.responsibilityOverrideReason ? ` — ${problem.responsibilityOverrideReason}` : ""}
                </p>
              ) : null}
            </section>

            {canManage ? (
              <ResponsibilityForm
                problem={problem}
                onSaved={(updated) => {
                  setProblem(updated);
                  onChanged();
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
