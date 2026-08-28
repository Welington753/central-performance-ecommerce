"use client";

import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Sidebar />

      {/* `lg:pl-64` reserva a largura da barra lateral fixa no desktop, para
          que o conteúdo nunca fique escondido atrás dela. No mobile a barra
          vira gaveta sobreposta e nenhum recuo é necessário. */}
      <div className="flex flex-1 flex-col lg:pl-64">
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
