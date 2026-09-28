"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { CurrentUserProvider, useCurrentUser } from "@/hooks/useCurrentUser";
import { AppShell } from "@/components/AppShell";

/**
 * Gate de troca obrigatória de senha (Checkpoint 4) — só existe UM caminho
 * que renderiza `<AppShell>`: `status==="ready"` com um `user` não-nulo e
 * `mustChangePassword===false`. Qualquer outro valor (checking, reconnecting,
 * unauthenticated, forbidden, ou um status desconhecido futuro) cai no
 * spinner/mensagem — fail-closed por construção, nunca libera o conteúdo
 * protegido por omissão. Só é montado (via `CurrentUserProvider` abaixo)
 * depois que `useAuthGuard` já confirmou `"authenticated"`.
 */
function MustChangePasswordGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, status, refresh } = useCurrentUser();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "ready" && user?.mustChangePassword) {
      router.replace("/alterar-senha");
    }
  }, [status, user, router]);

  if (status === "ready" && user && user.mustChangePassword === false) {
    return <AppShell>{children}</AppShell>;
  }

  if (status === "forbidden") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/70">
          Você está autenticado, mas não tem permissão para acessar esta
          área.
        </p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    // O redirecionamento para /login já foi disparado acima.
    return null;
  }

  if (status === "fatal_error") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="text-sm text-foreground/70">
            Não foi possível verificar sua sessão agora.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-border-subtle px-4 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

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

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const status = useAuthGuard();

  if (status === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label="Verificando sessão"
          />
          <p className="text-sm text-foreground/70">Verificando sessão...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    // O redirecionamento para /login já foi disparado pelo hook.
    return null;
  }

  if (status === "forbidden") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/70">
          Você está autenticado, mas não tem permissão para acessar esta
          área.
        </p>
      </div>
    );
  }

  if (status === "reconnecting") {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label="Reconectando ao servidor"
          />
          <p className="text-sm text-foreground/70">
            Reconectando ao servidor...
          </p>
        </div>
      </div>
    );
  }

  return (
    <CurrentUserProvider>
      <MustChangePasswordGate>{children}</MustChangePasswordGate>
    </CurrentUserProvider>
  );
}
