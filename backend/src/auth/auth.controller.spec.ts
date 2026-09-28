import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { AccountScopeMode } from '../users/account-scope-mode.enum';
import type { AuthorizationContext } from '../users/authorization-context.interface';
import { PermissionResolverService } from '../users/permission-resolver.service';
import { PERMISSIONS } from '../users/permissions.catalog';
import type { User } from '../users/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CurrentPasswordInvalidError } from './change-password.errors';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from './constants/auth.constants';
import { AccessTokenGuard } from './guards/access-token.guard';

function buildAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    userId: 'u1',
    active: true,
    roleKey: 'ANALYST',
    isAdmin: false,
    permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FULL_VIEW],
    accountScope: { mode: 'ALL' },
    mustChangePassword: false,
    ...overrides,
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    name: 'Ana',
    email: 'ana@example.com',
    passwordHash: 'hash',
    active: true,
    isAdmin: false,
    roleId: randomUUID(),
    accountScopeMode: AccountScopeMode.NONE,
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildFakeResponse(): jest.Mocked<
  Pick<Response, 'cookie' | 'clearCookie'>
> {
  return {
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
}

describe('AuthController', () => {
  let authService: jest.Mocked<
    Pick<
      AuthService,
      'login' | 'refresh' | 'logout' | 'getActiveUserOrFail' | 'changePassword'
    >
  >;
  let permissionResolverService: jest.Mocked<
    Pick<PermissionResolverService, 'resolve'>
  >;
  let controller: AuthController;

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getActiveUserOrFail: jest.fn(),
      changePassword: jest.fn(),
    };
    permissionResolverService = {
      resolve: jest.fn().mockResolvedValue(buildAuthorizationContext()),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: PermissionResolverService,
          useValue: permissionResolverService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) => {
              if (key === 'COOKIE_SECURE') return 'false';
              if (key === 'REFRESH_TOKEN_TTL_DAYS') return 30;
              return fallback;
            },
          },
        },
      ],
    })
      // A verificação do próprio AccessTokenGuard já é coberta por
      // access-token.guard.spec.ts; aqui os métodos do controller são
      // chamados diretamente, então o guard é substituído por um stub.
      .overrideGuard(AccessTokenGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(AuthController);
  });

  it('POST /auth/login sets HttpOnly access/refresh cookies and returns the user without passwordHash', async () => {
    const user = buildUser();
    authService.login.mockResolvedValue({
      user,
      accessToken: 'access.jwt',
      refreshToken: 'refresh-plain',
    });
    const res = buildFakeResponse();
    const req = {
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    } as unknown as Request;

    const result = await controller.login(
      { email: user.email, password: 'whatever' },
      req,
      res as unknown as Response,
    );

    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.email).toBe(user.email);

    expect(res.cookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE_NAME,
      'access.jwt',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'refresh-plain',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('POST /auth/login propagates a generic 401 for invalid credentials', async () => {
    authService.login.mockRejectedValue(
      new UnauthorizedException('Credenciais inválidas'),
    );
    const res = buildFakeResponse();
    const req = { headers: {} } as unknown as Request;

    await expect(
      controller.login(
        { email: 'x@example.com', password: 'wrong' },
        req,
        res as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('POST /auth/logout clears both cookies', async () => {
    const res = buildFakeResponse();
    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'refresh-plain' },
      headers: {},
    } as unknown as Request;

    const result = await controller.logout(req, res as unknown as Response);

    expect(authService.logout).toHaveBeenCalledWith('refresh-plain');
    expect(res.clearCookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.any(Object),
    );
    expect(result).toEqual({ success: true });
  });

  it('GET /auth/me returns the current user resolved from the access token payload', async () => {
    const user = buildUser();
    authService.getActiveUserOrFail.mockResolvedValue(user);

    const result = await controller.me({ sub: user.id, email: user.email });

    expect(authService.getActiveUserOrFail).toHaveBeenCalledWith(user.id);
    expect(result.email).toBe(user.email);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('GET /auth/me rejects when no payload is present (guard did not run / failed silently)', async () => {
    await expect(controller.me(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(permissionResolverService.resolve).not.toHaveBeenCalled();
  });

  it('26/27. GET /auth/me inclui role/permissions/accountScope/mustChangePassword e preserva os campos antigos (isAdmin incluso)', async () => {
    const user = buildUser({ isAdmin: true });
    authService.getActiveUserOrFail.mockResolvedValue(user);
    permissionResolverService.resolve.mockResolvedValue(
      buildAuthorizationContext({ roleKey: 'ADMIN', isAdmin: true }),
    );

    const result = await controller.me({ sub: user.id, email: user.email });

    expect(result.role).toBe('ADMIN');
    expect(result.permissions).toEqual([
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.FULL_VIEW,
    ]);
    expect(result.accountScope).toEqual({ mode: 'ALL' });
    expect(result.mustChangePassword).toBe(false);
    // Campos do contrato antigo, intactos:
    expect(result.id).toBe(user.id);
    expect(result.name).toBe(user.name);
    expect(result.email).toBe(user.email);
    expect(result.active).toBe(user.active);
    expect(result.isAdmin).toBe(true);
  });

  it('28. GET /auth/me nunca inclui passwordHash, token ou override', async () => {
    const user = buildUser();
    authService.getActiveUserOrFail.mockResolvedValue(user);

    const result = await controller.me({ sub: user.id, email: user.email });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized.toLowerCase()).not.toContain('token');
    expect(serialized.toLowerCase()).not.toContain('override');
  });

  it('30. GET /auth/me resolve a autorização de novo a cada chamada — mudança de permissão aparece sem novo login', async () => {
    const user = buildUser();
    authService.getActiveUserOrFail.mockResolvedValue(user);
    permissionResolverService.resolve
      .mockResolvedValueOnce(
        buildAuthorizationContext({
          roleKey: 'VIEWER',
          permissions: [PERMISSIONS.DASHBOARD_VIEW],
        }),
      )
      .mockResolvedValueOnce(
        buildAuthorizationContext({
          roleKey: 'ADMIN',
          permissions: [PERMISSIONS.USERS_MANAGE],
        }),
      );

    const first = await controller.me({ sub: user.id, email: user.email });
    const second = await controller.me({ sub: user.id, email: user.email });

    expect(first.role).toBe('VIEWER');
    expect(second.role).toBe('ADMIN');
    expect(permissionResolverService.resolve).toHaveBeenCalledTimes(2);
    expect(permissionResolverService.resolve).toHaveBeenNthCalledWith(
      1,
      user.id,
    );
    expect(permissionResolverService.resolve).toHaveBeenNthCalledWith(
      2,
      user.id,
    );
  });

  it('POST /auth/change-password chama AuthService, limpa os dois cookies e nunca inclui token na resposta', async () => {
    authService.changePassword.mockResolvedValue(undefined);
    const res = buildFakeResponse();

    const result = await controller.changePassword(
      { currentPassword: 'atual123456', newPassword: 'nova1234567' },
      { sub: 'u1', email: 'a@b.com' },
      res as unknown as Response,
    );

    expect(authService.changePassword).toHaveBeenCalledWith(
      'u1',
      'atual123456',
      'nova1234567',
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE_NAME,
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.any(Object),
    );
    expect(result).toEqual({ success: true });
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });

  it('POST /auth/change-password sem payload -> 401, nunca chama AuthService', async () => {
    const res = buildFakeResponse();
    await expect(
      controller.changePassword(
        { currentPassword: 'x', newPassword: 'y' },
        undefined,
        res as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it('POST /auth/change-password propaga erro de senha atual inválida sem limpar cookies', async () => {
    authService.changePassword.mockRejectedValue(
      new CurrentPasswordInvalidError(),
    );
    const res = buildFakeResponse();

    await expect(
      controller.changePassword(
        { currentPassword: 'errada', newPassword: 'nova1234567' },
        { sub: 'u1', email: 'a@b.com' },
        res as unknown as Response,
      ),
    ).rejects.toMatchObject({ message: 'CURRENT_PASSWORD_INVALID' });
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
