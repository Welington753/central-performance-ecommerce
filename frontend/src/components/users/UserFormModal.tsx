"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiFetchError, fetchMarketplaceAccounts } from "@/lib/api";
import { createUser, updateUser } from "@/lib/users-api";
import {
  buildAccountScopePayload,
  computeOverrides,
} from "@/lib/users-form-helpers";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  UserAccountScopeFieldset,
  UserIdentityFields,
  UserPermissionsFieldset,
} from "./UserFormFields";
import type { PermissionKey, PermissionsCatalogDto, RoleKey, UserDetailDto } from "@/types/users";
import type { MarketplaceAccountDto } from "@/types/marketplace";

export interface UserFormSavedResult {
  user: UserDetailDto;
  temporaryPassword?: string;
  isSelf: boolean;
}

interface UserFormModalProps {
  mode: "create" | "edit";
  initialUser?: UserDetailDto;
  currentUserId: string;
  catalog: PermissionsCatalogDto;
  onClose: () => void;
  onSaved: (result: UserFormSavedResult) => void;
}

type AccountScopeMode = "ALL" | "SELECTED" | "NONE";

/**
 * Criação/edição de usuário (Checkpoint 4). Regras de negócio replicadas
 * aqui (ADMIN fixo/tudo marcado; ANALYST/VIEWER só enviam overrides; escopo
 * SELECTED bloqueado sem contas carregadas) só evitam um erro óbvio de UX —
 * `UserAccessRulesService` no backend continua sendo quem decide de fato.
 */
