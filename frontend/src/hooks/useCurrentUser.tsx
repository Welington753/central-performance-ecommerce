"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { RETRY_DELAYS_MS } from "./useAuthGuard";
import type { AccountScope, PermissionKey, RoleKey } from "@/types/users";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  /** Checkpoint BI-1: só decide se a UI mostra a ação de administrador — o backend nunca confia nisto sozinho. */
  isAdmin: boolean;
  role: RoleKey | null;
  permissions: PermissionKey[];
  accountScope: AccountScope;
  mustChangePassword: boolean;
};

export type CurrentUserStatus =
  | "checking"
  | "ready"
  | "reconnecting"
  | "unauthenticated"
  | "forbidden"
  | "fatal_error";

export type CurrentUserState = {
  user: CurrentUser | null;
  /** === status === "checking" — mantém o contrato anterior para quem só olhava isLoading. */
  isLoading: boolean;
  status: CurrentUserStatus;
  /** Reexecuta a leitura de /auth/me sob demanda (ex.: depois de o usuário editar o próprio papel/permissões). */
  refresh: () => Promise<void>;
};

function parseCurrentUser(data: unknown): CurrentUser | null {
  const candidate = data as Partial<CurrentUser> | null;
  const isUsable =
    typeof candidate?.id === "string" &&
    typeof candidate?.name === "string" &&
    typeof candidate?.email === "string" &&
    Array.isArray(candidate?.permissions);
  if (!isUsable) {
    return null;
  }
  return {
    id: candidate.id as string,
    name: candidate.name as string,
    email: candidate.email as string,
    isAdmin: candidate.isAdmin === true,
    role: typeof candidate.role === "string" ? (candidate.role as RoleKey) : null,
    permissions: candidate.permissions as PermissionKey[],
    accountScope:
      candidate.accountScope && typeof candidate.accountScope === "object"
        ? (candidate.accountScope as AccountScope)
        : { mode: "NONE" },
    mustChangePassword: candidate.mustChangePassword === true,
  };
}

const CurrentUserContext = createContext<CurrentUserState | null>(null);

/**
 * Toda a máquina de busca/retry de `/auth/me`, parametrizada por `enabled`.
 * Usada de duas formas:
 * - `CurrentUserProvider` (`enabled` sempre `true`) — leitura única
 *   compartilhada por tudo sob `(protegido)/layout.tsx` (Sidebar, gate de
 *   troca obrigatória, página de usuários), evitando multiplicar chamadas
 *   concorrentes.
 * - Fallback "standalone" de `useCurrentUser()` (`enabled` só quando NÃO há
 *   `CurrentUserProvider` acima) — preserva o uso direto de `AppShell`/
 *   `Sidebar` fora de `(protegido)/layout.tsx` (ex.: testes que renderizam
 *   `<AppShell>` isolado), com sua própria busca independente, exatamente
 *   como o hook se comportava antes deste checkpoint. Quando `enabled` é
 *   `false`, nenhum efeito faz fetch — nunca duplica a leitura quando o
 *   Provider já existe.
 *
 * Fail-closed por construção: qualquer coisa que não seja `status==="ready"`
 * com um `user` válido é tratada como "ainda não posso liberar conteúdo
 * protegido" (ver `MustChangePasswordGate` em `(protegido)/layout.tsx`),
 * nunca como "libera por omissão". Mesma disciplina de retry de
 * `useAuthGuard` (backoff compartilhado, um timer só, retry imediato ao
 * voltar o foco, cleanup no unmount) — propositalmente uma segunda instância
 * dessa lógica, e não uma reescrita de `useAuthGuard`, para não quebrar seus
 * testes existentes.
 *
 * `"fatal_error"` é o estado de erro não transitório (corpo 200 malformado
 * ou status HTTP que não é 401/403/5xx) — nunca agenda retry automático
 * (repetir sozinho não corrige um contrato errado), fica em erro seguro até
 * o consumidor chamar `refresh()` manualmente (botão "Tentar novamente").
 */
