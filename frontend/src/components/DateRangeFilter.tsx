"use client";

import { useState } from "react";
import {
  DATE_RANGE_ERROR_MESSAGES,
  PERIOD_PRESETS,
  dateOnlyToString,
  resolvePreset,
  todaySaoPaulo,
  validateDateRangeStrings,
  type PeriodPresetKey,
} from "@/lib/date-range";
import { formatCalendarDate } from "@/lib/kpi-format";

interface DateRangeFilterProps {
  from: string;
  to: string;
  allTime?: boolean;
  /**
   * Datas REAIS aplicadas pelo backend quando `allTime` está ativo (Fase 4,
   * item 1) — vêm de `period.from`/`period.to` da resposta, nunca inventadas
   * no cliente. `undefined` enquanto a resposta ainda não chegou.
   */
  resolvedAllTimePeriod?: { from: string; to: string };
  onChange: (range: { from: string; to: string }) => void;
  onAllTimeChange?: () => void;
}

const DEFAULT_RANGE_DAYS = 30;

function matchingPreset(from: string, to: string): PeriodPresetKey | null {
  const now = new Date();
  for (const preset of PERIOD_PRESETS) {
    const resolved = resolvePreset(preset.key, now);
    if (
      dateOnlyToString(resolved.from) === from &&
      dateOnlyToString(resolved.to) === to
    ) {
      return preset.key;
    }
  }
  return null;
}

export function DateRangeFilter({
  from,
  to,
  allTime = false,
  resolvedAllTimePeriod,
  onChange,
  onAllTimeChange,
}: DateRangeFilterProps) {
  const activePreset = matchingPreset(from, to);
  const [customOpen, setCustomOpen] = useState(!allTime && activePreset === null);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [error, setError] = useState<string | null>(null);

  const todayStr = dateOnlyToString(todaySaoPaulo());

  function applyPreset(key: PeriodPresetKey) {
    const range = resolvePreset(key);
    setCustomOpen(false);
    setError(null);
    onChange({
      from: dateOnlyToString(range.from),
      to: dateOnlyToString(range.to),
    });
  }

  function openCustom() {
    setDraftFrom(from);
    setDraftTo(to);
    setError(null);
    setCustomOpen(true);
  }

  function applyCustom() {
    const result = validateDateRangeStrings(draftFrom, draftTo);
    if (!result.valid) {
      setError(DATE_RANGE_ERROR_MESSAGES[result.error]);
      return;
    }
    setError(null);
    onChange({
      from: dateOnlyToString(result.range.from),
      to: dateOnlyToString(result.range.to),
    });
  }

  function resetToDefault() {
    const range = resolvePreset("last30");
    setCustomOpen(false);
    setError(null);
    onChange({
      from: dateOnlyToString(range.from),
      to: dateOnlyToString(range.to),
    });
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-5 py-4">
      <legend className="px-1 text-sm font-medium text-foreground/70">
        Período
      </legend>

      <div
        role="group"
        aria-label="Atalhos de período"
        className="flex flex-wrap gap-2"
      >
        {PERIOD_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={!allTime && activePreset === preset.key && !customOpen}
            onClick={() => applyPreset(preset.key)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              !allTime && activePreset === preset.key && !customOpen
                ? "border-brand bg-brand/10 text-brand"
                : "border-border-subtle hover:bg-foreground/5"
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={!allTime && customOpen}
          onClick={openCustom}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            !allTime && customOpen
              ? "border-brand bg-brand/10 text-brand"
              : "border-border-subtle hover:bg-foreground/5"
          }`}
        >
          Personalizado
        </button>
        {onAllTimeChange ? (
          <button
            type="button"
            aria-pressed={allTime}
            onClick={() => {
              setCustomOpen(false);
              setError(null);
              onAllTimeChange();
            }}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              allTime
                ? "border-brand bg-brand/10 text-brand"
                : "border-border-subtle hover:bg-foreground/5"
            }`}
          >
            Todo o período
          </button>
        ) : null}
      </div>

      {allTime ? (
        <div className="flex flex-col gap-1 border-t border-border-subtle pt-3 text-sm text-foreground/60">
          {resolvedAllTimePeriod ? (
            <p>
              Período consultado:{" "}
              <span className="font-medium text-foreground">
                {formatCalendarDate(resolvedAllTimePeriod.from)} a{" "}
                {formatCalendarDate(resolvedAllTimePeriod.to)}
              </span>
            </p>
          ) : null}
          <p>
            Consultando da primeira à última venda registrada — sem
            comparação com período anterior.
          </p>
          <p>
            Todo o período disponível no sistema — pode não representar todo
            o histórico da conta no marketplace.
          </p>
        </div>
      ) : customOpen ? (
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-3 sm:flex-row sm:items-end sm:gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/60">Data inicial</span>
            <input
              type="date"
              value={draftFrom}
              max={todayStr}
              onChange={(event) => setDraftFrom(event.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/60">Data final</span>
            <input
              type="date"
              value={draftTo}
              max={todayStr}
              onChange={(event) => setDraftTo(event.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyCustom}
              className="rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={resetToDefault}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
            >
              Limpar (voltar aos {DEFAULT_RANGE_DAYS} dias)
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
