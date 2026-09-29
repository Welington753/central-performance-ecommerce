import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { AuthorizationContextService } from '../auth/authorization-context.service';
import { PermissionGuard } from '../auth/guards/permission.guard';
import type { AuthorizationContext } from '../users/authorization-context.interface';
import type { AccountScope } from '../users/account-scope.types';
import { PERMISSIONS } from '../users/permissions.catalog';
import { SyncRunsController } from './sync-runs.controller';
import { SyncRunsService } from './sync-runs.service';

describe('SyncRunsController (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;

  const syncRunsService = {
    findAll: jest.fn(),
    findAllForScope: jest.fn(),
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
      controllers: [SyncRunsController],
      providers: [
        { provide: SyncRunsService, useValue: syncRunsService },
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
    currentPermissions = [PERMISSIONS.SYNC_VIEW];
    currentAccountScope = { mode: 'ALL' };
    currentMustChangePassword = false;
    syncRunsService.findAllForScope.mockResolvedValue([]);
  });

  describe('GET /sync-runs', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http()).get('/sync-runs').expect(401);
    });

    it('403 sem sync.view', async () => {
      currentPermissions = [];
      await request(http()).get('/sync-runs').expect(403);
    });

    it('200 com sync.view — chama SOMENTE findAllForScope, nunca findAll', async () => {
      currentAccountScope = { mode: 'SELECTED', accountIds: ['a1'] };
      await request(http()).get('/sync-runs').expect(200);
      expect(syncRunsService.findAllForScope).toHaveBeenCalledWith(
        {},
        currentAccountScope,
      );
      expect(syncRunsService.findAll).not.toHaveBeenCalled();
    });

    it('403 PASSWORD_CHANGE_REQUIRED quando mustChangePassword', async () => {
      currentMustChangePassword = true;
      const res = await request(http()).get('/sync-runs').expect(403);
      expect((res.body as { message: string }).message).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    });
  });
});
