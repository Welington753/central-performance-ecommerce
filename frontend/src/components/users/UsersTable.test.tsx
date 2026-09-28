import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersTable } from "./UsersTable";
import type { UserListItemDto } from "@/types/users";

const USERS: UserListItemDto[] = [
  {
    id: "u1",
    name: "Ana Admin",
    email: "ana@example.com",
    active: true,
    role: "ADMIN",
    createdAt: "2026-01-05T00:00:00.000Z",
  },
  {
    id: "u2",
    name: "Beatriz Viewer",
    email: "bea@example.com",
    active: false,
    role: "VIEWER",
    createdAt: "2026-02-10T00:00:00.000Z",
  },
];

function baseProps() {
  return {
    users: USERS,
    page: 1,
    totalPages: 3,
    total: 42,
    currentUserId: "u1",
    canManage: true,
    onPageChange: jest.fn(),
    onEdit: jest.fn(),
    onToggleStatus: jest.fn(),
    onResetPassword: jest.fn(),
    onViewAudit: jest.fn(),
  };
}

describe("UsersTable", () => {
  it("mostra nome, e-mail, status e papel de cada usuário", () => {
    render(<UsersTable {...baseProps()} />);

    expect(screen.getByText("Ana Admin")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
    expect(screen.getByText("Beatriz Viewer")).toBeInTheDocument();
    expect(screen.getByText("Inativo")).toBeInTheDocument();
    expect(screen.getByText("Visualizador")).toBeInTheDocument();
  });

  it("mostra estado vazio quando não há usuários", () => {
    render(<UsersTable {...baseProps()} users={[]} />);
    expect(
      screen.getByText("Nenhum usuário encontrado para estes filtros."),
    ).toBeInTheDocument();
  });

  it("paginação chama onPageChange e respeita os limites", async () => {
    const onPageChange = jest.fn();
    const user = userEvent.setup();
    render(<UsersTable {...baseProps()} onPageChange={onPageChange} />);

    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("com users.manage, mostra ações e desabilita 'Redefinir senha' na própria linha", () => {
    render(<UsersTable {...baseProps()} />);

    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
    const resetButtons = screen.getAllByRole("button", {
      name: "Redefinir senha",
    });
    expect(resetButtons[0]).toBeDisabled(); // linha do próprio usuário (u1)
    expect(resetButtons[1]).not.toBeDisabled();
  });

  it("sem users.manage (somente leitura), nenhuma ação administrativa aparece", () => {
    render(<UsersTable {...baseProps()} canManage={false} />);

    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Redefinir senha" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auditoria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Ações" })).not.toBeInTheDocument();
  });

  it("aciona callbacks de editar/desativar/auditoria", async () => {
    const props = baseProps();
    const user = userEvent.setup();
    render(<UsersTable {...props} />);

    const editButtons = screen.getAllByRole("button", { name: "Editar" });
    await user.click(editButtons[1]);
    expect(props.onEdit).toHaveBeenCalledWith(USERS[1]);

    const toggleButtons = screen.getAllByRole("button", { name: /Desativar|Reativar/ });
    await user.click(toggleButtons[1]);
    expect(props.onToggleStatus).toHaveBeenCalledWith(USERS[1]);

    const auditButtons = screen.getAllByRole("button", { name: "Auditoria" });
    await user.click(auditButtons[0]);
    expect(props.onViewAudit).toHaveBeenCalledWith(USERS[0]);
  });
});
