import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from '../../users/users.service';

/**
 * Checkpoint BI-1: exige que o usuário autenticado seja administrador
 * (`users.is_admin`) — SEMPRE composto DEPOIS de `AccessTokenGuard`
 * (`@UseGuards(AccessTokenGuard, AdminGuard)`), nunca sozinho, já que
 * depende de `request.user` já populado.
 *
 * Relê o usuário do banco a cada requisição (nunca confia num campo
 * `isAdmin` embutido no JWT) — uma promoção/rebaixamento de administrador
 * feita direto no banco vale imediatamente na próxima requisição, sem
 * esperar o token expirar ou exigir novo login. Mesmo padrão de releitura
 * "sempre fresca" já usado por `AuthService.getActiveUserOrFail`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = request.user;
    if (!payload) {
      throw new UnauthorizedException('Não autenticado.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active || !user.isAdmin) {
      throw new ForbiddenException('Ação restrita a administradores.');
    }

    return true;
  }
}
