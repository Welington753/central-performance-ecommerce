import { ApiFetchError } from "./api";
import {
  changeOwnPassword,
  createUser,
  getPermissionsCatalog,
  getUser,
  getUserAudit,
  listUsers,
  resetUserPassword,
  setUserStatus,
  updateUser,
} from "./users-api";

jest.mock("./api", () => {
  const actual = jest.requireActual("./api");
  return { ...actual, apiFetch: jest.fn() };
});

const api = jest.requireMock("./api") as { apiFetch: jest.Mock };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("users-api — chamadas usam apiFetch com os caminhos exatos do backend", () => {
  it("listUsers monta query string e devolve a página", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(200, { items: [], total: 0, page: 1, limit: 20 }));

    await listUsers({ page: 2, limit: 10, status: "active", role: "ADMIN" });

    const [path] = api.apiFetch.mock.calls[0] as [string];
    expect(path).toBe("/users?page=2&limit=10&status=active&role=ADMIN");
  });

  it("getPermissionsCatalog chama /users/permissions-catalog", async () => {
    api.apiFetch.mockResolvedValue(
      jsonResponse(200, { permissions: [], presets: {} }),
    );
    await getPermissionsCatalog();
    expect(api.apiFetch).toHaveBeenCalledWith("/users/permissions-catalog", {
      signal: undefined,
    });
  });

  it("getUser chama /users/:id", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(200, { id: "u1" }));
    await getUser("u1");
    expect(api.apiFetch).toHaveBeenCalledWith("/users/u1", {
      signal: undefined,
    });
  });

  it("createUser envia POST /users com o payload exato", async () => {
    api.apiFetch.mockResolvedValue(
      jsonResponse(201, { user: {}, temporaryPassword: "x" }),
    );
    const payload = {
      name: "Ana",
      email: "ana@example.com",
      role: "VIEWER" as const,
      overrides: [],
      accountScope: { mode: "ALL" as const },
    };
    await createUser(payload);
    expect(api.apiFetch).toHaveBeenCalledWith("/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  });

  it("updateUser envia PATCH /users/:id", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(200, { id: "u1" }));
    await updateUser("u1", { name: "Novo nome" });
    expect(api.apiFetch).toHaveBeenCalledWith("/users/u1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Novo nome" }),
    });
  });

  it("setUserStatus envia PATCH /users/:id/status", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(200, { id: "u1" }));
    await setUserStatus("u1", false);
    expect(api.apiFetch).toHaveBeenCalledWith("/users/u1/status", {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
  });

  it("resetUserPassword envia POST /users/:id/reset-password", async () => {
    api.apiFetch.mockResolvedValue(
      jsonResponse(200, { temporaryPassword: "temp" }),
    );
    const result = await resetUserPassword("u1");
    expect(api.apiFetch).toHaveBeenCalledWith("/users/u1/reset-password", {
      method: "POST",
    });
    expect(result.temporaryPassword).toBe("temp");
  });

  it("getUserAudit chama /users/:id/audit com paginação", async () => {
    api.apiFetch.mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, page: 1, limit: 20 }),
    );
    await getUserAudit("u1", { page: 2, limit: 5 });
    expect(api.apiFetch).toHaveBeenCalledWith("/users/u1/audit?page=2&limit=5", {
      signal: undefined,
    });
  });

  it("changeOwnPassword envia POST /auth/change-password com retryOnUnauthorized: false", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(200, { success: true }));
    await changeOwnPassword("atual123456", "novaSenha123456");
    expect(api.apiFetch).toHaveBeenCalledWith("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: "atual123456",
        newPassword: "novaSenha123456",
      }),
      retryOnUnauthorized: false,
    });
  });

  it("13/14/15. changeOwnPassword com 401 vira ApiFetchError('SESSION_EXPIRED') — uma única chamada, sem repetir", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(401, {}));
    const error = await changeOwnPassword("atual123456", "novaSenha123456").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiFetchError);
    expect((error as ApiFetchError).code).toBe("SESSION_EXPIRED");
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe("users-api — mapeamento de erros estáveis", () => {
  it.each([
    ["USER_NOT_FOUND", "Usuário não encontrado."],
    ["USER_EMAIL_ALREADY_EXISTS", "Já existe um usuário com este e-mail."],
    ["ROLE_NOT_FOUND", "Papel inválido."],
    ["INVALID_PERMISSION", "Permissão inválida."],
    ["INVALID_ACCOUNT_SCOPE", "Escopo de contas inválido."],
    [
      "LAST_ACTIVE_ADMIN_REQUIRED",
      "Não é possível remover o último administrador ativo.",
    ],
    [
      "CANNOT_RESET_OWN_PASSWORD",
      "Não é possível redefinir sua própria senha por esta tela.",
    ],
    ["CURRENT_PASSWORD_INVALID", "Senha atual incorreta."],
    ["NEW_PASSWORD_MUST_DIFFER", "A nova senha deve ser diferente da atual."],
    [
      "PASSWORD_CHANGE_REQUIRED",
      "É necessário trocar sua senha antes de continuar.",
    ],
  ])("%s vira '%s'", async (code, message) => {
    api.apiFetch.mockResolvedValue(
      jsonResponse(400, { message: code }) as Response,
    );

    await expect(getUser("u1")).rejects.toMatchObject({ message, code });
  });

  it("código desconhecido usa a mensagem genérica", async () => {
    api.apiFetch.mockResolvedValue(jsonResponse(500, { message: "ALGO_NOVO" }));

    await expect(getUser("u1")).rejects.toMatchObject({
      message: "Não foi possível concluir a operação agora. Tente novamente.",
    });
  });

  it("erro sem corpo JSON válido usa a mensagem genérica", async () => {
    api.apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("não é JSON");
      },
    } as unknown as Response);

    await expect(getUser("u1")).rejects.toBeInstanceOf(ApiFetchError);
  });
});
