import {
  isPermissionKey,
  PERMISSIONS,
  type PermissionKey,
} from './permissions.catalog';

/**
 * Ponte TEMPORÁRIA entre as 4 permission keys em português já em uso por
 * `customers/customer-permissions.ts` (`RequireCustomerPermissions`,
 * `CustomerPermissionGuard`) e o catálogo canônico em inglês. Não persistida
 * em banco (`role_permissions`/`user_permission_overrides` já nascem só com
 * chaves canônicas — ver migration deste checkpoint).
 *
 * Estratégia de transição: como ainda NÃO existe permissão granular
 * persistida em produção hoje (`hasCustomerPermission` ainda decide só por
 * `isAdmin`), este checkpoint não altera `customer-permissions.ts` nem
 * `customers.controller.ts` — continuam funcionando exatamente como antes.
 * Este mapa existe para o PRÓXIMO checkpoint, quando
 * `CustomerPermissionGuard`/`hasCustomerPermission` passarem a resolver a
 * permissão efetiva do usuário (papel + overrides, chaves canônicas): nesse
 * momento, cada chave em português recebida via `@RequireCustomerPermissions`
 * será traduzida para a canônica correspondente através deste único ponto,
 * até que `customer-permissions.ts` seja migrado para usar as chaves
 * canônicas diretamente e este arquivo (e o teste que o acompanha) possa ser
 * removido.
 *
 * Centralizado aqui de propósito — nenhuma outra parte do código deve copiar
 * esta tradução. Testado em `permission-key-aliases.spec.ts` contra os
 * valores REAIS de `CUSTOMER_PERMISSIONS` (nunca uma lista solta re-digitada
 * à mão), para nunca divergir silenciosamente.
 */
export const LEGACY_CUSTOMER_PERMISSION_ALIASES: Readonly<
  Record<string, PermissionKey>
> = {
  'clientes.visualizar': PERMISSIONS.CUSTOMERS_VIEW,
  'clientes.exportar': PERMISSIONS.CUSTOMERS_EXPORT,
  'clientes.exportar_dados_pessoais':
    PERMISSIONS.CUSTOMERS_EXPORT_PERSONAL_DATA,
  'clientes.gerenciar_enriquecimento': PERMISSIONS.CUSTOMERS_MANAGE_ENRICHMENT,
};

/**
 * Converte uma permission key qualquer (já canônica OU um alias legado de
 * Clientes em português) para a chave canônica — `null` se não reconhecida.
 * Nunca lança exceção: fail-closed por retorno, quem chama decide como
 * tratar `null` (sempre como "negar", nunca como "ignorar e liberar").
 *
 * Uso previsto: preparação para o checkpoint que reescrever
 * `CustomerPermissionGuard` sobre `PermissionResolverService` — hoje nada
 * chama isto em runtime fora de teste (`customer-permissions.ts` continua
 * decidindo só por `isAdmin`, sem nenhuma mudança neste checkpoint).
 */
export function toCanonicalPermissionKey(rawKey: string): PermissionKey | null {
  if (isPermissionKey(rawKey)) return rawKey;
  return LEGACY_CUSTOMER_PERMISSION_ALIASES[rawKey] ?? null;
}
