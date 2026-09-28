/**
 * Cliente dedicado de `/users*` e `POST /auth/change-password` (Checkpoint 4)
 * — mesmo padrão de `customers-api.ts`: usa só `apiFetch` (credenciais,
 * refresh automático e timeout compartilhados, nunca um fetch próprio),
 * nunca uma URL fixa do Render, nunca token manual em header, e nunca loga
 * request/response (a senha temporária só existe no valor de retorno
 * tipado, nunca em um `console.*`).
 */
import { ApiFetchError, apiFetch, parseSanitizedErrorCode } from "@/lib/api";
import type {
  AuditLogItemDto,
  AuditQuery,
  CreateUserPayload,
  CreateUserResult,
  ListUsersQuery,
  Paginated,
  PermissionsCatalogDto,
  ResetPasswordResult,
  UpdateUserPayload,
  UserDetailDto,
  UserListItemDto,
} from "@/types/users";

/** Códigos estáveis do backend (Checkpoint 3/4) → mensagem amigável em PT-BR. */
export const USERS_ERROR_MESSAGES: Record<string, string> = {
  USER_NOT_FOUND: "Usuário não encontrado.",
  USER_EMAIL_ALREADY_EXISTS: "Já existe um usuário com este e-mail.",
  ROLE_NOT_FOUND: "Papel inválido.",
  INVALID_PERMISSION: "Permissão inválida.",
  INVALID_ACCOUNT_SCOPE: "Escopo de contas inválido.",
  LAST_ACTIVE_ADMIN_REQUIRED:
    "Não é possível remover o último administrador ativo.",
  CANNOT_RESET_OWN_PASSWORD:
    "Não é possível redefinir sua própria senha por esta tela.",
  CURRENT_PASSWORD_INVALID: "Senha atual incorreta.",
  NEW_PASSWORD_MUST_DIFFER: "A nova senha deve ser diferente da atual.",
  PASSWORD_CHANGE_REQUIRED:
    "É necessário trocar sua senha antes de continuar.",
};

const GENERIC_MESSAGE =
  "Não foi possível concluir a operação agora. Tente novamente.";

async function throwMappedError(response: Response): Promise<never> {
  const code = await parseSanitizedErrorCode(response);
  throw new ApiFetchError(
    (code && USERS_ERROR_MESSAGES[code]) || GENERIC_MESSAGE,
    code,
  );
}

function listUsersParams(query: ListUsersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));
  if (query.status) params.set("status", query.status);
  if (query.role) params.set("role", query.role);
  return params;
}

export async function listUsers(
  query: ListUsersQuery = {},
  signal?: AbortSignal,
): Promise<Paginated<UserListItemDto>> {
  const response = await apiFetch(`/users?${listUsersParams(query)}`, {
    signal,
  });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as Paginated<UserListItemDto>;
}

export async function getPermissionsCatalog(
  signal?: AbortSignal,
): Promise<PermissionsCatalogDto> {
  const response = await apiFetch("/users/permissions-catalog", { signal });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as PermissionsCatalogDto;
}

export async function getUser(
  id: string,
  signal?: AbortSignal,
): Promise<UserDetailDto> {
  const response = await apiFetch(`/users/${id}`, { signal });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as UserDetailDto;
}

export async function createUser(
  payload: CreateUserPayload,
): Promise<CreateUserResult> {
  const response = await apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as CreateUserResult;
}

export async function updateUser(
  id: string,
  payload: UpdateUserPayload,
): Promise<UserDetailDto> {
  const response = await apiFetch(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as UserDetailDto;
}

export async function setUserStatus(
  id: string,
  active: boolean,
): Promise<UserDetailDto> {
  const response = await apiFetch(`/users/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as UserDetailDto;
}

export async function resetUserPassword(
  id: string,
): Promise<ResetPasswordResult> {
  const response = await apiFetch(`/users/${id}/reset-password`, {
    method: "POST",
  });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as ResetPasswordResult;
}

export async function getUserAudit(
  id: string,
  query: AuditQuery = {},
  signal?: AbortSignal,
): Promise<Paginated<AuditLogItemDto>> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.limit) params.set("limit", String(query.limit));
  const response = await apiFetch(`/users/${id}/audit?${params}`, { signal });
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as Paginated<AuditLogItemDto>;
}

/**
 * `POST /auth/change-password` — troca a própria senha (sempre exige a senha
 * atual). `retryOnUnauthorized: false`: um 401 aqui nunca dispara
 * `/auth/refresh` nem repete o POST — a troca de senha é uma mutação
 * sensível que jamais pode ser reenviada sozinha; o chamador (`/alterar-senha`)
 * trata `code: "SESSION_EXPIRED"` para limpar os campos e redirecionar ao
 * login com mensagem de sessão expirada, sem nenhuma tentativa automática.
 */
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ success: true }> {
  const response = await apiFetch("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
    retryOnUnauthorized: false,
  });
  if (response.status === 401) {
    throw new ApiFetchError(
      "Sua sessão expirou. Entre novamente.",
      "SESSION_EXPIRED",
    );
  }
  if (!response.ok) return throwMappedError(response);
  return (await response.json()) as { success: true };
}
