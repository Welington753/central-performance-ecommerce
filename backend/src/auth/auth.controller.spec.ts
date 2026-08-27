import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { User } from '../users/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from './constants/auth.constants';
import { AccessTokenGuard } from './guards/access-token.guard';

function buildUser(): User {
  return {
    id: randomUUID(),
    name: 'Ana',
    email: 'ana@example.com',
    passwordHash: 'hash',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    Pick<AuthService, 'login' | 'refresh' | 'logout' | 'getActiveUserOrFail'>
  >;
  let controller: AuthController;

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      getActiveUserOrFail: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
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
  });
});
