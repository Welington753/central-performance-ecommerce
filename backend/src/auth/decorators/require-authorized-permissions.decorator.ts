import { applyDecorators, UseGuards } from '@nestjs/common';
import type { PermissionKey } from '../../users/permissions.catalog';
import { AccessTokenGuard } from '../guards/access-token.guard';
import {
  PermissionGuard,
  RequirePermissions,
} from '../guards/permission.guard';

/**
 * Composição pronta `AccessTokenGuard -> PermissionGuard` + metadata de
 * permissões exigidas, na ordem certa — só reaproveita os dois guards e o
 * decorator `RequirePermissions` já existentes (nenhuma lógica de
 * autenticação nova aqui). Não usado ainda em nenhum controller existente
 * neste checkpoint; disponível para o checkpoint de proteção das rotas.
 */
export function RequireAuthorizedPermissions(...permissions: PermissionKey[]) {
  return applyDecorators(
    UseGuards(AccessTokenGuard, PermissionGuard),
    RequirePermissions(...permissions),
  );
}
