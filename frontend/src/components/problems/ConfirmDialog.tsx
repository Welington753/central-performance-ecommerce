"use client";

interface ConfirmDialogProps {
  message: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação antes de pausar/retomar; durante a requisição os botões ficam bloqueados. */
export function ConfirmDialog({ message, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirmar ação"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border-subtle bg-background px-5 py-5 shadow-xl"
      >
        <p className="text-sm">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-md border border-brand bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50"
          >
            {busy ? "Aguarde..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
