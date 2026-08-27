"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export type AuthGuardStatus = "checking" | "authenticated" | "unauthenticated";

/**
 * Protege rotas client-side.
 *
 * O backend usa cookies de sessão HttpOnly (inacessíveis via JavaScript), então
 * não é possível verificar autenticação lendo cookies no cliente. A validação
 * real só pode ser feita perguntando ao backend: este hook chama
 * `GET {NEXT_PUBLIC_API_URL}/auth/me` (com `credentials: 'include'`, para que o
 * cookie HttpOnly seja enviado automaticamente pelo navegador) ao montar.
 *
 * - Enquanto a checagem está em andamento, retorna `"checking"` — a página deve
 *   mostrar um estado de "verificando sessão".
 * - Se `/auth/me` responder 200, retorna `"authenticated"`.
 * - Se responder qualquer erro HTTP, ou a chamada falhar por rede (backend
 *   indisponível), retorna `"unauthenticated"` e redireciona para `/login`
 *   via `router.replace` (não usa `push`, para não poluir o histórico).
 */
export function useAuthGuard(): AuthGuardStatus {
  const router = useRouter();
  const [status, setStatus] = useState<AuthGuardStatus>("checking");

  useEffect(() => {
    let isActive = true;

    async function checkSession() {
      try {
        const response = await apiFetch("/auth/me", { method: "GET" });

        if (!isActive) {
          return;
        }

        if (response.ok) {
          setStatus("authenticated");
        } else {
          setStatus("unauthenticated");
          router.replace("/login");
        }
      } catch {
        if (!isActive) {
          return;
        }
        setStatus("unauthenticated");
        router.replace("/login");
      }
    }

    checkSession();

    return () => {
      isActive = false;
    };
  }, [router]);

  return status;
}
