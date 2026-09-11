import { parsePositiveSafeIntegerString } from './shopee-decimal-id.util';
import { SHOPEE_ENDPOINTS } from './shopee-endpoints';

export interface BuildShopeeAuthorizationUrlInput {
  authorizationHost: string;
  partnerId: string;
  redirectUri: string;
  state: string;
}

const MAX_STATE_LENGTH = 512;

/**
 * Allowlist derivada diretamente de `shopee-endpoints.ts` — nunca uma cópia
 * manual que possa divergir. Defesa em profundidade: mesmo que um chamador
 * futuro passe um host por engano (bug, configuração adulterada), o builder
 * rejeita qualquer valor que não seja EXATAMENTE um dos hosts de autorização
 * oficiais confirmados (Checkpoint CP2D).
 */
const ALLOWED_AUTHORIZATION_HOSTS: ReadonlySet<string> = new Set(
  Object.values(SHOPEE_ENDPOINTS)
    .map((endpoint) => endpoint.authorizationHost)
    .filter((host): host is string => host !== null),
);

export class ShopeeAuthorizationUrlBuildError extends Error {}

/**
 * Builder puro da URL de autorização Shopee (Checkpoint CP2D) — só MONTA a
 * URL via `URL`/`URLSearchParams` (nunca concatenação de strings), nunca faz
 * nenhuma chamada HTTP. Query fechada a EXATAMENTE cinco parâmetros
 * (`auth_type`, `partner_id`, `redirect_uri`, `response_type`, `state`):
 * nunca inclui Partner Key, `timestamp`/`sign` (só a assinatura da Public
 * API, usada por `ShopeeHttpClient`, exige isso — a tela de autorização
 * não), PKCE (a Shopee não documenta `code_challenge` nesta tela) nem
 * `scope`. `url.search = ''` garante que nenhum parâmetro extra sobreviva
 * mesmo que `authorizationHost` já viesse com query string.
 *
 * Deliberadamente NÃO repete a validação completa (environment-aware) de
 * `validateShopeeRedirectUri` — essa já ocorre antes, em
 * `ShopeeCredentialsService.ensureConfigured()`, chamada obrigatoriamente
 * pelo `ShopeeOAuthService.startConnection` antes de chegar aqui. Este
 * builder só confirma, de forma pura e sem `NODE_ENV`, que `redirectUri` é
 * uma URL `http(s)` sintaticamente válida — nunca loga a URL completa nem o
 * valor recebido em caso de erro, só um código fechado.
 */
export function buildShopeeAuthorizationUrl(
  input: BuildShopeeAuthorizationUrlInput,
): string {
  if (!ALLOWED_AUTHORIZATION_HOSTS.has(input.authorizationHost)) {
    throw new ShopeeAuthorizationUrlBuildError(
      'SHOPEE_AUTHORIZATION_HOST_NOT_ALLOWED',
    );
  }

  if (parsePositiveSafeIntegerString(input.partnerId) === null) {
    throw new ShopeeAuthorizationUrlBuildError('SHOPEE_INVALID_PARTNER_ID');
  }

  if (input.state.length === 0 || input.state.length > MAX_STATE_LENGTH) {
    throw new ShopeeAuthorizationUrlBuildError('SHOPEE_INVALID_STATE');
  }

  let redirectProtocol: string;
  try {
    redirectProtocol = new URL(input.redirectUri).protocol;
  } catch {
    throw new ShopeeAuthorizationUrlBuildError('SHOPEE_INVALID_REDIRECT_URI');
  }
  if (redirectProtocol !== 'https:' && redirectProtocol !== 'http:') {
    throw new ShopeeAuthorizationUrlBuildError('SHOPEE_INVALID_REDIRECT_URI');
  }

  const url = new URL(input.authorizationHost);
  url.search = '';
  url.searchParams.set('auth_type', 'seller');
  url.searchParams.set('partner_id', input.partnerId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  return url.toString();
}
