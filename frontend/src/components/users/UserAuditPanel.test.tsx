import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserAuditPanel } from "./UserAuditPanel";
import { getUserAudit } from "@/lib/users-api";
import { ApiFetchError } from "@/lib/api";

// `jest.mock` resolve o argumento fora do pipeline de transform do Next
// (que entende o alias `@/*`) — precisa de caminho relativo real.
jest.mock("../../lib/users-api", () => ({
  getUserAudit: jest.fn(),
}));

const mockGetUserAudit = getUserAudit as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("UserAuditPanel", () => {
  it("traduz ação e mostra data/campos alterados, sem segredos", async () => {
    mockGetUserAudit.mockResolvedValue({
      items: [
        {
          id: "a1",
          actorUserId: "admin1",
          targetUserId: "u1",
          action: "ROLE_CHANGED",
          changes: { fields: ["role"] },
          createdAt: "2026-01-10T12:00:00.000Z",
        },
        {
          id: "a2",
          actorUserId: "admin1",
          targetUserId: "u1",
          action: "PASSWORD_RESET",
          changes: { fields: ["passwordHash", "mustChangePassword"] },
          createdAt: "2026-01-11T12:00:00.000Z",
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
    });

    render(
      <UserAuditPanel userId="u1" userName="Ana" onClose={jest.fn()} />,
    );

    expect(await screen.findByText("Papel alterado")).toBeInTheDocument();
    expect(screen.getByText("Campos alterados: Papel")).toBeInTheDocument();
    expect(
      screen.getByText("Senha redefinida por administrador"),
    ).toBeInTheDocument();
    // Nunca expõe passwordHash/mustChangePassword nem qualquer texto cru.
    expect(screen.queryByText(/passwordHash/)).not.toBeInTheDocument();
    expect(screen.queryByText(/mustChangePassword/)).not.toBeInTheDocument();
  });

  it("mostra estado de carregamento e depois a lista", async () => {
    mockGetUserAudit.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    render(<UserAuditPanel userId="u1" userName="Ana" onClose={jest.fn()} />);

    expect(screen.getByText("Carregando auditoria...")).toBeInTheDocument();
    expect(
      await screen.findByText("Nenhum evento de auditoria registrado ainda."),
    ).toBeInTheDocument();
  });

  it("mostra erro amigável se a busca falhar", async () => {
    mockGetUserAudit.mockRejectedValue(new ApiFetchError("Falha ao carregar."));
    render(<UserAuditPanel userId="u1" userName="Ana" onClose={jest.fn()} />);

    expect(await screen.findByText("Falha ao carregar.")).toBeInTheDocument();
  });

  it("chama onClose ao clicar em Fechar", async () => {
    mockGetUserAudit.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<UserAuditPanel userId="u1" userName="Ana" onClose={onClose} />);

    await screen.findByText("Nenhum evento de auditoria registrado ainda.");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aborta a leitura pendente ao desmontar", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGetUserAudit.mockImplementation(
      (_id: string, _query: unknown, signal: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {});
      },
    );

    const { unmount } = render(
      <UserAuditPanel userId="u1" userName="Ana" onClose={jest.fn()} />,
    );

    expect(capturedSignal?.aborted).toBe(false);
    act(() => {
      unmount();
    });
    expect(capturedSignal?.aborted).toBe(true);
  });
});
