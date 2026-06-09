// Minimal stateless MCP server over Streamable HTTP (single JSON-RPC
// message per POST, JSON response). Tools-only — no resources, prompts,
// sessions or SSE, which keeps it a perfect fit for Lambda.

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_VERSION = SUPPORTED_VERSIONS[0];

const SERVER_INFO = { name: "health-pipeline", version: "1.0.0" };

function rpcResult(id, result) {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function rpcError(id, code, message) {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } };
}

export function createMcpHandler(tools) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  return async function handle(msg, ctx) {
    if (Array.isArray(msg))
      return rpcError(null, -32600, "Batch requests are not supported");
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
      return rpcError(msg?.id ?? null, -32600, "Invalid request");

    // Notifications (no id) get acknowledged with 202 and no body.
    if (msg.id === undefined) return { status: 202, body: null };

    switch (msg.method) {
      case "initialize": {
        const requested = msg.params?.protocolVersion;
        const protocolVersion = SUPPORTED_VERSIONS.includes(requested)
          ? requested
          : LATEST_VERSION;
        return rpcResult(msg.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
      }

      case "ping":
        return rpcResult(msg.id, {});

      case "tools/list":
        return rpcResult(msg.id, {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });

      case "tools/call": {
        const tool = byName.get(msg.params?.name);
        if (!tool)
          return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
        try {
          const result = await tool.handler(msg.params?.arguments ?? {}, ctx);
          return rpcResult(msg.id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          });
        } catch (err) {
          // Tool-level failures are results with isError, not protocol errors.
          return rpcResult(msg.id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          });
        }
      }

      default:
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  };
}
