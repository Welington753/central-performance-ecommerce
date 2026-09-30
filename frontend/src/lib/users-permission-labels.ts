import type { PermissionKey, RoleKey } from "@/types/users";

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: "Administrador",
  ANALYST: "Analista",
  VIEWER: "Visualizador",
};

export const ACCOUNT_SCOPE_MODE_LABELS: Record<
  "ALL" | "SELECTED" | "NONE",
  string
> = {
  ALL: "Todas as contas",
  SELECTED: "Contas selecionadas",
  NONE: "Nenhuma conta",
};

interface PermissionMeta {
  label: string;
  description: string;
}

/** Rótulo + descrição em PT-BR de cada permission key canônica — nunca só a chave técnica na UI. */
export const PERMISSION_LABELS: Record<PermissionKey, PermissionMeta> = {
  "dashboard.view": {
    label: "Ver Dashboard",
    description: "Acessar a visão geral de KPIs.",
  },
  "full.view": {
    label: "Ver Full",
    description: "Acessar o desempenho da modalidade Full.",
  },
  "customers.view": {
    label: "Ver Clientes",
    description: "Consultar a lista de clientes identificados.",
  },
  "customers.export": {
    label: "Exportar Clientes",
    description: "Baixar a planilha de clientes.",
  },
  "customers.export_personal_data": {
    label: "Exportar dados pessoais de Clientes",
    description: "Incluir dados pessoais completos na exportação de clientes.",
  },
  "customers.manage_enrichment": {
    label: "Gerenciar enriquecimento de Clientes",
    description: "Iniciar/pausar/retomar o enriquecimento histórico de compradores.",
  },
  "goals.view": {
    label: "Ver Metas",
    description: "Consultar metas mensais e ritmo de realização.",
  },
  "goals.manage": {
    label: "Gerenciar Metas",
    description: "Cadastrar e alterar metas mensais.",
  },
  "integrations.view": {
    label: "Ver Integrações",
    description: "Consultar contas e status de conexão dos marketplaces.",
  },
  "integrations.manage": {
    label: "Gerenciar Integrações",
    description: "Conectar, reconectar ou renomear contas de marketplace.",
  },
  "sync.view": {
    label: "Ver Sincronizações",
    description: "Consultar o histórico de sincronizações.",
  },
  "sync.run": {
    label: "Executar sincronização",
    description: "Disparar a sincronização manual de pedidos.",
  },
  "sync.backfill": {
    label: "Completar histórico",
    description: "Iniciar/pausar/retomar a busca de histórico antigo de vendas.",
  },
  "sync.full_history": {
    label: "Corrigir histórico Full",
    description: "Reclassificar retroativamente pedidos Full do Mercado Livre.",
  },
  "users.view": {
    label: "Ver Usuários",
    description: "Consultar a lista de usuários do sistema.",
  },
  "problems.view": {
    label: "Ver Problemas",
    description: "Consultar reclamações e problemas dos marketplaces.",
  },
  "problems.manage": {
    label: "Gerenciar Problemas",
    description: "Corrigir manualmente a responsabilidade de um problema.",
  },
  "problems.sync": {
    label: "Sincronizar Problemas",
    description: "Iniciar, pausar e retomar a sincronização de problemas por conta.",
  },
  "users.manage": {
    label: "Gerenciar Usuários",
    description:
      "Criar, editar, ativar/desativar, redefinir senha e consultar auditoria de usuários.",
  },
};

export interface PermissionGroup {
  id: string;
  title: string;
  keys: PermissionKey[];
}

/** Agrupamento visual das 16 permissões nas 7 seções pedidas pelo checkpoint. */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  { id: "visao-geral", title: "Visão geral", keys: ["dashboard.view"] },
  { id: "full", title: "Full", keys: ["full.view"] },
  {
    id: "clientes",
    title: "Clientes",
    keys: [
      "customers.view",
      "customers.export",
      "customers.export_personal_data",
      "customers.manage_enrichment",
    ],
  },
  { id: "metas", title: "Metas", keys: ["goals.view", "goals.manage"] },
  {
    id: "integracoes",
    title: "Integrações",
    keys: ["integrations.view", "integrations.manage"],
  },
  {
    id: "sincronizacoes",
    title: "Sincronizações",
    keys: ["sync.view", "sync.run", "sync.backfill", "sync.full_history"],
  },
  {
    id: "problemas",
    title: "Problemas",
    keys: ["problems.view", "problems.manage", "problems.sync"],
  },
  {
    id: "administracao",
    title: "Administração",
    keys: ["users.view", "users.manage"],
  },
];

/** Rótulo em PT-BR de `UserAuditAction` (`backend/src/users/user-audit-action.enum.ts`). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  USER_CREATED: "Usuário criado",
  USER_UPDATED: "Dados atualizados",
  USER_ACTIVATED: "Usuário ativado",
  USER_DEACTIVATED: "Usuário desativado",
  PASSWORD_RESET: "Senha redefinida por administrador",
  PASSWORD_CHANGED: "Senha alterada pelo usuário",
  ROLE_CHANGED: "Papel alterado",
  PERMISSIONS_CHANGED: "Permissões alteradas",
  ACCOUNT_SCOPE_CHANGED: "Escopo de contas alterado",
};

/**
 * Rótulo em PT-BR dos nomes de campo que aparecem em `changes.fields`.
 * Ações de senha (`PASSWORD_RESET`/`PASSWORD_CHANGED`) nunca devem exibir
 * `changes.fields` (só contêm `passwordHash`/`mustChangePassword`, internos)
 * — filtradas antes de chegar aqui pelo componente de auditoria.
 */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  role: "Papel",
  overrides: "Permissões",
  accountScope: "Escopo de contas",
  active: "Status",
};

/** Ações cujos `changes.fields` nunca devem ser exibidos (só carregam dados internos). */
export const AUDIT_ACTIONS_WITHOUT_VISIBLE_FIELDS = new Set([
  "PASSWORD_RESET",
  "PASSWORD_CHANGED",
]);
