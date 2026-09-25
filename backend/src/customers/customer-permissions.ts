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
import type { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

/**
 * Permissões da função "Clientes". Primeira versão: TODAS exigem
 * administrador (`users.is_admin`) — `hasCustomerPermission` é o único ponto
 * a trocar quando papéis granulares existirem.
 */
export const CUSTOMER_PERMISSIONS = {
  VIEW: 'clientes.visualizar',
  EXPORT: 'clientes.exportar',
  EXPORT_PERSONAL_DATA: 'clientes.exportar_dados_pessoais',
  MANAGE_ENRICHMENT: 'clientes.gerenciar_enriquecimento',
} as const;

export type CustomerPermission =
  (typeof CUSTOMER_PERMISSIONS)[keyof typeof CUSTOMER_PERMISSIONS];

const CUSTOMER_PERMISSIONS_KEY = 'customerPermissions';

export const RequireCustomerPermissions = (
  ...permissions: CustomerPermission[]
) => SetMetadata(CUSTOMER_PERMISSIONS_KEY, permissions);

export function hasCustomerPermission(
  user: Pick<User, 'active' | 'isAdmin'>,
  _permission: CustomerPermission,
): boolean {
  return user.active && user.isAdmin;
}

/**
 * Sempre composto DEPOIS de `AccessTokenGuard`. Relê o usuário do banco a
 * cada requisição (mesmo padrão de `AdminGuard`) — nunca confia no JWT para
 * decidir permissão.
 */
@Injectable()
export class CustomerPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<CustomerPermission[] | undefined>(
        CUSTOMER_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    const payload = context.switchToHttp().getRequest<Request>().user;
    if (!payload) throw new UnauthorizedException('Não autenticado.');

    const user = await this.usersService.findById(payload.sub);
    if (
      !user ||
      required.length === 0 ||
      !required.every((permission) => hasCustomerPermission(user, permission))
    ) {
      throw new ForbiddenException('CUSTOMER_PERMISSION_REQUIRED');
    }
    return true;
  }
}
