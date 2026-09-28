import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '../../users/permissions.catalog';
import { AuthorizationContextService } from '../authorization-context.service';

const REQUIRE_ALL_PERMISSIONS_KEY = 'requireAllPermissions';
const REQUIRE_ANY_PERMISSION_KEY = 'requireAnyPermission';

/** Exige TODAS as permissões informadas. Só aceita `PermissionKey` tipada — nunca string solta. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRE_ALL_PERMISSIONS_KEY, permissions);

/** Exige PELO MENOS UMA das permissões informadas. */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRE_ANY_PERMISSION_KEY, permissions);

/**
 * Fundação de autorização (Checkpoint 2) — substituirá `AdminGuard`/
 * `CustomerPermissionGuard` num checkpoint futuro. SEMPRE composto DEPOIS
 * de `AccessTokenGuard` (`@UseGuards(AccessTokenGuard, PermissionGuard)`,
 * ou via o decorator composto `RequireAuthorizedPermissions`) — depende de
 * `request.user` já populado.
 *
 * Ainda NÃO aplicado em nenhum controller existente neste checkpoint.
 *
 * Fail-closed por padrão: uma rota que tenha o guard mas nenhum
 * `@RequirePermissions`/`@RequireAnyPermission` NUNCA é liberada por
 * acidente — nega antes mesmo de resolver o contexto de autorização.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContextService: AuthorizationContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireAll = this.reflector.getAllAndOverride<
      PermissionKey[] | undefined
    >(REQUIRE_ALL_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const requireAny = this.reflector.getAllAndOverride<
      PermissionKey[] | undefined
    >(REQUIRE_ANY_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    const hasAllMetadata = Array.isArray(requireAll) && requireAll.length > 0;
    const hasAnyMetadata = Array.isArray(requireAny) && requireAny.length > 0;
    if (!hasAllMetadata && !hasAnyMetadata) {
      // Nem resolve o contexto — rota sem metadata de permissão nunca é
      // liberada por acidente, custe o que custar.
      throw new ForbiddenException('PERMISSION_METADATA_REQUIRED');
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new UnauthorizedException('Não autenticado.');
    }

    const authorization =
      await this.authorizationContextService.resolveForRequest(request);
    if (!authorization.active) {
      throw new ForbiddenException('PERMISSION_REQUIRED');
    }

    // Checkpoint 3: nenhuma rota protegida por PermissionGuard funciona
    // antes da troca de senha obrigatória — nunca vira logout (o usuário
    // continua autenticado; só as rotas COM permissão ficam bloqueadas).
    // `/auth/me`, `/auth/change-password`, `/auth/logout`, `/auth/refresh`
    // nunca usam este guard, então continuam acessíveis.
    if (authorization.mustChangePassword) {
      throw new ForbiddenException('PASSWORD_CHANGE_REQUIRED');
    }

    if (hasAllMetadata) {
      const missing = requireAll.some(
        (permission) => !authorization.permissions.includes(permission),
      );
      if (missing) {
        throw new ForbiddenException('PERMISSION_REQUIRED');
      }
    }

    if (hasAnyMetadata) {
      const hasOne = requireAny.some((permission) =>
        authorization.permissions.includes(permission),
      );
      if (!hasOne) {
        throw new ForbiddenException('PERMISSION_REQUIRED');
      }
    }

    return true;
  }
}