export function UserFormModal({
  mode,
  initialUser,
  currentUserId,
  catalog,
  onClose,
  onSaved,
}: UserFormModalProps) {
  const initialRole = initialUser?.role ?? "VIEWER";

  const [name, setName] = useState(initialUser?.name ?? "");
  const [email, setEmail] = useState(initialUser?.email ?? "");
  const [role, setRole] = useState<RoleKey>(initialRole);
  const [scopeMode, setScopeMode] = useState<AccountScopeMode>(
    initialUser?.accountScope.mode ?? "ALL",
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () =>
      new Set(
        initialUser?.accountScope.mode === "SELECTED"
          ? initialUser.accountScope.accountIds
          : [],
      ),
  );
  const [selectedPermissions, setSelectedPermissions] = useState<
    Set<PermissionKey>
  >(
    () =>
      new Set(
        initialUser ? initialUser.permissions : catalog.presets[initialRole] ?? [],
      ),
  );

  const [accounts, setAccounts] = useState<MarketplaceAccountDto[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsLoadError, setAccountsLoadError] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    description: string;
  } | null>(null);

  // Contas SEMPRE vêm da API real de marketplace accounts — nunca uma lista
  // hardcoded/mock. Aborta ao desmontar (cliente atual suporta AbortSignal).
  useEffect(() => {
    const controller = new AbortController();
    // `accountsLoading` já nasce `true` (estado inicial) — este efeito roda
    // uma única vez na montagem (deps `[]`), então nunca precisa reafirmar
    // o valor aqui (evitaria um setState síncrono logo no corpo do efeito).
    fetchMarketplaceAccounts(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAccounts(result);
        setAccountsLoadError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccountsLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAccountsLoading(false);
      });
    return () => controller.abort();
  }, []);

  function handleRoleChange(nextRole: RoleKey) {
    setRole(nextRole);
    if (nextRole === "ADMIN") {
      setSelectedPermissions(new Set(catalog.permissions));
      setScopeMode("ALL");
      setSelectedAccountIds(new Set());
    } else {
      setSelectedPermissions(new Set(catalog.presets[nextRole] ?? []));
    }
  }

  function togglePermission(key: PermissionKey) {
    if (role === "ADMIN" || key === "users.manage") return;
    setSelectedPermissions((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAccount(id: string) {
    setSelectedAccountIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const preset = catalog.presets[role] ?? [];

  function buildPayloadPieces() {
    const overrides = computeOverrides(
      role,
      catalog.permissions,
      preset,
      selectedPermissions,
    );
    const accountScope =
      role === "ADMIN"
        ? ({ mode: "ALL" } as const)
        : buildAccountScopePayload(scopeMode, [...selectedAccountIds]);
    return { overrides, accountScope };
  }

  /**
   * `message: null` bloqueia o envio sem duplicar um banner de formulário —
   * usado só para `accountsLoadError`, cuja mensagem já aparece inline junto
   * à lista de contas (ver fieldset "Escopo de contas" abaixo).
   */
  function validationBlock(): { message: string | null } | null {
    if (!name.trim()) return { message: "Informe o nome." };
    if (mode === "create" && !email.trim()) {
      return { message: "Informe o e-mail." };
    }
    if (role !== "ADMIN" && scopeMode === "SELECTED") {
      if (accountsLoading) {
        return { message: "Aguarde o carregamento das contas." };
      }
      if (accountsLoadError) return { message: null };
      if (selectedAccountIds.size === 0) {
        return { message: "Selecione ao menos uma conta." };
      }
    }
    return null;
  }

  function riskyChangeConfirmation(): {
    title: string;
    description: string;
  } | null {
    if (mode !== "edit" || !initialUser) return null;

    if (initialUser.role !== "ADMIN" && role === "ADMIN") {
      return {
        title: "Promover a Administrador",
        description: `${initialUser.name} passará a ter todas as permissões do sistema.`,
      };
    }
    if (initialUser.role === "ADMIN" && role !== "ADMIN") {
      return {
        title: "Remover papel de Administrador",
        description: `Você está removendo o papel de Administrador de ${initialUser.name}.`,
      };
    }
    if (initialUser.id === currentUserId) {
      const { overrides } = buildPayloadPieces();
      const permissionsChanged = overrides.length > 0;
      if (permissionsChanged) {
        return {
          title: "Alterar suas próprias permissões",
          description: "Você está alterando suas próprias permissões.",
        };
      }
    }
    return null;
  }

  async function performSave() {
    setIsSubmitting(true);
    setFormError(null);
    try {
      const { overrides, accountScope } = buildPayloadPieces();
      if (mode === "create") {
        const result = await createUser({
          name: name.trim(),
          email: email.trim(),
          role,
          overrides,
          accountScope,
        });
        onSaved({
          user: result.user,
          temporaryPassword: result.temporaryPassword,
          isSelf: false,
        });
      } else if (initialUser) {
        const updated = await updateUser(initialUser.id, {
          name: name.trim(),
          role,
          overrides,
          accountScope,
        });
        onSaved({ user: updated, isSelf: initialUser.id === currentUserId });
      }
    } catch (caught) {
      setFormError(
        caught instanceof ApiFetchError
          ? caught.message
          : "Não foi possível salvar agora. Tente novamente.",
      );
      setIsSubmitting(false);
      setPendingConfirm(null);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    const block = validationBlock();
    if (block) {
      setFormError(block.message);
      return;
    }

    const risky = riskyChangeConfirmation();
    if (risky) {
      setFormError(null);
      setPendingConfirm(risky);
      return;
    }
    await performSave();
  }

  const title =
    mode === "create" ? "Novo usuário" : `Editar ${initialUser?.name ?? ""}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-border-subtle bg-surface p-6"
      >
        <h2 id="user-form-title" className="text-lg font-semibold">
          {title}
        </h2>

        <UserIdentityFields
          mode={mode}
          initialUser={initialUser}
          name={name}
          onNameChange={setName}
          email={email}
          onEmailChange={setEmail}
          role={role}
          onRoleChange={handleRoleChange}
        />

        <UserAccountScopeFieldset
          role={role}
          scopeMode={scopeMode}
          onScopeModeChange={setScopeMode}
          accounts={accounts}
          accountsLoading={accountsLoading}
          accountsLoadError={accountsLoadError}
          selectedAccountIds={selectedAccountIds}
          onToggleAccount={toggleAccount}
        />

        <UserPermissionsFieldset
          role={role}
          preset={preset}
          selectedPermissions={selectedPermissions}
          onTogglePermission={togglePermission}
        />

        {formError ? (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-border-subtle px-4 py-1.5 text-sm disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-brand-foreground disabled:opacity-50"
          >
            {isSubmitting ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>

      {pendingConfirm ? (
        <ConfirmActionDialog
          title={pendingConfirm.title}
          description={pendingConfirm.description}
          confirmLabel="Confirmar"
          isSubmitting={isSubmitting}
          onConfirm={() => void performSave()}
          onCancel={() => setPendingConfirm(null)}
        />
      ) : null}
    </div>
  );
}
