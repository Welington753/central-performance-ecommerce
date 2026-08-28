export interface BuildAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/**
 * Só MONTA a URL — o backend nunca faz uma chamada HTTP a `/authorization`
 * (design §2). PKCE sempre S256, `scope` nunca é enviado (não documentado).
 */
export function buildAuthorizationUrl(
  input: BuildAuthorizationUrlInput,
): string {
  const url = new URL('https://auth.mercadolivre.com.br/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
