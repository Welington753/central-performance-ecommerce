"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export type AuthGuardStatus =
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "forbidden"
  | "reconnecting";

// Mesmo racional do polling de /health no login (cold start do Render
// free) — poucas tentativas rápidas no início, depois espaçadas, nunca
// imediatas para sempre (o último valor se repete indefinidamente).
const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000];

/**
 * Protege rotas client-side.
 *
 * O backend usa cookies de sessão HttpOnly (inacessíveis via JavaScript),
 * então a validação real só pode ser feita perguntando ao backend: este
 * hook chama `GET /auth/me` (com `credentials: 'include'`, via `apiFetch` —
 * que já tenta um refresh automático em 401 antes de devolver a resposta)
 * ao montar.
 *
 * - `"checking"`: verificação em andamento (primeira carga).
 * - `"authenticated"`: `/auth/me` respondeu 200 — mostra o conteúdo protegido.
 * - `"unauthenticated"`: 401 confirmado (mesmo depois da tentativa de
 *   refresh do `apiFetch`) — única condição que redireciona para `/login`.
 * - `"forbidden"`: 403 — falta de permissão, nunca tratado como logout.
 * - `"reconnecting"`: falha de rede/timeout ou qualquer outro status (ex.:
 *   502/503/504, cold start do Render) — nunca redireciona, tenta de novo
 *   sozinho com backoff limitado.
 */
export function useAuthGuard(): AuthGuardStatus {
  const router = useRouter();
  const [status, setStatus] = useState<AuthGuardStatus>("checking");

  const isActiveRef = useRef(true);
  const statusRef = useRef<AuthGuardStatus>("checking");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const checkSessionRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearScheduledRetry = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Único ponto que agenda um novo timer — sempre limpa o anterior antes,
  // nunca dois timers concorrentes (chamado tanto pelo backoff normal quanto
  // pelo retorno de foco/visibilidade, que também limpa antes de chamar).
  const scheduleRetry = useCallback(() => {
    clearScheduledRetry();
    const attempt = attemptRef.current;
    const delay =
      RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    attemptRef.current = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
    timeoutRef.current = setTimeout(() => {
      void checkSessionRef.current();
    }, delay);
  }, [clearScheduledRetry]);

  const checkSession = useCallback(async () => {
    try {
      const response = await apiFetch("/auth/me", {
        method: "GET",
        cache: "no-store",
      });
      if (!isActiveRef.current) return;

      if (response.ok) {
        attemptRef.current = 0;
        setStatus("authenticated");
        return;
      }
      if (response.status === 401) {
        setStatus("unauthenticated");
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setStatus("forbidden");
        return;
      }
      // Qualquer outro status (502/503/504/500/etc.) — falha temporária do
      // servidor, nunca sessão expirada.
      setStatus("reconnecting");
      scheduleRetry();
    } catch {
      // Falha de rede/timeout — mesma distinção: nunca é logout.
      if (!isActiveRef.current) return;
      setStatus("reconnecting");
      scheduleRetry();
    }
  }, [router, scheduleRetry]);

  useEffect(() => {
    checkSessionRef.current = checkSession;
  }, [checkSession]);

  useEffect(() => {
    isActiveRef.current = true;
    void checkSessionRef.current();
    return () => {
      isActiveRef.current = false;
      clearScheduledRetry();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
  }, []);

  // Ao voltar para a aba ou focar a janela durante "reconectando", consulta
  // IMEDIATAMENTE em vez de esperar o próximo passo do backoff — cancela
  // qualquer timer pendente antes, para nunca deixar dois em voo.
  useEffect(() => {
    function retryNow() {
      if (document.visibilityState !== "visible") return;
      if (statusRef.current !== "reconnecting") return;
      clearScheduledRetry();
      void checkSessionRef.current();
    }
    document.addEventListener("visibilitychange", retryNow);
    window.addEventListener("focus", retryNow);
    return () => {
      document.removeEventListener("visibilitychange", retryNow);
      window.removeEventListener("focus", retryNow);
    };
  }, [clearScheduledRetry]);

  return status;
}
