"use client";

import { useRef, useState } from "react";

interface TemporaryPasswordModalProps {
  userName: string;
  password: string;
  onClose: () => void;
}

/**
 * Mostra a senha temporária UMA ÚNICA VEZ — quem chama nunca guarda a senha
 * fora do estado do componente pai, e fecha este modal remove o valor do
 * estado (nunca é possível reabrir a mesma senha depois). Nunca grava em
 * `localStorage`/`sessionStorage`/cookie/URL, nunca loga no console.
 */
export function TemporaryPasswordModal({
  userName,
  password,
  onClose,
}: TemporaryPasswordModalProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleCopy() {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API indisponível");
      }
      await navigator.clipboard.writeText(password);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
      inputRef.current?.select();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="temporary-password-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <h2 id="temporary-password-title" className="text-lg font-semibold">
          Senha temporária de {userName}
        </h2>
        <p className="text-sm text-foreground/70">
          Esta senha será exibida somente uma vez. Copie e envie ao usuário
          agora — ela não poderá ser vista de novo depois de fechar esta
          janela.
        </p>

        <input
          ref={inputRef}
          type="text"
          readOnly
          value={password}
          aria-label="Senha temporária"
          onFocus={(event) => event.target.select()}
          className="rounded-md border border-border-subtle bg-background px-3 py-2 font-mono text-sm"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/20"
          >
            Copiar
          </button>
          {copyState === "copied" ? (
            <span role="status" className="text-xs text-green-700">
              Copiado!
            </span>
          ) : null}
        </div>

        {copyState === "failed" ? (
          <p role="alert" className="text-xs text-foreground/60">
            Não foi possível copiar automaticamente. Selecione o texto acima
            e copie manualmente (Ctrl+C).
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-brand-foreground"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
