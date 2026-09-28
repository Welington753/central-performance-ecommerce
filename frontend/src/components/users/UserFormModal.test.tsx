import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserFormModal } from "./UserFormModal";
import { createUser, updateUser } from "@/lib/users-api";
import { fetchMarketplaceAccounts } from "@/lib/api";
import { ApiFetchError } from "@/lib/api";
import type {
  PermissionsCatalogDto,
  UserDetailDto,
} from "@/types/users";
import type { MarketplaceAccountDto } from "@/types/marketplace";

jest.mock("../../lib/users-api", () => ({
  createUser: jest.fn(),
  updateUser: jest.fn(),
}));

jest.mock("../../lib/api", () => {
  const actual = jest.requireActual("../../lib/api");
  return { ...actual, fetchMarketplaceAccounts: jest.fn() };
});

const mockCreateUser = createUser as jest.Mock;
const mockUpdateUser = updateUser as jest.Mock;
const mockFetchAccounts = fetchMarketplaceAccounts as jest.Mock;

const ANALYST_PRESET = [
  "dashboard.view",
  "full.view",
  "customers.view",
  "customers.export",
  "goals.view",
  "integrations.view",
  "sync.view",
] as const;

const VIEWER_PRESET = [
  "dashboard.view",
  "full.view",
  "goals.view",
  "integrations.view",
  "sync.view",
] as const;

const ALL_PERMISSIONS = [
  "dashboard.view",
  "full.view",
  "customers.view",
  "customers.export",
  "customers.export_personal_data",
  "customers.manage_enrichment",
  "goals.view",
  "goals.manage",
  "integrations.view",
  "integrations.manage",
  "sync.view",
  "sync.run",
  "sync.backfill",
  "sync.full_history",
  "users.view",
  "users.manage",
] as const;

const CATALOG: PermissionsCatalogDto = {
  permissions: [...ALL_PERMISSIONS],
  presets: {
    ADMIN: [...ALL_PERMISSIONS],
    ANALYST: [...ANALYST_PRESET],
    VIEWER: [...VIEWER_PRESET],
  },
};

function account(id: string, nickname: string | null): MarketplaceAccountDto {
  return {
    id,
    marketplace: "MERCADO_LIVRE",
    externalSellerId: null,
    nickname,
    status: "CONNECTED",
    recoveryHint: null,
    nextRetryAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const ACCOUNTS = [account("acc-1", "Loja 1"), account("acc-2", "Loja 2")];

function detailUser(overrides: Partial<UserDetailDto> = {}): UserDetailDto {
  return {
    id: "u1",
    name: "Beatriz",
    email: "beatriz@example.com",
    active: true,
    role: "ANALYST",
    isAdmin: false,
    permissions: [...ANALYST_PRESET],
    overrides: [],
    accountScope: { mode: "ALL" },
    mustChangePassword: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchAccounts.mockResolvedValue(ACCOUNTS);
});

describe("UserFormModal — criação", () => {
  it("cria usuário com papel VIEWER padrão e escopo ALL, mostrando a senha temporária no retorno", async () => {
    mockCreateUser.mockResolvedValue({
      user: detailUser({ role: "VIEWER" }),
      temporaryPassword: "temp-123",
    });
    const onSaved = jest.fn();
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
    expect(mockCreateUser).toHaveBeenCalledWith({
      name: "Nova Pessoa",
      email: "nova@example.com",
      role: "VIEWER",
      overrides: [],
      accountScope: { mode: "ALL" },
    });
    expect(onSaved).toHaveBeenCalledWith({
      user: expect.objectContaining({ role: "VIEWER" }),
      temporaryPassword: "temp-123",
      isSelf: false,
    });
  });

  it("e-mail duplicado mostra a mensagem específica do backend", async () => {
    mockCreateUser.mockRejectedValue(
      new ApiFetchError(
        "Já existe um usuário com este e-mail.",
        "USER_EMAIL_ALREADY_EXISTS",
      ),
    );
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "ja@example.com");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText("Já existe um usuário com este e-mail."),
    ).toBeInTheDocument();
  });
});

describe("UserFormModal — edição", () => {
  it("envia PATCH com o novo nome, mantendo papel/escopo atuais", async () => {
    mockUpdateUser.mockResolvedValue(detailUser({ name: "Beatriz Atualizada" }));
    const onSaved = jest.fn();
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="edit"
        initialUser={detailUser()}
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={onSaved}
      />,
    );

    const nameInput = screen.getByLabelText("Nome");
    await user.clear(nameInput);
    await user.type(nameInput, "Beatriz Atualizada");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
    expect(mockUpdateUser).toHaveBeenCalledWith("u1", {
      name: "Beatriz Atualizada",
      role: "ANALYST",
      overrides: [],
      accountScope: { mode: "ALL" },
    });
    expect(onSaved).toHaveBeenCalledWith({
      user: expect.objectContaining({ name: "Beatriz Atualizada" }),
      isSelf: false,
    });
  });

  it("não permite editar o e-mail — mostra somente como texto", () => {
    render(
      <UserFormModal
        mode="edit"
        initialUser={detailUser()}
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText("E-mail")).not.toBeInTheDocument();
    expect(screen.getByText("E-mail: beatriz@example.com")).toBeInTheDocument();
  });
});

