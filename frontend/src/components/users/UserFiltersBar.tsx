"use client";

import { ROLE_KEYS, type RoleKey } from "@/types/users";
import { ROLE_LABELS } from "@/lib/users-permission-labels";

export interface UserFiltersValue {
  status: "all" | "active" | "inactive";
  role: "all" | RoleKey;
}

interface UserFiltersBarProps {
  value: UserFiltersValue;
  onChange: (next: UserFiltersValue) => void;
}

const inputClass =
  "rounded-md border border-border-subtle bg-background px-2 py-1.5 text-sm";

export function UserFiltersBar({ value, onChange }: UserFiltersBarProps) {
  return (
    <div
      aria-label="Filtros de usuários"
      className="flex flex-wrap items-end gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        Status
        <select
          className={inputClass}
          value={value.status}
          onChange={(e) =>
            onChange({
              ...value,
              status: e.target.value as UserFiltersValue["status"],
            })
          }
        >
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Papel
        <select
          className={inputClass}
          value={value.role}
          onChange={(e) =>
            onChange({
              ...value,
              role: e.target.value as UserFiltersValue["role"],
            })
          }
        >
          <option value="all">Todos</option>
          {ROLE_KEYS.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
