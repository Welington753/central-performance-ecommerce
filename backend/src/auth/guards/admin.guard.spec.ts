import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UsersService } from '../../users/users.service';
import { AdminGuard } from './admin.guard';

function buildContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  it('rejects when request.user is missing (AccessTokenGuard not composed before it)', async () => {
    const findById = jest.fn();
    const usersService = { findById } as unknown as UsersService;
    const guard = new AdminGuard(usersService);
    const context = buildContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects a non-admin authenticated user with 403', async () => {
    const usersService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'u1', active: true, isAdmin: false }),
    } as unknown as UsersService;
    const guard = new AdminGuard(usersService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an admin flagged user who is no longer active', async () => {
    const usersService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'u1', active: false, isAdmin: true }),
    } as unknown as UsersService;
    const guard = new AdminGuard(usersService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when the user id from the token no longer exists', async () => {
    const usersService = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const guard = new AdminGuard(usersService);
    const context = buildContext({ user: { sub: 'gone', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an active admin user', async () => {
    const usersService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'u1', active: true, isAdmin: true }),
    } as unknown as UsersService;
    const guard = new AdminGuard(usersService);
    const context = buildContext({ user: { sub: 'u1', email: 'a@b.com' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('always re-reads the user from the database — never trusts a role embedded in the JWT payload', async () => {
    const findById = jest
      .fn()
      .mockResolvedValue({ id: 'u1', active: true, isAdmin: true });
    const usersService = { findById } as unknown as UsersService;
    const guard = new AdminGuard(usersService);
    const context = buildContext({
      // O payload do token não carrega nenhum campo de papel — só sub/email.
      user: { sub: 'u1', email: 'a@b.com' },
    });

    await guard.canActivate(context);
    expect(findById).toHaveBeenCalledWith('u1');
  });
});
