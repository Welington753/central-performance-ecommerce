import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import {
  PermissionGuard,
  RequirePermissions,
} from '../auth/guards/permission.guard';
import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { AuditQueryDto } from './dto/audit-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { LastActiveAdminRequiredError } from './last-admin-guard';
import { PERMISSIONS } from './permissions.catalog';
import {
  CannotResetOwnPasswordError,
  InvalidAccountScopeError,
  InvalidPermissionError,
  RoleNotFoundError,
  UserEmailAlreadyExistsError,
  UserNotFoundError,
} from './users-management.errors';
import { UsersManagementService } from './users-management.service';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * API administrativa de usuários (Checkpoint 3). Rotas estáticas
 * (`/permissions-catalog`) declaradas ANTES de `/:id` — evita colisão de
 * roteamento (`/permissions-catalog` nunca é interpretado como um `:id`).
 * Controller nunca acessa TypeORM diretamente — tudo via
 * `UsersManagementService`.
 */
@ApiTags('users')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersManagementService: UsersManagementService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async list(@Query() query: ListUsersQueryDto) {
    return this.usersManagementService.list(query);
  }

  @Get('permissions-catalog')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  getPermissionsCatalog() {
    return this.usersManagementService.getPermissionsCatalog();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.mapErrors(() => this.usersManagementService.getById(id));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AccessTokenPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!actor) throw new UnauthorizedException('Não autenticado.');
    response.set(NO_STORE_HEADERS);
    return this.mapErrors(() =>
      this.usersManagementService.create(actor.sub, {
        name: dto.name,
        email: dto.email,
        role: dto.role,
        overrides: dto.overrides,
        accountScope: dto.accountScope,
      }),
    );
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AccessTokenPayload | undefined,
  ) {
    if (!actor) throw new UnauthorizedException('Não autenticado.');
    return this.mapErrors(() =>
      this.usersManagementService.update(actor.sub, id, {
        name: dto.name,
        role: dto.role,
        overrides: dto.overrides,
        accountScope: dto.accountScope,
      }),
    );
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AccessTokenPayload | undefined,
  ) {
    if (!actor) throw new UnauthorizedException('Não autenticado.');
    return this.mapErrors(() =>
      this.usersManagementService.setStatus(actor.sub, id, dto.active),
    );
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!actor) throw new UnauthorizedException('Não autenticado.');
    response.set(NO_STORE_HEADERS);
    return this.mapErrors(() =>
      this.usersManagementService.resetPassword(actor.sub, id),
    );
  }

  @Get(':id/audit')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async getAudit(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AuditQueryDto,
  ) {
    return this.mapErrors(() =>
      this.usersManagementService.getAudit(id, query),
    );
  }

  private async mapErrors<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof UserNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof RoleNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof UserEmailAlreadyExistsError)
        throw new ConflictException(error.message);
      if (error instanceof InvalidPermissionError)
        throw new BadRequestException(error.message);
      if (error instanceof InvalidAccountScopeError)
        throw new BadRequestException(error.message);
      if (error instanceof CannotResetOwnPasswordError)
        throw new BadRequestException(error.message);
      if (error instanceof LastActiveAdminRequiredError)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
