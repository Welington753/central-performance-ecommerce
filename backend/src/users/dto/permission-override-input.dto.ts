import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';

/**
 * `permissionKey` NÃO usa `@IsIn(ALL_PERMISSION_KEYS)` aqui de propósito:
 * a validação contra o catálogo acontece no service
 * (`UsersManagementService`), que lança `InvalidPermissionError` — mapeado
 * pelo controller para o código estável `INVALID_PERMISSION`. Fazer isso no
 * DTO daria uma mensagem genérica do `class-validator`, não o código
 * estável pedido.
 */
export class PermissionOverrideInputDto {
  @ApiProperty()
  @IsString()
  permissionKey!: string;

  @ApiProperty()
  @IsBoolean()
  granted!: boolean;
}
