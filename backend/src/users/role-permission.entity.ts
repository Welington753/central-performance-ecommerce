import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { PermissionKey } from './permissions.catalog';

/**
 * Permissões padrão de cada papel — a favor de `role_id + permission_key`
 * único (nunca duplicado). `permissionKey` é validada por CHECK constraint
 * no banco (mesma lista de 16 chaves do catálogo, hardcoded na migration —
 * ver nota em `permissions.catalog.ts` sobre por que a migration nunca
 * importa este catálogo diretamente).
 */
@Entity({ name: 'role_permissions' })
@Index(
  'UQ_role_permissions_role_id_permission_key',
  ['roleId', 'permissionKey'],
  {
    unique: true,
  },
)
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ name: 'permission_key', type: 'varchar' })
  permissionKey!: PermissionKey;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
