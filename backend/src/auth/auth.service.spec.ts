import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import type { Repository } from 'typeorm';
import type { User } from '../users/user.entity';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { GENERIC_AUTH_ERROR_MESSAGE } from './constants/auth.constants';
import { UserSession } from './user-session.entity';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    name: 'Ana Admin',
    email: 'ana@example.com',
    passwordHash: 'irrelevant-in-most-tests',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    refreshTokenHash: 'some-hash',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    revokedAt: null,
    createdAt: new Date(),
    ip: null,
    userAgent: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail' | 'findById'>>;
  let sessionRepository: jest.Mocked<
    Pick<Repository<UserSession>, 'findOne' | 'create' | 'save'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get' | 'getOrThrow'>>;
  let authService: AuthService;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    sessionRepository = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(
          (partial: Partial<UserSession>) => partial as UserSession,
        ),
      save: jest
        .fn()
        .mockImplementation((entity: UserSession) => Promise.resolve(entity)),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    };
    configService = {
      get: jest
        .fn()
        .mockImplementation((key: string, fallback?: unknown) => fallback),
      getOrThrow: jest.fn().mockReturnValue('access-token-secret'),
    };

    authService = new AuthService(
      usersService as unknown as UsersService,
      sessionRepository as unknown as Repository<UserSession>,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  describe('login', () => {
    it('succeeds with correct credentials (argon2.verify against the real stored hash)', async () => {
      const password = 'correct-horse-battery-staple';
      const passwordHash = await argon2.hash(password);
      // Prova independente de que a combinação hash/senha realmente bate,
      // usando o argon2 real (não mockado) — o mesmo que o AuthService usa.
      await expect(argon2.verify(passwordHash, password)).resolves.toBe(true);
      const user = buildUser({ passwordHash });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await authService.login(user.email, password, {
        ip: '127.0.0.1',
      });

      expect(result.user).toBe(user);
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken).toHaveLength(128); // 64 bytes em hex
    });

    it('rejects an unknown email with the generic message', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login('unknown@example.com', 'whatever', {}),
      ).rejects.toMatchObject({ message: GENERIC_AUTH_ERROR_MESSAGE });
    });

    it('rejects a wrong password with the exact same generic message as an unknown email', async () => {
      const passwordHash = await argon2.hash('the-real-password');
      const user = buildUser({ passwordHash });
      usersService.findByEmail.mockResolvedValue(user);

      let unknownEmailError: unknown;
      let wrongPasswordError: unknown;

      try {
        await authService.login('unknown@example.com', 'whatever', {});
      } catch (error) {
        unknownEmailError = error;
      }

      try {
        await authService.login(user.email, 'wrong-password', {});
      } catch (error) {
        wrongPasswordError = error;
      }

      expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect((unknownEmailError as UnauthorizedException).message).toBe(
        (wrongPasswordError as UnauthorizedException).message,
      );
      expect((wrongPasswordError as UnauthorizedException).message).toBe(
        GENERIC_AUTH_ERROR_MESSAGE,
      );
    });

    it('rejects an inactive user even with the correct password', async () => {
      const password = 'correct-password';
      const passwordHash = await argon2.hash(password);
      const user = buildUser({ passwordHash, active: false });
      usersService.findByEmail.mockResolvedValue(user);

      await expect(
        authService.login(user.email, password, {}),
      ).rejects.toMatchObject({
        message: GENERIC_AUTH_ERROR_MESSAGE,
      });
    });

    it('never persists the plain refresh token — only its SHA-256 hash', async () => {
      const password = 'correct-password';
      const passwordHash = await argon2.hash(password);
      const user = buildUser({ passwordHash });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await authService.login(user.email, password, {});

      expect(sessionRepository.create).toHaveBeenCalledTimes(1);
      const createArg = sessionRepository.create.mock
        .calls[0][0] as Partial<UserSession>;

      expect(createArg.refreshTokenHash).toBe(sha256Hex(result.refreshToken));
      expect(createArg.refreshTokenHash).not.toBe(result.refreshToken);
      expect(JSON.stringify(createArg)).not.toContain(result.refreshToken);
    });
  });

  describe('refresh (rotação)', () => {
    it('revokes the old session and issues a brand-new one', async () => {
      const plainRefreshToken = 'a'.repeat(128);
      const existingSession = buildSession({
        refreshTokenHash: sha256Hex(plainRefreshToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      const user = buildUser({ id: existingSession.userId });
      sessionRepository.findOne.mockResolvedValue(existingSession);
      usersService.findById.mockResolvedValue(user);

      const result = await authService.refresh(plainRefreshToken, {});

      // Primeira chamada a save() revoga a sessão antiga.
      expect(sessionRepository.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: existingSession.id,
          revokedAt: expect.any(Date) as Date,
        }),
      );
      // Uma nova sessão é criada com um refresh token diferente do anterior.
      expect(sessionRepository.create).toHaveBeenCalledTimes(1);
      expect(result.refreshToken).not.toBe(plainRefreshToken);
      expect(result.user).toBe(user);
    });

    it('rejects a revoked session with the generic session error', async () => {
      const plainRefreshToken = 'b'.repeat(128);
      sessionRepository.findOne.mockResolvedValue(
        buildSession({
          refreshTokenHash: sha256Hex(plainRefreshToken),
          revokedAt: new Date(),
        }),
      );

      await expect(
        authService.refresh(plainRefreshToken, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired session', async () => {
      const plainRefreshToken = 'c'.repeat(128);
      sessionRepository.findOne.mockResolvedValue(
        buildSession({
          refreshTokenHash: sha256Hex(plainRefreshToken),
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        authService.refresh(plainRefreshToken, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown refresh token', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.refresh('does-not-exist', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the session matching the given refresh token', async () => {
      const plainRefreshToken = 'd'.repeat(128);
      const session = buildSession({
        refreshTokenHash: sha256Hex(plainRefreshToken),
        revokedAt: null,
      });
      sessionRepository.findOne.mockResolvedValue(session);

      await authService.logout(plainRefreshToken);

      expect(sessionRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: session.id,
          revokedAt: expect.any(Date) as Date,
        }),
      );
    });

    it('does nothing when the refresh token does not match any session', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(
        authService.logout('unknown-token'),
      ).resolves.toBeUndefined();
      expect(sessionRepository.save).not.toHaveBeenCalled();
    });
  });
});