describe("UserFormModal — ADMIN fixa permissões e escopo ALL", () => {
  it("ao escolher ADMIN, todas as permissões ficam marcadas e desabilitadas, e o escopo trava em ALL", async () => {
    const user = userEvent.setup();
    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Papel"), "ADMIN");

    const usersManageCheckbox = screen.getByRole("checkbox", {
      name: /Gerenciar Usuários/,
    });
    expect(usersManageCheckbox).toBeChecked();
    expect(usersManageCheckbox).toBeDisabled();

    const allRadio = screen.getByRole("radio", { name: "Todas as contas" });
    expect(allRadio).toBeChecked();
    expect(allRadio).toBeDisabled();
  });

  it("ADMIN sempre envia overrides:[] e accountScope ALL, mesmo criando", async () => {
    mockCreateUser.mockResolvedValue({
      user: detailUser({ role: "ADMIN" }),
      temporaryPassword: "temp-999",
    });
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Novo Admin");
    await user.type(screen.getByLabelText("E-mail"), "admin2@example.com");
    await user.selectOptions(screen.getByLabelText("Papel"), "ADMIN");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: "ADMIN", overrides: [], accountScope: { mode: "ALL" } }),
    );
  });
});

describe("UserFormModal — ANALYST/VIEWER enviam só overrides", () => {
  it("revogar uma permissão do preset e conceder uma fora do preset envia só o diff", async () => {
    mockUpdateUser.mockResolvedValue(detailUser());
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="edit"
        initialUser={detailUser({ role: "ANALYST", permissions: [...ANALYST_PRESET] })}
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    // Revoga "Exportar Clientes" (está no preset do ANALYST).
    await user.click(screen.getByRole("checkbox", { name: /Exportar Clientes/ }));
    // Concede "Gerenciar Metas" (fora do preset do ANALYST).
    await user.click(screen.getByRole("checkbox", { name: /Gerenciar Metas/ }));

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateUser.mock.calls[0];
    expect(payload.overrides).toEqual(
      expect.arrayContaining([
        { permissionKey: "customers.export", granted: false },
        { permissionKey: "goals.manage", granted: true },
      ]),
    );
    expect(payload.overrides).toHaveLength(2);
  });

  it("users.manage nunca pode ser marcada para ANALYST/VIEWER", () => {
    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /Gerenciar Usuários/ });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });
});

describe("UserFormModal — escopo de contas", () => {
  it("SELECTED exige ao menos uma conta antes de salvar", async () => {
    const user = userEvent.setup();
    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("radio", { name: "Contas selecionadas" }));
    await screen.findByText("Loja 1");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Selecione ao menos uma conta.")).toBeInTheDocument();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("envia exatamente os IDs reais selecionados, deduplicados", async () => {
    mockCreateUser.mockResolvedValue({
      user: detailUser(),
      temporaryPassword: "x",
    });
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("radio", { name: "Contas selecionadas" }));
    await user.click(await screen.findByRole("checkbox", { name: "Loja 1" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        accountScope: { mode: "SELECTED", accountIds: ["acc-1"] },
      }),
    );
  });

  it("trocar de SELECTED para ALL ou NONE nunca envia accountIds", async () => {
    mockCreateUser.mockResolvedValue({ user: detailUser(), temporaryPassword: "x" });
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("radio", { name: "Contas selecionadas" }));
    await user.click(await screen.findByRole("checkbox", { name: "Loja 1" }));
    await user.click(screen.getByRole("radio", { name: "Nenhuma conta" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ accountScope: { mode: "NONE" } }),
    );
  });

  it("bloqueia salvar SELECTED enquanto as contas ainda carregam", async () => {
    mockFetchAccounts.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("radio", { name: "Contas selecionadas" }));
    expect(screen.getByText("Carregando contas...")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText("Aguarde o carregamento das contas."),
    ).toBeInTheDocument();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("bloqueia salvar SELECTED se a leitura de contas falhar", async () => {
    mockFetchAccounts.mockRejectedValue(new Error("falhou"));
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("radio", { name: "Contas selecionadas" }));
    await screen.findByText(
      "Não foi possível carregar as contas de marketplace. Tente novamente.",
    );

    await user.click(screen.getByRole("button", { name: "Salvar" }));

    // Bloqueia o envio sem duplicar a mensagem (já visível inline, acima).
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(
        "Não foi possível carregar as contas de marketplace. Tente novamente.",
      ),
    ).toHaveLength(1);
  });
});

describe("UserFormModal — confirmação de mudanças sensíveis", () => {
  it("promover para ADMIN exige confirmação antes de salvar", async () => {
    mockUpdateUser.mockResolvedValue(detailUser({ role: "ADMIN" }));
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="edit"
        initialUser={detailUser({ role: "ANALYST" })}
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Papel"), "ADMIN");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(mockUpdateUser).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: /Promover a Administrador/ });
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
  });

  it("remover papel de ADMIN exige confirmação antes de salvar", async () => {
    mockUpdateUser.mockResolvedValue(detailUser({ role: "VIEWER" }));
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="edit"
        initialUser={detailUser({ role: "ADMIN", permissions: [...ALL_PERMISSIONS] })}
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Papel"), "VIEWER");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Remover papel de Administrador/),
    ).toBeInTheDocument();
  });

  it("editar as próprias permissões exige confirmação", async () => {
    mockUpdateUser.mockResolvedValue(detailUser());
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="edit"
        initialUser={detailUser({ id: "admin1", role: "ANALYST" })}
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /Gerenciar Metas/ }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(
      await screen.findByText(/alterando suas próprias permissões/),
    ).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe("UserFormModal — nunca envia submissão em duplicidade", () => {
  it("desabilita o botão Salvar durante a requisição", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    mockCreateUser.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();

    render(
      <UserFormModal
        mode="create"
        currentUserId="admin1"
        catalog={CATALOG}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Nova Pessoa");
    await user.type(screen.getByLabelText("E-mail"), "nova@example.com");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("button", { name: "Salvando..." })).toBeDisabled();

    resolveCreate({ user: detailUser(), temporaryPassword: "x" });
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
  });
});
