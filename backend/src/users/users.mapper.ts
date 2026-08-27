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
  dto.createdAt = user.createdAt;
  dto.updatedAt = user.updatedAt;
  return dto;
}
