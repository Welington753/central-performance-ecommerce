"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const INVALID_CREDENTIALS_MESSAGE = "E-mail ou senha inválidos.";
// Nunca reutiliza a mensagem de credenciais inválidas para falha de
// rede/5xx (fechamento frontend, resiliência a cold start) — dizer
// "inválidas" quando o problema é o backend acordando confundiria o
// usuário a trocar a senha por engano.
const TEMPORARY_UNAVAILABLE_MESSAGE =
  "Serviço temporariamente indisponível. Tente novamente em instantes.";
const STARTING_SERVER_MESSAGE =
  "Iniciando servidor. Isso pode levar até 1 minuto...";

// Cold start do Render free (mesmo racional do worker do backend) — poucas
// tentativas rápidas no início, depois espaçadas, nunca imediatas para
// sempre.
const HEALTH_CHECK_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backendReady, setBackendReady] = useState(false);

  const healthCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const healthCheckAttemptRef = useRef(0);

  /**
   * Chama `GET /health` (público, sem cookie de sessão necessário) ao abrir
   * a tela — no plano gratuito do Render, o backend pode estar hibernado, e
   * a PRIMEIRA requisição real (login) não pode ser o que o acorda: o
   * usuário digitaria a senha contra um backend que ainda nem respondeu.
   * Falha de rede ou 502/503/504 (backend acordando) tenta de novo sozinho,
   * com backoff limitado; qualquer outra resposta HTTP (mesmo um erro
   * inesperado) já conta como "backend respondendo" e libera o formulário —
   * o próprio login, se necessário, mostra o erro real depois.
   */
  useEffect(() => {
    let isActive = true;

    async function checkHealth() {
      try {
        const response = await apiFetch("/health", { method: "GET" });
        if (!isActive) return;
        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        ) {
          scheduleNextHealthCheck();
          return;
        }
        setBackendReady(true);
      } catch {
        if (!isActive) return;
        scheduleNextHealthCheck();
      }
    }

    function scheduleNextHealthCheck() {
      if (!isActive) return;
      const attempt = healthCheckAttemptRef.current;
      const delay =
        HEALTH_CHECK_RETRY_DELAYS_MS[
          Math.min(attempt, HEALTH_CHECK_RETRY_DELAYS_MS.length - 1)
        ];
      healthCheckAttemptRef.current = Math.min(
        attempt + 1,
        HEALTH_CHECK_RETRY_DELAYS_MS.length - 1,
      );
      healthCheckTimeoutRef.current = setTimeout(
        () => void checkHealth(),
        delay,
      );
    }

    void checkHealth();

    return () => {
      isActive = false;
      if (healthCheckTimeoutRef.current !== null) {
        clearTimeout(healthCheckTimeoutRef.current);
        healthCheckTimeoutRef.current = null;
      }
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || !backendReady) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (response.status === 401) {
        setErrorMessage(INVALID_CREDENTIALS_MESSAGE);
        return;
      }

      if (!response.ok) {
        // Qualquer falha que não seja "credenciais erradas" (5xx, etc.) —
        // nunca reenvia e-mail/senha automaticamente; o usuário decide
        // quando tentar de novo clicando "Entrar".
        setErrorMessage(TEMPORARY_UNAVAILABLE_MESSAGE);
        return;
      }

      router.push("/dashboard");
    } catch {
      // Falha de rede (backend indisponível, etc.) — mesma distinção: nunca
      // é "senha errada".
      setErrorMessage(TEMPORARY_UNAVAILABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-foreground">
            CP
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Central de Performance
          </h1>
          <p className="text-sm text-foreground/60">
            Entre com sua conta para continuar
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6 shadow-sm"
        >
          {!backendReady ? (
            <p
              role="status"
              className="rounded-md border border-border-subtle bg-foreground/5 px-3 py-2 text-xs text-foreground/70"
            >
              {STARTING_SERVER_MESSAGE}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={!backendReady}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="voce@empresa.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={!backendReady}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="********"
            />
          </div>

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-brand">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !backendReady}
            className="mt-2 flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden="true"
                />
                Entrando...
              </>
            ) : (
              "Entrar"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
