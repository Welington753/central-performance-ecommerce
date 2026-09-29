import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CP1 da funcionalidade "Problemas": schema genérico multi-marketplace para
 * claims/problemas (só o Mercado Livre é implementado agora — colunas
 * `varchar` para tudo que identifica marketplace/valor externo, igual ao
 * padrão de `marketplace_orders`), e as 3 permissões novas
 * (`problems.view`/`problems.manage`/`problems.sync`, 16 -> 19 chaves).
 *
 * Sem repository/upsert, sem sync, sem endpoints — só fundação (ver
 * `docs/architecture.md`: nenhuma tabela aqui referencia classe concreta de
 * conector). `responsibility`/`responsibility_confidence` nascem sempre
 * `UNKNOWN`/`NONE`; nenhuma classificação automática é implementada.
 */
const PREVIOUS_PERMISSION_KEYS_IN_LIST = `(
  'dashboard.view', 'full.view', 'customers.view', 'customers.export',
  'customers.export_personal_data', 'customers.manage_enrichment',
  'goals.view', 'goals.manage', 'integrations.view', 'integrations.manage',
  'sync.view', 'sync.run', 'sync.backfill', 'sync.full_history',
  'users.view', 'users.manage'
)`;

const CURRENT_PERMISSION_KEYS_IN_LIST = `(
  'dashboard.view', 'full.view', 'customers.view', 'customers.export',
  'customers.export_personal_data', 'customers.manage_enrichment',
  'goals.view', 'goals.manage', 'integrations.view', 'integrations.manage',
  'sync.view', 'sync.run', 'sync.backfill', 'sync.full_history',
  'users.view', 'users.manage',
  'problems.view', 'problems.manage', 'problems.sync'
)`;

const NEW_PERMISSION_KEYS = [
  'problems.view',
  'problems.manage',
  'problems.sync',
];

