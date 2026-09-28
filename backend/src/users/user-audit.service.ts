import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { UserAuditAction } from './user-audit-action.enum';

/**
 * Ponto ÚNICO de escrita de auditoria de usuários. Contrato nunca aceita
 * senha/hash/token — `changes` só carrega nomes de campo (ver chamadores em
 * `UserProvisioningService`/`UserAccessManagementService`), nunca valor
 * antigo/novo.
 */
@Injectable()
export class UserAuditService {
  async insertAudit(
    queryRunner: QueryRunner,
    entry: {
      actorUserId: string;
      targetUserId: string;
      action: UserAuditAction;
      changes: Record<string, unknown>;
    },
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "user_audit_logs" (actor_user_id, target_user_id, action, changes)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        entry.actorUserId,
        entry.targetUserId,
        entry.action,
        JSON.stringify(entry.changes),
      ],
    );
  }
}
