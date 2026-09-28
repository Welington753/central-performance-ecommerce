import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PermissionKey } from './permissions.catalog';

/**
 * Exceção individual de permissão, além/aquém do preset do papel do
 * usuário. `granted=true` concede uma permissão que o preset não dá;
 * `granted=false` revoga uma permissão que o preset concederia. Resolução
 * final (papel ∪ overrides `granted=true` − overrides `granted=false`) fica
 * para o service do próximo checkpoint — aqui só o schema.
 *
 * ADMIN não aceita override negativo (decisão de negócio, Checkpoint 1) —
 * não expressável em CHECK constraint sem sub-select entre tabelas (exigiria
 * trigger, evitado neste checkpoint); a regra será aplicada e testada no
 * service que escrever nesta tabela.
 */
@Entity({ name: 'user_permission_overrides' })
@Index(
  'UQ_user_permission_overrides_user_id_permission_key',
  ['userId', 'permissionKey'],
  { unique: true },
)
export class UserPermissionOverride {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'permission_key', type: 'varchar' })
  permissionKey!: PermissionKey;

  @Column({ type: 'boolean' })
  granted!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
