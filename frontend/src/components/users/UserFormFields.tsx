"use client";

import {
  ACCOUNT_SCOPE_MODE_LABELS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_LABELS,
} from "@/lib/users-permission-labels";
import { ROLE_KEYS, type PermissionKey, type RoleKey, type UserDetailDto } from "@/types/users";
import type { MarketplaceAccountDto } from "@/types/marketplace";

interface UserIdentityFieldsProps {
  mode: "create" | "edit";
  initialUser?: UserDetailDto;
  name: string;
  onNameChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  role: RoleKey;
  onRoleChange: (role: RoleKey) => void;
}

/** E-mail só é editável na criação — `UpdateUserDto` não aceita trocar e-mail. */
export function UserIdentityFields({
  mode,
  initialUser,
  name,
  onNameChange,
  email,
  onEmailChange,
  role,
  onRoleChange,
}: UserIdentityFieldsProps) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Nome
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          className="rounded-md border border-border-subtle bg-background px-3 py-2"
        />
      </label>

      {mode === "create" ? (
        <label className="flex flex-col gap-1 text-sm">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            className="rounded-md border border-border-subtle bg-background px-3 py-2"
          />
        </label>
      ) : (
        <p className="text-sm text-foreground/60">E-mail: {initialUser?.email}</p>
      )}

      {mode === "edit" ? (
        <p className="text-sm text-foreground/60">
          Status: {initialUser?.active ? "Ativo" : "Inativo"}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        Papel
        <select
          value={role}
          onChange={(event) => onRoleChange(event.target.value as RoleKey)}
          className="rounded-md border border-border-subtle bg-background px-3 py-2"
        >
          {ROLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {ROLE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function accountLabel(account: MarketplaceAccountDto): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.id.slice(0, 8)}`;
}

interface UserAccountScopeFieldsetProps {
  role: RoleKey;
  scopeMode: "ALL" | "SELECTED" | "NONE";
  onScopeModeChange: (mode: "ALL" | "SELECTED" | "NONE") => void;
  accounts: MarketplaceAccountDto[];
  accountsLoading: boolean;
  accountsLoadError: boolean;
  selectedAccountIds: ReadonlySet<string>;
  onToggleAccount: (id: string) => void;
}

/** ADMIN trava em ALL (rádios desabilitados) — escopo por conta só existe para ANALYST/VIEWER. */
export function UserAccountScopeFieldset({
  role,
  scopeMode,
  onScopeModeChange,
  accounts,
  accountsLoading,
  accountsLoadError,
  selectedAccountIds,
  onToggleAccount,
}: UserAccountScopeFieldsetProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Escopo de contas</legend>
      {(["ALL", "SELECTED", "NONE"] as const).map((modeOption) => (
        <label key={modeOption} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="account-scope-mode"
            checked={scopeMode === modeOption}
            disabled={role === "ADMIN"}
            onChange={() => onScopeModeChange(modeOption)}
          />
          {ACCOUNT_SCOPE_MODE_LABELS[modeOption]}
        </label>
      ))}
      {role !== "ADMIN" && scopeMode === "SELECTED" ? (
        accountsLoading ? (
          <p className="pl-4 text-xs text-foreground/60">
            Carregando contas...
          </p>
        ) : accountsLoadError ? (
          <p role="alert" className="pl-4 text-xs text-red-700">
            Não foi possível carregar as contas de marketplace. Tente
            novamente.
          </p>
        ) : (
          <div className="flex flex-col gap-1 pl-4">
            {accounts.map((account) => (
              <label key={account.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedAccountIds.has(account.id)}
                  onChange={() => onToggleAccount(account.id)}
                />
                {accountLabel(account)}
              </label>
            ))}
          </div>
        )
      ) : null}
    </fieldset>
  );
}

interface UserPermissionsFieldsetProps {
  role: RoleKey;
  preset: readonly PermissionKey[];
  selectedPermissions: ReadonlySet<PermissionKey>;
  onTogglePermission: (key: PermissionKey) => void;
}

/**
 * ADMIN mostra tudo marcado/desabilitado; `users.manage` nunca é
 * selecionável fora do ADMIN. Marca "(alterado)" quando o estado do
 * checkbox diverge do preset do papel — mostra claramente o que foi
 * herdado vs. modificado.
 */
export function UserPermissionsFieldset({
  role,
  preset,
  selectedPermissions,
  onTogglePermission,
}: UserPermissionsFieldsetProps) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-sm font-medium">Permissões</legend>
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            {group.title}
          </p>
          <div className="flex flex-col gap-1 pl-2">
            {group.keys.map((key) => {
              const checked = role === "ADMIN" || selectedPermissions.has(key);
              const disabled = role === "ADMIN" || key === "users.manage";
              const differsFromPreset =
                role !== "ADMIN" && preset.includes(key) !== checked;
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onTogglePermission(key)}
                  />
                  <span>
                    {PERMISSION_LABELS[key].label}
                    <span className="block text-xs text-foreground/50">
                      {PERMISSION_LABELS[key].description}
                    </span>
                  </span>
                  {differsFromPreset ? (
                    <span className="text-xs font-medium text-brand">
                      (alterado)
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
