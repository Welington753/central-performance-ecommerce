import { ApiProperty } from '@nestjs/swagger';
import type { AccountScope } from '../account-scope.types';
import { UserResponseDto } from './user-response.dto';

/**
 * Resposta de `GET /auth/me` — extensão ADITIVA (Checkpoint 2) de
 * `UserResponseDto`, usada SOMENTE por este endpoint. Login/refresh
 * continuam devolvendo `UserResponseDto` puro, sem os campos novos.
 *
 * `role`/`permissions`/`accountScope`/`mustChangePassword` vêm de
 * `AuthorizationContext` (`PermissionResolverService`), nunca lidos direto
 * do banco por este DTO — nunca inclui `user_permission_overrides`,
 * `passwordHash` nem qualquer token/segredo.
 */
export class CurrentUserResponseDto extends UserResponseDto {
  @ApiProperty({
    nullable: true,
    description:
      'Chave do papel (ADMIN/ANALYST/VIEWER) ou null se o usuário não tem papel.',
  })
  role!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Permission keys canônicas, ordenadas.',
  })
  permissions!: string[];

  @ApiProperty({
    description:
      '{ mode: "ALL" } | { mode: "SELECTED", accountIds: string[] } | { mode: "NONE" }',
  })
  accountScope!: AccountScope;

  @ApiProperty()
  mustChangePassword!: boolean;
}
