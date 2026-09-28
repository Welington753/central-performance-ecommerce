import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthorizationContext } from '../users/authorization-context.interface';
import { PermissionResolverService } from '../users/permission-resolver.service';

/**
 * Envelope de request-scoping SEM usar Nest's `Scope.REQUEST` (que recria a
 * cadeia inteira de dependências a cada requisição): anexa o resultado ao
 * próprio objeto `Request` do Express (que já é recriado a cada requisição
 * pelo framework), igual ao `request.user` já populado por
 * `AccessTokenGuard`. Nunca variável de módulo/estático — isso vazaria
 * entre requisições concorrentes.
 *
 * Consumido por `PermissionGuard` e, no futuro, por services de
 * analytics/sincronização/integração que precisem do escopo de contas do
 * usuário sem reconsultar o banco.
 */
@Injectable()
export class AuthorizationContextService {
  constructor(private readonly resolver: PermissionResolverService) {}

  async resolveForRequest(request: Request): Promise<AuthorizationContext> {
    if (request.authorizationContext) {
      return request.authorizationContext;
    }

    const payload = request.user;
    if (!payload) {
      throw new UnauthorizedException('Não autenticado.');
    }

    const context = await this.resolver.resolve(payload.sub);
    request.authorizationContext = context;
    return context;
  }
}
