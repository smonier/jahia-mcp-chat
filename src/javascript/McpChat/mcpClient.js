import {getCsrfHeaders, storeResponseToken, invalidateTokens} from './csrfToken';

// Tool names the LLM sees are <server>__<tool>; server names cannot contain "__"
export const TOOL_SEPARATOR = '__';

const ctx = () => window.contextJsParameters?.contextPath || '';
const PROXY_PATH = '/modules/jahia-mcp-chat/mcp';

let callId = 1;
const sessions = {}; // server name -> Mcp-Session-Id, or '' once initialized without one
const initializing = {};

export function serverUrl(server) {
    return new URL(ctx() + server.url, globalThis.location.origin).toString();
}

// Streamable HTTP servers may answer a POST with an SSE stream; take the response with our id
async function readJsonRpc(res, id) {
    const type = res.headers.get('Content-Type') || '';
    if (!type.includes('text/event-stream')) return res.json();
    const text = await res.text();
    let last = null;
    for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg.id === id) return msg;
            last = msg;
        } catch {}
    }
    return last || {};
}

async function post(server, siteKey, payload) {
    const headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'};
    if (sessions[server.name]) headers['Mcp-Session-Id'] = sessions[server.name];
    let url;
    if (server.local) {
        url = serverUrl(server);
    } else {
        Object.assign(headers, await getCsrfHeaders(PROXY_PATH), {'X-Site-Key': siteKey || ''});
        url = `${ctx()}${PROXY_PATH}?server=${encodeURIComponent(server.name)}`;
    }
    const res = await fetch(url, {method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(payload)});
    if (!server.local) {
        if (res.status === 302 || res.status === 403) invalidateTokens();
        storeResponseToken(PROXY_PATH, res);
    }
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) sessions[server.name] = sid;
    return res;
}

async function ensureInitialized(server, siteKey) {
    if (server.name in sessions) return;
    if (!initializing[server.name]) {
        initializing[server.name] = (async () => {
            try {
                const res = await post(server, siteKey, {
                    jsonrpc: '2.0', id: String(callId++), method: 'initialize',
                    params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'jahia-mcp-chat', version: '1.0.0'}}
                });
                if (res.ok) await post(server, siteKey, {jsonrpc: '2.0', method: 'notifications/initialized'});
            } catch {}
            if (!(server.name in sessions)) sessions[server.name] = '';
            delete initializing[server.name];
        })();
    }
    await initializing[server.name];
}

export async function mcpRequest(server, siteKey, method, params) {
    await ensureInitialized(server, siteKey);
    const id = String(callId++);
    const res = await post(server, siteKey, {jsonrpc: '2.0', id, method, params: params || {}});
    if (!res.ok) throw new Error(`MCP ${server.name} HTTP ${res.status}: ${await res.text()}`);
    const json = await readJsonRpc(res, id);
    if (json.error) throw new Error(`MCP ${server.name}: ${json.error.message || JSON.stringify(json.error)}`);
    return json.result;
}

// Tools of every server, renamed <server>__<tool>; a server that fails is skipped
export async function fetchAllTools(servers, siteKey) {
    const lists = await Promise.all((servers || []).map(async server => {
        try {
            const result = await mcpRequest(server, siteKey, 'tools/list', {});
            return (result?.tools || []).map(t => ({...t, name: `${server.name}${TOOL_SEPARATOR}${t.name}`}));
        } catch {
            return [];
        }
    }));
    return lists.flat();
}

export function resolveTool(servers, prefixedName) {
    const i = (prefixedName || '').indexOf(TOOL_SEPARATOR);
    if (i > 0) {
        const server = servers.find(s => s.name === prefixedName.slice(0, i));
        if (server) return {server, tool: prefixedName.slice(i + TOOL_SEPARATOR.length)};
    }
    // An unprefixed name is accepted only when there is a single server
    if (servers.length === 1) return {server: servers[0], tool: prefixedName};
    return null;
}

export async function callTool(servers, siteKey, prefixedName, args) {
    const resolved = resolveTool(servers || [], prefixedName);
    if (!resolved) {
        throw new Error(`Unknown tool "${prefixedName}". Use <server>${TOOL_SEPARATOR}<tool>, servers: ${(servers || []).map(s => s.name).join(', ') || '(none)'}`);
    }
    return mcpRequest(resolved.server, siteKey, 'tools/call', {name: resolved.tool, arguments: args || {}});
}
