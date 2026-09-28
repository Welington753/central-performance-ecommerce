import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkpoint 1 de Usuários/Papéis/Permissões granulares: cria o schema de
 * RBAC (papéis, permissões por papel, overrides individuais, escopo de
 * contas, auditoria) e migra usuários preexistentes a partir de `is_admin`
 * — sem remover `is_admin` (ver `1788600000000-users-is-admin.ts`) e sem
 * criar nenhum guard/endpoint novo (isso é de checkpoints seguintes).
 *
 * As 16 permission keys e os 3 presets de papel estão hardcoded como
 * literais SQL aqui de propósito — NUNCA importa `users/permissions.catalog.ts`
 * (constante da aplicação): a migration precisa ser independente do estado
 * futuro do código (ex.: alguém renomeando/reordenando o catálogo não pode
 * mudar silenciosamente o que já foi inserido em produção). O alinhamento
 * entre catálogo e o que esta migration insere é garantido por teste de
 * integração (`database/users-roles-permissions-migration.integration.spec.ts`),
 * não por import compartilhado.
 *
 * `account_scope_mode` é fail-closed por definição: 'ALL' | 'SELECTED' |
 * 'NONE', nunca "ausência de linha em user_account_scope = tudo liberado".
 * Usuários preexistentes (admin ou não) recebem 'ALL' para preservar
 * exatamente a visão que já tinham antes de existir qualquer restrição;
 * usuários novos, a partir de agora, nascem 'NONE' pelo DEFAULT da coluna.
 *
 * `role_id` é NOT NULL (Checkpoint 3 — ajuste feito nesta MESMA migration,
 * ainda não implantada, nunca numa segunda migration): o backfill abaixo
 * preenche TODO usuário preexistente antes do `ALTER COLUMN ... SET NOT
 * NULL`, então nenhuma linha jamais fica sem papel neste caminho. Todo
 * caminho de criação de usuário (`UsersService.createUser`, seed,
 * `UsersManagementService.create`) é obrigado a informar `role_id`.
 *
 * "ADMIN não aceita override negativo" e "não permitir desativar/rebaixar o
 * último administrador" são regras de negócio que dependem de outras linhas
 * da própria tabela (papel do usuário, quantos admins ativos existem) — não
 * expressáveis em CHECK constraint sem trigger. Por decisão explícita deste
 * checkpoint (evitar trigger complexo sem necessidade), ficam para o service
 * que vier a escrever nestas tabelas, comprovadas por teste (inclusive de
 * concorrência, para o caso do último admin).
 */
const PERMISSION_KEYS_IN_LIST = `(
  'dashboard.view', 'full.view', 'customers.view', 'customers.export',
  'customers.export_personal_data', 'customers.manage_enrichment',
  'goals.view', 'goals.manage', 'integrations.view', 'integrations.manage',
  'sync.view', 'sync.run', 'sync.backfill', 'sync.full_history',
  'users.view', 'users.manage'
)`;

const ALL_PERMISSION_KEYS_ARRAY_LITERAL = `ARRAY[
  'dashboard.view', 'full.view', 'customers.view', 'customers.export',
  'customers.export_personal_data', 'customers.manage_enrichment',
  'goals.view', 'goals.manage', 'integrations.view', 'integrations.manage',
  'sync.view', 'sync.run', 'sync.backfill', 'sync.full_history',
  'users.view', 'users.manage'
]`;

