import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../interfaces/access-token-payload.interface';

/**
 * Extrai o payload do access token (populado por `AccessTokenGuard`) da
 * requisição atual.
 */
export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): AccessTokenPayload | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.user;
  },
);
