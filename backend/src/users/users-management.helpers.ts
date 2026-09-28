import type { QueryRunner, Repository } from 'typeorm';
import type { RoleKey } from './permissions.catalog';
import type { Role } from './role.entity';
import {
  RoleNotFoundError,
  UserEmailAlreadyExistsError,
} from './users-management.errors';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Helpers puros e sem estado compartilhados por `UserProvisioningService` e
 * `UserAccessManagementService` — ponto único para evitar duplicar as
 * mesmas regras em mais de um serviço.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function requireRole(
  roleRepository: Repository<Role>,
  roleKey: RoleKey,
): Promise<Role> {
  const role = await roleRepository.findOneBy({ key: roleKey });
  if (!role) throw new RoleNotFoundError();
  return role;
}

export async function safeRollback(queryRunner: QueryRunner): Promise<void> {
  if (queryRunner.isTransactionActive) {
    try {
      await queryRunner.rollbackTransaction();
    } catch {
      // Nunca mascara o erro original em propagação.
    }
  }
}

export function mapUniqueViolation(error: unknown): Error {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === POSTGRES_UNIQUE_VIOLATION) {
    return new UserEmailAlreadyExistsError();
  }
  return error as Error;
}
