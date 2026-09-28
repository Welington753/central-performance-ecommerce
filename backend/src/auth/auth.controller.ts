import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUserResponseDto } from '../users/dto/current-user-response.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { PermissionResolverService } from '../users/permission-resolver.service';
import { toCurrentUserResponse, toUserResponse } from '../users/users.mapper';
import { AuthService } from './auth.service';
import {
  CurrentPasswordInvalidError,
  NewPasswordMustDifferError,
} from './change-password.errors';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from './constants/auth.constants';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { AccessTokenGuard } from './guards/access-token.guard';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';

interface AuthResponse {
  user: UserResponseDto;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly permissionResolverService: PermissionResolverService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto.email, dto.password, {
      ip: req.ip ?? null,
      userAgent: this.extractUserAgent(req),
    });
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { user: toUserResponse(result.user) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    const result = await this.authService.refresh(refreshToken, {
      ip: req.ip ?? null,
      userAgent: this.extractUserAgent(req),
    });
    this.setAuthCookies(res, result.accessToken, result.refreshToken);
    return { user: toUserResponse(result.user) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    this.clearAuthCookies(res);
    return { success: true };
  }

  @ApiCookieAuth()
  @UseGuards(AccessTokenGuard)
  @Get('me')
  async me(
    @CurrentUser() payload?: AccessTokenPayload,
  ): Promise<CurrentUserResponseDto> {
    if (!payload) {
      throw new UnauthorizedException('Não autenticado.');
    }
    const user = await this.authService.getActiveUserOrFail(payload.sub);
    // Resolvido do zero a cada chamada (nunca cacheado) — uma mudança de
    // papel/permissão/escopo feita direto no banco vale já na próxima
    // requisição, sem exigir novo login.
    const authorization = await this.permissionResolverService.resolve(
      payload.sub,
    );
    return toCurrentUserResponse(user, authorization);
  }

  /**
   * Nunca protegido por `PermissionGuard` (só `AccessTokenGuard`) — precisa
   * continuar acessível mesmo com `mustChangePassword=true` (é exatamente
   * a rota que resolve isso). Exige SEMPRE a senha atual, inclusive no
   * primeiro acesso. Revoga todas as sessões do usuário (a atual inclusa)
   * e limpa os cookies — o usuário precisa logar de novo com a senha nova.
   */
  @ApiCookieAuth()
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() payload: AccessTokenPayload | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    if (!payload) {
      throw new UnauthorizedException('Não autenticado.');
    }
    try {
      await this.authService.changePassword(
        payload.sub,
        dto.currentPassword,
        dto.newPassword,
      );
    } catch (error) {
      if (error instanceof CurrentPasswordInvalidError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof NewPasswordMustDifferError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    this.clearAuthCookies(res);
    return { success: true };
  }

  private extractUserAgent(req: Request): string | null {
    // "user-agent" é tipado por @types/node como `string | undefined`
    // (cabeçalho conhecido de valor único, ao contrário de "set-cookie").
    return req.headers['user-agent'] ?? null;
  }

  private isSecureCookie(): boolean {
    return this.configService.get<string>('COOKIE_SECURE') === 'true';
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureCookie(),
      path: '/',
    };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const accessTokenTtlSeconds = this.configService.get<number>(
      'ACCESS_TOKEN_TTL_SECONDS',
      900,
    );
    const refreshTokenTtlDays = this.configService.get<number>(
      'REFRESH_TOKEN_TTL_DAYS',
      30,
    );

    res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
      ...this.baseCookieOptions(),
      maxAge: accessTokenTtlSeconds * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      ...this.baseCookieOptions(),
      maxAge: refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, this.baseCookieOptions());
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, this.baseCookieOptions());
  }
}
