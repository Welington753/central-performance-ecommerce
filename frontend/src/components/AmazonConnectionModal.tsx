"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  createMarketplaceAccount,
  provisionAmazonAccount,
  verifyAmazonConnection,
} from "@/lib/api";
import type { AmazonVerifyConnectionCode } from "@/types/amazon-connection";

// Mensagens públicas FIXAS (mesmo design de REASON_MESSAGES em
// /integracoes) — nunca derivadas de texto livre do backend/Amazon, sempre
// deste mapa fechado indexado só pelo código sanitizado.
const VERIFY_ERROR_MESSAGES: Record<AmazonVerifyConnectionCode, string> = {
  VERIFIED: "",
  AMAZON_NOT_CONFIGURED:
    "A configuração do servidor Amazon está incompleta. Contate o time técnico.",
  AMAZON_ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN:
    "Nenhuma credencial válida está salva para esta conta ainda.",
  AMAZON_ACCOUNT_BUSY:
    "Outra operação está em andamento para esta conta. Tente novamente em instantes.",
  AMAZON_REFRESH_TOKEN_REJECTED:
    "A Amazon rejeitou o refresh token informado. Gere um novo na autoautorização e tente novamente.",
  AMAZON_LWA_APP_CONFIGURATION_ERROR:
    "A aplicação Amazon está configurada incorretamente no servidor. Contate o time técnico.",
  AMAZON_REFRESH_TRANSIENT_FAILURE:
    "A Amazon está temporariamente indisponível. Tente novamente em instantes.",
  AMAZON_REFRESH_RESULT_NOT_COMMITTED:
    "Outra atualização concorrente ocorreu. Tente novamente.",
  AMAZON_CREDENTIAL_DECRYPTION_FAILED:
    "Não foi possível ler a credencial salva. Reconfigure a conexão.",
  AMAZON_ACCOUNT_MARKETPLACE_MISMATCH: "Esta conta não é uma conta Amazon.",
  PROVIDER_REJECTED_CREDENTIAL:
    "A Amazon rejeitou o acesso com essas credenciais. Verifique o Selling Partner ID e o refresh token.",
  PROVIDER_RATE_LIMITED:
    "A Amazon limitou a taxa de requisições. Tente novamente em instantes.",
  PROVIDER_REJECTED_REQUEST:
    "A Amazon rejeitou a requisição de teste. Contate o time técnico.",
  INVALID_PROVIDER_RESPONSE:
    "A Amazon retornou uma resposta inesperada. Tente novamente.",
  PROVIDER_UNAVAILABLE:
    "A Amazon está indisponível no momento. Tente novamente em instantes.",
};

const GENERIC_SAVE_ERROR =
  "Não foi possível salvar as credenciais. Verifique os dados e tente novamente.";

export type AmazonConnectionModalMode =
  | { kind: "create" }
  | { kind: "credentials"; accountId: string };

interface AmazonConnectionModalProps {
  mode: AmazonConnectionModalMode;
  onClose: () => void;
  onRefresh: () => void;
}

/**
 * Assistente "Configurar Amazon" (Checkpoint 4-C, §8). O refresh token
 * nunca é salvo em localStorage/sessionStorage, nunca vai para a URL, nunca
 * aparece em mensagem de erro/console, e é sempre limpo do estado após
 * qualquer tentativa de envio — mesmo em caso de falha.
 */
export function AmazonConnectionModal({
  mode,
  onClose,
  onRefresh,
}: AmazonConnectionModalProps) {
  const [nickname, setNickname] = useState("");
  const [sellingPartnerId, setSellingPartnerId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Mesma trava síncrona já usada em /integracoes: um `useRef` fecha a
  // janela de corrida de um segundo clique/submit real no mesmo tick, que
  // `useState` sozinho não garante fechar a tempo.
  const submittingRef = useRef(false);
  // Protege contra uma resposta assíncrona ANTIGA (de uma tentativa
  // anterior, já abandonada) sobrescrever o estado de uma tentativa mais
  // nova — cada submit tem seu próprio id; só o mais recente pode gravar.
  const requestIdRef = useRef(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    const requestId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== requestId;

    try {
      const accountId =
        mode.kind === "create"
          ? (await createMarketplaceAccount("AMAZON", nickname || undefined))
              .id
          : mode.accountId;
      if (isStale()) return;
      if (mode.kind === "create") onRefresh(); // a conta já existe — reflete já

      await provisionAmazonAccount(accountId, {
        sellingPartnerId,
        refreshToken,
      });
      if (isStale()) return;

      const verifyResult = await verifyAmazonConnection(accountId);
      if (isStale()) return;

      if (verifyResult.connected) {
        onRefresh();
        onClose();
      } else {
        setErrorMessage(
          VERIFY_ERROR_MESSAGES[verifyResult.code] || GENERIC_SAVE_ERROR,
        );
        onRefresh(); // credenciais foram salvas; reflete o novo status mesmo sem conexão confirmada
      }
    } catch {
      if (!isStale()) setErrorMessage(GENERIC_SAVE_ERROR);
    } finally {
      // Limpo SEMPRE, independentemente de sucesso/erro/staleness — nunca
      // deixa o refresh token no estado depois de uma tentativa de envio.
      setRefreshToken("");
      if (!isStale()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="amazon-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    >
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-surface p-6 shadow-sm">
        <h2 id="amazon-modal-title" className="text-lg font-semibold">
          Configurar Amazon
        </h2>

        <ul className="mt-3 flex flex-col gap-1 text-sm text-foreground/70">
          <li>✓ Autenticação LWA já implementada</li>
          <li>✓ Criptografia de credenciais já implementada</li>
          <li>✓ Renovação automática de token já implementada</li>
        </ul>
        <p className="mt-3 rounded-md border border-border-subtle bg-foreground/5 p-3 text-xs text-foreground/70">
          Somente o usuário principal (Primary User) da conta Amazon pode
          autoautorizar esta aplicação privada e gerar o refresh token.
        </p>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="mt-4 flex flex-col gap-4"
        >
          {mode.kind === "create" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="amazon-nickname" className="text-sm font-medium">
                Apelido da conta
              </label>
              <input
                id="amazon-nickname"
                name="nickname"
                type="text"
                autoComplete="off"
                maxLength={120}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="Amazon principal"
                className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="amazon-selling-partner-id"
              className="text-sm font-medium"
            >
              Selling Partner ID
            </label>
            <input
              id="amazon-selling-partner-id"
              name="sellingPartnerId"
              type="text"
              autoComplete="off"
              required
              maxLength={64}
              value={sellingPartnerId}
              onChange={(event) => setSellingPartnerId(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="amazon-refresh-token"
              className="text-sm font-medium"
            >
              Refresh Token
            </label>
            <input
              id="amazon-refresh-token"
              name="refreshToken"
              type="password"
              autoComplete="off"
              required
              maxLength={4096}
              value={refreshToken}
              onChange={(event) => setRefreshToken(event.target.value)}
              className="rounded-md border border-border-subtle bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-brand">
              {errorMessage}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !sellingPartnerId || !refreshToken}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
            >
              {submitting ? "Salvando..." : "Salvar e testar conexão"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
