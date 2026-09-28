import { ROLE_LABELS } from "@/lib/users-permission-labels";
import type { UserListItemDto } from "@/types/users";

/**
 * `escopo de contas` fica FORA desta tabela de propósito: `GET /users`
 * (`UserListItem` em `backend/src/users/users-management.types.ts`) nunca
 * retorna `accountScope` — só `GET /users/:id` traz esse campo. Mostrar aqui
 * exigiria uma chamada extra por linha (N+1) que o backend não foi desenhado
 * para suportar; o escopo aparece ao abrir o formulário de edição de cada
 * usuário. Ver limitação registrada no relatório final.
 */
interface UsersTableProps {
  users: UserListItemDto[];
  page: number;
  totalPages: number;
  total: number;
  currentUserId: string;
  canManage: boolean;
  onPageChange: (page: number) => void;
  onEdit: (user: UserListItemDto) => void;
  onToggleStatus: (user: UserListItemDto) => void;
  onResetPassword: (user: UserListItemDto) => void;
  onViewAudit: (user: UserListItemDto) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function UsersTable({
  users,
  page,
  totalPages,
  total,
  currentUserId,
  canManage,
  onPageChange,
  onEdit,
  onToggleStatus,
  onResetPassword,
  onViewAudit,
}: UsersTableProps) {
  if (users.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-10 text-center text-sm text-foreground/60">
        Nenhum usuário encontrado para estes filtros.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-foreground/5 text-xs uppercase tracking-wide text-foreground/60">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Nome</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">E-mail</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Status</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Papel</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Criado em</th>
              {canManage ? (
                <th scope="col" className="whitespace-nowrap px-3 py-2">Ações</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {users.map((row) => {
              const isSelf = row.id === currentUserId;
              return (
                <tr key={row.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{row.email}</td>
                  <td className="px-3 py-2">
                    {row.active ? "Ativo" : "Inativo"}
                  </td>
                  <td className="px-3 py-2">{ROLE_LABELS[row.role]}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDate(row.createdAt)}
                  </td>
                  {canManage ? (
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          className="rounded-md border border-border-subtle px-2 py-1 text-xs hover:bg-foreground/5"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleStatus(row)}
                          className="rounded-md border border-border-subtle px-2 py-1 text-xs hover:bg-foreground/5"
                        >
                          {row.active ? "Desativar" : "Reativar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onResetPassword(row)}
                          disabled={isSelf}
                          title={
                            isSelf
                              ? "Não é possível redefinir sua própria senha por esta tela."
                              : undefined
                          }
                          className="rounded-md border border-border-subtle px-2 py-1 text-xs hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Redefinir senha
                        </button>
                        <button
                          type="button"
                          onClick={() => onViewAudit(row)}
                          className="rounded-md border border-border-subtle px-2 py-1 text-xs hover:bg-foreground/5"
                        >
                          Auditoria
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav
        aria-label="Paginação de usuários"
        className="flex items-center justify-between text-sm"
      >
        <span className="text-foreground/60">
          {total.toLocaleString("pt-BR")} usuários · página {page} de{" "}
          {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </nav>
    </div>
  );
}
