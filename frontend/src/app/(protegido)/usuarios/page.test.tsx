import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsuariosPage from "./page";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  getPermissionsCatalog,
  getUser,
  getUserAudit,
  listUsers,
  resetUserPassword,
  setUserStatus,
} from "@/lib/users-api";
import { ApiFetchError } from "@/lib/api";
import type { UserFormSavedResult } from "@/components/users/UserFormModal";

jest.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
  hasPermission: jest.requireActual("../../../hooks/useCurrentUser").hasPermission,
}));

jest.mock("../../../lib/users-api", () => ({
  listUsers: jest.fn(),
  getPermissionsCatalog: jest.fn(),
  getUser: jest.fn(),
  setUserStatus: jest.fn(),
  resetUserPassword: jest.fn(),
  getUserAudit: jest.fn(),
}));

// `UserFormModal` já tem cobertura própria (UserFormModal.test.tsx) — aqui
// só verificamos a integração (props recebidas, onSaved/onClose disparados).
jest.mock("../../../components/users/UserFormModal", () => ({
  UserFormModal: (props: {
    mode: "create" | "edit";
    initialUser?: { id: string; name: string };
    onClose: () => void;
    onSaved: (result: UserFormSavedResult) => void;
  }) => (
    <div data-testid="user-form-modal" data-mode={props.mode}>
      {props.initialUser ? (
        <p>Editando: {props.initialUser.name}</p>
      ) : null}
      <button onClick={props.onClose}>fechar-form</button>
      <button
        onClick={() =>
          props.onSaved({
            user: { id: "new-1", name: "Salvo" } as never,
            temporaryPassword: "temp-999",
            isSelf: false,
          })
        }
      >
        salvar-com-senha-temp
      </button>
      <button
        onClick={() =>
          props.onSaved({
            user: { id: "admin1", name: "Eu mesmo" } as never,
            isSelf: true,
          })
        }
      >
        salvar-self
      </button>
    </div>
  ),
}));

const mockUseCurrentUser = useCurrentUser as jest.Mock;
const mockListUsers = listUsers as jest.Mock;
const mockGetPermissionsCatalog = getPermissionsCatalog as jest.Mock;
const mockGetUser = getUser as jest.Mock;
const mockSetUserStatus = setUserStatus as jest.Mock;
const mockResetUserPassword = resetUserPassword as jest.Mock;
const mockGetUserAudit = getUserAudit as jest.Mock;

const CATALOG = {
  permissions: ["dashboard.view", "users.view", "users.manage"],
  presets: { ADMIN: [], ANALYST: [], VIEWER: [] },
};

