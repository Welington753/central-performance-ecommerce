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
import { AmazonConnectionController } from './amazon-connection.controller';
import { AmazonConnectionService } from './amazon-connection.service';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ACCOUNT_NOT_FOUND_MESSAGE } from '../marketplace-accounts/marketplace-accounts.service';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('AmazonConnectionController (HTTP)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let currentUserId: string | null;
  let currentPermissions: string[];
  let currentAccountScope: AccountScope;
  let currentMustChangePassword: boolean;

  const amazonConnectionService = {
    getSetupStatus: jest.fn(),
    provision: jest.fn(),
    verify: jest.fn(),
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
      controllers: [AmazonConnectionController],
      providers: [
        { provide: AmazonConnectionService, useValue: amazonConnectionService },
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
    amazonConnectionService.getSetupStatus.mockResolvedValue({
      applicationConfigured: true,
      missingConfigurationKeys: [],
      hasAccount: false,
      accounts: [],
      canProvision: true,
      canVerify: false,
      canSynchronize: false,
    });
    scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockResolvedValue(
      { id: VALID_UUID },
    );
  });

  describe('GET /integrations/amazon/setup-status', () => {
    it('401 sem autenticação', async () => {
      currentUserId = null;
      await request(http())
        .get('/integrations/amazon/setup-status')
        .expect(401);
    });

    it('403 sem integrations.view', async () => {
      currentPermissions = [];
      await request(http())
        .get('/integrations/amazon/setup-status')
        .expect(403);
    });

    it('200 com integrations.view', async () => {
      await request(http())
        .get('/integrations/amazon/setup-status')
        .expect(200);
    });

    it('403 PASSWORD_CHANGE_REQUIRED quando mustChangePassword', async () => {
      currentMustChangePassword = true;
      const res = await request(http())
        .get('/integrations/amazon/setup-status')
        .expect(403);
      expect((res.body as { message: string }).message).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    });
  });

  describe('POST /marketplace-accounts/:id/amazon/provision', () => {
    const body = { sellingPartnerId: 'A1B2C3', refreshToken: 'Atzr|refresh' };

    it('403 sem integrations.manage', async () => {
      currentPermissions = [PERMISSIONS.INTEGRATIONS_VIEW];
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/amazon/provision`)
        .send(body)
        .expect(403);
    });

    it('404 genérico quando a conta está fora do escopo — nunca chama provision', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/amazon/provision`)
        .send(body)
        .expect(404);
      expect(amazonConnectionService.provision).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo', async () => {
      amazonConnectionService.provision.mockResolvedValue({ id: VALID_UUID });
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/amazon/provision`)
        .send(body)
        .expect(200);
      expect(
        scopedMarketplaceAccountService.assertAllowedAndFindOrFail,
      ).toHaveBeenCalledWith(currentAccountScope, VALID_UUID);
      expect(amazonConnectionService.provision).toHaveBeenCalledWith(
        VALID_UUID,
        body,
        'u1',
      );
    });
  });

  describe('POST /marketplace-accounts/:id/amazon/verify', () => {
    it('403 sem integrations.manage', async () => {
      currentPermissions = [PERMISSIONS.INTEGRATIONS_VIEW];
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/amazon/verify`)
        .expect(403);
    });

    it('404 genérico quando a conta está fora do escopo — nunca chama verify', async () => {
      scopedMarketplaceAccountService.assertAllowedAndFindOrFail.mockRejectedValue(
        new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
      );
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/amazon/verify`)
        .expect(404);
      expect(amazonConnectionService.verify).not.toHaveBeenCalled();
    });

    it('200 quando a conta está no escopo', async () => {
      amazonConnectionService.verify.mockResolvedValue({ connected: true });
      await request(http())
        .post(`/marketplace-accounts/${VALID_UUID}/amazon/verify`)
        .expect(200);
      expect(amazonConnectionService.verify).toHaveBeenCalledWith(VALID_UUID);
    });
  });
});
