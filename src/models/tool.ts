/** An MCP server the assistant may call tools on. */
export interface McpServer {
  id: string;
  label: string;
  url: string;
  /** Env var holding the key. The key itself is never stored in the database. */
  apiKeyEnv: string | null;
  apiKeyHeader: string;
  enabled: boolean;
  sortOrder: number;
  notes: string | null;
}

/** A tool as MCP describes it. */
export interface McpTool {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
}

/** An MCP tool qualified by the server that owns it. */
export interface QualifiedTool extends McpTool {
  serverId: string;
  /** `<serverId>__<name>`, so two servers may expose the same tool name. */
  qualifiedName: string;
}

/** A tool invocation the model asked for, in OpenAI/OpenRouter shape. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** The outcome of running one tool call. */
export interface ToolResult {
  toolCallId: string;
  /** The qualified name, as the model referred to it. */
  name: string;
  /** Text handed back to the model. Errors are reported here, not thrown. */
  content: string;
  isError: boolean;
}

/** Splits `<serverId>__<tool>` back into its parts. */
export function parseQualifiedName(
  qualified: string,
): { serverId: string; tool: string } | null {
  const separator = qualified.indexOf("__");
  if (separator <= 0) return null;
  return {
    serverId: qualified.slice(0, separator),
    tool: qualified.slice(separator + 2),
  };
}

export function qualify(serverId: string, tool: string): string {
  return `${serverId}__${tool}`;
}
