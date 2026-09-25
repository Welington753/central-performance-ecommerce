/**
 * Configuração central da navegação lateral — única fonte de verdade dos
 * grupos/itens do menu. Adicionar uma página nova exige só: criar a rota e
 * registrar um item aqui (nunca hardcodear links soltos em outros
 * componentes). `permissionKey` é reservado para uma futura filtragem por
 * permissão (ainda não implementada) — hoje todo item sem `permissionKey`
 * (ou com ele) é sempre exibido.
 */

export type NavIconProps = {
  className?: string;
};

export type NavIcon = (props: NavIconProps) => React.JSX.Element;

export interface NavItem {
  /** Identificador estável do item — nunca reaproveitado nem renomeado entre versões. */
  id: string;
  label: string;
  href: string;
  Icon: NavIcon;
  /** Reservado para filtragem futura por permissão; ausente = visível para qualquer sessão autenticada. */
  permissionKey?: string;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

function DashboardIcon({ className }: NavIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function FullIcon({ className }: NavIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z" />
      <path d="M3 6.5V13l7 3.5 7-3.5V6.5" />
      <path d="M10 10v6.5" />
    </svg>
  );
}

function CustomersIcon({ className }: NavIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="7" r="3" />
      <path d="M2.5 17a5.5 5.5 0 0 1 11 0" />
      <path d="M13.5 4.5a3 3 0 0 1 0 5" />
      <path d="M15.5 12.5a5.5 5.5 0 0 1 2 4.5" />
    </svg>
  );
}

function IntegrationsIcon({ className }: NavIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.5 11.5 6 14a3 3 0 1 1-4.2-4.2l2.5-2.5" />
      <path d="M11.5 8.5 14 6a3 3 0 1 1 4.2 4.2l-2.5 2.5" />
      <path d="M7.5 12.5 12.5 7.5" />
    </svg>
  );
}

function SyncIcon({ className }: NavIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 10a7 7 0 0 1 11.9-5" />
      <path d="M17 10a7 7 0 0 1-11.9 5" />
      <path d="M15 2.5V5h-2.5" />
      <path d="M5 17.5V15h2.5" />
    </svg>
  );
}

/** Somente rotas que já existem — nenhum item fictício ou "em breve". */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "visao-geral",
    title: "VISÃO GERAL",
    items: [
      { id: "dashboard", href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
    ],
  },
  {
    id: "analises",
    title: "ANÁLISES",
    items: [
      { id: "full", href: "/full", label: "Full", Icon: FullIcon },
      {
        id: "clientes",
        href: "/clientes",
        label: "Clientes",
        Icon: CustomersIcon,
        permissionKey: "clientes.visualizar",
      },
    ],
  },
  {
    id: "marketplaces",
    title: "MARKETPLACES",
    items: [
      { id: "integracoes", href: "/integracoes", label: "Integrações", Icon: IntegrationsIcon },
    ],
  },
  {
    id: "operacao",
    title: "OPERAÇÃO",
    items: [
      { id: "sincronizacoes", href: "/sincronizacoes", label: "Sincronizações", Icon: SyncIcon },
    ],
  },
];

/** Ativo em rotas exatas e em subrotas (ex.: `/dashboard/metas` sob `/dashboard`). */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
