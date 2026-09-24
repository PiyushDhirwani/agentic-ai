import { MCP } from "@/config/constants";
import { frameData, takeLines } from "@/lib/sse";
import type { McpServer, McpTool } from "@/models";

/**
 * A minimal MCP client over Streamable HTTP.
 *
 * Only remote servers are supported: a stdio server needs a child process,
 * which a serverless function cannot host.
 *
 * A response may be plain JSON or SSE-framed (`event: message` / `data: {…}`),
 * so both are handled. The session id from `initialize` must ride on every
 * later request; it lives for one invocation, since nothing persists between
 * serverless calls.
 */

export class McpError extends Error {
  serverId: string;

  constructor(message: string, serverId: string) {
    super(message);
    this.name = "McpError";
    this.serverId = serverId;
  }
}

interface JsonRpcResponse {
  result?: any;
  error?: { code: number; message: string };
}

/** Pulls the JSON-RPC payload out of either response shape. */
function parseResponse(body: string): JsonRpcResponse | null {
  const trimmed = body.trim();

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      return null;
    }
  }

  // SSE framing: take the last data line carrying a result or error.
  const { lines } = takeLines(`${body}\n`);
  let latest: JsonRpcResponse | null = null;
  for (const line of lines) {
    const data = frameData(line);
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed.result !== undefined || parsed.error) latest = parsed;
    } catch {
      // Ignore frames that are not JSON-RPC payloads.
    }
  }
  return latest;
}

export class McpConnection {
  private readonly server: McpServer;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(server: McpServer) {
    this.server = server;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Servers may answer with either, so accept both.
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP.protocolVersion,
    };

    if (this.server.apiKeyEnv) {
      const key = process.env[this.server.apiKeyEnv];
      if (key) headers[this.server.apiKeyHeader] = key;
    }
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const response = await fetch(this.server.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
      signal: AbortSignal.timeout(MCP.timeoutMs),
    });

    // Handed out on initialize and required by every later request.
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;

    const body = await response.text();

    if (!response.ok) {
      const parsed = parseResponse(body);
      const detail = parsed?.error?.message ?? body.slice(0, 200);
      throw new McpError(
        `${this.server.id}: ${method} failed (HTTP ${response.status}): ${detail}`,
        this.server.id,
      );
    }

    const parsed = parseResponse(body);
    if (!parsed) {
      throw new McpError(`${this.server.id}: unparseable response to ${method}`, this.server.id);
    }
    if (parsed.error) {
      throw new McpError(`${this.server.id}: ${parsed.error.message}`, this.server.id);
    }
    return parsed.result;
  }

  /** Handshake. Must run before anything else. */
  async connect(): Promise<void> {
    await this.call("initialize", {
      protocolVersion: MCP.protocolVersion,
      capabilities: {},
      clientInfo: { name: MCP.clientName, version: MCP.clientVersion },
    });
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.call("tools/list");
    const tools: any[] = result?.tools ?? [];
    return tools
      .filter((tool) => typeof tool?.name === "string")
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      }));
  }

  /**
   * Runs a tool and flattens the result to text.
   *
   * A tool that fails reports `isError` rather than throwing: the model is
   * better served by seeing "that search returned nothing" and trying
   * something else than by the whole turn collapsing.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    const result = await this.call("tools/call", { name, arguments: args });

    const blocks: any[] = result?.content ?? [];
    const text = blocks
      .map((block) => {
        if (block?.type === "text") return block.text ?? "";
        if (block?.type === "resource") return block.resource?.text ?? "";
        return "";
      })
      .filter(Boolean)
      .join("\n\n");

    return {
      content: text || JSON.stringify(result ?? {}).slice(0, MCP.maxResultChars),
      isError: Boolean(result?.isError),
    };
  }
}

/** Opens a connection and completes the handshake. */
export async function connect(server: McpServer): Promise<McpConnection> {
  const connection = new McpConnection(server);
  await connection.connect();
  return connection;
}
