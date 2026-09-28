import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryRunner, Repository } from 'typeorm';
import { MarketplaceAccount } from '../integrations/marketplace-accounts/marketplace-account.entity';
import {
  isPermissionKey,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSION_PRESETS,
  type PermissionKey,
  type RoleKey,
} from './permissions.catalog';
import {
  InvalidAccountScopeError,
  InvalidPermissionError,
} from './users-management.errors';
import type {
  AccountScopeInput,
  OverrideInput,
} from './users-management.types';

/**
 * Ponto ÚNICO das regras de override/escopo de conta e da persistência
 * dessas duas tabelas — usado por `UserProvisioningService` (create) e
 * `UserAccessManagementService` (update), nunca duplicado inline em nenhum
 * dos dois.
 */
@Injectable()
export class UserAccessRulesService {
  constructor(
    @InjectRepository(MarketplaceAccount)
    private readonly marketplaceAccountRepository: Repository<MarketplaceAccount>,
  ) {}

  private presetFor(role: RoleKey): readonly PermissionKey[] {
    return ROLE_PERMISSION_PRESETS[role];
  }

  /**
   * Regra "ADMIN sempre tem tudo, nunca aceita override" — chamado tanto na
   * criação quanto na edição.
   */
  resolveOverridesForRole(
    roleKey: RoleKey,
    overrides: OverrideInput[],
  ): OverrideInput[] {
    if (roleKey === ROLE_KEYS.ADMIN) {
      if (overrides.length > 0) {
        throw new InvalidPermissionError('ADMIN não aceita overrides');
      }
      return [];
    }
    return this.validateAndResolveOverrides(roleKey, overrides);
  }

  /**
   * Regra "ADMIN sempre tem escopo ALL, nunca accountIds" — chamado tanto na
   * criação quanto na edição.
   */
  validateAccountScopeForRole(
    roleKey: RoleKey,
    scope: AccountScopeInput,
  ): void {
    if (roleKey === ROLE_KEYS.ADMIN) {
      if (scope.mode !== 'ALL' || (scope.accountIds?.length ?? 0) > 0) {
        throw new InvalidAccountScopeError('ADMIN sempre tem escopo ALL');
      }
      return;
    }
    this.validateAccountScope(scope);
  }

  /**
   * Valida e poda overrides contra o preset do papel NÃO-ADMIN — usada
   * tanto para override recém-enviado quanto para re-podar overrides
   * residuais ao trocar de papel entre ANALYST/VIEWER.
   */
  private validateAndResolveOverrides(
    roleKey: RoleKey,
    overrides: OverrideInput[],
  ): OverrideInput[] {
    const seen = new Set<string>();
    const preset = new Set<PermissionKey>(this.presetFor(roleKey));
    const result: OverrideInput[] = [];

    for (const override of overrides) {
      if (!isPermissionKey(override.permissionKey)) {
        throw new InvalidPermissionError(
          `chave desconhecida: ${override.permissionKey}`,
        );
      }
      if (seen.has(override.permissionKey)) {
        throw new InvalidPermissionError(
          `chave duplicada: ${override.permissionKey}`,
        );
      }
      seen.add(override.permissionKey);

      if (override.permissionKey === PERMISSIONS.USERS_MANAGE) {
        throw new InvalidPermissionError(
          'users.manage não pode ser concedida por override',
        );
      }

      const alreadyInPreset = preset.has(override.permissionKey);
      const redundant =
        (override.granted && alreadyInPreset) ||
        (!override.granted && !alreadyInPreset);
      if (!redundant) {
        result.push(override);
      }
    }

    return result;
  }

  private validateAccountScope(scope: AccountScopeInput): void {
    const accountIds = scope.accountIds ?? [];
    if (scope.mode === 'ALL' || scope.mode === 'NONE') {
      if (accountIds.length > 0) {
        throw new InvalidAccountScopeError(
          `${scope.mode} não aceita accountIds`,
        );
      }
      return;
    }
    if (scope.mode === 'SELECTED') {
      if (accountIds.length === 0) {
        throw new InvalidAccountScopeError('SELECTED exige ao menos uma conta');
      }
    }
  }

  private async normalizeAndValidateAccountIds(
    accountIds: string[],
  ): Promise<string[]> {
    const normalized = [...new Set(accountIds)].sort();
    const existing = await this.marketplaceAccountRepository.findBy({
      id: In(normalized),
    });
    if (existing.length !== normalized.length) {
      throw new InvalidAccountScopeError(
        'uma ou mais contas informadas não existem',
      );
    }
    return normalized;
  }

  async persistOverrides(
    queryRunner: QueryRunner,
    userId: string,
    overrides: OverrideInput[],
  ): Promise<void> {
    for (const override of overrides) {
      await queryRunner.query(
        `INSERT INTO "user_permission_overrides" (user_id, permission_key, granted)
         VALUES ($1, $2, $3)`,
        [userId, override.permissionKey, override.granted],
      );
    }
  }

  async persistAccountScope(
    queryRunner: QueryRunner,
    userId: string,
    scope: AccountScopeInput,
  ): Promise<void> {
    if (scope.mode !== 'SELECTED') return;
    const accountIds = await this.normalizeAndValidateAccountIds(
      scope.accountIds ?? [],
    );
    for (const accountId of accountIds) {
      await queryRunner.query(
        `INSERT INTO "user_account_scope" (user_id, marketplace_account_id) VALUES ($1, $2)`,
        [userId, accountId],
      );
    }
  }
}
