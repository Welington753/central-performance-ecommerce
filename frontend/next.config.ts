import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Checkpoint CP2K-6B-2A: build de produção em container — gera
  // `.next/standalone` com só as dependências realmente usadas em runtime
  // (trace automático), evitando copiar `node_modules` inteiro para a
  // imagem final. Não afeta `next dev`/`next start` local (só muda o que
  // `next build` produz a mais).
  output: "standalone",
};

export default nextConfig;
