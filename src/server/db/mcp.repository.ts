import type { McpServer } from "@/models";
import { sql } from "./client";

interface McpServerRow {
  id: string;
  label: string | null;
  url: string;
  api_key_env: string | null;
  api_key_header: string;
  enabled: boolean;
  sort_order: number;
  notes: string | null;
}

function toServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    label: row.label ?? row.id,
    url: row.url,
    apiKeyEnv: row.api_key_env,
    apiKeyHeader: row.api_key_header,
    enabled: row.enabled,
    sortOrder: Number(row.sort_order),
    notes: row.notes,
  };
}

export async function listEnabled(): Promise<McpServer[]> {
  const rows = (await sql()`
    SELECT id, label, url, api_key_env, api_key_header, enabled, sort_order, notes
    FROM mcp_servers
    WHERE enabled
    ORDER BY sort_order ASC, id ASC
  `) as McpServerRow[];
  return rows.map(toServer);
}

export async function listAll(): Promise<McpServer[]> {
  const rows = (await sql()`
    SELECT id, label, url, api_key_env, api_key_header, enabled, sort_order, notes
    FROM mcp_servers
    ORDER BY sort_order ASC, id ASC
  `) as McpServerRow[];
  return rows.map(toServer);
}

export async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
  const rows = (await sql()`
    UPDATE mcp_servers SET enabled = ${enabled}, updated_at = now()
    WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}
