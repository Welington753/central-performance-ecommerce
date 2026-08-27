"use client";

import { useAuthGuard } from "@/hooks/useAuthGuard";
import { AppShell } from "@/components/AppShell";

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

  return <AppShell>{children}</AppShell>;
}
