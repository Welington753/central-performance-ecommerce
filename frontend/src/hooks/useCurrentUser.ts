"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type CurrentUser = {
  name: string;
  email: string;
};

export type CurrentUserState = {
  user: CurrentUser | null;
  isLoading: boolean;
};

/**
 * Lê o usuário autenticado a partir do endpoint já existente `GET /auth/me`
 * (mesmo fluxo de sessão usado por `useAuthGuard`) apenas para exibição na
 * interface. Não cria endpoint novo, não altera o backend e não interfere na
 * proteção de rotas.
 *
 * Enquanto a resposta não chega, `isLoading` é `true` e `user` é `null` — a UI
 * deve mostrar um estado neutro, nunca um nome ou e-mail inventado. Se a
 * chamada falhar (rede ou HTTP de erro), `user` permanece `null`.
 */
export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({
    user: null,
    isLoading: true,
  });

  useEffect(() => {
    let isActive = true;

    async function loadCurrentUser() {
      try {
        const response = await apiFetch("/auth/me", { method: "GET" });

        if (!isActive) {
          return;
        }

        if (!response.ok) {
          setState({ user: null, isLoading: false });
          return;
        }

        const data: unknown = await response.json();

        if (!isActive) {
          return;
        }

        const candidate = data as Partial<CurrentUser> | null;
        const isUsable =
          typeof candidate?.name === "string" &&
          typeof candidate?.email === "string";

        setState({
          user: isUsable
            ? { name: candidate.name as string, email: candidate.email as string }
            : null,
          isLoading: false,
        });
      } catch {
        if (!isActive) {
          return;
        }
        setState({ user: null, isLoading: false });
      }
    }

    loadCurrentUser();

    return () => {
      isActive = false;
    };
  }, []);

  return state;
}
