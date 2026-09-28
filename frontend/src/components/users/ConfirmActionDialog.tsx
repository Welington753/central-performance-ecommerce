"use client";

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmação genérico — reusado por desativar/reativar
 * usuário, redefinir senha, promover/rebaixar ADMIN e editar o próprio
 * papel/permissões (cada chamador passa título/descrição/rótulo próprios).
 */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  isSubmitting = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-action-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <h2 id="confirm-action-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-foreground/70">{description}</p>

        {errorMessage ? (
          <p role="alert" className="text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md border border-border-subtle px-4 py-1.5 text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={
              danger
                ? "rounded-md bg-red-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                : "rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-brand-foreground disabled:opacity-50"
            }
          >
            {isSubmitting ? "Aguarde..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
