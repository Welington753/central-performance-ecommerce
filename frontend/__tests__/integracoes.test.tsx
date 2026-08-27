import { render, screen } from "@testing-library/react";
import IntegracoesPage from "@/app/(protegido)/integracoes/page";

describe("IntegracoesPage", () => {
  it("renderiza os três cards de marketplace com os status corretos", () => {
    render(<IntegracoesPage />);

    expect(screen.getByText("Mercado Livre")).toBeInTheDocument();
    expect(screen.getByText("Amazon")).toBeInTheDocument();
    expect(screen.getByText("Shopee")).toBeInTheDocument();

    expect(screen.getByText("Status: Não conectado")).toBeInTheDocument();
    expect(screen.getAllByText("Status: Disponível futuramente")).toHaveLength(2);
    expect(screen.getByText("Primeira integração planejada")).toBeInTheDocument();
  });

  it("desabilita o botão 'Conectar Mercado Livre' com o texto de disponibilidade futura", () => {
    render(<IntegracoesPage />);

    const button = screen.getByRole("button", {
      name: /conectar mercado livre/i,
    });

    expect(button).toBeDisabled();
    expect(screen.getByText("Disponível na próxima etapa")).toBeInTheDocument();
  });

  it("não renderiza botões funcionais para Amazon ou Shopee", () => {
    render(<IntegracoesPage />);

    const buttons = screen.getAllByRole("button");
    // O único botão da página é o do Mercado Livre (desabilitado).
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/conectar mercado livre/i);
  });
});
