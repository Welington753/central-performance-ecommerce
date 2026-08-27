import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';

declare module 'express' {
  interface Request {
    /**
     * Preenchido pelo AccessTokenGuard após verificar o JWT do cookie de
     * access token. Ausente em rotas públicas ou quando a autenticação falhar
     * antes do guard popular o valor.
     */
    user?: AccessTokenPayload;
  }
}
