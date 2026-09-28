"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiFetchError } from "@/lib/api";
import {
  getPermissionsCatalog,
  getUser,
  listUsers,
  resetUserPassword,
  setUserStatus,
} from "@/lib/users-api";
import { hasPermission, useCurrentUser } from "@/hooks/useCurrentUser";
import {
  UserFiltersBar,
  type UserFiltersValue,
} from "@/components/users/UserFiltersBar";
import type { UserFormSavedResult } from "@/components/users/UserFormModal";
import { UsersActionModals, type PendingAction } from "@/components/users/UsersActionModals";
import { UsersTable } from "@/components/users/UsersTable";
import type {
  ListUsersQuery,
  Paginated,
  PermissionsCatalogDto,
  UserDetailDto,
  UserListItemDto,
} from "@/types/users";

const PAGE_SIZE = 20;

function Notice({
  tone,
  children,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  const classes =
    tone === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-700"
      : "border-border-subtle bg-surface text-foreground/60";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-sm ${classes}`}
    >
      {children}
    </div>
  );
}

interface UsersContentProps {
  canManage: boolean;
  currentUserId: string;
  refreshCurrentUser: () => Promise<void>;
}

function UsersContent({
  canManage,
  currentUserId,
  refreshCurrentUser,
}: UsersContentProps) {
  const [filters, setFilters] = useState<UserFiltersValue>({
    status: "all",
    role: "all",
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<UserListItemDto> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<PermissionsCatalogDto | null>(null);

  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; user: UserDetailDto } | null
  >(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetailFor, setLoadingDetailFor] = useState<string | null>(
    null,
  );

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [tempPasswordReveal, setTempPasswordReveal] = useState<{
    userName: string;
    password: string;
  } | null>(null);
  const [auditUser, setAuditUser] = useState<UserListItemDto | null>(null);

  const loadUsers = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const query: ListUsersQuery = { page, limit: PAGE_SIZE };
        if (filters.status !== "all") query.status = filters.status;
        if (filters.role !== "all") query.role = filters.role;
        const result = await listUsers(query, signal);
        if (signal?.aborted) return;
        setData(result);
        setListError(null);
      } catch (caught) {
        if (signal?.aborted) return;
        setListError(
          caught instanceof ApiFetchError
            ? caught.message
            : "Não foi possível carregar os usuários agora.",
        );
      }
    },
    [page, filters],
  );

  // Aborta a leitura pendente ao trocar filtro/página ou desmontar.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await loadUsers(controller.signal);
    })();
    return () => controller.abort();
  }, [loadUsers]);

  useEffect(() => {
    const controller = new AbortController();
    getPermissionsCatalog(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch(() => {
        // Erro tratado implicitamente: catalog permanece null e a página
        // mostra "Carregando..." — usuário pode recarregar a página.
      });
    return () => controller.abort();
  }, []);

  async function openCreate() {
    setDetailError(null);
    setFormState({ mode: "create" });
  }

  async function openEdit(row: UserListItemDto) {
    setDetailError(null);
    setLoadingDetailFor(row.id);
    try {
      const detail = await getUser(row.id);
      setFormState({ mode: "edit", user: detail });
    } catch (caught) {
      setDetailError(
        caught instanceof ApiFetchError
          ? caught.message
          : "Não foi possível carregar os dados do usuário.",
      );
    } finally {
      setLoadingDetailFor(null);
    }
  }

  async function handleFormSaved(result: UserFormSavedResult) {
    setFormState(null);
    await loadUsers();
    if (result.temporaryPassword) {
      setTempPasswordReveal({
        userName: result.user.name,
        password: result.temporaryPassword,
      });
    }
    // Reflete papel/permissões/escopo atualizados na Sidebar/gate sem
    // recarregar a página inteira.
    if (result.isSelf) {
      await refreshCurrentUser();
    }
  }

  function requestToggleStatus(row: UserListItemDto) {
    setActionError(null);
    setPendingAction({ kind: "toggle-status", user: row });
  }

  function requestResetPassword(row: UserListItemDto) {
    setActionError(null);
    setPendingAction({ kind: "reset-password", user: row });
  }

  async function confirmPendingAction() {
    if (!pendingAction || actionSubmitting) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      if (pendingAction.kind === "toggle-status") {
        await setUserStatus(
          pendingAction.user.id,
          !pendingAction.user.active,
        );
        await loadUsers();
      } else {
        const result = await resetUserPassword(pendingAction.user.id);
        setTempPasswordReveal({
          userName: pendingAction.user.name,
          password: result.temporaryPassword,
        });
      }
      setPendingAction(null);
    } catch (caught) {
      setActionError(
        caught instanceof ApiFetchError
          ? caught.message
          : "Não foi possível concluir a ação agora.",
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  if (!catalog) {
    return <Notice tone="info">Carregando...</Notice>;
  }

  return (
    <>
      <div className="flex items-center justify-end">
        {canManage ? (
          <button
            type="button"
            onClick={() => void openCreate()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
          >
            Novo usuário
          </button>
        ) : null}
      </div>

      <UserFiltersBar
        value={filters}
        onChange={(next) => {
          setPage(1);
          setFilters(next);
        }}
      />

      {listError ? <Notice tone="error">{listError}</Notice> : null}
      {detailError ? <Notice tone="error">{detailError}</Notice> : null}
      {loadingDetailFor ? (
        <Notice tone="info">Carregando dados do usuário...</Notice>
      ) : null}

      {!data ? (
        <Notice tone="info">Carregando usuários...</Notice>
      ) : (
        <UsersTable
          users={data.items}
          page={data.page}
          totalPages={Math.max(1, Math.ceil(data.total / data.limit))}
          total={data.total}
          currentUserId={currentUserId}
          canManage={canManage}
          onPageChange={setPage}
          onEdit={(row) => void openEdit(row)}
          onToggleStatus={requestToggleStatus}
          onResetPassword={requestResetPassword}
          onViewAudit={setAuditUser}
        />
      )}

      <UsersActionModals
        formState={formState}
        catalog={catalog}
        currentUserId={currentUserId}
        onFormClose={() => setFormState(null)}
        onFormSaved={(result) => void handleFormSaved(result)}
        pendingAction={pendingAction}
        actionSubmitting={actionSubmitting}
        actionError={actionError}
        onConfirmPendingAction={() => void confirmPendingAction()}
        onCancelPendingAction={() => {
          setPendingAction(null);
          setActionError(null);
        }}
        tempPasswordReveal={tempPasswordReveal}
        onCloseTempPassword={() => setTempPasswordReveal(null)}
        auditUser={auditUser}
        onCloseAudit={() => setAuditUser(null)}
      />
    </>
  );
}

export default function UsuariosPage() {
  const { user, status, refresh } = useCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Gerencie contas, papéis e permissões de acesso à Central de
          Performance.
        </p>
      </div>

      {status !== "ready" ? (
        <Notice tone="info">Carregando...</Notice>
      ) : !hasPermission(user, "users.view") ? (
        <Notice tone="error">
          Acesso restrito — você não tem permissão para visualizar usuários.
        </Notice>
      ) : (
        <UsersContent
          canManage={hasPermission(user, "users.manage")}
          currentUserId={user!.id}
          refreshCurrentUser={refresh}
        />
      )}
    </div>
  );
}
