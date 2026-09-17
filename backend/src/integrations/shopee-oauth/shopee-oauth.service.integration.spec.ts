import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { OAuthAuthorizationRequest } from '../mercado-livre-oauth/oauth-authorization-request.entity';
import { OAuthAuthorizationRequestsService } from '../mercado-livre-oauth/oauth-authorization-requests.service';
import type { ShopeeCredentialsService } from './shopee-credentials.service';
import type { ShopeeTokenOutcome } from './shopee-http.client';
import { ShopeeHttpClient } from './shopee-http.client';
import { mapShopeeCallbackOutcomeToPublicReason } from './shopee-callback-reason.mapper';
import { ShopeeOAuthService } from './shopee-oauth.service';

function fakeConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService {
  const values: Record<string, unknown> = {
    // `AdvisoryLockService` lê esta chave independente de marketplace (ver
    // comentário em `advisory-lock.service.ts`) — mantida curta para os
    // testes de lock indisponível não ficarem lentos.
    ML_ACCOUNT_LOCK_WAIT_MS: 500,
    CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

function fakeHttpClient(
  exchangeAuthorizationCode: jest.Mock,
): ShopeeHttpClient {
  return { exchangeAuthorizationCode } as unknown as ShopeeHttpClient;
}

// Este arquivo só exercita `handleAuthorizationCallback`/`handleCallback`
// (nunca `startConnection`, coberto em `shopee-oauth.service.startconnection.
// integration.spec.ts`) — `ShopeeCredentialsService` nunca é chamada pelos
// testes aqui, um stub sem comportamento é suficiente só para satisfazer a
// assinatura do construtor.
function fakeCredentialsService(): ShopeeCredentialsService {
  return {} as unknown as ShopeeCredentialsService;
}

const FIXED_NOW_MS = 1700000000000;
const SUCCESS_TOKEN = {
  accessToken: 'shopee-access-token-example',
  refreshToken: 'shopee-refresh-token-example',
  expiresInSeconds: 14400,
  requestId: 'req-1',
};

function successOutcome(
  overrides: Partial<typeof SUCCESS_TOKEN> = {},
): ShopeeTokenOutcome {
  return { kind: 'success', token: { ...SUCCESS_TOKEN, ...overrides } };
}

describe('ShopeeOAuthService — callback transacional (Postgres real)', () => {
  let dataSource: DataSource;
  let encryptionService: EncryptionService;
  let marketplaceAccountsService: MarketplaceAccountsService;
  let authorizationRequestsService: OAuthAuthorizationRequestsService;
  let advisoryLockService: AdvisoryLockService;
  let accountId: string;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      OAuthAuthorizationRequest,
      MarketplaceAccount,
    ]);
    const configService = fakeConfigService();
    encryptionService = new EncryptionService(configService);
    marketplaceAccountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    authorizationRequestsService = new OAuthAuthorizationRequestsService(
      dataSource,
      encryptionService,
    );
    advisoryLockService = new AdvisoryLockService(dataSource, configService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    accountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'SHOPEE', 'DISCONNECTED')`,
      [accountId],
    );
  });

  function buildService(
    exchangeAuthorizationCode: jest.Mock,
    clock: () => number = () => FIXED_NOW_MS,
  ): ShopeeOAuthService {
    return new ShopeeOAuthService(
      marketplaceAccountsService,
      authorizationRequestsService,
      advisoryLockService,
      fakeHttpClient(exchangeAuthorizationCode),
      encryptionService,
      fakeCredentialsService(),
      fakeConfigService(),
      dataSource,
      clock,
    );
  }

  async function createShopeePending(
    targetAccountId: string = accountId,
  ): ReturnType<OAuthAuthorizationRequestsService['createPending']> {
    return authorizationRequestsService.createPending({
      marketplaceAccountId: targetAccountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.SHOPEE,
      usePkce: false,
    });
  }

  async function readAccount(id: string = accountId) {
    const rows: Array<{
      status: string;
      token_version: number;
      external_seller_id: string | null;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
      token_expires_at: Date | null;
      connected_by_user_id: string | null;
      refresh_failure_count: number;
      refresh_retry_at: Date | null;
      last_refresh_attempt_at: Date | null;
      failure_code: string | null;
      error_summary: string | null;
    }> = await dataSource.query(
      `SELECT status, token_version, external_seller_id, encrypted_access_token,
              encrypted_refresh_token, token_expires_at, connected_by_user_id,
              refresh_failure_count, refresh_retry_at, last_refresh_attempt_at,
              failure_code, error_summary
         FROM marketplace_accounts WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function readRequest(id: string) {
    const rows: Array<{ status: string; failure_code: string | null }> =
      await dataSource.query(
        `SELECT status, failure_code FROM oauth_authorization_requests WHERE id = $1`,
        [id],
      );
    return rows[0];
  }

  describe('sucesso', () => {
    it('1/2/3/4/5/6/7/8/9/10: conecta com tokens cifrados, limpa contadores, e finaliza conta+tentativa consistentemente', async () => {
      const pending = await createShopeePending();
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService(exchange);

      const outcome = await service.handleAuthorizationCallback({
        state: pending.state,
        code: 'auth-code-1',
        shopId: '200000',
      });

      expect(outcome).toEqual({ kind: 'success' });
      expect(exchange).toHaveBeenCalledWith({
        code: 'auth-code-1',
        shopId: '200000',
      });

      const account = await readAccount();
      // 1/3: tokens cifrados, nunca texto puro.
      expect(account.status).toBe('CONNECTED');
      expect(account.encrypted_access_token).not.toBeNull();
      expect(account.encrypted_access_token).not.toBe(
        SUCCESS_TOKEN.accessToken,
      );
      expect(account.encrypted_refresh_token).not.toBe(
        SUCCESS_TOKEN.refreshToken,
      );
      // 2: descriptografia confirma o conteúdo original.
      expect(
        encryptionService.decrypt(account.encrypted_access_token as string),
      ).toBe(SUCCESS_TOKEN.accessToken);
      expect(
        encryptionService.decrypt(account.encrypted_refresh_token as string),
      ).toBe(SUCCESS_TOKEN.refreshToken);
      // 4: o "code" jamais aparece em nenhuma coluna.
      const allColumns = JSON.stringify(account);
      expect(allColumns).not.toContain('auth-code-1');
      // 5: externalSellerId recebe o shopId.
      expect(account.external_seller_id).toBe('200000');
      // 6: tokenExpiresAt usa expiresInSeconds com o relógio injetado.
      expect(account.token_expires_at?.getTime()).toBe(
        FIXED_NOW_MS + SUCCESS_TOKEN.expiresInSeconds * 1000,
      );
      // 7: connectedByUserId vem da tentativa.
      expect(account.connected_by_user_id).toBe(userId);
      // 8: tokenVersion incrementa.
      expect(account.token_version).toBe(1);
      // 9: contadores de refresh limpos.
      expect(account.refresh_failure_count).toBe(0);
      expect(account.refresh_retry_at).toBeNull();
      expect(account.last_refresh_attempt_at).toBeNull();
      expect(account.failure_code).toBeNull();

      // 10: tentativa e conta finalizam consistentemente.
      const request = await readRequest(pending.id);
      expect(request.status).toBe('SUCCESS');
      expect(request.failure_code).toBeNull();

      // 25: o outcome público nunca carrega nada alem do kind.
      expect(Object.keys(outcome)).toEqual(['kind']);
    });
  });

  describe('validação de entrada / state inválido (11-15)', () => {
    it('11: state inexistente nunca chega a consumir nada', async () => {
      const exchange = jest.fn();
      const service = buildService(exchange);

      const outcome = await service.handleAuthorizationCallback({
        state: 'never-existed-state-xyz',
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({ kind: 'invalid_callback' });
      expect(exchange).not.toHaveBeenCalled();
    });

    it('12: state expirado é rejeitado de forma indistinguível de "nunca existiu"', async () => {
      const pending = await createShopeePending();
      await dataSource.query(
        `UPDATE oauth_authorization_requests SET expires_at = now() - interval '1 hour' WHERE id = $1`,
        [pending.id],
      );
      const exchange = jest.fn();
      const service = buildService(exchange);

      const outcome = await service.handleAuthorizationCallback({
        state: pending.state,
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({ kind: 'invalid_callback' });
      expect(exchange).not.toHaveBeenCalled();
    });

    it('13: state já utilizado (consumido por uma chamada anterior) é rejeitado igualmente', async () => {
      const pending = await createShopeePending();
      // Simula um primeiro uso bem-sucedido do state (PENDING → PROCESSING).
      await authorizationRequestsService.claimByState(
        pending.state,
        Marketplace.SHOPEE,
      );

      const exchange = jest.fn();
      const service = buildService(exchange);
      const outcome = await service.handleAuthorizationCallback({
        state: pending.state,
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({ kind: 'invalid_callback' });
      expect(exchange).not.toHaveBeenCalled();
    });

    it('14: uma tentativa do Mercado Livre apresentada ao serviço Shopee é rejeitada SEM consumir/alterar a tentativa do outro marketplace (isolamento cross-marketplace)', async () => {
      const mlPending = await authorizationRequestsService.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const exchange = jest.fn();
      const service = buildService(exchange);

      const outcome = await service.handleAuthorizationCallback({
        state: mlPending.state,
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({ kind: 'invalid_callback' });
      expect(exchange).not.toHaveBeenCalled();

      // `claimByState` agora filtra por marketplace na própria UPDATE
      // atômica — um state do ML nunca casa com expectedMarketplace=SHOPEE,
      // então a tentativa ML permanece PENDING, nunca é tocada.
      const request = await readRequest(mlPending.id);
      expect(request.status).toBe('PENDING');
      expect(request.failure_code).toBeNull();

      const account = await readAccount();
      expect(account.status).toBe('DISCONNECTED');
    });

    it.each(['', '0', '-5', 'abc', '9999999999999999999', '200 000'])(
      '15: shopId inválido ("%s") nunca consome o state nem chama o cliente HTTP',
      async (invalidShopId) => {
        const pending = await createShopeePending();
        const exchange = jest.fn();
        const service = buildService(exchange);

        const outcome = await service.handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: invalidShopId,
        });

        expect(outcome).toEqual({ kind: 'invalid_callback' });
        expect(exchange).not.toHaveBeenCalled();

        const request = await readRequest(pending.id);
        expect(request.status).toBe('PENDING');
      },
    );
  });

  describe('outcomes do ShopeeHttpClient (16-19) — nunca retry, sempre finaliza a tentativa', () => {
    it.each`
      label                    | exchangeOutcome                                                               | expectedFailureCode
      ${'provider_rejected'}   | ${{ kind: 'provider_rejected', providerErrorCode: 'error_auth' }}             | ${'TOKEN_EXCHANGE_REJECTED'}
      ${'rate_limited'}        | ${{ kind: 'rate_limited', retryAfterMs: 30000 }}                              | ${'TOKEN_EXCHANGE_RATE_LIMITED'}
      ${'invalid_response'}    | ${{ kind: 'invalid_response' }}                                               | ${'TOKEN_EXCHANGE_INVALID_RESPONSE'}
      ${'unknown_result'}      | ${{ kind: 'unknown_result' }}                                                 | ${'TOKEN_EXCHANGE_RESULT_UNKNOWN'}
      ${'configuration_error'} | ${{ kind: 'configuration_error', failureCode: 'SHOPEE_NOT_CONFIGURED' }}      | ${'SHOPEE_NOT_CONFIGURED'}
      ${'invalid_request'}     | ${{ kind: 'invalid_request', failureCode: 'INVALID_AUTHORIZATION_RESPONSE' }} | ${'INVALID_AUTHORIZATION_RESPONSE'}
    `(
      '16-19: $label termina a tentativa (sem retry) com failureCode $expectedFailureCode e a conta permanece DISCONNECTED',
      async ({ exchangeOutcome, expectedFailureCode }) => {
        const pending = await createShopeePending();
        const exchange = jest.fn().mockResolvedValue(exchangeOutcome);
        const service = buildService(exchange);

        const outcome = await service.handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: '1',
        });

        expect(outcome).toEqual({ kind: 'connection_failed' });
        expect(exchange).toHaveBeenCalledTimes(1);

        const request = await readRequest(pending.id);
        expect(request.status).toBe('FAILED');
        expect(request.failure_code).toBe(expectedFailureCode);

        const account = await readAccount();
        expect(account.status).toBe('DISCONNECTED');
        expect(account.encrypted_access_token).toBeNull();
      },
    );
  });

  describe('instrumentação segura de provider_rejected (diagnóstico Live)', () => {
    it('registra um log WARN só com o vocabulário seguro autorizado quando a Shopee rejeita a troca', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        const pending = await createShopeePending();
        const exchange = jest.fn().mockResolvedValue({
          kind: 'provider_rejected',
          providerErrorCode: 'error_auth',
        });
        const service = buildService(exchange);

        const outcome = await service.handleAuthorizationCallback({
          state: pending.state,
          code: 'super-secret-code',
          shopId: '1',
        });

        expect(outcome).toEqual({ kind: 'connection_failed' });
        expect(warnSpy).toHaveBeenCalledWith(
          'SHOPEE_TOKEN_EXCHANGE_REJECTED',
          expect.objectContaining({
            failureCode: 'TOKEN_EXCHANGE_REJECTED',
            providerErrorCode: 'error_auth',
            marketplaceAccountId: accountId,
            authorizationRequestId: pending.id,
          }),
        );

        const loggedPayload = JSON.stringify(warnSpy.mock.calls);
        expect(loggedPayload).not.toContain('super-secret-code');
        expect(loggedPayload).not.toContain(pending.state);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('nunca registra o providerErrorCode bruto rejeitado pela sanitização (permanece responsabilidade do ShopeeHttpClient)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        const pending = await createShopeePending();
        const exchange = jest.fn().mockResolvedValue({
          kind: 'provider_rejected',
          providerErrorCode: 'UNCLASSIFIED_PROVIDER_ERROR',
        });
        const service = buildService(exchange);

        await service.handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: '1',
        });

        expect(warnSpy).toHaveBeenCalledWith(
          'SHOPEE_TOKEN_EXCHANGE_REJECTED',
          expect.objectContaining({
            providerErrorCode: 'UNCLASSIFIED_PROVIDER_ERROR',
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it.each`
      label                    | exchangeOutcome
      ${'rate_limited'}        | ${{ kind: 'rate_limited', retryAfterMs: 30000 }}
      ${'invalid_response'}    | ${{ kind: 'invalid_response' }}
      ${'unknown_result'}      | ${{ kind: 'unknown_result' }}
      ${'configuration_error'} | ${{ kind: 'configuration_error', failureCode: 'SHOPEE_NOT_CONFIGURED' }}
      ${'invalid_request'}     | ${{ kind: 'invalid_request', failureCode: 'INVALID_AUTHORIZATION_RESPONSE' }}
    `(
      'nunca registra o log WARN de instrumentação para $label (só provider_rejected)',
      async ({ exchangeOutcome }) => {
        const warnSpy = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation();
        try {
          const pending = await createShopeePending();
          const exchange = jest.fn().mockResolvedValue(exchangeOutcome);
          const service = buildService(exchange);

          await service.handleAuthorizationCallback({
            state: pending.state,
            code: 'c',
            shopId: '1',
          });

          expect(warnSpy).not.toHaveBeenCalledWith(
            'SHOPEE_TOKEN_EXCHANGE_REJECTED',
            expect.anything(),
          );
        } finally {
          warnSpy.mockRestore();
        }
      },
    );

    it('o motivo público continua exatamente CONNECTION_FAILED para provider_rejected', () => {
      expect(mapShopeeCallbackOutcomeToPublicReason('connection_failed')).toBe(
        'CONNECTION_FAILED',
      );
    });
  });

  describe('falha de criptografia (20)', () => {
    it('nenhum token parcial é persistido quando a cifragem falha', async () => {
      const pending = await createShopeePending();
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService(exchange);

      const encryptSpy = jest
        .spyOn(encryptionService, 'encrypt')
        .mockImplementation(() => {
          throw new Error('boom');
        });

      try {
        const outcome = await service.handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: '1',
        });

        expect(outcome).toEqual({ kind: 'connection_failed' });

        const account = await readAccount();
        expect(account.status).toBe('DISCONNECTED');
        expect(account.encrypted_access_token).toBeNull();
        expect(account.encrypted_refresh_token).toBeNull();

        const request = await readRequest(pending.id);
        expect(request.status).toBe('FAILED');
        expect(request.failure_code).toBe('CREDENTIAL_ENCRYPTION_FAILED');
      } finally {
        encryptSpy.mockRestore();
      }
    });
  });

  describe('conflito de tokenVersion (21)', () => {
    it('uma conexão concorrente vencendo a corrida faz esta chamada terminar em TOKEN_RESULT_NOT_COMMITTED, sem sobrescrever o estado mais novo', async () => {
      const pending = await createShopeePending();

      // Simula uma segunda conexão concorrente completando DEPOIS que este
      // fluxo já leu `expectedTokenVersion`, mas ANTES do CAS: o mock só
      // bate o token_version na primeira vez que é chamado (imitando outra
      // requisição vencendo a corrida enquanto a Shopee processa esta).
      const exchange = jest.fn().mockImplementation(async () => {
        await dataSource.query(
          `UPDATE marketplace_accounts SET token_version = token_version + 1 WHERE id = $1`,
          [accountId],
        );
        return successOutcome();
      });
      const service = buildService(exchange);

      const outcome = await service.handleAuthorizationCallback({
        state: pending.state,
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({ kind: 'connection_failed' });

      const request = await readRequest(pending.id);
      expect(request.status).toBe('FAILED');
      expect(request.failure_code).toBe('TOKEN_RESULT_NOT_COMMITTED');

      // O estado mais novo (token_version bumped pela "conexão concorrente")
      // nunca é sobrescrito/revertido.
      const account = await readAccount();
      expect(account.token_version).toBe(1);
      expect(account.status).toBe('DISCONNECTED');
    });
  });

  describe('shopId já conectado em outra conta (22)', () => {
    it('rejeita com SHOP_ALREADY_CONNECTED e marca a segunda conta em ERROR, preservando a primeira conexão intacta', async () => {
      const firstAccountId = randomUUID();
      await dataSource.query(
        `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'SHOPEE', 'DISCONNECTED')`,
        [firstAccountId],
      );
      const firstPending = await createShopeePending(firstAccountId);
      const firstExchange = jest.fn().mockResolvedValue(successOutcome());
      await buildService(firstExchange).handleAuthorizationCallback({
        state: firstPending.state,
        code: 'c1',
        shopId: '555000',
      });

      const secondPending = await createShopeePending(accountId);
      const secondExchange = jest
        .fn()
        .mockResolvedValue(
          successOutcome({ accessToken: 'other-access-token' }),
        );
      const outcome = await buildService(
        secondExchange,
      ).handleAuthorizationCallback({
        state: secondPending.state,
        code: 'c2',
        shopId: '555000',
      });

      expect(outcome).toEqual({ kind: 'connection_failed' });

      const secondRequest = await readRequest(secondPending.id);
      expect(secondRequest.status).toBe('FAILED');
      expect(secondRequest.failure_code).toBe('SHOP_ALREADY_CONNECTED');

      const secondAccount = await readAccount(accountId);
      expect(secondAccount.status).toBe('ERROR');
      expect(secondAccount.failure_code).toBe('SHOP_ALREADY_CONNECTED');
      expect(secondAccount.external_seller_id).toBeNull();

      const firstAccount = await readAccount(firstAccountId);
      expect(firstAccount.status).toBe('CONNECTED');
      expect(firstAccount.external_seller_id).toBe('555000');
    });
  });

  describe('lock indisponível (23)', () => {
    it('quando o advisory lock da conta já está em uso, finaliza a tentativa com ACCOUNT_BUSY e devolve lock_unavailable, sem chamar o cliente HTTP', async () => {
      const pending = await createShopeePending();
      const exchange = jest.fn();
      const service = buildService(exchange);

      const heldLock = await advisoryLockService.tryAcquire(accountId);
      expect(heldLock).not.toBeNull();

      try {
        const outcome = await service.handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: '1',
        });

        expect(outcome).toEqual({ kind: 'lock_unavailable' });
        expect(exchange).not.toHaveBeenCalled();

        const request = await readRequest(pending.id);
        expect(request.status).toBe('FAILED');
        expect(request.failure_code).toBe('ACCOUNT_BUSY');
      } finally {
        await heldLock?.release();
      }
    });
  });

  describe('duas callbacks concorrentes (24)', () => {
    it('exatamente uma das duas chamadas (mesmo state, repetido) tem sucesso; a conta termina CONNECTED com tokenVersion=1', async () => {
      const pending = await createShopeePending();
      const exchange = jest.fn().mockResolvedValue(successOutcome());

      const [first, second] = await Promise.all([
        buildService(exchange).handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: '1',
        }),
        buildService(exchange).handleAuthorizationCallback({
          state: pending.state,
          code: 'c',
          shopId: '1',
        }),
      ]);

      const kinds = [first.kind, second.kind].sort();
      expect(kinds).toEqual(['invalid_callback', 'success']);

      const account = await readAccount();
      expect(account.status).toBe('CONNECTED');
      expect(account.token_version).toBe(1);
    });
  });

  describe('nenhum segredo em nenhum outcome (25)', () => {
    it('todo outcome possível carrega apenas { kind }, nunca code/state/shopId/tokens', async () => {
      const outcomes: unknown[] = [];

      outcomes.push(
        await buildService(jest.fn()).handleAuthorizationCallback({
          state: 'nope',
          code: 'secret-code',
          shopId: '1',
        }),
      );

      const pending = await createShopeePending();
      outcomes.push(
        await buildService(
          jest.fn().mockResolvedValue({ kind: 'provider_rejected' }),
        ).handleAuthorizationCallback({
          state: pending.state,
          code: 'secret-code-2',
          shopId: '999',
        }),
      );

      for (const outcome of outcomes) {
        expect(Object.keys(outcome as object)).toEqual(['kind']);
        const serialized = JSON.stringify(outcome);
        expect(serialized).not.toContain('secret-code');
        expect(serialized).not.toContain('999');
      }
    });
  });
});
