/**
 * Cliente HTTP central para chamadas ao backend.
 *
 * - Sempre envia `credentials: 'include'` para que os cookies HttpOnly de
 *   sessão emitidos pelo backend (login/refresh) sejam enviados/recebidos
 *   corretamente pelo navegador.
 * - Usa `NEXT_PUBLIC_API_URL` como base da API. Nenhum segredo é lido ou
 *   embutido aqui — apenas a URL pública do backend.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiFetchError";
  }
}

/**
 * Executa um fetch contra o backend, já configurado com a base URL e
 * `credentials: 'include'`. Não lança em respostas HTTP de erro (4xx/5xx) —
 * quem chamar deve checar `response.ok`. Lança apenas em falhas de rede
 * (backend indisponível, DNS, CORS bloqueado, etc.), para que o chamador
 * trate esse caso separadamente sem expor detalhes internos na UI.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;

  try {
    return await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiFetchError(
      "Não foi possível se comunicar com o servidor. Tente novamente mais tarde.",
    );
  }
}
