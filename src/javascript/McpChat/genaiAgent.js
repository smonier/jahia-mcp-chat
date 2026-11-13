// The chat runs on genai-connector's streamed agent (/modules/genai/agent/stream): the model, its provider and
// key are the connector's, chosen by tier; the tools are the Jahia MCP tools plus the remote servers' tools this
// module registers, each under the user's own permissions or sign-in.
import {getCsrfHeaders, storeResponseToken, invalidateTokens} from './csrfToken';

const ctx = () => window.contextJsParameters?.contextPath || '';
const HEADERS = {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'};
export const TIERS = ['advanced', 'balanced', 'lite'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// {tiers: {advanced: {agentAvailable, provider, model}, ...}, tools: [{name, safety}]} or null when the connector
// is not installed
export async function fetchGenAiStatus() {
    try {
        const res = await fetch(`${ctx()}/modules/genai/status`, {credentials: 'same-origin', cache: 'no-store'});
        if (!res.ok || res.redirected) return null;
        const json = await res.json();
        return {tiers: json.tiers || {}, tools: json.tools || []};
    } catch {
        return null;
    }
}

export function availableTiers(status) {
    return TIERS.filter(t => status?.tiers?.[t]?.agentAvailable);
}

export async function confirmToolCall(streamId, callId, approve) {
    const res = await fetch(`${ctx()}/modules/genai/agent/confirm`, {
        method: 'POST', credentials: 'same-origin', headers: HEADERS,
        body: JSON.stringify({streamId, callId, approve})
    });
    return res.ok;
}

// Keeps a file for the chat.upload_attachment tool; returns its id
export async function storeAttachment(att, bytes) {
    const path = '/modules/jahia-mcp-chat/attachments';
    const res = await fetch(`${ctx()}${path}?name=${encodeURIComponent(att.name)}`, {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': att.type || 'application/octet-stream', ...(await getCsrfHeaders(path))},
        body: bytes
    });
    if (!res.ok || res.redirected) {
        invalidateTokens();
        throw new Error(`attachment ${res.status}`);
    }
    storeResponseToken(path, res);
    return (await res.json()).id;
}

// Yields {type: text | tool_start | tool_result | approval_required | usage}
export async function* runAgent({input, images, history, tier, instructions, maxTokens, locale, allowedTools, signal}) {
    const res = await fetch(`${ctx()}/modules/genai/agent/stream`, {
        method: 'POST', credentials: 'same-origin', headers: HEADERS, signal,
        body: JSON.stringify({
            input,
            tier,
            instructions,
            history,
            ...(images?.length ? {images} : {}),
            ...(maxTokens ? {maxOutputTokens: maxTokens} : {}),
            ...(locale ? {locale} : {}),
            ...(allowedTools ? {allowedTools} : {})
        })
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let streamId = '';
    let buf = '';
    let event = 'message';
    let data = '';

    const frame = function* (name, raw) {
        let d = {};
        try { d = JSON.parse(raw); } catch {}
        if (name === 'start') streamId = d.streamId || '';
        if (name === 'partial' && d.text) yield {type: 'text', content: d.text};
        if (name === 'tool_call') {
            let toolInput = {};
            try { toolInput = JSON.parse(d.argumentsJson || '{}'); } catch {}
            yield {type: 'tool_start', id: d.callId, name: d.tool, input: toolInput};
        }
        if (name === 'approval_required') {
            yield {type: 'approval_required', streamId: d.streamId || streamId, callId: d.callId, name: d.tool, argumentsJson: d.argumentsJson};
        }
        if (name === 'tool_result') {
            yield {type: 'tool_result', id: d.callId, result: d.ok ? (d.resultPreview || '') : {error: d.resultPreview || 'Tool failed'}};
        }
        if (name === 'complete' && d.usage) {
            yield {type: 'usage', input: d.usage.inputTokens || 0, output: d.usage.outputTokens || 0};
        }
        if (name === 'error') throw new Error(d.error || 'error');
    };

    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
            if (line.startsWith('event:')) {
                event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                data += (data ? '\n' : '') + line.slice(5).trim();
            } else if (line.trim() === '') {
                if (data) yield* frame(event, data);
                event = 'message';
                data = '';
            }
        }
    }
    if (data) yield* frame(event, data);
}
