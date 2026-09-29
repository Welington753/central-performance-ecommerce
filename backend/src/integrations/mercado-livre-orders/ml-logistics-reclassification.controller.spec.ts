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
import { MlLogisticsReclassificationController } from './ml-logistics-reclassification.controller';
import {
  MlLogisticsReclassificationError,
  MlLogisticsReclassificationService,
} from './ml-logistics-reclassification.service';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from '../marketplace-accounts/marketplace-accounts.service';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('MlLogisticsReclassificationController (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;

  const service = {
    getStatus: jest.fn(),
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    getStatusForAllAccounts: jest.fn(),
    startAll: jest.fn(),
    pauseAll: jest.fn(),
    resumeAll: jest.fn(),
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
      controllers: [MlLogisticsReclassificationController],
      providers: [
        { provide: MlLogisticsReclassificationService, useValue: service },
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
    currentPermissions = [PERMISSIONS.SYNC_VIEW, PERMISSIONS.SYNC_FULL_HISTORY];
    currentAccountScope = { mode: 'ALL' };
    currentMustChangePassword = false;
    scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockResolvedValue(
      { id: VALID_UUID },
    );
    service.getStatusForAllAccounts.mockResolvedValue([]);
    service.startAll.mockResolvedValue([]);
    service.pauseAll.mockResolvedValue([]);
    service.resumeAll.mockResolvedValue([]);
  });

  describe('rotas por conta', () => {
    it('401 sem autenticação (status)', async () => {
      currentUserId = null;
      await request(http())
        .get(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/status`,
        )
        .expect(401);
    });

    it('403 sem sync.view (status)', async () => {
      currentPermissions = [];
      await request(http())
        .get(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/status`,
        )
        .expect(403);
    });

    it('404 genérico quando a conta está fora do escopo (status) — nunca chama o service', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .get(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/status`,
        )
        .expect(404);
      expect(service.getStatus).not.toHaveBeenCalled();
    });

    it('status delegates to service.getStatus with the validated accountId', async () => {
      service.getStatus.mockResolvedValue({ status: 'IDLE' });
      await request(http())
        .get(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/status`,
        )
        .expect(200);
      expect(service.getStatus).toHaveBeenCalledWith(VALID_UUID);
    });

    it('403 sem sync.full_history (start) — leitura não libera escrita', async () => {
      currentPermissions = [PERMISSIONS.SYNC_VIEW];
      await request(http())
        .post(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/start`,
        )
        .expect(403);
      expect(service.start).not.toHaveBeenCalled();
    });

    it('404 genérico quando a conta está fora do escopo (start) — nunca chama o service', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .post(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/start`,
        )
        .expect(404);
      expect(service.start).not.toHaveBeenCalled();
    });

    it('start delegates to service.start', async () => {
      service.start.mockResolvedValue({ status: 'RUNNING' });
      await request(http())
        .post(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/start`,
        )
        .expect(200);
      expect(service.start).toHaveBeenCalledWith(VALID_UUID);
    });

    it('pause delegates to service.pause', async () => {
      service.pause.mockResolvedValue({ status: 'PAUSED' });
      await request(http())
        .post(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/pause`,
        )
        .expect(200);
      expect(service.pause).toHaveBeenCalledWith(VALID_UUID);
    });

    it('resume delegates to service.resume', async () => {
      service.resume.mockResolvedValue({ status: 'RUNNING' });
      await request(http())
        .post(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/resume`,
        )
        .expect(200);
      expect(service.resume).toHaveBeenCalledWith(VALID_UUID);
    });

    it('maps MlLogisticsReclassificationError (wrong marketplace) to BadRequestException', async () => {
      service.getStatus.mockRejectedValue(
        new MlLogisticsReclassificationError('ACCOUNT_NOT_MERCADO_LIVRE'),
      );
      const res = await request(http())
        .get(
          `/marketplace-accounts/${VALID_UUID}/logistics-reclassification/status`,
        )
        .expect(400);
      expect(res.body).toBeDefined();
    });
  });

  describe('rotas "todas as contas"', () => {
    it('403 sem sync.view (statusAll)', async () => {
      currentPermissions = [];
      await request(http())
        .get(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/status',
        )
        .expect(403);
    });

    it('statusAll delegates to service.getStatusForAllAccounts com o accountScope resolvido', async () => {
      currentAccountScope = { mode: 'SELECTED', accountIds: ['a1'] };
      await request(http())
        .get(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/status',
        )
        .expect(200);
      expect(service.getStatusForAllAccounts).toHaveBeenCalledWith(
        currentAccountScope,
      );
    });

    it('403 sem sync.full_history (startAll)', async () => {
      currentPermissions = [PERMISSIONS.SYNC_VIEW];
      await request(http())
        .post(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/start',
        )
        .expect(403);
      expect(service.startAll).not.toHaveBeenCalled();
    });

    it('startAll delegates to service.startAll com o accountScope resolvido', async () => {
      currentAccountScope = { mode: 'NONE' };
      await request(http())
        .post(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/start',
        )
        .expect(200);
      expect(service.startAll).toHaveBeenCalledWith(currentAccountScope);
    });

    it('pauseAll delegates to service.pauseAll', async () => {
      await request(http())
        .post(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/pause',
        )
        .expect(200);
      expect(service.pauseAll).toHaveBeenCalledWith(currentAccountScope);
    });

    it('resumeAll delegates to service.resumeAll', async () => {
      await request(http())
        .post(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/resume',
        )
        .expect(200);
      expect(service.resumeAll).toHaveBeenCalledWith(currentAccountScope);
    });
  });
});
