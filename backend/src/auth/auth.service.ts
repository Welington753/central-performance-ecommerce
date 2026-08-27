import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import {
  GENERIC_AUTH_ERROR_MESSAGE,
  GENERIC_SESSION_ERROR_MESSAGE,
} from './constants/auth.constants';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { UserSession } from './user-session.entity';

const REFRESH_TOKEN_BYTES = 64;

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends IssuedTokens {
  user: User;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Duração do access token, em segundos (padrão: 900s = 15 minutos). */
  private get accessTokenTtlSeconds(): number {
    return this.configService.get<number>('ACCESS_TOKEN_TTL_SECONDS', 900);
  }

  private get refreshTokenTtlDays(): number {
    return this.configService.get<number>('REFRESH_TOKEN_TTL_DAYS', 30);
  }

  async login(
    email: string,
    password: string,
    context: SessionContext,
  ): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(email);
    const isPasswordValid = user
      ? await this.verifyPassword(user.passwordHash, password)
      : false;

    if (!user || !user.active || !isPasswordValid) {
      // Mensagem idêntica para email inexistente e para senha incorreta —
      // nunca revelar qual dos dois campos estava errado.
      throw new UnauthorizedException(GENERIC_AUTH_ERROR_MESSAGE);
    }

    const tokens = await this.issueTokens(user, context);
    return { user, ...tokens };
  }

  async refresh(
    refreshTokenPlain: string,
    context: SessionContext,
  ): Promise<AuthResult> {
    const refreshTokenHash = sha256Hex(refreshTokenPlain);
    const session = await this.sessionRepository.findOne({
      where: { refreshTokenHash },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(GENERIC_SESSION_ERROR_MESSAGE);
    }

    const user = await this.usersService.findById(session.userId);
    if (!user || !user.active) {
      throw new UnauthorizedException(GENERIC_SESSION_ERROR_MESSAGE);
    }

    // Rotação: revoga a sessão atual antes de emitir uma nova.
    session.revokedAt = new Date();
    await this.sessionRepository.save(session);

    const tokens = await this.issueTokens(user, context);
    return { user, ...tokens };
  }

  async logout(refreshTokenPlain: string): Promise<void> {
    const refreshTokenHash = sha256Hex(refreshTokenPlain);
    const session = await this.sessionRepository.findOne({
      where: { refreshTokenHash },
    });

    if (session && !session.revokedAt) {
      session.revokedAt = new Date();
      await this.sessionRepository.save(session);
    }
  }

  async getActiveUserOrFail(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.active) {
      throw new UnauthorizedException('Não autenticado.');
    }
    return user;
  }

  private async verifyPassword(
    passwordHash: string,
    plainPassword: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, plainPassword);
    } catch {
      return false;
    }
  }

  private async issueTokens(
    user: User,
    context: SessionContext,
  ): Promise<IssuedTokens> {
    const refreshTokenPlain = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const refreshTokenHash = sha256Hex(refreshTokenPlain);
    const expiresAt = new Date(
      Date.now() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    const session = this.sessionRepository.create({
      userId: user.id,
      refreshTokenHash,
      expiresAt,
      revokedAt: null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
    await this.sessionRepository.save(session);

    const accessTokenPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
    };
    const accessToken = await this.jwtService.signAsync(accessTokenPayload, {
      secret: this.configService.getOrThrow<string>('ACCESS_TOKEN_SECRET'),
      expiresIn: this.accessTokenTtlSeconds,
    });

    return { accessToken, refreshToken: refreshTokenPlain };
  }
}
