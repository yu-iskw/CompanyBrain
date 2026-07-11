/**
 * MCP server deployable: JSON-RPC 2.0 over stdio (newline-delimited),
 * exposing the governed tool set from @companybrain/mcp-adapter.
 *
 * The delegated identity comes from the environment the supervisor launches
 * the server with (COMPANYBRAIN_USER_ID / COMPANYBRAIN_USER_GROUPS) — the MCP
 * client itself is never trusted to name the principal.
 */
import type { Principal } from '@companybrain/domain';
import type { McpToolSet } from '@companybrain/mcp-adapter';

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

export const SERVER_INFO = { name: 'companybrain', version: '0.1.0' } as const;

function response(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function errorResponse(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function principalFromEnv(env: NodeJS.ProcessEnv): Principal {
  const id = env.COMPANYBRAIN_USER_ID;
  if (id === undefined || id.trim() === '') {
    throw new Error('COMPANYBRAIN_USER_ID must be set to the delegated user identity');
  }
  const groups = (env.COMPANYBRAIN_USER_GROUPS ?? '')
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group !== '');
  return { id, groups };
}

export async function handleMessage(
  tools: McpToolSet,
  principal: Principal,
  raw: string,
): Promise<JsonRpcResponse | undefined> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return errorResponse(null, -32700, 'parse error');
  }
  switch (request.method) {
    case 'initialize': {
      return response(request.id, {
        protocolVersion: '2025-06-18',
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      });
    }
    case 'notifications/initialized': {
      return undefined;
    }
    case 'tools/list': {
      return response(request.id, { tools: tools.listTools() });
    }
    case 'tools/call': {
      const params = request.params ?? {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        typeof params.arguments === 'object' && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      const result = await tools.callTool(principal, name, args);
      return response(request.id, {
        isError: result.isError,
        content: [{ type: 'text', text: JSON.stringify(result.content) }],
      });
    }
    default: {
      return errorResponse(request.id, -32601, `method "${request.method}" not found`);
    }
  }
}
