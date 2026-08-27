import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE_NAME } from '../constants/auth.constants';
import { AccessTokenGuard } from './access-token.guard';

function buildContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AccessTokenGuard', () => {
  const configService = {
    getOrThrow: () => 'test-secret',
  } as unknown as ConfigService;

  it('rejects a request without an access token cookie', () => {
    const verify = jest.fn();
    const jwtService = { verify } as unknown as JwtService;
    const guard = new AccessTokenGuard(jwtService, configService);
    const context = buildContext({ cookies: {} });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid/expired access token', () => {
    const jwtService = {
      verify: jest.fn().mockImplementation(() => {
        throw new Error('jwt expired');
      }),
    } as unknown as JwtService;
    const guard = new AccessTokenGuard(jwtService, configService);
    const context = buildContext({
      cookies: { [ACCESS_TOKEN_COOKIE_NAME]: 'invalid-token' },
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('allows the request and attaches the payload when the token is valid', () => {
    const payload = { sub: 'user-1', email: 'user@example.com' };
    const jwtService = {
      verify: jest.fn().mockReturnValue(payload),
    } as unknown as JwtService;
    const guard = new AccessTokenGuard(jwtService, configService);
    const request: Partial<Request> = {
      cookies: { [ACCESS_TOKEN_COOKIE_NAME]: 'valid-token' },
    };
    const context = buildContext(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(payload);
  });
});
