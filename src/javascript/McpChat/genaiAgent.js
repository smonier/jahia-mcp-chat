// Jahia GenAI connector (genai-connector module): the agent loop runs server-side with the Jahia MCP tools
// in-process, under the user's own session. Remote MCP servers and images are not available in this mode.

export const GENAI_PROVIDER = 'genai';

const ctx = () => window.contextJsParameters?.contextPath || '';
const HEADERS = {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'};

// {available, provider, model} or null when the connector is missing or its agent cannot run
export async function fetchGenAiStatus() {
    try {
        const res = await fetch(`${ctx()}/modules/genai/status`, {credentials: 'same-origin', cache: 'no-store'});
        if (!res.ok || res.redirected) return null;
        const json = await res.json();
        return json.available && json.agentAvailable ? {provider: json.provider || '', model: json.model || ''} : null;
    } catch {
        return null;
    }
}

export async function confirmToolCall(streamId, callId, approve) {
    const res = await fetch(`${ctx()}/modules/genai/agent/confirm`, {
        method: 'POST', credentials: 'same-origin', headers: HEADERS,
        body: JSON.stringify({streamId, callId, approve})
    });
    return res.ok;
}

function historyText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return '';
}

// Yields the same events as the other loops (text, tool_start, tool_result, usage) plus approval_required
export async function* runGenAiAgentLoop(messages, instructions, signal, maxTokens, locale) {
    const turns = messages.map(m => ({role: m.role, text: historyText(m.content)})).filter(t => t.text);
    const last = turns.pop();
    if (!last || last.role !== 'user') throw new Error('Nothing to send');

    const res = await fetch(`${ctx()}/modules/genai/agent/stream`, {
        method: 'POST', credentials: 'same-origin', headers: HEADERS, signal,
        body: JSON.stringify({
            input: last.text,
            instructions,
            history: turns,
            ...(maxTokens ? {maxOutputTokens: maxTokens} : {}),
            ...(locale ? {locale} : {})
        })
    });
    if (!res.ok) throw new Error(`Jahia GenAI ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const pending = []; // tool calls without a result yet, in order: tool_result frames carry no callId
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
            let input = {};
            try { input = JSON.parse(d.argumentsJson || '{}'); } catch {}
            pending.push({id: d.callId, name: d.tool});
            yield {type: 'tool_start', id: d.callId, name: d.tool, input};
        }
        if (name === 'approval_required') {
            yield {type: 'approval_required', streamId: d.streamId || streamId, callId: d.callId, name: d.tool, argumentsJson: d.argumentsJson};
        }
        if (name === 'tool_result') {
            const i = pending.findIndex(p => p.name === d.tool);
            const call = i >= 0 ? pending.splice(i, 1)[0] : null;
            yield {type: 'tool_result', id: call?.id, result: d.ok ? (d.resultPreview || '') : {error: d.resultPreview || 'Tool failed'}};
        }
        if (name === 'complete' && d.usage) {
            yield {type: 'usage', input: d.usage.inputTokens || 0, output: d.usage.outputTokens || 0};
        }
        if (name === 'error') throw new Error(`Jahia GenAI: ${d.error || 'error'}`);
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
