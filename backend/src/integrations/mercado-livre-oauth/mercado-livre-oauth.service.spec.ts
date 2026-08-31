import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { OAuthConnectionInProgressError } from './oauth-authorization-requests.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: null,
    nickname: null,
    status: MarketplaceAccountStatus.DISCONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 0,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function configService(): ConfigService {
  const values: Record<string, unknown> = {
    ML_CLIENT_ID: 'app-id',
    ML_REDIRECT_URI:
      'https://api.example.com/integrations/mercado-livre/callback',
  };
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('MercadoLivreOAuthService.startConnection', () => {
  it('builds an authorization URL when the account is connectable', async () => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
    };
    const authorizationRequestsService = {
      createPending: jest.fn().mockResolvedValue({
        id: 'req-1',
        state: 'state-value',
        codeChallenge: 'challenge-value',
      }),
    };

    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      authorizationRequestsService as never,
      {} as never, // AdvisoryLockService, unused by startConnection
      {} as never, // MercadoLivreHttpClient, unused by startConnection
      {} as never, // EncryptionService, unused by startConnection
      configService(),
      {} as never, // DataSource, unused by startConnection
    );

    const result = await service.startConnection({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
    });

    expect(result.authorizationUrl).toContain('state=state-value');
    expect(result.authorizationUrl).toContain('code_challenge=challenge-value');
    expect(authorizationRequestsService.createPending).toHaveBeenCalledWith({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
      marketplace: Marketplace.MERCADO_LIVRE,
    });
  });

  it.each([Marketplace.AMAZON, Marketplace.SHOPEE])(
    'rejects with NotFoundException when the account marketplace is %s',
    async (marketplace) => {
      const marketplaceAccountsService = {
        findByIdOrFail: jest.fn().mockResolvedValue(account({ marketplace })),
      };
      const service = new MercadoLivreOAuthService(
        marketplaceAccountsService as never,
        { createPending: jest.fn() } as never,
        {} as never,
        {} as never,
        {} as never,
        configService(),
        {} as never,
      );

      await expect(
        service.startConnection({
          marketplaceAccountId: 'acc-1',
          initiatedByUserId: 'u',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('maps OAuthConnectionInProgressError to a 409 ConflictException', async () => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
    };
    const authorizationRequestsService = {
      createPending: jest
        .fn()
        .mockRejectedValue(new OAuthConnectionInProgressError()),
    };
    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      authorizationRequestsService as never,
      {} as never,
      {} as never,
      {} as never,
      configService(),
      {} as never,
    );

    await expect(
      service.startConnection({
        marketplaceAccountId: 'acc-1',
        initiatedByUserId: 'u',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

interface FakeQueryRunner {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  query: jest.Mock;
  readonly isTransactionActive: boolean;
}

// `isTransactionActive` replica o campo real de `QueryRunner`: começa
// `false`, vira `true` quando `startTransaction()` resolve, e volta a
// `false` quando `commitTransaction()`/`rollbackTransaction()` resolve —
// exatamente o que `applyConnectionAndFinalizeAtomically` inspeciona antes
// de decidir se chama `rollbackTransaction()` em seu `catch`. Overrides que
// substituem `startTransaction`/`commitTransaction`/`rollbackTransaction`
// por um mock que rejeita (para simular exceção) preservam esse
// comportamento por padrão — a implementação de overrides fica responsável
// por deixar `isTransactionActive` num estado coerente com o que o mock
// simula (ver testes de injeção de exceção abaixo).
function makeFakeQueryRunner(
  overrides: Partial<Omit<FakeQueryRunner, 'isTransactionActive'>> = {},
): FakeQueryRunner {
  const state = { active: false };
  const runner = {
    connect: jest.fn().mockResolvedValue(undefined),
    // Sem `async`/`await` interno (divergência mínima do plano, verificação
    // de lint `@typescript-eslint/require-await`): `await` sobre um valor
    // não-Promise resolve normalmente, preservando o comportamento (mutação
    // síncrona de `state.active`) que os testes de injeção de exceção abaixo
    // dependem.
    startTransaction: jest.fn().mockImplementation(() => {
      state.active = true;
    }),
    commitTransaction: jest.fn().mockImplementation(() => {
      state.active = false;
    }),
    rollbackTransaction: jest.fn().mockImplementation(() => {
      state.active = false;
    }),
    release: jest.fn().mockResolvedValue(undefined),
    // Resultado padrão: o UPDATE de oauth_authorization_requests (a única
    // query que a implementação real dispara diretamente neste QueryRunner
    // — `applySuccessfulConnection` é um mock à parte, não toca nele de
    // verdade) afeta 1 linha, simulando PROCESSING → SUCCESS bem-sucedido.
    // Formato `[rows, rowCount]` (divergência mínima do plano documentada
    // em `mercado-livre-oauth.service.ts`): reproduz o retorno real de
    // `PostgresQueryRunner.query()` para `UPDATE ... RETURNING`.
    query: jest.fn().mockResolvedValue([[{ id: 'req-1' }], 1]),
    ...overrides,
  };
  return Object.defineProperty(runner, 'isTransactionActive', {
    get: () => state.active,
    enumerable: true,
  }) as FakeQueryRunner;
}

interface Collaborators {
  marketplaceAccountsService: {
    findByIdOrFail: jest.Mock;
    findByMarketplaceAndExternalSellerId: jest.Mock;
    applySuccessfulConnection: jest.Mock;
    markError: jest.Mock;
  };
  authorizationRequestsService: {
    claimByState: jest.Mock;
    finalizeFailure: jest.Mock;
  };
  advisoryLockService: { tryAcquire: jest.Mock };
  httpClient: { exchangeCode: jest.Mock; fetchIdentity: jest.Mock };
  encryptionService: { encrypt: jest.Mock; decrypt: jest.Mock };
  configService: ConfigService;
  dataSource: { createQueryRunner: jest.Mock };
  queryRunner: FakeQueryRunner;
}

function claimedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    marketplaceAccountId: 'acc-1',
    initiatedByUserId: 'user-1',
    encryptedCodeVerifier: 'iv:tag:verifier',
    ...overrides,
  };
}

function makeCollaborators(): Collaborators {
  const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
  const queryRunner = makeFakeQueryRunner();
  return {
    marketplaceAccountsService: {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
      findByMarketplaceAndExternalSellerId: jest.fn().mockResolvedValue(null),
      applySuccessfulConnection: jest.fn().mockResolvedValue('applied'),
      markError: jest.fn().mockResolvedValue(true),
    },
    authorizationRequestsService: {
      claimByState: jest.fn().mockResolvedValue(claimedRequest()),
      finalizeFailure: jest.fn().mockResolvedValue(true),
    },
    advisoryLockService: {
      tryAcquire: jest.fn().mockResolvedValue(lockHandle),
    },
    httpClient: {
      exchangeCode: jest.fn().mockResolvedValue({
        kind: 'success',
        token: {
          accessToken: 'APP_USR-1',
          refreshToken: 'TG-1',
          expiresInSeconds: 10800,
          userId: 42,
          tokenType: 'bearer',
          scope: 'offline_access read',
        },
      }),
      fetchIdentity: jest
        .fn()
        .mockResolvedValue({ kind: 'success', externalUserId: 42 }),
    },
    encryptionService: {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn(() => 'plain-code-verifier'),
    },
    configService: {
      getOrThrow: (key: string) =>
        (
          ({ FRONTEND_URL: 'https://app.example.com' }) as Record<
            string,
            string
          >
        )[key],
    } as unknown as ConfigService,
    dataSource: { createQueryRunner: jest.fn().mockReturnValue(queryRunner) },
    queryRunner,
  };
}

function buildService(c: Collaborators) {
  return new MercadoLivreOAuthService(
    c.marketplaceAccountsService as never,
    c.authorizationRequestsService as never,
    c.advisoryLockService as never,
    c.httpClient as never,
    c.encryptionService as never,
    c.configService,
    c.dataSource as never,
  );
}

describe('MercadoLivreOAuthService.handleCallback', () => {
  it('redirects to OAUTH_CALLBACK_INVALID on malformed params (missing state)', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ code: 'c' });

    expect(redirectUrl).toContain('reason=OAUTH_CALLBACK_INVALID');
    expect(c.authorizationRequestsService.claimByState).not.toHaveBeenCalled();
  });

  it('redirects to OAUTH_CALLBACK_INVALID when the state cannot be claimed (unknown/expired/reused)', async () => {
    const c = makeCollaborators();
    c.authorizationRequestsService.claimByState.mockResolvedValue(null);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(redirectUrl).toContain('reason=OAUTH_CALLBACK_INVALID');
  });

  it('claims the state BEFORE interpreting error=access_denied, then finalizes FAILED/AUTHORIZATION_DENIED', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      error: 'access_denied',
    });

    expect(c.authorizationRequestsService.claimByState).toHaveBeenCalledWith(
      's',
    );
    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'AUTHORIZATION_DENIED',
    );
    expect(redirectUrl).toContain('reason=AUTHORIZATION_DENIED');
    expect(c.advisoryLockService.tryAcquire).not.toHaveBeenCalled();
  });

  it('maps any other provider error to FAILED/AUTHORIZATION_PROVIDER_ERROR -> OAUTH_CALLBACK_INVALID', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      error: 'server_error',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'AUTHORIZATION_PROVIDER_ERROR',
    );
    expect(redirectUrl).toContain('reason=OAUTH_CALLBACK_INVALID');
  });

  it('finalizes FAILED/ACCOUNT_BUSY and redirects to TRY_AGAIN_LATER when the advisory lock is not acquired', async () => {
    const c = makeCollaborators();
    c.advisoryLockService.tryAcquire.mockResolvedValue(null);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_BUSY',
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
    expect(c.httpClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('finalizes FAILED/CREDENTIAL_DECRYPTION_FAILED when the stored code_verifier cannot be decrypted, releases the lock', async () => {
    const c = makeCollaborators();
    c.encryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad auth tag');
    });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'CREDENTIAL_DECRYPTION_FAILED',
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it.each([
    ['definitive_error', 'TOKEN_EXCHANGE_FAILED'],
    ['client_configuration_error', 'TOKEN_EXCHANGE_FAILED'],
    ['unknown_result', 'CALLBACK_RESULT_UNKNOWN'],
    ['invalid_response', 'INVALID_TOKEN_RESPONSE'],
  ] as const)(
    'maps exchangeCode outcome %s to failureCode %s',
    async (kind, failureCode) => {
      const c = makeCollaborators();
      c.httpClient.exchangeCode.mockResolvedValue({ kind });
      const service = buildService(c);

      const { redirectUrl } = await service.handleCallback({
        state: 's',
        code: 'c',
      });

      expect(
        c.authorizationRequestsService.finalizeFailure,
      ).toHaveBeenCalledWith('req-1', failureCode);
      expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
    },
  );

  it('never resends the same code: exchangeCode is called at most once per callback', async () => {
    const c = makeCollaborators();
    c.httpClient.exchangeCode.mockResolvedValue({ kind: 'unknown_result' });
    const service = buildService(c);

    await service.handleCallback({ state: 's', code: 'c' });

    expect(c.httpClient.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('finalizes FAILED/IDENTITY_LOOKUP_FAILED when /users/me fails, never persists tokens', async () => {
    const c = makeCollaborators();
    c.httpClient.fetchIdentity.mockResolvedValue({ kind: 'failure' });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'IDENTITY_LOOKUP_FAILED',
    );
    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('finalizes FAILED/IDENTITY_MISMATCH when /users/me id differs from the token user_id', async () => {
    const c = makeCollaborators();
    c.httpClient.fetchIdentity.mockResolvedValue({
      kind: 'success',
      externalUserId: 999,
    });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'IDENTITY_MISMATCH',
    );
    expect(redirectUrl).toContain('reason=IDENTITY_MISMATCH');
  });

  it("reconnection: accepts when the returned identity matches the account's existing externalSellerId", async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({
        externalSellerId: '42',
        status: MarketplaceAccountStatus.TOKEN_EXPIRED,
      }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=success');
  });

  it('reconnection: rejects with IDENTITY_MISMATCH when the returned identity differs, preserves the original account', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({
        externalSellerId: '777',
        status: MarketplaceAccountStatus.TOKEN_EXPIRED,
      }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'IDENTITY_MISMATCH',
    );
    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=IDENTITY_MISMATCH');
  });

  it('duplicate externalSellerId (pre-check): marks the attempt FAILED/ACCOUNT_ALREADY_CONNECTED and the target account ERROR, never touches the winning account', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByMarketplaceAndExternalSellerId.mockResolvedValue(
      account({ id: 'other-acc', externalSellerId: '42' }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_ALREADY_CONNECTED',
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acc-1',
        failureCode: 'ACCOUNT_ALREADY_CONNECTED',
      }),
    );
    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=ACCOUNT_ALREADY_CONNECTED');
  });

  it('duplicate externalSellerId (race at CAS time): maps external_seller_conflict the same way as the pre-check', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.applySuccessfulConnection.mockResolvedValue(
      'external_seller_conflict',
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_ALREADY_CONNECTED',
    );
    expect(redirectUrl).toContain('reason=ACCOUNT_ALREADY_CONNECTED');
  });

  it("revalidates the account's marketplace after re-reading it post-lock: a non-MERCADO_LIVRE account finalizes FAILED/ACCOUNT_STATE_CONFLICT WITHOUT calling the ML (design §6.2 hardening — this is the vocabulary entry's only call site)", async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({ marketplace: Marketplace.AMAZON }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_STATE_CONFLICT',
    );
    expect(c.httpClient.exchangeCode).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('finalizes FAILED/TOKEN_RESULT_NOT_COMMITTED on a version_conflict CAS result, opens no lasting transaction (rolled back), never retries', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.applySuccessfulConnection.mockResolvedValue(
      'version_conflict',
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'TOKEN_RESULT_NOT_COMMITTED',
    );
    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('finalizes FAILED/TOKEN_RESULT_NOT_COMMITTED when the account CAS applies but the paired request-finalization UPDATE affects zero rows (request_not_processing) — proves the two writes are NOT independently committed', async () => {
    const c = makeCollaborators();
    c.queryRunner.query.mockResolvedValue([[], 0]); // 0 linhas: a tentativa não estava mais PROCESSING
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'TOKEN_RESULT_NOT_COMMITTED',
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by the account CAS (applySuccessfulConnection) rolls back the shared transaction and releases the QueryRunner exactly once, never leaves it dangling', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.applySuccessfulConnection.mockRejectedValue(
      new Error('cas boom'),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by the PROCESSING→SUCCESS UPDATE rolls back the shared transaction and releases the QueryRunner exactly once', async () => {
    const c = makeCollaborators();
    c.queryRunner.query.mockRejectedValue(new Error('update boom'));
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by commitTransaction still rolls back (a failed COMMIT leaves the transaction active in real TypeORM/Postgres — isTransactionActive is only set false by a COMMIT that resolves) and releases the QueryRunner exactly once', async () => {
    const c = makeCollaborators();
    c.queryRunner.commitTransaction.mockRejectedValue(new Error('commit boom'));
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by queryRunner.connect() never opens a transaction (no rollback attempted) but still releases the QueryRunner exactly once, and the callback still redirects (never throws to the caller)', async () => {
    const c = makeCollaborators();
    const connectError = new Error('connection reset');
    c.queryRunner.connect.mockRejectedValue(connectError);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by queryRunner.startTransaction() never leaves isTransactionActive true (no rollback attempted) but still releases the QueryRunner exactly once, and the callback still redirects', async () => {
    const c = makeCollaborators();
    const startTransactionError = new Error('could not start transaction');
    c.queryRunner.startTransaction.mockRejectedValue(startTransactionError);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).not.toHaveBeenCalled();
    expect(c.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('happy path: applies the connection and the request finalization in ONE transaction (shared QueryRunner), commits once, redirects to reason=success, releases the lock', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(c.dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acc-1',
        externalSellerId: '42',
        encryptedAccessToken: 'enc:APP_USR-1',
        encryptedRefreshToken: 'enc:TG-1',
        connectedByUserId: 'user-1',
      }),
      c.queryRunner, // MESMO QueryRunner passado para o UPDATE de oauth_authorization_requests
    );
    expect(c.queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'SUCCESS'"),
      ['req-1'],
    );
    expect(c.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=success');
  });

  it('threads a null connectedByUserId through when the original OAuthAuthorizationRequest.initiatedByUserId is null (FK ON DELETE SET NULL — design §6.2/§4)', async () => {
    const c = makeCollaborators();
    c.authorizationRequestsService.claimByState.mockResolvedValue(
      claimedRequest({ initiatedByUserId: null }),
    );
    const service = buildService(c);

    await service.handleCallback({ state: 's', code: 'c' });

    expect(
      c.marketplaceAccountsService.applySuccessfulConnection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ connectedByUserId: null }),
      c.queryRunner,
    );
  });

  it('always releases the advisory lock AND still redirects (never throws / never a raw 500) even when a downstream step fails unexpectedly', async () => {
    const c = makeCollaborators();
    c.httpClient.fetchIdentity.mockRejectedValue(new Error('unexpected'));
    const service = buildService(c);
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    c.advisoryLockService.tryAcquire.mockResolvedValue(lockHandle);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
    expect(lockHandle.release).toHaveBeenCalled();
  });

  it('never throws even for an error raised before the lock is acquired (e.g. claimByState itself failing) — always redirects', async () => {
    const c = makeCollaborators();
    c.authorizationRequestsService.claimByState.mockRejectedValue(
      new Error('db down'),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      code: 'c',
    });

    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });
});
