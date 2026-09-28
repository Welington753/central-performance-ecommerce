import type { AuthorizationContext } from './authorization-context.interface';
import { CurrentUserResponseDto } from './dto/current-user-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { User } from './user.entity';

/**
 * Mapeia explicitamente uma entidade `User` para o DTO de resposta público,
 * garantindo que `passwordHash` nunca vaze em uma resposta HTTP.
 */
export function toUserResponse(user: User): UserResponseDto {
  const dto = new UserResponseDto();
  dto.id = user.id;
  dto.name = user.name;
  dto.email = user.email;
  dto.active = user.active;
  dto.isAdmin = user.isAdmin;
  dto.createdAt = user.createdAt;
  dto.updatedAt = user.updatedAt;
  return dto;
}

/**
 * Usado SOMENTE por `GET /auth/me` (Checkpoint 2) — combina o contrato
 * público já existente (`toUserResponse`) com o `AuthorizationContext`
 * recém-resolvido. `isAdmin` continua vindo da coluna do usuário (não do
 * contexto) por compatibilidade — hoje os dois são equivalentes (backfill
 * do Checkpoint 1), mas o contrato antigo nunca deve mudar de fonte.
 */
export function toCurrentUserResponse(
  user: User,
  authorization: AuthorizationContext,
): CurrentUserResponseDto {
  const dto = new CurrentUserResponseDto();
  Object.assign(dto, toUserResponse(user));
  dto.role = authorization.roleKey;
  dto.permissions = [...authorization.permissions];
  dto.accountScope = authorization.accountScope;
  dto.mustChangePassword = authorization.mustChangePassword;
  return dto;
}
