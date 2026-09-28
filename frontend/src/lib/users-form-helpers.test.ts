import { buildAccountScopePayload, computeOverrides } from "./users-form-helpers";
import { PERMISSION_KEYS, type PermissionKey } from "@/types/users";

const ANALYST_PRESET: PermissionKey[] = [
  "dashboard.view",
  "full.view",
  "customers.view",
  "customers.export",
  "goals.view",
  "integrations.view",
  "sync.view",
];

describe("computeOverrides", () => {
  it("ADMIN nunca envia overrides, mesmo com seleção divergente", () => {
    const overrides = computeOverrides(
      "ADMIN",
      PERMISSION_KEYS,
      ANALYST_PRESET,
      new Set(["dashboard.view"]),
    );
    expect(overrides).toEqual([]);
  });

  it("ANALYST sem mudanças em relação ao preset não envia overrides", () => {
    const overrides = computeOverrides(
      "ANALYST",
      PERMISSION_KEYS,
      ANALYST_PRESET,
      new Set(ANALYST_PRESET),
    );
    expect(overrides).toEqual([]);
  });

  it("ANALYST só envia as chaves que divergem do preset (concedidas e revogadas)", () => {
    const selected = new Set<PermissionKey>([
      ...ANALYST_PRESET.filter((key) => key !== "customers.export"), // revoga
      "users.view", // concede além do preset
    ]);

    const overrides = computeOverrides(
      "ANALYST",
      PERMISSION_KEYS,
      ANALYST_PRESET,
      selected,
    );

    expect(overrides).toEqual(
      expect.arrayContaining([
        { permissionKey: "customers.export", granted: false },
        { permissionKey: "users.view", granted: true },
      ]),
    );
    expect(overrides).toHaveLength(2);
  });
});

describe("buildAccountScopePayload", () => {
  it("ALL nunca envia accountIds", () => {
    expect(buildAccountScopePayload("ALL", ["a", "b"])).toEqual({ mode: "ALL" });
  });

  it("NONE nunca envia accountIds", () => {
    expect(buildAccountScopePayload("NONE", ["a"])).toEqual({ mode: "NONE" });
  });

  it("SELECTED envia os IDs reais selecionados", () => {
    expect(buildAccountScopePayload("SELECTED", ["a", "b"])).toEqual({
      mode: "SELECTED",
      accountIds: ["a", "b"],
    });
  });

  it("SELECTED deduplica IDs repetidos", () => {
    expect(buildAccountScopePayload("SELECTED", ["a", "b", "a"])).toEqual({
      mode: "SELECTED",
      accountIds: ["a", "b"],
    });
  });
});