export class UsersRolesPermissions1790594851607 implements MigrationInterface {
  name = 'UsersRolesPermissions1790594851607';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createRoles(queryRunner);
    await this.createRolePermissions(queryRunner);
    await this.seedRolePermissions(queryRunner);
    await this.alterUsers(queryRunner);
    await this.backfillUsers(queryRunner);
    await this.createUserPermissionOverrides(queryRunner);
    await this.createUserAccountScope(queryRunner);
    await this.createUserAuditLogs(queryRunner);
  }

  private async createRoles(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" varchar NOT NULL,
        "name" varchar NOT NULL,
        "is_system" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_roles_key" ON "roles" ("key")
    `);
    await queryRunner.query(`
      INSERT INTO "roles" ("key", "name") VALUES
        ('ADMIN', 'Administrador'),
        ('ANALYST', 'Analista'),
        ('VIEWER', 'Visualizador')
    `);
  }

  private async createRolePermissions(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role_id" uuid NOT NULL,
        "permission_key" varchar NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_permissions_role_id" FOREIGN KEY ("role_id")
          REFERENCES "roles" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_role_permissions_permission_key" CHECK (
          "permission_key" IN ${PERMISSION_KEYS_IN_LIST}
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_role_permissions_role_id_permission_key"
        ON "role_permissions" ("role_id", "permission_key")
    `);
  }

  private async seedRolePermissions(queryRunner: QueryRunner): Promise<void> {
    // ADMIN: catálogo inteiro — sempre em sincronia com o CHECK constraint
    // acima (a mesma lista), nunca uma lista separada que possa divergir.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_key")
      SELECT r."id", permission_key
      FROM "roles" r, unnest(${ALL_PERMISSION_KEYS_ARRAY_LITERAL}) AS permission_key
      WHERE r."key" = 'ADMIN'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_key")
      SELECT r."id", permission_key
      FROM "roles" r, unnest(ARRAY[
        'dashboard.view', 'full.view', 'customers.view', 'customers.export',
        'goals.view', 'integrations.view', 'sync.view'
      ]) AS permission_key
      WHERE r."key" = 'ANALYST'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_key")
      SELECT r."id", permission_key
      FROM "roles" r, unnest(ARRAY[
        'dashboard.view', 'full.view', 'goals.view', 'integrations.view',
        'sync.view'
      ]) AS permission_key
      WHERE r."key" = 'VIEWER'
    `);
  }

  private async alterUsers(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "role_id" uuid,
        ADD COLUMN "account_scope_mode" varchar NOT NULL DEFAULT 'NONE',
        ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false,
        ADD COLUMN "password_changed_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CK_users_account_scope_mode" CHECK (
          "account_scope_mode" IN ('ALL', 'SELECTED', 'NONE')
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_role_id" FOREIGN KEY ("role_id")
          REFERENCES "roles" ("id")
    `);
  }

  private async backfillUsers(queryRunner: QueryRunner): Promise<void> {
    // Preserva exatamente a visão que cada usuário preexistente já tinha:
    // 'ALL' para ambos (nunca 'NONE'/'SELECTED', que restringiriam algo que
    // hoje é irrestrito). Só o papel muda conforme `is_admin`.
    await queryRunner.query(`
      UPDATE "users"
      SET "role_id" = (SELECT "id" FROM "roles" WHERE "key" = 'ADMIN'),
          "account_scope_mode" = 'ALL'
      WHERE "is_admin" = true
    `);
    await queryRunner.query(`
      UPDATE "users"
      SET "role_id" = (SELECT "id" FROM "roles" WHERE "key" = 'VIEWER'),
          "account_scope_mode" = 'ALL'
      WHERE "is_admin" = false
    `);
    // Todo usuário preexistente já foi preenchido pelos dois UPDATEs acima
    // (is_admin é sempre true OU false) — seguro aplicar NOT NULL agora.
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL
    `);
  }

  private async createUserPermissionOverrides(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_permission_overrides" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "permission_key" varchar NOT NULL,
        "granted" boolean NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_permission_overrides" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_permission_overrides_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_user_permission_overrides_permission_key" CHECK (
          "permission_key" IN ${PERMISSION_KEYS_IN_LIST}
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_permission_overrides_user_id_permission_key"
        ON "user_permission_overrides" ("user_id", "permission_key")
    `);
  }

  private async createUserAccountScope(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_account_scope" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "marketplace_account_id" uuid NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_account_scope" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_account_scope_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_account_scope_marketplace_account_id" FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_account_scope_user_id_marketplace_account_id"
        ON "user_account_scope" ("user_id", "marketplace_account_id")
    `);
  }

  private async createUserAuditLogs(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_user_id" uuid NOT NULL,
        "target_user_id" uuid NOT NULL,
        "action" varchar NOT NULL,
        "changes" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "CK_user_audit_logs_action" CHECK (
          "action" IN (
            'USER_CREATED', 'USER_UPDATED', 'USER_ACTIVATED', 'USER_DEACTIVATED',
            'PASSWORD_RESET', 'PASSWORD_CHANGED', 'ROLE_CHANGED',
            'PERMISSIONS_CHANGED', 'ACCOUNT_SCOPE_CHANGED'
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_audit_logs_target_user_id" ON "user_audit_logs" ("target_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_audit_logs_created_at" ON "user_audit_logs" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_account_scope"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_permission_overrides"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "FK_users_role_id",
        DROP CONSTRAINT IF EXISTS "CK_users_account_scope_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "password_changed_at",
        DROP COLUMN IF EXISTS "must_change_password",
        DROP COLUMN IF EXISTS "account_scope_mode",
        DROP COLUMN IF EXISTS "role_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
