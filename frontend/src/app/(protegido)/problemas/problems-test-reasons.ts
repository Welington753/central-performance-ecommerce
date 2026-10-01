import type { ProblemReasonOptionDto } from "@/types/problems";

const ML1_ID = "11111111-1111-4111-8111-111111111111";
const ML2_ID = "22222222-2222-4222-8222-222222222222";

const reason = (
  reasonId: string,
  reasonLabel: string,
  count: number,
  ml1: number,
  ml2: number,
): ProblemReasonOptionDto => ({
  reasonId,
  name: reasonId,
  reasonLabel,
  count,
  percentage: Math.round((count / 50) * 10000) / 100,
  byAccount: [
    { accountId: ML1_ID, accountNickname: "ML1", count: ml1 },
    { accountId: ML2_ID, accountNickname: "ML2", count: ml2 },
  ],
});

/** Distribuição COMPLETA (7 motivos — mais que um top 5), total do período = 50 problemas. */
export const REASONS: ProblemReasonOptionDto[] = [
  reason("repentant_buyer", "Arrependimento do comprador", 20, 12, 8),
  reason("broken_item", "Produto quebrado ou com defeito", 10, 6, 4),
  reason("missing_item", "Produto faltando", 6, 6, 0),
  reason("undelivered_other", "Não entregue — outro motivo", 5, 0, 5),
  reason("different_than_published", "Produto diferente do anunciado", 4, 2, 2),
  reason("missing_accessories", "Acessórios faltando", 3, 3, 0),
  reason("mystery_code", "Mystery code", 2, 1, 1),
];
