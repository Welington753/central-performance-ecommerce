import { useEffect, useState } from "react";

/** `true` em telas estreitas (< 768px). Sem `matchMedia` (SSR/testes) assume desktop. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
