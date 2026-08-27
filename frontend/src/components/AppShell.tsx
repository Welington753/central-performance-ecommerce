"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/integracoes", label: "Integrações" },
  { href: "/sincronizacoes", label: "Sincronizações" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Backend pode estar indisponível: seguimos para /login de qualquer forma.
    } finally {
      router.push("/login");
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border-subtle bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-brand-foreground">
              CP
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Central de Performance
            </span>
          </div>

          <nav className="flex items-center gap-1" aria-label="Navegação principal">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand/10 text-brand"
                      : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Saindo..." : "Sair"}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
