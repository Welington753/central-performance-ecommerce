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
import { ShopeeOrdersSyncController } from './shopee-orders-sync.controller';
import { ShopeeOrdersSyncService } from './shopee-orders-sync.service';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from '../marketplace-accounts/marketplace-accounts.service';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('ShopeeOrdersSyncController (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;

  const syncService = { syncOrders: jest.fn() };
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
      controllers: [ShopeeOrdersSyncController],
      providers: [
        { provide: ShopeeOrdersSyncService, useValue: syncService },
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
    currentPermissions = [PERMISSIONS.SYNC_RUN];
    currentAccountScope = { mode: 'ALL' };
    currentMustChangePassword = false;
    scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockResolvedValue(
      { id: VALID_UUID },
    );
  });

  describe('POST /marketplace-accounts/:id/shopee/sync-orders', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/sync-orders`)
        .expect(401);
    });

    it('403 sem sync.run', async () => {
      currentPermissions = [];
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/sync-orders`)
        .expect(403);
      expect(syncService.syncOrders).not.toHaveBeenCalled();
    });

    it('404 genérico quando a conta está fora do escopo — nunca chama o conector', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/sync-orders`)
        .expect(404);
      expect(syncService.syncOrders).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo', async () => {
      syncService.syncOrders.mockResolvedValue({ status: 'SUCCESS' });
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/sync-orders`)
        .expect(200);
      expect(syncService.syncOrders).toHaveBeenCalledWith(VALID_UUID);
    });

    it('403 PASSWORD_CHANGE_REQUIRED quando mustChangePassword', async () => {
      currentMustChangePassword = true;
      const res = await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/shopee/sync-orders`)
        .expect(403);
      expect((res.body as { message: string }).message).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    });
  });
});
