"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiFetchError } from "@/lib/api";
import { changeOwnPassword } from "@/lib/users-api";
import { PASSWORD_MIN_LENGTH, passwordMeetsPolicy } from "@/lib/password-policy";
import { useAuthGuard } from "@/hooks/useAuthGuard";

/**
 * Reaproveita `useAuthGuard` tal como está (checking/reconnecting → spinner;
 * unauthenticated → o próprio hook já redireciona para /login) — nenhuma
 * segunda interpretação de sessão. Fica FORA de `(protegido)/layout.tsx` de
 * propósito: o gate de troca obrigatória de senha nunca envolve esta rota,
 * então não existe como o redirect apontar para si mesmo (sem loop por
 * construção). Acessível também para quem NÃO precisa trocar a senha
 * (troca voluntária).
 */
export default function AlterarSenhaPage() {
  const status = useAuthGuard();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (status === "checking" || status === "reconnecting") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label={
              status === "reconnecting"
                ? "Reconectando ao servidor"
                : "Verificando sessão"
            }
          />
          <p className="text-sm text-foreground/70">
            {status === "reconnecting"
              ? "Reconectando ao servidor..."
              : "Verificando sessão..."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    // O redirecionamento para /login já foi disparado pelo hook.
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);

    if (!currentPassword) {
      setErrorMessage("Informe a senha atual.");
      return;
    }
    if (!passwordMeetsPolicy(newPassword)) {
      setErrorMessage(
        `A nova senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres, com letras e números.`,
      );
      return;
    }
    if (newPassword === currentPassword) {
      setErrorMessage("A nova senha deve ser diferente da atual.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage("A confirmação não confere com a nova senha.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      // Limpa os campos antes de navegar — nunca guarda a senha fora do
      // estado do formulário, nem depois de concluído.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      // Backend já limpou os cookies de sessão — nunca tenta refresh
      // automático nem reenvia a senha depois disto.
      router.push("/login?passwordChanged=1");
    } catch (caught) {
      if (caught instanceof ApiFetchError && caught.code === "SESSION_EXPIRED") {
        // Sessão expirou durante a troca — nunca tenta refresh nem reenvia o
        // POST (ver `changeOwnPassword`); limpa os campos e manda para o
        // login com aviso, exatamente como no caminho de sucesso.
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        router.push("/login?sessionExpired=1");
        return;
      }
      setErrorMessage(
        caught instanceof ApiFetchError
          ? caught.message
          : "Não foi possível alterar a senha agora. Tente novamente.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Alterar senha
          </h1>
          <p className="text-sm text-foreground/60">
            Informe a senha atual e escolha uma nova senha.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6 shadow-sm"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="current-password" className="text-sm font-medium">
              Senha atual
            </label>
            <input
              id="current-password"
              name="currentPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={isSubmitting}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-sm font-medium">
              Nova senha
            </label>
            <input
              id="new-password"
              name="newPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={isSubmitting}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-new-password" className="text-sm font-medium">
              Confirmar nova senha
            </label>
            <input
              id="confirm-new-password"
              name="confirmNewPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={isSubmitting}
              value={confirmNewPassword}
              onChange={(event) => setConfirmNewPassword(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground/70">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(event) => setShowPasswords(event.target.checked)}
            />
            Mostrar senhas
          </label>

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-brand">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Alterando..." : "Alterar senha"}
          </button>
        </form>
      </div>
    </main>
  );
}