export class MarketplaceProblems1790693652944 implements MigrationInterface {
  name = 'MarketplaceProblems1790693652944';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createMarketplaceProblems(queryRunner);
    await this.createMarketplaceProblemReasons(queryRunner);
    await this.createMarketplaceProblemActions(queryRunner);
    await this.expandPermissionKeys(queryRunner);
  }

  private async createMarketplaceProblems(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_problems" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid NOT NULL,
        "marketplace_order_id" uuid,
        "external_claim_id" varchar NOT NULL,
        "resource" varchar NOT NULL,
        "resource_id" varchar NOT NULL,
        "status" varchar NOT NULL,
        "type" varchar NOT NULL,
        "stage" varchar NOT NULL,
        "site_id" varchar NOT NULL,
        "reason_id" varchar,
        "parent_claim_id" varchar,
        "fulfilled" boolean,
        "quantity_type" varchar,
        "claim_version" varchar,
        "resolution_reason" varchar,
        "resolution_benefited_roles" text[] NOT NULL DEFAULT '{}',
        "resolution_closed_by" varchar,
        "resolution_applied_coverage" boolean,
        "resolution_date" TIMESTAMPTZ,
        "detail_due_date" TIMESTAMPTZ,
        "detail_responsible" varchar,
        "detail_title" varchar,
        "detail_description" text,
        "detail_problem" varchar,
        "reputation_impact" varchar,
        "reputation_has_incentive" boolean,
        "reputation_due_date" TIMESTAMPTZ,
        "responsibility" varchar NOT NULL DEFAULT 'UNKNOWN',
        "responsibility_confidence" varchar NOT NULL DEFAULT 'NONE',
        "responsibility_source" varchar,
        "responsibility_overridden_by_user_id" uuid,
        "responsibility_overridden_at" TIMESTAMPTZ,
        "responsibility_override_reason" text,
        "date_created" TIMESTAMPTZ NOT NULL,
        "last_updated" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_problems" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_problems_marketplace_account_id" FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_marketplace_problems_marketplace_order_id" FOREIGN KEY ("marketplace_order_id")
          REFERENCES "marketplace_orders" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_marketplace_problems_responsibility_overridden_by_user_id" FOREIGN KEY ("responsibility_overridden_by_user_id")
          REFERENCES "users" ("id"),
        CONSTRAINT "CK_marketplace_problems_responsibility_confidence" CHECK (
          "responsibility_confidence" IN ('NONE', 'HEURISTIC_TRIAGE', 'MANUAL')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_problems_account_external_claim_id"
        ON "marketplace_problems" ("marketplace_account_id", "external_claim_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problems_account_status"
        ON "marketplace_problems" ("marketplace_account_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problems_account_date_created"
        ON "marketplace_problems" ("marketplace_account_id", "date_created")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problems_reason_id"
        ON "marketplace_problems" ("reason_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problems_reputation_impact"
        ON "marketplace_problems" ("reputation_impact")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problems_marketplace_order_id"
        ON "marketplace_problems" ("marketplace_order_id")
    `);
  }

  private async createMarketplaceProblemReasons(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_problem_reasons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace" varchar NOT NULL,
        "site_id" varchar NOT NULL,
        "reason_id" varchar NOT NULL,
        "flow" varchar NOT NULL,
        "name" varchar NOT NULL,
        "detail" text,
        "status" varchar NOT NULL,
        "triage" text[] NOT NULL DEFAULT '{}',
        "allowed_flows" text[] NOT NULL DEFAULT '{}',
        "expected_resolutions" text[] NOT NULL DEFAULT '{}',
        "fetched_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_problem_reasons" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_problem_reasons_marketplace_site_reason"
        ON "marketplace_problem_reasons" ("marketplace", "site_id", "reason_id")
    `);
  }

  private async createMarketplaceProblemActions(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_problem_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_problem_id" uuid NOT NULL,
        "player_role" varchar NOT NULL,
        "player_type" varchar NOT NULL,
        "action_code" varchar NOT NULL,
        "mandatory" boolean NOT NULL DEFAULT false,
        "due_date" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_problem_actions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_problem_actions_marketplace_problem_id" FOREIGN KEY ("marketplace_problem_id")
          REFERENCES "marketplace_problems" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problem_actions_marketplace_problem_id"
        ON "marketplace_problem_actions" ("marketplace_problem_id")
    `);
  }

  private async expandPermissionKeys(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        DROP CONSTRAINT "CK_role_permissions_permission_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        ADD CONSTRAINT "CK_role_permissions_permission_key" CHECK (
          "permission_key" IN ${CURRENT_PERMISSION_KEYS_IN_LIST}
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "user_permission_overrides"
        DROP CONSTRAINT "CK_user_permission_overrides_permission_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_permission_overrides"
        ADD CONSTRAINT "CK_user_permission_overrides_permission_key" CHECK (
          "permission_key" IN ${CURRENT_PERMISSION_KEYS_IN_LIST}
        )
    `);

    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_key")
      SELECT r."id", permission_key
      FROM "roles" r, unnest(ARRAY['problems.view', 'problems.manage', 'problems.sync']) AS permission_key
      WHERE r."key" = 'ADMIN'
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_key")
      SELECT r."id", 'problems.view'
      FROM "roles" r
      WHERE r."key" = 'ANALYST'
    `);
    // VIEWER não recebe nenhuma das 3 novas permissões — nenhum INSERT.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      DELETE FROM "role_permissions" WHERE "permission_key" = ANY($1)
    `,
      [NEW_PERMISSION_KEYS],
    );
    await queryRunner.query(
      `
      DELETE FROM "user_permission_overrides" WHERE "permission_key" = ANY($1)
    `,
      [NEW_PERMISSION_KEYS],
    );

    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        DROP CONSTRAINT "CK_role_permissions_permission_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        ADD CONSTRAINT "CK_role_permissions_permission_key" CHECK (
          "permission_key" IN ${PREVIOUS_PERMISSION_KEYS_IN_LIST}
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "user_permission_overrides"
        DROP CONSTRAINT "CK_user_permission_overrides_permission_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "user_permission_overrides"
        ADD CONSTRAINT "CK_user_permission_overrides_permission_key" CHECK (
          "permission_key" IN ${PREVIOUS_PERMISSION_KEYS_IN_LIST}
        )
    `);

    await queryRunner.query(
      `DROP TABLE IF EXISTS "marketplace_problem_actions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_problems"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "marketplace_problem_reasons"`,
    );
  }
}
