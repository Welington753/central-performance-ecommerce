import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE_NAME } from '../constants/auth.constants';
import type { AccessTokenPayload } from '../interfaces/access-token-payload.interface';

/**
 * Guard reutilizável que exige um access token JWT válido no cookie
 * HttpOnly `access_token`. Usado por qualquer rota protegida (ex.:
 * `/marketplace-accounts`, `/sync-runs`, `/auth/me`).
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE_NAME] as
      string | undefined;

    if (!token) {
      throw new UnauthorizedException('Não autenticado.');
    }

    try {
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('ACCESS_TOKEN_SECRET'),
      });
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Não autenticado.');
    }
  }
}
