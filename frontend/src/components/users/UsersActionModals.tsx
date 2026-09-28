"use client";

import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { TemporaryPasswordModal } from "./TemporaryPasswordModal";
import { UserAuditPanel } from "./UserAuditPanel";
import { UserFormModal, type UserFormSavedResult } from "./UserFormModal";
import type {
  PermissionsCatalogDto,
  UserDetailDto,
  UserListItemDto,
} from "@/types/users";

export type PendingAction =
  | { kind: "toggle-status"; user: UserListItemDto }
  | { kind: "reset-password"; user: UserListItemDto };

interface UsersActionModalsProps {
  formState: { mode: "create" } | { mode: "edit"; user: UserDetailDto } | null;
  catalog: PermissionsCatalogDto;
  currentUserId: string;
  onFormClose: () => void;
  onFormSaved: (result: UserFormSavedResult) => void;

  pendingAction: PendingAction | null;
  actionSubmitting: boolean;
  actionError: string | null;
  onConfirmPendingAction: () => void;
  onCancelPendingAction: () => void;

  tempPasswordReveal: { userName: string; password: string } | null;
  onCloseTempPassword: () => void;

  auditUser: UserListItemDto | null;
  onCloseAudit: () => void;
}

/** Agrupa os modais/diálogos da página `/usuarios` — puramente de orquestração/renderização condicional. */
export function UsersActionModals({
  formState,
  catalog,
  currentUserId,
  onFormClose,
  onFormSaved,
  pendingAction,
  actionSubmitting,
  actionError,
  onConfirmPendingAction,
  onCancelPendingAction,
  tempPasswordReveal,
  onCloseTempPassword,
  auditUser,
  onCloseAudit,
}: UsersActionModalsProps) {
  return (
    <>
      {formState ? (
        <UserFormModal
          mode={formState.mode}
          initialUser={formState.mode === "edit" ? formState.user : undefined}
          currentUserId={currentUserId}
          catalog={catalog}
          onClose={onFormClose}
          onSaved={onFormSaved}
        />
      ) : null}

      {pendingAction ? (
        <ConfirmActionDialog
          title={
            pendingAction.kind === "toggle-status"
              ? pendingAction.user.active
                ? "Desativar usuário"
                : "Reativar usuário"
              : "Redefinir senha"
          }
          description={
            pendingAction.kind === "toggle-status"
              ? pendingAction.user.active
                ? `${pendingAction.user.name} não conseguirá mais entrar no sistema.`
                : `${pendingAction.user.name} poderá entrar no sistema novamente.`
              : `Uma nova senha temporária será gerada para ${pendingAction.user.name} — a senha atual deixará de funcionar imediatamente.`
          }
          confirmLabel={
            pendingAction.kind === "toggle-status"
              ? pendingAction.user.active
                ? "Desativar"
                : "Reativar"
              : "Redefinir"
          }
          danger={pendingAction.kind === "toggle-status" && pendingAction.user.active}
          isSubmitting={actionSubmitting}
          errorMessage={actionError}
          onConfirm={onConfirmPendingAction}
          onCancel={onCancelPendingAction}
        />
      ) : null}

      {tempPasswordReveal ? (
        <TemporaryPasswordModal
          userName={tempPasswordReveal.userName}
          password={tempPasswordReveal.password}
          onClose={onCloseTempPassword}
        />
      ) : null}

      {auditUser ? (
        <UserAuditPanel
          userId={auditUser.id}
          userName={auditUser.name}
          onClose={onCloseAudit}
        />
      ) : null}
    </>
  );
}
