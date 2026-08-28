import { createHash, randomBytes } from 'crypto';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** state: CSPRNG, codificado base64url (design §3: "Ser gerado com CSPRNG"). */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

/** Nunca armazenamos o state em texto puro — só este hash (design §3). */
export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** PKCE S256 — nunca `plain` (design §2). */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}