function useCurrentUserFetchState(enabled: boolean): CurrentUserState {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<CurrentUserStatus>("checking");

  const isActiveRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const checkRef = useRef<() => Promise<void>>(async () => {});

  const clearScheduledRetry = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    clearScheduledRetry();
    const attempt = attemptRef.current;
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    attemptRef.current = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
    timeoutRef.current = setTimeout(() => {
      void checkRef.current();
    }, delay);
  }, [clearScheduledRetry]);

  const check = useCallback(async () => {
    try {
      const response = await apiFetch("/auth/me", {
        method: "GET",
        cache: "no-store",
      });
      if (!isActiveRef.current) return;

      if (response.ok) {
        const data: unknown = await response.json();
        if (!isActiveRef.current) return;
        const parsed = parseCurrentUser(data);
        if (!parsed) {
          // Corpo 200 mas incompleto/inesperado — não é falha transitória de
          // rede/servidor (repetir sozinho não vai corrigir um contrato
          // errado), então não agenda retry automático: fica em erro seguro
          // com botão manual ("Tentar novamente" → `refresh()`), nunca
          // libera o AppShell e nunca fica preso num spinner sem explicação.
          clearScheduledRetry();
          setStatus("fatal_error");
          return;
        }
        attemptRef.current = 0;
        setUser(parsed);
        setStatus("ready");
        return;
      }
      if (response.status === 401) {
        // Nunca redireciona aqui — quem decide navegar para /login a partir
        // de `status==="unauthenticated"` é o consumidor (ex.:
        // `MustChangePasswordGate` em `(protegido)/layout.tsx`, que já tem
        // seu próprio `useRouter()`). Mantém este hook sem dependência de
        // roteador — igual ao comportamento original, antes deste
        // checkpoint — e sem duplicar a responsabilidade de redirecionar já
        // exercida por `useAuthGuard`.
        clearScheduledRetry();
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      if (response.status === 403) {
        // Defensivo — hoje /auth/me não tem PermissionGuard, nunca deveria
        // devolver 403; nunca tratado como logout, nunca apaga a sessão.
        clearScheduledRetry();
        setStatus("forbidden");
        return;
      }
      if (response.status >= 500) {
        // Falha do lado do servidor (502/503/504/500 — cold start do Render
        // incluso) — genuinamente transitória, repete sozinho com backoff.
        setStatus("reconnecting");
        scheduleRetry();
        return;
      }
      // Qualquer outro status HTTP não tratado (ex.: 400/404/422) não é
      // transitório — repetir sozinho não corrige nada. Erro seguro com
      // retry manual, nunca um spinner infinito sem explicação.
      clearScheduledRetry();
      setStatus("fatal_error");
    } catch {
      if (!isActiveRef.current) return;
      setStatus("reconnecting");
      scheduleRetry();
    }
  }, [scheduleRetry, clearScheduledRetry]);

  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  useEffect(() => {
    if (!enabled) return;
    isActiveRef.current = true;
    void checkRef.current();
    return () => {
      isActiveRef.current = false;
      clearScheduledRetry();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem (por `enabled`)
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    function retryNow() {
      if (document.visibilityState !== "visible") return;
      if (status !== "reconnecting") return;
      clearScheduledRetry();
      void checkRef.current();
    }
    document.addEventListener("visibilitychange", retryNow);
    window.addEventListener("focus", retryNow);
    return () => {
      document.removeEventListener("visibilitychange", retryNow);
      window.removeEventListener("focus", retryNow);
    };
  }, [enabled, status, clearScheduledRetry]);

  const refresh = useCallback(async () => {
    clearScheduledRetry();
    attemptRef.current = 0;
    await checkRef.current();
  }, [clearScheduledRetry]);

  return {
    user,
    isLoading: status === "checking",
    status,
    refresh,
  };
}

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const value = useCurrentUserFetchState(true);
  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  );
}

/**
 * Usa o `CurrentUserProvider` mais próximo quando existir (reaproveita o
 * mesmo fetch — nunca duplica). Sem um Provider acima, cai no fallback
 * standalone (própria busca independente) — ver `useCurrentUserFetchState`.
 */
export function useCurrentUser(): CurrentUserState {
  const context = useContext(CurrentUserContext);
  const standalone = useCurrentUserFetchState(context === null);
  return context ?? standalone;
}

/** Fail-closed: usuário nulo ou permissão ausente ⇒ `false`, nunca um fallback permissivo. */
export function hasPermission(
  user: CurrentUser | null,
  key: PermissionKey,
): boolean {
  if (!user) return false;
  return user.permissions.includes(key);
}

export function hasAnyPermission(
  user: CurrentUser | null,
  keys: readonly PermissionKey[],
): boolean {
  if (!user) return false;
  return keys.some((key) => user.permissions.includes(key));
}
