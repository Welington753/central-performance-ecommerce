import { useEffect, useRef, useState } from "react";

interface QueryState<T> {
  key: string;
  data: T | null;
  failure: unknown;
}

export interface AsyncQuery<T> {
  data: T | null;
  /** Falha da consulta ATUAL (nunca de um filtro anterior). */
  failure: unknown;
  loading: boolean;
}

/**
 * Consulta atrelada a uma chave de filtros. Mudar a chave descarta na hora o
 * resultado/erro anterior (loading derivado — nada de erro velho com filtro
 * novo) e ABORTA a requisição em andamento; uma resposta atrasada de outra
 * chave nunca sobrescreve a mais recente. `key === null` = não consultar.
 */
export function useAsyncQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
): AsyncQuery<T> {
  const [state, setState] = useState<QueryState<T> | null>(null);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, failure: null });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setState({ key, data: null, failure });
      });
    return () => controller.abort();
  }, [key]);

  const current = key !== null && state?.key === key ? state : null;
  return { data: current?.data ?? null, failure: current?.failure ?? null, loading: key !== null && current === null };
}
