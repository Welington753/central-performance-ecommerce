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
import { ShopeeOAuthController } from './shopee-oauth.controller';
import { ShopeeOAuthService } from './shopee-oauth.service';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from '../marketplace-accounts/marketplace-accounts.service';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('ShopeeOAuthController (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;

  const oauthService = {
    startConnection: jest.fn(),
    handleCallback: jest.fn(),
  };
  const scopedMarketplaceAccountService = {
    assertAllowedAndFindOrFail: jest.fn(),
  };

  const authorizationContextService = {
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
      controllers: [ShopeeOAuthController],
      providers: [
        { provide: ShopeeOAuthService, useValue: oauthService },
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
    currentPermissions = [PERMISSIONS.INTEGRATIONS_MANAGE];
    currentAccountScope = { mode: 'ALL' };
    currentMustChangePassword = false;
    scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockResolvedValue(
      { id: VALID_UUID },
    );
  });

  describe('POST /marketplace-accounts/:id/shopee/connect', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/connect`)
        .expect(401);
    });

    it('403 sem integrations.manage', async () => {
      currentPermissions = [];
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/connect`)
        .expect(403);
      expect(oauthService.startConnection).not.toHaveBeenCalled();
    });

    it('404 genérico quando a conta está fora do escopo — nunca inicia OAuth', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/connect`)
        .expect(404);
      expect(oauthService.startConnection).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo', async () => {
      oauthService.startConnection.mockResolvedValue({
        authorizationUrl: 'https://exemplo.invalido/auth',
      });
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/connect`)
        .expect(200);
      expect(oauthService.startConnection).toHaveBeenCalledWith({
        marketplaceAccountId: VALID_UUID,
        initiatedByUserId: 'u1',
      });
    });
  });

  describe('GET /integrations/shopee/callback — público, nunca guardado', () => {
    it('continua acessível sem cookie de sessão (nenhum guard aplicado)', async () => {
      currentUserId = null;
      oauthService.handleCallback.mockResolvedValue({
        redirectUrl: '/login?shopee=1',
      });
      await request(http())
        .get('/integrations/shopee/callback')
        .query({ code: 'c', state: 's', shop_id: '123' })
        .expect(302);
      expect(oauthService.handleCallback).toHaveBeenCalledTimes(1);
    });
  });
});
