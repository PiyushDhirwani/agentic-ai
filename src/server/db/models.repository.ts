import type { ModelOption } from "@/models";
import { sql } from "./client";

interface ModelRow {
  id: string;
  label: string | null;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
  notes: string | null;
}

function toModelOption(row: ModelRow): ModelOption {
  return {
    id: row.id,
    label: row.label ?? row.id,
    enabled: row.enabled,
    isDefault: row.is_default,
    sortOrder: Number(row.sort_order),
    notes: row.notes,
  };
}

/** Enabled models in fallback order. This feeds the chain and the picker. */
export async function listEnabled(): Promise<ModelOption[]> {
  const rows = (await sql()`
    SELECT id, label, enabled, is_default, sort_order, notes
    FROM models
    WHERE enabled
    ORDER BY sort_order ASC, id ASC
  `) as ModelRow[];
  return rows.map(toModelOption);
}

/** Every model, including disabled ones. For administration. */
export async function listAll(): Promise<ModelOption[]> {
  const rows = (await sql()`
    SELECT id, label, enabled, is_default, sort_order, notes
    FROM models
    ORDER BY sort_order ASC, id ASC
  `) as ModelRow[];
  return rows.map(toModelOption);
}

export interface ModelUpsert {
  id: string;
  label?: string | null;
  enabled?: boolean;
  sortOrder?: number;
  notes?: string | null;
}

/** Adds a model or updates the fields supplied; others keep their values. */
export async function upsert(model: ModelUpsert): Promise<ModelOption> {
  const rows = (await sql()`
    INSERT INTO models (id, label, enabled, sort_order, notes)
    VALUES (
      ${model.id},
      ${model.label ?? null},
      ${model.enabled ?? true},
      ${model.sortOrder ?? 100},
      ${model.notes ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      label      = COALESCE(${model.label ?? null}, models.label),
      enabled    = COALESCE(${model.enabled ?? null}, models.enabled),
      sort_order = COALESCE(${model.sortOrder ?? null}, models.sort_order),
      notes      = COALESCE(${model.notes ?? null}, models.notes),
      updated_at = now()
    RETURNING id, label, enabled, is_default, sort_order, notes
  `) as ModelRow[];
  return toModelOption(rows[0]);
}

export async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
  const rows = (await sql()`
    UPDATE models SET enabled = ${enabled}, updated_at = now()
    WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/**
 * Promotes one model to default. A partial unique index allows only one
 * default row, so the old one must be cleared in the same transaction.
 */
export async function setDefault(id: string): Promise<boolean> {
  const rows = (await sql().transaction((tx) => [
    tx`UPDATE models SET is_default = FALSE, updated_at = now() WHERE is_default`,
    tx`UPDATE models SET is_default = TRUE, enabled = TRUE, updated_at = now()
       WHERE id = ${id} RETURNING id`,
  ])) as unknown as [unknown, { id: string }[]];
  return rows[1].length > 0;
}

export async function remove(id: string): Promise<boolean> {
  const rows = (await sql()`
    DELETE FROM models WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}
