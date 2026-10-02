import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import type { UpsertProblemInput } from './mercado-livre-claim-to-problem.mapper';

interface ProblemRow {
  id: string;
  marketplace_order_id: string | null;
  status: string;
  resolution_reason: string | null;
  detail_title: string | null;
  detail_description: string | null;
  detail_responsible: string | null;
  detail_problem: string | null;
  detail_due_date: Date | null;
  reputation_impact: string | null;
  reputation_has_incentive: boolean | null;
  reputation_due_date: Date | null;
  responsibility: string;
  responsibility_confidence: string;
  responsibility_source: string | null;
  responsibility_overridden_by_user_id: string | null;
  responsibility_overridden_at: Date | null;
  responsibility_override_reason: string | null;
  last_checked_at: Date | null;
  updated_at: Date;
  last_updated: Date;
}

interface ActionRow {
  id: string;
  player_role: string;
  player_type: string;
  action_code: string;
  mandatory: boolean;
  due_date: Date | null;
  created_at: Date;
}

describe('MarketplaceProblemsPersistenceService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MarketplaceProblemsPersistenceService;
  let accountId: string;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDataSourceOptions({
        databaseUrl: requireTestDatabaseUrl(),
        nodeEnv: 'test',
      }),
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
    service = new MarketplaceProblemsPersistenceService(dataSource);
  });

  afterAll(async () => {
    // Não deixa usuário/admin sintético órfão no banco compartilhado: outras
    // suítes (ex.: `last-admin-guard`, `users-management`) contam admins reais.
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    accountId = account.id;
  });

  function baseInput(
    overrides: Partial<UpsertProblemInput> = {},
  ): UpsertProblemInput {
    return {
      marketplaceAccountId: accountId,
      externalClaimId: `claim-${randomUUID()}`,
      resource: 'order',
      resourceId: 'r1',
      status: 'opened',
      type: 'mediations',
      stage: 'claim',
      siteId: 'MLB',
      reasonId: 'PDD1234',
      parentClaimId: null,
      fulfilled: false,
      quantityType: 'total',
      claimVersion: '1.0',
      resolutionReason: null,
      resolutionBenefitedRoles: [],
      resolutionClosedBy: null,
      resolutionAppliedCoverage: null,
      resolutionDate: null,
      dateCreated: new Date('2026-01-10T00:00:00.000Z'),
      lastUpdated: new Date('2026-01-10T00:00:00.000Z'),
      detail: { fetched: false },
      reputation: { fetched: false },
      ...overrides,
    };
  }

  async function loadProblem(id: string): Promise<ProblemRow> {
    const [row] = await dataSource.query<ProblemRow[]>(
      `SELECT * FROM marketplace_problems WHERE id = $1`,
      [id],
    );
    return row;
  }

  async function loadActions(problemId: string): Promise<ActionRow[]> {
    return dataSource.query<ActionRow[]>(
      `SELECT * FROM marketplace_problem_actions WHERE marketplace_problem_id = $1 ORDER BY created_at`,
      [problemId],
    );
  }

  describe('inserção nova', () => {
    it('cria com responsibility=UNKNOWN/NONE/NULL vindos do DEFAULT do banco', async () => {
      const result = await service.upsertProblem(baseInput());
      expect(result.accepted).toBe(true);
      expect(result.inserted).toBe(true);
      expect(typeof result.id).toBe('string');
      const row = await loadProblem(result.id!);
      expect(row.responsibility).toBe('UNKNOWN');
      expect(row.responsibility_confidence).toBe('NONE');
      expect(row.responsibility_source).toBeNull();
    });

    it('detail.fetched=false → colunas de detail NULL, nenhuma action', async () => {
      const result = await service.upsertProblem(
        baseInput({ detail: { fetched: false } }),
      );
      const row = await loadProblem(result.id!);
      expect(row.detail_title).toBeNull();
      expect(await loadActions(result.id!)).toHaveLength(0);
    });

    it('detail.fetched=true,value=null → colunas de detail NULL e actions vazias', async () => {
      const result = await service.upsertProblem(
        baseInput({ detail: { fetched: true, value: null } }),
      );
      const row = await loadProblem(result.id!);
      expect(row.detail_title).toBeNull();
      expect(await loadActions(result.id!)).toHaveLength(0);
    });

    it('detail.fetched=true,value={...} com actions → linhas criadas', async () => {
      const result = await service.upsertProblem(
        baseInput({
          detail: {
            fetched: true,
            value: {
              dueDate: new Date('2026-01-20T00:00:00.000Z'),
              responsible: 'seller',
              title: 'Produto não recebido',
              description: 'desc',
              problem: 'not_delivered',
              actions: [
                {
                  playerRole: 'respondent',
                  playerType: 'seller',
                  actionCode: 'allow',
                  mandatory: true,
                  dueDate: null,
                },
              ],
            },
          },
        }),
      );
      const row = await loadProblem(result.id!);
      expect(row.detail_title).toBe('Produto não recebido');
      const actions = await loadActions(result.id!);
      expect(actions).toHaveLength(1);
      expect(actions[0].action_code).toBe('allow');
    });
  });

  describe('update aceito (last_updated mais novo)', () => {
    it('sobrescreve core e substitui detail por inteiro (inclusive zerando um campo)', async () => {
      const created = await service.upsertProblem(
        baseInput({
          detail: {
            fetched: true,
            value: {
              dueDate: null,
              responsible: 'seller',
              title: 'Título antigo',
              description: 'desc antiga',
              problem: 'not_delivered',
              actions: [],
            },
          },
        }),
      );
      const claimId = (await loadProblem(created.id!)).id;

      const updated = await service.upsertProblem(
        baseInput({
          externalClaimId: (
            await dataSource.query<Array<{ external_claim_id: string }>>(
              `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
              [claimId],
            )
          )[0].external_claim_id,
          status: 'closed',
          lastUpdated: new Date('2026-01-11T00:00:00.000Z'),
          detail: {
            fetched: true,
            value: {
              dueDate: null,
              responsible: null,
              title: null,
              description: 'desc nova',
              problem: 'not_delivered',
              actions: [],
            },
          },
        }),
      );
      expect(updated.accepted).toBe(true);
      expect(updated.inserted).toBe(false);
      const row = await loadProblem(updated.id!);
      expect(row.status).toBe('closed');
      expect(row.detail_title).toBeNull();
      expect(row.detail_description).toBe('desc nova');
    });

    it('detail.fetched=true,value=null limpa detail e zera actions mesmo que já existissem', async () => {
      const created = await service.upsertProblem(
        baseInput({
          detail: {
            fetched: true,
            value: {
              dueDate: null,
              responsible: 'seller',
              title: 'Título',
              description: null,
              problem: null,
              actions: [
                {
                  playerRole: 'respondent',
                  playerType: 'seller',
                  actionCode: 'allow',
                  mandatory: false,
                  dueDate: null,
                },
              ],
            },
          },
        }),
      );
      const externalClaimId =
        (await loadProblem(created.id!)) &&
        (
          await dataSource.query<Array<{ external_claim_id: string }>>(
            `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
            [created.id],
          )
        )[0].external_claim_id;
      expect(await loadActions(created.id!)).toHaveLength(1);

      const updated = await service.upsertProblem(
        baseInput({
          externalClaimId,
          lastUpdated: new Date('2026-01-11T00:00:00.000Z'),
          detail: { fetched: true, value: null },
        }),
      );
      const row = await loadProblem(updated.id!);
      expect(row.detail_title).toBeNull();
      expect(await loadActions(updated.id!)).toHaveLength(0);
    });

    it('detail.fetched=false preserva detail e as MESMAS linhas de actions (id/created_at intactos)', async () => {
      const created = await service.upsertProblem(
        baseInput({
          detail: {
            fetched: true,
            value: {
              dueDate: null,
              responsible: 'seller',
              title: 'Título preservado',
              description: null,
              problem: null,
              actions: [
                {
                  playerRole: 'respondent',
                  playerType: 'seller',
                  actionCode: 'allow',
                  mandatory: false,
                  dueDate: null,
                },
              ],
            },
          },
        }),
      );
      const externalClaimId = (
        await dataSource.query<Array<{ external_claim_id: string }>>(
          `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
          [created.id],
        )
      )[0].external_claim_id;
      const actionsBefore = await loadActions(created.id!);
      expect(actionsBefore).toHaveLength(1);

      const updated = await service.upsertProblem(
        baseInput({
          externalClaimId,
          status: 'closed',
          lastUpdated: new Date('2026-01-11T00:00:00.000Z'),
          detail: { fetched: false },
        }),
      );
      const row = await loadProblem(updated.id!);
      expect(row.status).toBe('closed');
      expect(row.detail_title).toBe('Título preservado');
      const actionsAfter = await loadActions(updated.id!);
      expect(actionsAfter).toEqual(actionsBefore);
    });

    it('mesmos 3 estados para reputation (sem aspecto de actions)', async () => {
      const created = await service.upsertProblem(
        baseInput({
          reputation: {
            fetched: true,
            value: { impact: 'affected', hasIncentive: true, dueDate: null },
          },
        }),
      );
      const externalClaimId = (
        await dataSource.query<Array<{ external_claim_id: string }>>(
          `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
          [created.id],
        )
      )[0].external_claim_id;

      const notFetched = await service.upsertProblem(
        baseInput({
          externalClaimId,
          lastUpdated: new Date('2026-01-11T00:00:00.000Z'),
          reputation: { fetched: false },
        }),
      );
      let row = await loadProblem(notFetched.id!);
      expect(row.reputation_impact).toBe('affected');

      const cleared = await service.upsertProblem(
        baseInput({
          externalClaimId,
          lastUpdated: new Date('2026-01-12T00:00:00.000Z'),
          reputation: { fetched: true, value: null },
        }),
      );
      row = await loadProblem(cleared.id!);
      expect(row.reputation_impact).toBeNull();
      expect(row.reputation_has_incentive).toBeNull();
    });
  });

  describe('update rejeitado (last_updated mais antigo)', () => {
    it('linha inteira idêntica antes/depois — core, order, actions, last_checked_at, updated_at', async () => {
      const created = await service.upsertProblem(
        baseInput({
          lastUpdated: new Date('2026-01-15T00:00:00.000Z'),
          detail: {
            fetched: true,
            value: {
              dueDate: null,
              responsible: 'seller',
              title: 'Título',
              description: null,
              problem: null,
              actions: [
                {
                  playerRole: 'respondent',
                  playerType: 'seller',
                  actionCode: 'allow',
                  mandatory: false,
                  dueDate: null,
                },
              ],
            },
          },
        }),
      );
      const externalClaimId = (
        await dataSource.query<Array<{ external_claim_id: string }>>(
          `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
          [created.id],
        )
      )[0].external_claim_id;

      const before = await loadProblem(created.id!);
      const actionsBefore = await loadActions(created.id!);

      const rejected = await service.upsertProblem(
        baseInput({
          externalClaimId,
          status: 'closed',
          lastUpdated: new Date('2026-01-10T00:00:00.000Z'), // mais antigo
          detail: { fetched: true, value: null }, // tentaria limpar — deve ser ignorado
        }),
      );
      expect(rejected).toEqual({ accepted: false, id: null, inserted: false });

      const after = await loadProblem(created.id!);
      const actionsAfter = await loadActions(created.id!);
      expect(after).toEqual(before);
      expect(actionsAfter).toEqual(actionsBefore);
    });
  });

  describe('correção manual sobrevive a um update aceito', () => {
    it('as 6 colunas de responsabilidade permanecem intocadas', async () => {
      const created = await service.upsertProblem(baseInput());
      const externalClaimId = (
        await dataSource.query<Array<{ external_claim_id: string }>>(
          `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
          [created.id],
        )
      )[0].external_claim_id;

      const [role] = await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM roles WHERE key = 'ADMIN' LIMIT 1`,
      );
      const [user] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO users (name, email, password_hash, active, role_id, account_scope_mode)
         VALUES ('Auditor Manual', $1, 'hash', true, $2, 'ALL') RETURNING id`,
        [`auditor-${randomUUID()}@example.com`, role.id],
      );
      const overriddenByUserId = user.id;
      const overriddenAt = new Date('2026-01-11T00:00:00.000Z');
      await dataSource.query(
        `UPDATE marketplace_problems SET
           responsibility = 'SELLER_FAULT',
           responsibility_confidence = 'MANUAL',
           responsibility_source = 'MANUAL_REVIEW',
           responsibility_overridden_by_user_id = $2,
           responsibility_overridden_at = $3,
           responsibility_override_reason = 'Confirmado por auditoria manual'
         WHERE id = $1`,
        [created.id, overriddenByUserId, overriddenAt],
      );

      const updated = await service.upsertProblem(
        baseInput({
          externalClaimId,
          status: 'closed',
          lastUpdated: new Date('2026-01-12T00:00:00.000Z'),
        }),
      );
      expect(updated.accepted).toBe(true);

      const row = await loadProblem(updated.id!);
      expect(row.status).toBe('closed');
      expect(row.responsibility).toBe('SELLER_FAULT');
      expect(row.responsibility_confidence).toBe('MANUAL');
      expect(row.responsibility_source).toBe('MANUAL_REVIEW');
      expect(row.responsibility_overridden_by_user_id).toBe(overriddenByUserId);
      expect(new Date(row.responsibility_overridden_at!).toISOString()).toBe(
        overriddenAt.toISOString(),
      );
      expect(row.responsibility_override_reason).toBe(
        'Confirmado por auditoria manual',
      );
    });
  });

  describe('associação de pedido', () => {
    it('associa quando existe marketplace_orders correspondente', async () => {
      const [order] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO marketplace_orders
            (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created)
          VALUES ($1, 'order-123', 'paid', 'BRL', 100, now()) RETURNING id`,
        [accountId],
      );
      const result = await service.upsertProblem(
        baseInput({ resource: 'order', resourceId: 'order-123' }),
      );
      const row = await loadProblem(result.id!);
      expect(row.marketplace_order_id).toBe(order.id);
    });

    it('permanece NULL quando não existe pedido correspondente (nunca cria pedido)', async () => {
      const result = await service.upsertProblem(
        baseInput({ resource: 'order', resourceId: 'order-inexistente' }),
      );
      const row = await loadProblem(result.id!);
      expect(row.marketplace_order_id).toBeNull();
      const orders = await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM marketplace_orders WHERE external_order_id = 'order-inexistente'`,
      );
      expect(orders).toHaveLength(0);
    });

    it('nunca reassocia um marketplace_order_id já preenchido', async () => {
      const [orderA] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO marketplace_orders
            (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created)
          VALUES ($1, 'order-a', 'paid', 'BRL', 100, now()) RETURNING id`,
        [accountId],
      );
      await dataSource.query(
        `INSERT INTO marketplace_orders
            (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created)
          VALUES ($1, 'order-b', 'paid', 'BRL', 100, now())`,
        [accountId],
      );
      const created = await service.upsertProblem(
        baseInput({ resource: 'order', resourceId: 'order-a' }),
      );
      const externalClaimId = (
        await dataSource.query<Array<{ external_claim_id: string }>>(
          `SELECT external_claim_id FROM marketplace_problems WHERE id = $1`,
          [created.id],
        )
      )[0].external_claim_id;

      const updated = await service.upsertProblem(
        baseInput({
          externalClaimId,
          resourceId: 'order-b',
          lastUpdated: new Date('2026-01-11T00:00:00.000Z'),
        }),
      );
      const row = await loadProblem(updated.id!);
      expect(row.marketplace_order_id).toBe(orderA.id);
    });
  });

  describe('concorrência real', () => {
    it('dois upserts concorrentes (evento novo + evento antigo) para a mesma chave resultam em 1 linha com o estado do evento novo', async () => {
      const externalClaimId = `claim-concurrent-${randomUUID()}`;
      await service.upsertProblem(
        baseInput({
          externalClaimId,
          lastUpdated: new Date('2026-01-10T00:00:00.000Z'),
        }),
      );

      const dataSourceB = new DataSource(
        buildDataSourceOptions({
          databaseUrl: requireTestDatabaseUrl(),
          nodeEnv: 'test',
        }),
      );
      await dataSourceB.initialize();
      const serviceB = new MarketplaceProblemsPersistenceService(dataSourceB);

      try {
        const [oldResult, newResult] = await Promise.all([
          service.upsertProblem(
            baseInput({
              externalClaimId,
              status: 'stale',
              lastUpdated: new Date('2026-01-05T00:00:00.000Z'), // mais antigo que o já persistido
              detail: {
                fetched: true,
                value: {
                  dueDate: null,
                  responsible: null,
                  title: 'NUNCA deve aparecer',
                  description: null,
                  problem: null,
                  actions: [],
                },
              },
            }),
          ),
          serviceB.upsertProblem(
            baseInput({
              externalClaimId,
              status: 'closed',
              lastUpdated: new Date('2026-01-20T00:00:00.000Z'), // mais novo
              detail: {
                fetched: true,
                value: {
                  dueDate: null,
                  responsible: 'seller',
                  title: 'Estado correto',
                  description: null,
                  problem: null,
                  actions: [
                    {
                      playerRole: 'respondent',
                      playerType: 'seller',
                      actionCode: 'allow',
                      mandatory: false,
                      dueDate: null,
                    },
                  ],
                },
              },
            }),
          ),
        ]);

        expect(oldResult.accepted).toBe(false);
        expect(newResult.accepted).toBe(true);

        const rows = await dataSource.query<ProblemRow[]>(
          `SELECT * FROM marketplace_problems WHERE marketplace_account_id = $1 AND external_claim_id = $2`,
          [accountId, externalClaimId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('closed');
        expect(rows[0].detail_title).toBe('Estado correto');

        const actions = await loadActions(rows[0].id);
        expect(actions).toHaveLength(1);
        expect(actions[0].action_code).toBe('allow');
      } finally {
        await dataSourceB.destroy();
      }
    });
  });

  describe('rollback em falha ao inserir action', () => {
    it('reverte problema e associação inteiros quando uma action é inválida', async () => {
      const externalClaimId = `claim-rollback-${randomUUID()}`;
      await expect(
        service.upsertProblem(
          baseInput({
            externalClaimId,
            resource: 'order',
            resourceId: 'order-rollback',
            detail: {
              fetched: true,
              value: {
                dueDate: null,
                responsible: null,
                title: null,
                description: null,
                problem: null,
                actions: [
                  {
                    // player_role é NOT NULL no banco — string vazia passa
                    // pelo TypeScript mas nada garante isso contra um bug
                    // futuro; aqui simulamos a falha com um valor que viola
                    // a coluna NOT NULL de verdade.
                    playerRole: null as unknown as string,
                    playerType: 'seller',
                    actionCode: 'allow',
                    mandatory: false,
                    dueDate: null,
                  },
                ],
              },
            },
          }),
        ),
      ).rejects.toThrow();

      const rows = await dataSource.query<ProblemRow[]>(
        `SELECT * FROM marketplace_problems WHERE marketplace_account_id = $1 AND external_claim_id = $2`,
        [accountId, externalClaimId],
      );
      expect(rows).toHaveLength(0);
      const orders = await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM marketplace_orders WHERE external_order_id = 'order-rollback'`,
      );
      expect(orders).toHaveLength(0);
    });
  });

  describe('validação de entrada', () => {
    it('rejeita lastUpdated inválido antes de abrir transação', async () => {
      await expect(
        service.upsertProblem(
          baseInput({ lastUpdated: new Date('not-a-date') }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('findProblemsNeedingRefresh (CP2-B, item 7 do plano)', () => {
    it('devolve só linhas com resolution_date IS NULL', async () => {
      const openInput = baseInput();
      const closedInput = baseInput({
        resolutionDate: new Date('2026-01-11T00:00:00.000Z'),
      });
      const openResult = await service.upsertProblem(openInput);
      const closedResult = await service.upsertProblem(closedInput);
      const rows = await service.findProblemsNeedingRefresh(accountId, 100);
      const ids = rows.map((r) => r.externalClaimId);
      expect(ids).toContain(openInput.externalClaimId);
      expect(ids).not.toContain(closedInput.externalClaimId);
      expect(openResult.accepted).toBe(true);
      expect(closedResult.accepted).toBe(true);
    });

    it('respeita LIMIT', async () => {
      await service.upsertProblem(baseInput());
      await service.upsertProblem(baseInput());
      await service.upsertProblem(baseInput());
      const rows = await service.findProblemsNeedingRefresh(accountId, 2);
      expect(rows).toHaveLength(2);
    });

    it('ordena por last_checked_at ASC NULLS FIRST, id ASC', async () => {
      // 1º upsert grava last_checked_at = now() (já "verificado"); o 2º tem
      // o `last_checked_at` zerado manualmente depois (simula "nunca
      // verificado" — NULLS FIRST deve colocá-lo antes do 1º).
      const firstInput = baseInput();
      const secondInput = baseInput();
      await service.upsertProblem(firstInput);
      const second = await service.upsertProblem(secondInput);
      await dataSource.query(
        `UPDATE marketplace_problems SET last_checked_at = NULL WHERE id = $1`,
        [second.id],
      );

      const rows = await service.findProblemsNeedingRefresh(accountId, 100);
      const secondPos = rows.findIndex(
        (r) => r.externalClaimId === secondInput.externalClaimId,
      );
      const firstPos = rows.findIndex(
        (r) => r.externalClaimId === firstInput.externalClaimId,
      );
      expect(secondPos).toBeGreaterThanOrEqual(0);
      expect(firstPos).toBeGreaterThanOrEqual(0);
      expect(secondPos).toBeLessThan(firstPos);
    });

    it('devolve a data de criação do problema (acompanha uma eventual quarentena)', async () => {
      const input = baseInput();
      await service.upsertProblem(input);
      const [row] = await service.findProblemsNeedingRefresh(accountId, 10);
      expect(row.dateCreated).toEqual(input.dateCreated);
    });

    it('claim com quarentena pendente AINDA NÃO vencida espera o backoff (nunca fica fixo na frente da fila); vencida ou resolvida volta', async () => {
      const waiting = baseInput();
      const other = baseInput();
      await service.upsertProblem(waiting);
      await service.upsertProblem(other);
      await dataSource.query(
        `UPDATE marketplace_problems SET last_checked_at = NULL
          WHERE external_claim_id = $1`,
        [waiting.externalClaimId],
      );
      const quarantine = async (nextAttempt: string, resolved: boolean) => {
        await dataSource.query(
          `DELETE FROM marketplace_problem_claim_quarantine WHERE marketplace_account_id = $1`,
          [accountId],
        );
        await dataSource.query(
          `INSERT INTO marketplace_problem_claim_quarantine
             (marketplace_account_id, external_claim_id, failure_code, first_seen_at,
              last_seen_at, next_attempt_at, resolved_at)
           VALUES ($1, $2, 'CORE_NOT_FOUND', now(), now(), now() + $3::interval,
                   CASE WHEN $4 THEN now() ELSE NULL END)`,
          [accountId, waiting.externalClaimId, nextAttempt, resolved],
        );
      };
      const ids = async () =>
        (await service.findProblemsNeedingRefresh(accountId, 10)).map(
          (r) => r.externalClaimId,
        );

      await quarantine('1 hour', false);
      expect(await ids()).toEqual([other.externalClaimId]);

      await quarantine('-1 second', false);
      expect((await ids())[0]).toBe(waiting.externalClaimId);

      await quarantine('1 hour', true);
      expect((await ids())[0]).toBe(waiting.externalClaimId);
    });

    it('nunca devolve linha de outra conta', async () => {
      const [otherAccount] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
         VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
        [`conta-${randomUUID()}`],
      );
      await service.upsertProblem(
        baseInput({ marketplaceAccountId: otherAccount.id }),
      );
      const rows = await service.findProblemsNeedingRefresh(accountId, 100);
      expect(rows).toHaveLength(0);
    });
  });
});
