import { MCP } from "@/config/constants";
import { env } from "@/config/env";
import {
  parseQualifiedName,
  qualify,
  type McpServer,
  type QualifiedTool,
  type ToolCall,
  type ToolResult,
} from "@/models";
import { redis } from "@/server/cache/client";
import { cacheKeys } from "@/server/cache/keys";
import { mcp as mcpRepo } from "@/server/db";
import { connect } from "@/server/mcp/client";

/**
 * Aggregates tools from every enabled MCP server and dispatches calls back to
 * the right one.
 *
 * Tool names are namespaced `<serverId>__<tool>` so two servers may expose the
 * same name without colliding.
 *
 * Every failure degrades: a server that will not answer contributes no tools,
 * and a tool that errors reports that to the model instead of ending the turn.
 */

async function cachedTools(server: McpServer): Promise<QualifiedTool[]> {
  const client = redis();
  const key = cacheKeys.tools(server.id);

  if (client) {
    try {
      const raw = await client.get(key);
      if (raw) return JSON.parse(raw) as QualifiedTool[];
    } catch (error) {
      console.error(`[tools] cache read failed for ${server.id}:`, error);
    }
  }

  const connection = await connect(server);
  const tools = await connection.listTools();
  const qualified: QualifiedTool[] = tools.map((tool) => ({
    ...tool,
    serverId: server.id,
    qualifiedName: qualify(server.id, tool.name),
  }));

  if (client) {
    try {
      await client.set(key, JSON.stringify(qualified), "EX", env.tools.listTtlSeconds);
    } catch (error) {
      console.error(`[tools] cache write failed for ${server.id}:`, error);
    }
  }
  return qualified;
}

/** Every tool on every enabled server. Empty when MCP is off. */
export async function listTools(): Promise<QualifiedTool[]> {
  if (!env.tools.enabled) return [];

  let servers: McpServer[];
  try {
    servers = await mcpRepo.listEnabled();
  } catch (error) {
    console.error("[tools] could not load MCP servers:", error);
    return [];
  }

  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        return await cachedTools(server);
      } catch (error) {
        // One unreachable server must not deny the model the others.
        console.error(`[tools] ${server.id} unreachable; skipping its tools:`, error);
        return [] as QualifiedTool[];
      }
    }),
  );
  return results.flat();
}

/** Converts to the tool definitions OpenRouter expects. */
export function toOpenRouterTools(tools: QualifiedTool[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.qualifiedName,
      description: tool.description ?? `${tool.name} on ${tool.serverId}`,
      parameters: tool.inputSchema,
    },
  }));
}

function truncate(text: string): string {
  return text.length > MCP.maxResultChars
    ? `${text.slice(0, MCP.maxResultChars)}\n\n[truncated]`
    : text;
}

/** Runs one tool call. Never throws — failures come back as `isError`. */
export async function execute(call: ToolCall): Promise<ToolResult> {
  const name = call.function.name;
  const parsed = parseQualifiedName(name);

  const fail = (message: string): ToolResult => ({
    toolCallId: call.id,
    name,
    content: message,
    isError: true,
  });

  if (!parsed) return fail(`Unknown tool "${name}".`);

  let args: Record<string, unknown>;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return fail(`Arguments for "${name}" were not valid JSON.`);
  }

  try {
    const servers = await mcpRepo.listEnabled();
    const server = servers.find((candidate) => candidate.id === parsed.serverId);
    if (!server) return fail(`Server "${parsed.serverId}" is not enabled.`);

    const connection = await connect(server);
    const result = await connection.callTool(parsed.tool, args);

    return {
      toolCallId: call.id,
      name,
      content: truncate(result.content),
      isError: result.isError,
    };
  } catch (error) {
    // Reported to the model so it can adapt, rather than ending the turn.
    console.error(`[tools] ${name} failed:`, error);
    return fail(error instanceof Error ? error.message : `Calling "${name}" failed.`);
  }
}

/** Runs several calls concurrently, preserving order. */
export async function executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(calls.map(execute));
}
