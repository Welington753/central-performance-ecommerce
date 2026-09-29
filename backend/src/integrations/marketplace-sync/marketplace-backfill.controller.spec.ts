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
import { MarketplaceBackfillController } from './marketplace-backfill.controller';
import { MarketplaceBackfillService } from './marketplace-backfill.service';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from '../marketplace-accounts/marketplace-accounts.service';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('MarketplaceBackfillController (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;

  const backfillService = {
    getStatus: jest.fn(),
    startBackfill: jest.fn(),
    pauseBackfill: jest.fn(),
    resumeBackfill: jest.fn(),
    runNextChunk: jest.fn(),
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
      controllers: [MarketplaceBackfillController],
      providers: [
        { provide: MarketplaceBackfillService, useValue: backfillService },
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
    currentPermissions = [PERMISSIONS.SYNC_VIEW, PERMISSIONS.SYNC_BACKFILL];
    currentAccountScope = { mode: 'ALL' };
    currentMustChangePassword = false;
    scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockResolvedValue(
      { id: VALID_UUID },
    );
  });

  describe('GET /marketplace-accounts/:id/backfill/status', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http())
        .get(`/marketplace-accounts/${VALID_UUID}/backfill/status`)
        .expect(401);
    });

    it('403 sem sync.view', async () => {
      currentPermissions = [];
      await request(http())
        .get(`/marketplace-accounts/${VALID_UUID}/backfill/status`)
        .expect(403);
    });

    it('404 genérico quando a conta está fora do escopo — nunca chama getStatus', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .get(`/marketplace-accounts/${VALID_UUID}/backfill/status`)
        .expect(404);
      expect(backfillService.getStatus).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo', async () => {
      backfillService.getStatus.mockResolvedValue({ status: 'NOT_STARTED' });
      await request(http())
        .get(`/marketplace-accounts/${VALID_UUID}/backfill/status`)
        .expect(200);
      expect(backfillService.getStatus).toHaveBeenCalledWith(VALID_UUID);
    });
  });

  describe.each([
    ['start', 'startBackfill'],
    ['pause', 'pauseBackfill'],
    ['resume', 'resumeBackfill'],
    ['next-chunk', 'runNextChunk'],
  ] as const)(
    'POST /marketplace-accounts/:id/backfill/%s',
    (route, serviceMethod) => {
      it('403 sem sync.backfill — sync.view sozinho não libera escrita', async () => {
        currentPermissions = [PERMISSIONS.SYNC_VIEW];
        await request(http())
          .post(`/marketplace-accounts/${VALID_UUID}/backfill/${route}`)
          .expect(403);
        expect(backfillService[serviceMethod]).not.toHaveBeenCalled();
      });

      it('404 genérico quando a conta está fora do escopo — nunca chama o service', async () => {
        scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
          new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
        );
        await request(http())
          .post(`/marketplace-accounts/${VALID_UUID}/backfill/${route}`)
          .expect(404);
        expect(backfillService[serviceMethod]).not.toHaveBeenCalled();
      });

      it('200 quando a conta está no escopo', async () => {
        backfillService[serviceMethod].mockResolvedValue({
          status: 'IN_PROGRESS',
        });
        await request(http())
          .post(`/marketplace-accounts/${VALID_UUID}/backfill/${route}`)
          .expect(200);
        expect(backfillService[serviceMethod]).toHaveBeenCalledWith(VALID_UUID);
      });
    },
  );
});
