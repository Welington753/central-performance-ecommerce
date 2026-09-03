jest.mock("../src/lib/api");

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AmazonConnectionModal } from "@/components/AmazonConnectionModal";
import * as api from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";

function amazonAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "acc-1",
    marketplace: "AMAZON",
    externalSellerId: null,
    nickname: null,
    status: "DISCONNECTED",
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

async function fillAndSubmit(options: {
  sellingPartnerId?: string;
  refreshToken?: string;
}) {
  const user = userEvent.setup();
  if (options.sellingPartnerId) {
    await user.type(
      screen.getByLabelText(/selling partner id/i),
      options.sellingPartnerId,
    );
  }
  if (options.refreshToken) {
    await user.type(
      screen.getByLabelText(/refresh token/i),
      options.refreshToken,
    );
  }
  await user.click(
    screen.getByRole("button", { name: /salvar e testar conexão/i }),
  );
  return user;
}

describe("AmazonConnectionModal", () => {
  it('mode "create" shows a nickname field; mode "credentials" does not', () => {
    const { unmount } = render(
      <AmazonConnectionModal
        mode={{ kind: "create" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );
    expect(screen.getByLabelText(/apelido da conta/i)).toBeInTheDocument();
    unmount();

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );
    expect(
      screen.queryByLabelText(/apelido da conta/i),
    ).not.toBeInTheDocument();
  });

  it("warns that only the Primary User of the Amazon account can self-authorize the private application", () => {
    render(
      <AmazonConnectionModal
        mode={{ kind: "create" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );
    expect(screen.getByText(/usuário principal/i)).toBeInTheDocument();
    expect(screen.getByText(/primary user/i)).toBeInTheDocument();
  });

  it("the refresh token field is type=password (masked) and has autoComplete off", () => {
    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );
    const field = screen.getByLabelText(/refresh token/i);
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
  });

  it('a full successful flow (create -> provision -> verify connected) calls onRefresh and onClose', async () => {
    (api.createMarketplaceAccount as jest.Mock).mockResolvedValue(
      amazonAccount({ id: "acc-new" }),
    );
    (api.provisionAmazonAccount as jest.Mock).mockResolvedValue(
      amazonAccount({ id: "acc-new", status: "CONNECTED" }),
    );
    (api.verifyAmazonConnection as jest.Mock).mockResolvedValue({
      connected: true,
      code: "VERIFIED",
      verifiedAt: "2026-09-03T12:00:00.000Z",
      marketplaceCount: 1,
    });
    const onClose = jest.fn();
    const onRefresh = jest.fn();

    render(
      <AmazonConnectionModal
        mode={{ kind: "create" }}
        onClose={onClose}
        onRefresh={onRefresh}
      />,
    );

    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: "Atzr|refresh-token-value",
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.createMarketplaceAccount).toHaveBeenCalledWith(
      "AMAZON",
      undefined,
    );
    expect(api.provisionAmazonAccount).toHaveBeenCalledWith("acc-new", {
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: "Atzr|refresh-token-value",
    });
    expect(api.verifyAmazonConnection).toHaveBeenCalledWith("acc-new");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("passes the nickname through when creating a new account", async () => {
    (api.createMarketplaceAccount as jest.Mock).mockResolvedValue(
      amazonAccount({ id: "acc-new" }),
    );
    (api.provisionAmazonAccount as jest.Mock).mockResolvedValue(
      amazonAccount({ id: "acc-new" }),
    );
    (api.verifyAmazonConnection as jest.Mock).mockResolvedValue({
      connected: true,
      code: "VERIFIED",
      verifiedAt: "2026-09-03T12:00:00.000Z",
      marketplaceCount: 1,
    });

    render(
      <AmazonConnectionModal
        mode={{ kind: "create" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/apelido da conta/i),
      "Amazon principal",
    );
    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: "Atzr|x",
    });

    await waitFor(() =>
      expect(api.createMarketplaceAccount).toHaveBeenCalledWith(
        "AMAZON",
        "Amazon principal",
      ),
    );
  });

  it("a rejected refresh token shows the sanitized VERIFY_ERROR_MESSAGES text — never a raw code or backend message", async () => {
    (api.provisionAmazonAccount as jest.Mock).mockResolvedValue(
      amazonAccount({ id: "acc-1", status: "CONNECTED" }),
    );
    (api.verifyAmazonConnection as jest.Mock).mockResolvedValue({
      connected: false,
      code: "AMAZON_REFRESH_TOKEN_REJECTED",
      verifiedAt: "2026-09-03T12:00:00.000Z",
      marketplaceCount: 0,
    });

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: "Atzr|bad-token",
    });

    expect(
      await screen.findByText(/rejeitou o refresh token informado/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("AMAZON_REFRESH_TOKEN_REJECTED")).not.toBeInTheDocument();
  });

  it("a provision failure shows the generic sanitized error — never a raw exception message", async () => {
    (api.provisionAmazonAccount as jest.Mock).mockRejectedValue(
      new Error("Não foi possível salvar as credenciais da conta Amazon."),
    );

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: "Atzr|x",
    });

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "Não foi possível salvar as credenciais. Verifique os dados e tente novamente.",
    );
  });

  it("clears the refresh token field after ANY submit attempt — success or failure — and it never reappears in the DOM", async () => {
    const secretToken = "Atzr|SUPER-SECRET-REFRESH-TOKEN-VALUE";
    (api.provisionAmazonAccount as jest.Mock).mockRejectedValue(
      new Error("network down"),
    );

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: secretToken,
    });

    await screen.findByRole("alert");
    const field = screen.getByLabelText(/refresh token/i) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(document.body.innerHTML).not.toContain(secretToken);
  });

  it("never sends the refresh token in a URL — provisionAmazonAccount receives it only in the request body argument", async () => {
    const secretToken = "Atzr|SECRET-IN-BODY-ONLY";
    (api.provisionAmazonAccount as jest.Mock).mockResolvedValue(
      amazonAccount(),
    );
    (api.verifyAmazonConnection as jest.Mock).mockResolvedValue({
      connected: true,
      code: "VERIFIED",
      verifiedAt: "2026-09-03T12:00:00.000Z",
      marketplaceCount: 1,
    });

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: secretToken,
    });

    await waitFor(() =>
      expect(api.provisionAmazonAccount).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({ refreshToken: secretToken }),
      ),
    );
    // O primeiro argumento é só o accountId (uuid) — nunca uma URL com o
    // token embutido como query string.
    const [firstArg] = (api.provisionAmazonAccount as jest.Mock).mock
      .calls[0] as [string, unknown];
    expect(firstArg).not.toContain(secretToken);
  });

  it("never calls console.log/console.error with the refresh token", async () => {
    const secretToken = "Atzr|NEVER-LOGGED-TOKEN";
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    (api.provisionAmazonAccount as jest.Mock).mockResolvedValue(
      amazonAccount(),
    );
    (api.verifyAmazonConnection as jest.Mock).mockResolvedValue({
      connected: true,
      code: "VERIFIED",
      verifiedAt: "2026-09-03T12:00:00.000Z",
      marketplaceCount: 1,
    });

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    await fillAndSubmit({
      sellingPartnerId: "A1SELLERPARTNERID",
      refreshToken: secretToken,
    });
    await waitFor(() => expect(api.verifyAmazonConnection).toHaveBeenCalled());

    const allLoggedText = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .flat()
      .join(" ");
    expect(allLoggedText).not.toContain(secretToken);
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("disables the submit button while a submission is in flight (prevents duplicate double-click submits)", async () => {
    let resolveProvision!: (v: MarketplaceAccountDto) => void;
    (api.provisionAmazonAccount as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveProvision = resolve;
      }),
    );

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/selling partner id/i),
      "A1SELLERPARTNERID",
    );
    await user.type(screen.getByLabelText(/refresh token/i), "Atzr|x");
    const button = screen.getByRole("button", {
      name: /salvar e testar conexão/i,
    });
    await user.click(button);
    await user.click(button); // segundo clique enquanto a primeira chamada ainda está em voo

    expect(api.provisionAmazonAccount).toHaveBeenCalledTimes(1);

    resolveProvision(amazonAccount());
    // drena a cadeia assíncrona restante para não vazar `act()` warning
    await waitFor(() => expect(api.verifyAmazonConnection).toHaveBeenCalled());
  });

  it("the submit button stays disabled for the entire in-flight duration — a second real click is structurally impossible (disabled + synchronous ref guard), which is what makes stale in-flight responses irrelevant here", async () => {
    let resolveVerify!: (v: unknown) => void;
    (api.provisionAmazonAccount as jest.Mock).mockResolvedValue(
      amazonAccount(),
    );
    (api.verifyAmazonConnection as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveVerify = resolve;
      }),
    );

    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText(/selling partner id/i),
      "A1SELLERPARTNERID",
    );
    await user.type(screen.getByLabelText(/refresh token/i), "Atzr|x");
    const button = screen.getByRole("button", {
      name: /salvar e testar conexão/i,
    });
    await user.click(button);

    // Enquanto o verify está pendurado, o botão real fica desabilitado —
    // um segundo clique de usuário não dispara `onClick` (button:disabled).
    expect(screen.getByRole("button", { name: /salvando/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /salvando/i }));
    expect(api.provisionAmazonAccount).toHaveBeenCalledTimes(1);

    resolveVerify({
      connected: true,
      code: "VERIFIED",
      verifiedAt: "2026-09-03T12:00:00.000Z",
      marketplaceCount: 1,
    });
    await waitFor(() =>
      expect(api.verifyAmazonConnection).toHaveBeenCalledTimes(1),
    );
  });

  it("clicking Cancelar calls onClose without submitting anything", async () => {
    const onClose = jest.fn();
    render(
      <AmazonConnectionModal
        mode={{ kind: "credentials", accountId: "acc-1" }}
        onClose={onClose}
        onRefresh={jest.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.provisionAmazonAccount).not.toHaveBeenCalled();
  });
});
