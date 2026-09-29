import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthorizationContextService } from '../../auth/authorization-context.service';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import type { AuthorizationContext } from '../../users/authorization-context.interface';
import type { AccountScope } from '../../users/account-scope.types';
import { PERMISSIONS } from '../../users/permissions.catalog';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { ScopedMarketplaceAccountService } from './scoped-marketplace-account.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from './marketplace-accounts.service';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

function fakeAccount(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    marketplace: 'AMAZON',
    externalSellerId: null,
    nickname: null,
    status: 'DISCONNECTED',
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    refreshRetryAt: null,
    failureCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('MarketplaceAccountsController (HTTP)', () => {
  let app: INestApplication;
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  const marketplaceAccountsService = {
    findAllForScope: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    disconnect: jest.fn(),
  };

  const scopedMarketplaceAccountService = {
    assertAllowedAndFindOrFail: jest.fn(),
  };

  const authorizationContextService = {
    // Replica o efeito colateral REAL de `AuthorizationContextService`
    // (cachear em `request.authorizationContext`) — o novo decorator
    // `@AuthorizationContext()` (Checkpoint 5A) lê só daí, nunca chama o
    // service de novo.
    resolveForRequest: jest.fn((request: Request): AuthorizationContext => {
      const context: AuthorizationContext = {
        userId: currentUserId ?? 'anon',
        active: true,
        roleKey: 'ADMIN',
        isAdmin: true,
        permissions: currentPermissions as never,
        accountScope: currentAccountScope,
        mustChangePassword: currentMustChangePassword,
      };
      request.authorizationContext = context;
      return context;
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MarketplaceAccountsController],
      providers: [
        {
          provide: MarketplaceAccountsService,
          useValue: marketplaceAccountsService,
        },
        {
          provide: ScopedMarketplaceAccountService,
          useValue: scopedMarketplaceAccountService,
        },
        {
          provide: AuthorizationContextService,
          useValue: authorizationContextService,
        },
        PermissionGuard,
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (currentUserId === null) {
            throw new UnauthorizedException('Não autenticado.');
          }
          const req = context.switchToHttp().getRequest<Request>();
          req.user = { sub: currentUserId, email: 'a@b.com' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUserId = 'u1';
    currentPermissions = [
      PERMISSIONS.INTEGRATIONS_VIEW,
      PERMISSIONS.INTEGRATIONS_MANAGE,
    ];
    currentAccountScope = { mode: 'ALL' };
    currentMustChangePassword = false;
    marketplaceAccountsService.findAllForScope.mockResolvedValue([]);
    scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockResolvedValue(
      fakeAccount(),
    );
  });

  describe('GET /marketplace-accounts', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http()).get('/marketplace-accounts').expect(401);
    });

    it('403 autenticado sem integrations.view', async () => {
      currentPermissions = [];
      await request(http()).get('/marketplace-accounts').expect(403);
    });

    it('200 com integrations.view — repassa o accountScope resolvido a findAllForScope', async () => {
      currentAccountScope = { mode: 'SELECTED', accountIds: ['a1'] };
      await request(http()).get('/marketplace-accounts').expect(200);
      expect(marketplaceAccountsService.findAllForScope).toHaveBeenCalledWith(
        currentAccountScope,
      );
    });

    it('403 PASSWORD_CHANGE_REQUIRED quando mustChangePassword', async () => {
      currentMustChangePassword = true;
      const res = await request(http())
        .get('/marketplace-accounts')
        .expect(403);
      expect((res.body as { message: string }).message).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    });
  });

  describe('POST /marketplace-accounts (criação sem accountId conhecido)', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http())
        .post('/marketplace-accounts')
        .send({ marketplace: 'AMAZON' })
        .expect(401);
    });

    it('403 sem integrations.manage', async () => {
      currentPermissions = [PERMISSIONS.INTEGRATIONS_VIEW];
      await request(http())
        .post('/marketplace-accounts')
        .send({ marketplace: 'AMAZON' })
        .expect(403);
      expect(marketplaceAccountsService.create).not.toHaveBeenCalled();
    });

    it('403 quando accountScope é SELECTED — só ALL pode iniciar sem accountId conhecido', async () => {
      currentAccountScope = { mode: 'SELECTED', accountIds: ['a1'] };
      await request(http())
        .post('/marketplace-accounts')
        .send({ marketplace: 'AMAZON' })
        .expect(403);
      expect(marketplaceAccountsService.create).not.toHaveBeenCalled();
    });

    it('403 quando accountScope é NONE', async () => {
      currentAccountScope = { mode: 'NONE' };
      await request(http())
        .post('/marketplace-accounts')
        .send({ marketplace: 'AMAZON' })
        .expect(403);
      expect(marketplaceAccountsService.create).not.toHaveBeenCalled();
    });

    it('201 com integrations.manage + accountScope ALL', async () => {
      marketplaceAccountsService.create.mockResolvedValue(fakeAccount());
      await request(http())
        .post('/marketplace-accounts')
        .send({ marketplace: 'AMAZON' })
        .expect(201);
      expect(marketplaceAccountsService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /marketplace-accounts/:id/nickname', () => {
    it('403 sem integrations.manage', async () => {
      currentPermissions = [PERMISSIONS.INTEGRATIONS_VIEW];
      await request(http())
        .patch(`/marketplace-accounts/${VALID_UUID}/nickname`)
        .send({ nickname: 'Loja 1' })
        .expect(403);
    });

    it('404 genérico quando a conta está fora do escopo — nunca chama rename', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .patch(`/marketplace-accounts/${VALID_UUID}/nickname`)
        .send({ nickname: 'Loja 1' })
        .expect(404);
      expect(marketplaceAccountsService.rename).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo — repassa o accountScope à checagem antes de renomear', async () => {
      marketplaceAccountsService.rename.mockResolvedValue(
        fakeAccount({ nickname: 'Loja 1' }),
      );
      currentAccountScope = { mode: 'SELECTED', accountIds: [VALID_UUID] };
      await request(http())
        .patch(`/marketplace-accounts/${VALID_UUID}/nickname`)
        .send({ nickname: 'Loja 1' })
        .expect(200);
      expect(
        scopedMarketplaceAccountService.assertAllowedAndFindOrFail,
      ).toHaveBeenCalledWith(currentAccountScope, VALID_UUID);
      expect(marketplaceAccountsService.rename).toHaveBeenCalledWith(
        VALID_UUID,
        'Loja 1',
      );
    });
  });

  describe('POST /marketplace-accounts/:id/disconnect', () => {
    it('403 sem integrations.manage', async () => {
      currentPermissions = [PERMISSIONS.INTEGRATIONS_VIEW];
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/disconnect`)
        .expect(403);
    });

    it('404 genérico quando a conta está fora do escopo — nunca chama disconnect', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/disconnect`)
        .expect(404);
      expect(marketplaceAccountsService.disconnect).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo', async () => {
      marketplaceAccountsService.disconnect.mockResolvedValue(
        fakeAccount({ status: 'DISCONNECTED' }),
      );
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/disconnect`)
        .expect(200);
      expect(marketplaceAccountsService.disconnect).toHaveBeenCalledWith(
        VALID_UUID,
      );
    });
  });
});
