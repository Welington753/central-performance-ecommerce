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
import type { AuthorizationContext } from './authorization-context.interface';
import { PERMISSIONS } from './permissions.catalog';
import { UsersController } from './users.controller';
import { UsersManagementService } from './users-management.service';

describe('UsersController (HTTP)', () => {
  let app: INestApplication;
  let currentUserId: string | null;
  let currentPermissions: string[];
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  const usersManagementService = {
    list: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    getPermissionsCatalog: jest
      .fn()
      .mockReturnValue({ permissions: [], presets: {} }),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setStatus: jest.fn(),
    resetPassword: jest.fn(),
    getAudit: jest.fn(),
  };

  const authorizationContextService = {
    resolveForRequest: jest.fn((): AuthorizationContext => ({
      userId: currentUserId ?? 'anon',
      active: true,
      roleKey: 'ADMIN',
      isAdmin: true,
      permissions: currentPermissions as never,
      accountScope: { mode: 'ALL' },
      mustChangePassword: false,
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersManagementService, useValue: usersManagementService },
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
          // O AccessTokenGuard real sempre LANÇA 401 (nunca devolve
          // `false`, que o Nest trataria como 403) — o fake reproduz isso.
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
    currentUserId = null;
    currentPermissions = [];
  });

  it('1. sem sessão -> 401', async () => {
    await request(http()).get('/users').expect(401);
  });

  it('2. sessão sem users.view -> 403', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.DASHBOARD_VIEW];
    await request(http()).get('/users').expect(403);
  });

  it('sessão com users.view -> 200', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.USERS_VIEW];
    await request(http()).get('/users').expect(200);
  });

  it('GET /users/permissions-catalog nunca colide com /:id — resolvido como rota estática', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.USERS_VIEW];
    await request(http()).get('/users/permissions-catalog').expect(200);
    expect(usersManagementService.getPermissionsCatalog).toHaveBeenCalled();
    expect(usersManagementService.getById).not.toHaveBeenCalled();
  });

  it('9. campo desconhecido no corpo do POST /users -> 400 (whitelist do ValidationPipe global)', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.USERS_MANAGE];
    await request(http())
      .post('/users')
      .send({
        name: 'A',
        email: 'a@example.com',
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
        campoInventado: 'x',
      })
      .expect(400);
    expect(usersManagementService.create).not.toHaveBeenCalled();
  });

  it('10. papel inválido -> 400', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.USERS_MANAGE];
    await request(http())
      .post('/users')
      .send({
        name: 'A',
        email: 'a@example.com',
        role: 'SUPERUSER',
        accountScope: { mode: 'ALL' },
      })
      .expect(400);
    expect(usersManagementService.create).not.toHaveBeenCalled();
  });

  it('POST /users com corpo válido -> 200, delega ao service com o actor da sessão', async () => {
    currentUserId = 'admin-1';
    currentPermissions = [PERMISSIONS.USERS_MANAGE];
    usersManagementService.create.mockResolvedValue({
      user: { id: 'new-user', role: 'VIEWER' },
      temporaryPassword: 'temp-pass-123',
    });

    await request(http())
      .post('/users')
      .send({
        name: 'Novo',
        email: 'novo@example.com',
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      })
      // 201 Created — padrão REST/Nest para POST de criação, não sobrescrito.
      .expect(201)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');

    expect(usersManagementService.create).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({
        name: 'Novo',
        email: 'novo@example.com',
        role: 'VIEWER',
      }),
    );
  });

  it('POST /users/:id/reset-password -> 200 com Cache-Control: no-store e X-Content-Type-Options: nosniff', async () => {
    currentUserId = 'admin-1';
    currentPermissions = [PERMISSIONS.USERS_MANAGE];
    usersManagementService.resetPassword.mockResolvedValue({
      temporaryPassword: 'temp-pass-456',
    });

    await request(http())
      .post('/users/11111111-1111-4111-8111-111111111111/reset-password')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');

    expect(usersManagementService.resetPassword).toHaveBeenCalledWith(
      'admin-1',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('PATCH /users/:id/status exige users.manage (não basta users.view)', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.USERS_VIEW];
    await request(http())
      .patch('/users/11111111-1111-4111-8111-111111111111/status')
      .send({ active: false })
      .expect(403);
  });

  it('GET /users/:id/audit exige users.manage (não basta users.view)', async () => {
    currentUserId = 'u1';
    currentPermissions = [PERMISSIONS.USERS_VIEW];
    await request(http())
      .get('/users/11111111-1111-4111-8111-111111111111/audit')
      .expect(403);
  });
});
