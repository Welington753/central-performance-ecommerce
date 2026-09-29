import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';

/**
 * Extrai `request.authorizationContext` (populado por `PermissionGuard`, via
 * `AuthorizationContextService`, ver `permission.guard.ts`). Exportada
 * separada do `createParamDecorator` (Checkpoint 5A) para ser testável sem
 * a plumbing de parâmetro do Nest — o decorator abaixo é só um wrapper fino.
 *
 * Só pode ser usado em rotas já protegidas por
 * `@UseGuards(AccessTokenGuard, PermissionGuard)`: a ausência do contexto
 * aqui é sempre um erro de uso (guard fora de ordem ou ausente), nunca um
 * `undefined` silencioso repassado ao controller — falha fechada com 401.
 */
export function extractAuthorizationContext(
  _data: unknown,
  context: ExecutionContext,
): AuthorizationContextType {
  const request = context.switchToHttp().getRequest<Request>();
  if (!request.authorizationContext) {
    throw new UnauthorizedException(
      'Contexto de autorização ausente — a rota precisa usar PermissionGuard antes deste decorator.',
    );
  }
  return request.authorizationContext;
}

export const AuthorizationContext = createParamDecorator(
  extractAuthorizationContext,
);
