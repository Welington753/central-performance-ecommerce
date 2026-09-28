import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import type { AuthorizationContext } from '../users/authorization-context.interface';

declare module 'express' {
  interface Request {
    /**
     * Preenchido pelo AccessTokenGuard após verificar o JWT do cookie de
     * access token. Ausente em rotas públicas ou quando a autenticação falhar
     * antes do guard popular o valor.
     */
    user?: AccessTokenPayload;

    /**
     * Preenchido por `AuthorizationContextService.resolveForRequest` na
     * PRIMEIRA vez que algo pede o contexto de autorização nesta requisição
     * (Checkpoint 2) — nunca em outro lugar. Cache só dentro do ciclo de
     * vida desta requisição (o objeto `Request` é recriado a cada chamada
     * HTTP pelo Express); nunca variável de módulo/global, que vazaria
     * entre requisições concorrentes.
     */
    authorizationContext?: AuthorizationContext;
  }
}
