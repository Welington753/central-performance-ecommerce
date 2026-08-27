import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de resposta explícito para usuário — nunca inclui `passwordHash`.
 * Usado por todos os endpoints que retornam dados de usuário
 * (ex.: GET /auth/me, resultado de login/refresh).
 */
export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