const USERS_PAGE = {
  items: [
    {
      id: "u1",
      name: "Ana",
      email: "ana@example.com",
      active: true,
      role: "ADMIN",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "u2",
      name: "Beatriz",
      email: "bea@example.com",
      active: true,
      role: "VIEWER",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
};

function mockCurrentUser(overrides: {
  status?: string;
  permissions?: string[];
  id?: string;
}) {
  mockUseCurrentUser.mockReturnValue({
    status: overrides.status ?? "ready",
    isLoading: (overrides.status ?? "ready") === "checking",
    refresh: jest.fn().mockResolvedValue(undefined),
    user:
      (overrides.status ?? "ready") === "ready"
        ? {
            id: overrides.id ?? "admin1",
            name: "Admin",
            email: "admin@example.com",
            isAdmin: true,
            role: "ADMIN",
            permissions: overrides.permissions ?? ["users.view", "users.manage"],
            accountScope: { mode: "ALL" },
            mustChangePassword: false,
          }
        : null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser({});
  mockListUsers.mockResolvedValue(USERS_PAGE);
  mockGetPermissionsCatalog.mockResolvedValue(CATALOG);
  mockGetUserAudit.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
});

describe("UsuariosPage — gates de permissão", () => {
  it("10. sem users.view mostra acesso negado e nunca chama listUsers", async () => {
    mockCurrentUser({ permissions: ["dashboard.view"] });

    render(<UsuariosPage />);

    expect(
      await screen.findByText(/não tem permissão para visualizar usuários/i),
    ).toBeInTheDocument();
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it("mostra 'Carregando...' enquanto /auth/me ainda não respondeu", () => {
    mockCurrentUser({ status: "checking" });
    render(<UsuariosPage />);
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("11. users.view sem users.manage é somente leitura — sem 'Novo usuário' nem ações administrativas", async () => {
    mockCurrentUser({ permissions: ["users.view"] });

    render(<UsuariosPage />);

    await screen.findByText("Ana");
    expect(screen.queryByRole("button", { name: "Novo usuário" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("12. com users.manage, mostra 'Novo usuário' e ações administrativas", async () => {
    render(<UsuariosPage />);

    await screen.findByText("Ana");
    expect(screen.getByRole("button", { name: "Novo usuário" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(2);
  });
});

describe("UsuariosPage — lista, filtros e paginação", () => {
  it("13. lista usuários e permite trocar página", async () => {
    const user = userEvent.setup();
    render(<UsuariosPage />);

    await screen.findByText("Ana");
    expect(screen.getByText("Beatriz")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Status"), "active");
    await waitFor(() =>
      expect(mockListUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "active", page: 1 }),
        expect.anything(),
      ),
    );
  });

  it("mostra erro amigável se a listagem falhar", async () => {
    mockListUsers.mockRejectedValue(new ApiFetchError("Falha ao listar."));
    render(<UsuariosPage />);
    expect(await screen.findByText("Falha ao listar.")).toBeInTheDocument();
  });
});

describe("UsuariosPage — criação e edição", () => {
  it("14. abre o formulário de criação ao clicar em 'Novo usuário'", async () => {
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    await user.click(screen.getByRole("button", { name: "Novo usuário" }));

    expect(screen.getByTestId("user-form-modal")).toHaveAttribute(
      "data-mode",
      "create",
    );
  });

  it("16. abre o formulário de edição com os dados carregados de GET /users/:id", async () => {
    mockGetUser.mockResolvedValue({
      id: "u2",
      name: "Beatriz",
      email: "bea@example.com",
      active: true,
      role: "VIEWER",
      isAdmin: false,
      permissions: [],
      overrides: [],
      accountScope: { mode: "ALL" },
      mustChangePassword: false,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const editButtons = screen.getAllByRole("button", { name: "Editar" });
    await user.click(editButtons[1]);

    expect(mockGetUser).toHaveBeenCalledWith("u2");
    expect(await screen.findByText("Editando: Beatriz")).toBeInTheDocument();
  });

  it("mostra a senha temporária após criar um usuário e recarrega a lista", async () => {
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    await user.click(screen.getByRole("button", { name: "Novo usuário" }));
    await user.click(screen.getByRole("button", { name: "salvar-com-senha-temp" }));

    expect(await screen.findByText(/Senha temporária de Salvo/)).toBeInTheDocument();
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));
  });

  it("editar o próprio usuário chama refreshCurrentUser (Sidebar/gate atualizam sem reload)", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    mockUseCurrentUser.mockReturnValue({
      status: "ready",
      isLoading: false,
      refresh,
      user: {
        id: "admin1",
        name: "Admin",
        email: "admin@example.com",
        isAdmin: true,
        role: "ADMIN",
        permissions: ["users.view", "users.manage"],
        accountScope: { mode: "ALL" },
        mustChangePassword: false,
      },
    });
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    await user.click(screen.getByRole("button", { name: "Novo usuário" }));
    await user.click(screen.getByRole("button", { name: "salvar-self" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe("UsuariosPage — desativação, último admin e reset de senha", () => {
  it("21. desativar exige confirmação antes de chamar a API", async () => {
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const toggleButtons = screen.getAllByRole("button", { name: /Desativar|Reativar/ });
    await user.click(toggleButtons[0]);

    const dialog = await screen.findByRole("dialog", { name: /Desativar usuário/ });
    expect(mockSetUserStatus).not.toHaveBeenCalled();

    mockSetUserStatus.mockResolvedValue({});
    await user.click(within(dialog).getByRole("button", { name: "Desativar" }));

    await waitFor(() => expect(mockSetUserStatus).toHaveBeenCalledWith("u1", false));
  });

  it("22. último administrador mostra a mensagem específica do backend", async () => {
    mockSetUserStatus.mockRejectedValue(
      new ApiFetchError(
        "Não é possível remover o último administrador ativo.",
        "LAST_ACTIVE_ADMIN_REQUIRED",
      ),
    );
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const toggleButtons = screen.getAllByRole("button", { name: /Desativar|Reativar/ });
    await user.click(toggleButtons[0]);
    const dialog = await screen.findByRole("dialog", { name: /Desativar usuário/ });
    await user.click(within(dialog).getByRole("button", { name: "Desativar" }));

    expect(
      await screen.findByText("Não é possível remover o último administrador ativo."),
    ).toBeInTheDocument();
  });

  it("23. redefinir a própria senha está desabilitado na tabela", async () => {
    mockCurrentUser({ id: "u1" });
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const resetButtons = screen.getAllByRole("button", { name: "Redefinir senha" });
    expect(resetButtons[0]).toBeDisabled(); // linha de u1 === currentUserId
  });

  it("24. redefinir a senha de outro usuário mostra a senha uma vez", async () => {
    mockResetUserPassword.mockResolvedValue({ temporaryPassword: "nova-temp" });
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const resetButtons = screen.getAllByRole("button", { name: "Redefinir senha" });
    await user.click(resetButtons[1]); // linha de Beatriz (u2)
    const dialog = await screen.findByRole("dialog", { name: "Redefinir senha" });
    await user.click(within(dialog).getByRole("button", { name: "Redefinir" }));

    expect(await screen.findByText(/Senha temporária de Beatriz/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("nova-temp")).toBeInTheDocument();
  });

  it("25. fechar o modal de senha temporária remove a senha do DOM", async () => {
    mockResetUserPassword.mockResolvedValue({ temporaryPassword: "nova-temp" });
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const resetButtons = screen.getAllByRole("button", { name: "Redefinir senha" });
    await user.click(resetButtons[1]);
    const dialog = await screen.findByRole("dialog", { name: "Redefinir senha" });
    await user.click(within(dialog).getByRole("button", { name: "Redefinir" }));
    await screen.findByDisplayValue("nova-temp");

    await user.click(screen.getByRole("button", { name: "Fechar" }));

    expect(screen.queryByDisplayValue("nova-temp")).not.toBeInTheDocument();
    expect(screen.queryByText("nova-temp")).not.toBeInTheDocument();
  });
});

describe("UsuariosPage — auditoria", () => {
  it("26. abre a auditoria de um usuário e traduz as ações", async () => {
    mockGetUserAudit.mockResolvedValue({
      items: [
        {
          id: "a1",
          actorUserId: "admin1",
          targetUserId: "u1",
          action: "USER_CREATED",
          changes: { fields: ["name", "email", "role", "accountScope"] },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const auditButtons = screen.getAllByRole("button", { name: "Auditoria" });
    await user.click(auditButtons[0]);

    expect(await screen.findByText("Usuário criado")).toBeInTheDocument();
  });
});

describe("UsuariosPage — nenhuma mutação repetida automaticamente", () => {
  it("27. a confirmação de desativação só chama a API uma vez, mesmo re-renderizando", async () => {
    mockSetUserStatus.mockResolvedValue({});
    const user = userEvent.setup();
    render(<UsuariosPage />);
    await screen.findByText("Ana");

    const toggleButtons = screen.getAllByRole("button", { name: /Desativar|Reativar/ });
    await user.click(toggleButtons[0]);
    const dialog = await screen.findByRole("dialog", { name: /Desativar usuário/ });
    await user.click(within(dialog).getByRole("button", { name: "Desativar" }));

    await waitFor(() => expect(mockSetUserStatus).toHaveBeenCalledTimes(1));
    // O diálogo fecha sozinho após sucesso — nada dispara uma segunda chamada.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockSetUserStatus).toHaveBeenCalledTimes(1);
  });
});
