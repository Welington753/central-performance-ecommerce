import { ConflictException, NotFoundException } from '@nestjs/common';
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
import * as buildAuthorizationUrlModule from './shopee-build-authorization-url';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import type { ShopeeTokenOutcome } from './shopee-http.client';
import { ShopeeHttpClient } from './shopee-http.client';
import { ShopeeOAuthService } from './shopee-oauth.service';

/**
 * Checkpoint CP2D — cobre `startConnection` (início da conexão) e
 * `handleCallback` (orquestração HTTP do callback: outcome → redirect)
 * contra PostgreSQL 16 real. `ShopeeOAuthService` é instanciado diretamente
 * (sem Nest DI), mesmo padrão de `shopee-oauth.service.integration.spec.ts`
 * (CP2C) e `mercado-livre-oauth-callback.integration.spec.ts`.
 */
function fakeConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService {
  const values: Record<string, unknown> = {
    FRONTEND_URL: 'https://app.example.com',
    ML_ACCOUNT_LOCK_WAIT_MS: 500,
    CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
    NODE_ENV: 'production',
    SHOPEE_PARTNER_ID: '1000000',
    SHOPEE_PARTNER_KEY: 'partner-key-example',
    SHOPEE_REDIRECT_URI: 'https://api.example.com/integrations/shopee/callback',
    SHOPEE_ENVIRONMENT: 'PRODUCTION',
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function fakeHttpClient(
  exchangeAuthorizationCode: jest.Mock,
): ShopeeHttpClient {
  return { exchangeAuthorizationCode } as unknown as ShopeeHttpClient;
}

const FIXED_NOW_MS = 1700000000000;
const SUCCESS_TOKEN = {
  accessToken: 'shopee-access-token-example',
  refreshToken: 'shopee-refresh-token-example',
  expiresInSeconds: 14400,
  requestId: 'req-1',
};

function successOutcome(): ShopeeTokenOutcome {
  return { kind: 'success', token: { ...SUCCESS_TOKEN } };
}

describe('ShopeeOAuthService — início da conexão e callback HTTP (Postgres real, Checkpoint CP2D)', () => {
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
    options: {
      configOverrides?: Record<string, unknown>;
      exchangeAuthorizationCode?: jest.Mock;
      clock?: () => number;
    } = {},
  ): ShopeeOAuthService {
    const configService = fakeConfigService(options.configOverrides);
    const credentialsService = new ShopeeCredentialsService(configService);
    return new ShopeeOAuthService(
      marketplaceAccountsService,
      authorizationRequestsService,
      advisoryLockService,
      fakeHttpClient(options.exchangeAuthorizationCode ?? jest.fn()),
      encryptionService,
      credentialsService,
      configService,
      dataSource,
      options.clock ?? (() => FIXED_NOW_MS),
    );
  }

  async function readAccount(id: string = accountId) {
    const rows: Array<{
      status: string;
      token_version: number;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
    }> = await dataSource.query(
      `SELECT status, token_version, encrypted_access_token, encrypted_refresh_token
         FROM marketplace_accounts WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async function readRequestByAccount(id: string = accountId) {
    const rows: Array<{
      status: string;
      state_hash: string;
      encrypted_code_verifier: string | null;
      initiated_by_user_id: string | null;
    }> = await dataSource.query(
      `SELECT status, state_hash, encrypted_code_verifier, initiated_by_user_id
         FROM oauth_authorization_requests WHERE marketplace_account_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    return rows[0];
  }

  describe('startConnection', () => {
    it('13: conta inexistente → NotFoundException', async () => {
      const service = buildService();
      await expect(
        service.startConnection({
          marketplaceAccountId: randomUUID(),
          initiatedByUserId: userId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('14: conta de outro marketplace → NotFoundException, nunca revela o marketplace real', async () => {
      const mlAccountId = randomUUID();
      await dataSource.query(
        `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED')`,
        [mlAccountId],
      );
      const service = buildService();

      await expect(
        service.startConnection({
          marketplaceAccountId: mlAccountId,
          initiatedByUserId: userId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('15: configuração ausente (SHOPEE_PARTNER_ID não definido) → ConflictException SHOPEE_NOT_CONFIGURED, nenhuma tentativa criada', async () => {
      const service = buildService({
        configOverrides: { SHOPEE_PARTNER_ID: undefined },
      });

      await expect(
        service.startConnection({
          marketplaceAccountId: accountId,
          initiatedByUserId: userId,
        }),
      ).rejects.toMatchObject({ message: 'SHOPEE_NOT_CONFIGURED' });

      expect(await readRequestByAccount()).toBeUndefined();
    });

    it('16: Redirect URI inválida → ConflictException INVALID_REDIRECT_URI, nenhuma tentativa criada', async () => {
      const service = buildService({
        configOverrides: {
          SHOPEE_REDIRECT_URI: 'https://api.example.com/wrong/path',
        },
      });

      await expect(
        service.startConnection({
          marketplaceAccountId: accountId,
          initiatedByUserId: userId,
        }),
      ).rejects.toMatchObject({ message: 'INVALID_REDIRECT_URI' });

      expect(await readRequestByAccount()).toBeUndefined();
    });

    it('17/19: cria a tentativa sem PKCE — encryptedCodeVerifier NULL no banco', async () => {
      const service = buildService();
      await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });

      const request = await readRequestByAccount();
      expect(request.encrypted_code_verifier).toBeNull();
    });

    it('18: o state nunca é persistido em texto puro — só stateHash, diferente do state devolvido na URL', async () => {
      const service = buildService();
      const { authorizationUrl } = await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });
      const stateInUrl = new URL(authorizationUrl).searchParams.get('state');

      const request = await readRequestByAccount();
      expect(request.state_hash).not.toBe(stateInUrl);
      expect(request.state_hash.length).toBeGreaterThan(0);
    });

    it('20/36: retorna somente authorizationUrl e cria a tentativa PENDING Shopee', async () => {
      const service = buildService();
      const result = await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });

      expect(Object.keys(result)).toEqual(['authorizationUrl']);
      expect(result.authorizationUrl).toContain(
        'https://open.shopee.com.br/auth',
      );

      const request = await readRequestByAccount();
      expect(request.status).toBe('PENDING');
    });

    it('23: o usuário autenticado vira initiatedByUserId na tentativa', async () => {
      const service = buildService();
      await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });

      const request = await readRequestByAccount();
      expect(request.initiated_by_user_id).toBe(userId);
    });

    it('proteção contra tentativa órfã: falha forçada em buildShopeeAuthorizationUrl DEPOIS de createPending finaliza a tentativa como FAILED, nunca PENDING', async () => {
      const spy = jest
        .spyOn(buildAuthorizationUrlModule, 'buildShopeeAuthorizationUrl')
        .mockImplementation(() => {
          throw new Error('falha forçada pelo teste, depois de createPending');
        });
      const service = buildService();

      await expect(
        service.startConnection({
          marketplaceAccountId: accountId,
          initiatedByUserId: userId,
        }),
      ).rejects.toMatchObject({ message: 'CONNECTION_FAILED' });

      // A tentativa NÃO permanece PENDING — foi fechada imediatamente,
      // nunca dependendo do TTL de 10 minutos.
      const request = await readRequestByAccount();
      expect(request.status).toBe('FAILED');

      const failureCodeRows: Array<{ failure_code: string | null }> =
        await dataSource.query(
          'SELECT failure_code FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
          [accountId],
        );
      // Código interno fechado — nunca detalhe de configuração/URL.
      expect(failureCodeRows[0].failure_code).toBe(
        'AUTHORIZATION_URL_BUILD_FAILED',
      );

      spy.mockRestore();

      // Uma nova tentativa pode ser iniciada normalmente depois da falha —
      // a linha anterior (FAILED, preservada para auditoria) não bloqueia.
      const retry = await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });
      expect(retry.authorizationUrl).toContain(
        'https://open.shopee.com.br/auth',
      );
      const retryRequest = await readRequestByAccount();
      expect(retryRequest.status).toBe('PENDING');

      // A resposta do erro (ConflictException) nunca carrega state/Partner
      // ID/redirectUri — só a mensagem fechada já verificada acima.
    });

    it('22: uma segunda tentativa simultânea (mesma conta, primeira ainda PROCESSING) retorna 409', async () => {
      const service = buildService();
      const first = await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });
      const stateInUrl = new URL(first.authorizationUrl).searchParams.get(
        'state',
      ) as string;
      await authorizationRequestsService.claimByState(
        stateInUrl,
        Marketplace.SHOPEE,
      );

      await expect(
        service.startConnection({
          marketplaceAccountId: accountId,
          initiatedByUserId: userId,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('handleCallback (orquestração HTTP: outcome → redirect)', () => {
    async function startAndGetState(
      service: ShopeeOAuthService,
    ): Promise<string> {
      const { authorizationUrl } = await service.startConnection({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
      });
      return new URL(authorizationUrl).searchParams.get('state') as string;
    }

    it('37/38/39: callback correto conclui SUCCESS, conta fica CONNECTED com tokens cifrados, redirect de sucesso', async () => {
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      const { redirectUrl } = await service.handleCallback({
        state,
        code: 'auth-code-1',
        shopId: '200000',
      });

      expect(redirectUrl).toBe(
        'https://app.example.com/integracoes?shopee=success',
      );

      const account = await readAccount();
      expect(account.status).toBe('CONNECTED');
      expect(account.encrypted_access_token).not.toBeNull();
      expect(
        encryptionService.decrypt(account.encrypted_access_token as string),
      ).toBe(SUCCESS_TOKEN.accessToken);
    });

    it('26: falha do cliente gera redirect de erro com razão pública fechada', async () => {
      const exchange = jest
        .fn()
        .mockResolvedValue({ kind: 'provider_rejected' });
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      const { redirectUrl } = await service.handleCallback({
        state,
        code: 'auth-code-1',
        shopId: '200000',
      });

      expect(redirectUrl).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=CONNECTION_FAILED',
      );
    });

    it('27: query inválida (shopId vazio) não consome a tentativa, nem chama o cliente HTTP', async () => {
      const exchange = jest.fn();
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      const { redirectUrl } = await service.handleCallback({
        state,
        code: 'auth-code-1',
        shopId: '',
      });

      expect(redirectUrl).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(exchange).not.toHaveBeenCalled();

      const request = await readRequestByAccount();
      expect(request.status).toBe('PENDING');
    });

    it('28: um state do Mercado Livre apresentado ao callback Shopee não é consumido, redirect de erro fechado', async () => {
      const mlAccountId = randomUUID();
      await dataSource.query(
        `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED')`,
        [mlAccountId],
      );
      const mlPending = await authorizationRequestsService.createPending({
        marketplaceAccountId: mlAccountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const service = buildService();

      const { redirectUrl } = await service.handleCallback({
        state: mlPending.state,
        code: 'c',
        shopId: '1',
      });

      expect(redirectUrl).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE id = $1',
        [mlPending.id],
      );
      expect(rows[0].status).toBe('PENDING');
    });

    it('29: code/state/shopId nunca aparecem na URL de redirect (sucesso ou falha)', async () => {
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      const { redirectUrl } = await service.handleCallback({
        state,
        code: 'super-secret-auth-code',
        shopId: '200000',
      });

      expect(redirectUrl).not.toContain('super-secret-auth-code');
      expect(redirectUrl).not.toContain(state);
      expect(redirectUrl).not.toContain('200000');
    });

    it('30: nenhum token aparece no resultado do callback (outcome nem redirect)', async () => {
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      const result = await service.handleCallback({
        state,
        code: 'auth-code-1',
        shopId: '200000',
      });

      expect(Object.keys(result)).toEqual(['redirectUrl']);
      expect(result.redirectUrl).not.toContain(SUCCESS_TOKEN.accessToken);
      expect(result.redirectUrl).not.toContain(SUCCESS_TOKEN.refreshToken);
    });

    it('33: FRONTEND_URL inválida (http fora de development) falha de forma fechada (lança, nunca devolve redirect malformado)', async () => {
      const service = buildService({
        configOverrides: {
          FRONTEND_URL: 'http://app.example.com',
          NODE_ENV: 'production',
        },
      });

      await expect(
        service.handleCallback({ state: 's', code: 'c', shopId: '1' }),
      ).rejects.toThrow();
    });

    it('40: uma tentativa já reutilizada (SUCCESS) não pode ser usada de novo', async () => {
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      await service.handleCallback({ state, code: 'c1', shopId: '200000' });
      exchange.mockClear();

      const { redirectUrl } = await service.handleCallback({
        state,
        code: 'c2',
        shopId: '200000',
      });

      expect(redirectUrl).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(exchange).not.toHaveBeenCalled();
    });

    it('41: duas chamadas concorrentes de handleCallback com o mesmo state — só uma conecta', async () => {
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      const [first, second] = await Promise.all([
        service.handleCallback({ state, code: 'c', shopId: '200000' }),
        service.handleCallback({ state, code: 'c', shopId: '200000' }),
      ]);

      const outcomes = [first.redirectUrl, second.redirectUrl].sort();
      expect(outcomes[1]).toBe(
        'https://app.example.com/integracoes?shopee=success',
      );
      expect(outcomes[0]).not.toBe(outcomes[1]);
      expect(exchange).toHaveBeenCalledTimes(1);
    });

    it('35: nenhuma chamada real — exchangeAuthorizationCode é sempre o mock injetado', async () => {
      const exchange = jest.fn().mockResolvedValue(successOutcome());
      const service = buildService({ exchangeAuthorizationCode: exchange });
      const state = await startAndGetState(service);

      await service.handleCallback({ state, code: 'c', shopId: '200000' });

      expect(exchange).toHaveBeenCalledTimes(1);
      expect(exchange).toHaveBeenCalledWith({ code: 'c', shopId: '200000' });
    });
  });
});
