"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { NAV_GROUPS, isNavItemActive } from "@/lib/navigation";

/**
 * Cor institucional vinho da Central de Performance, aplicada aos destaques da
 * barra lateral. Fixa (e não o token `--brand`) porque o painel lateral é
 * sempre escuro, independentemente do tema claro/escuro do restante da tela.
 */
const BRAND = "#8C0E33";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading: isLoadingUser } = useCurrentUser();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);

  // Fecha a gaveta com Escape (somente enquanto ela está aberta).
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  // Bloqueia a rolagem do conteúdo enquanto a gaveta está aberta.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

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
    <>
      {/* Barra superior apenas em telas pequenas: abre/fecha a gaveta. */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-label={isOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={isOpen}
          aria-controls="navegacao-principal"
          className="rounded-md border border-border-subtle p-2 text-foreground/70 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C0E33]"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="text-sm font-semibold tracking-tight">
          Central de Performance
        </span>
      </header>

      {isOpen && (
        <div
          data-testid="sidebar-overlay"
          onClick={close}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      <nav
        id="navegacao-principal"
        aria-label="Navegação principal"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#150F11] text-white/80 transition-transform duration-200 ease-out lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Marca */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
            style={{ backgroundColor: BRAND }}
          >
            CP
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">
            Central de Performance
          </span>
        </div>

        {/* Grupos de navegação */}
        <div className="flex-1 overflow-y-auto px-3 py-5">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div
              key={group.id}
              className={groupIndex > 0 ? "mt-6 border-t border-white/10 pt-5" : ""}
            >
              <p className="px-2 pb-2 text-[11px] font-semibold tracking-widest text-white/40">
                {group.title}
              </p>
              <ul className="flex flex-col gap-1">
                {group.items.map(({ id, href, label, Icon }) => {
                  const isActive = isNavItemActive(pathname, href);
                  return (
                    <li key={id}>
                      <Link
                        href={href}
                        onClick={close}
                        aria-current={isActive ? "page" : undefined}
                        style={
                          isActive ? { backgroundColor: BRAND } : undefined
                        }
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C0E33] ${
                          isActive
                            ? "text-white"
                            : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Usuário autenticado + sair */}
        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 min-h-[2.25rem]">
            {isLoadingUser ? (
              <p className="text-xs text-white/40">Carregando usuário...</p>
            ) : user ? (
              <>
                <p className="truncate text-sm font-medium text-white">
                  {user.name}
                </p>
                <p className="truncate text-xs text-white/50">{user.email}</p>
              </>
            ) : (
              <p className="text-xs text-white/40">Usuário não identificado</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full rounded-md border border-white/15 px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8C0E33] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningOut ? "Saindo..." : "Sair"}
          </button>
        </div>
      </nav>
    </>
  );
}
