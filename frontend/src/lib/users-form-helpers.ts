import type {
  AccountScopeInputPayload,
  OverrideInputPayload,
  PermissionKey,
  RoleKey,
} from "@/types/users";

/**
 * Só as permissões cujo estado difere do preset do papel — nunca a lista
 * inteira. Espelha a regra de negócio já aplicada (e validada) pelo backend
 * em `UserAccessRulesService.validateAndResolveOverrides`; a UI só evita
 * mandar um override redundante, o backend continua definitivo.
 * ADMIN nunca aceita overrides — sempre `[]`.
 */
export function computeOverrides(
  role: RoleKey,
  allPermissionKeys: readonly PermissionKey[],
  presetKeys: readonly PermissionKey[],
  selectedKeys: ReadonlySet<PermissionKey>,
): OverrideInputPayload[] {
  if (role === "ADMIN") {
    return [];
  }
  const preset = new Set(presetKeys);
  const overrides: OverrideInputPayload[] = [];
  for (const key of allPermissionKeys) {
    const inPreset = preset.has(key);
    const inSelected = selectedKeys.has(key);
    if (inPreset !== inSelected) {
      overrides.push({ permissionKey: key, granted: inSelected });
    }
  }
  return overrides;
}

/**
 * `ALL`/`NONE` nunca enviam `accountIds`; `SELECTED` deduplica antes de
 * enviar (defesa extra — a UI não deveria produzir duplicata, mas nunca
 * confia só nisso).
 */
export function buildAccountScopePayload(
  mode: "ALL" | "SELECTED" | "NONE",
  selectedAccountIds: readonly string[],
): AccountScopeInputPayload {
  if (mode !== "SELECTED") {
    return { mode };
  }
  return { mode, accountIds: [...new Set(selectedAccountIds)] };
}
