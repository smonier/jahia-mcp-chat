import {useCallback, useRef, useState} from 'react';

const LLM_PROXY = '/modules/jahia-mcp-chat/llm-proxy';

const MCP_TOOL_DEFINITIONS = [
    {
        name: 'mcp_call',
        description: 'Call a Jahia MCP tool.',
        input_schema: {
            type: 'object',
            properties: {
                tool: {type: 'string'},
                params: {type: 'object'}
            },
            required: ['tool']
        }
    }
];

let mcpCallId = 1;

async function mcpJsonRpc(mcpEndpoint, mcpToken, method, params) {
    const res = await fetch(mcpEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(mcpToken ? {'Authorization': `APIToken ${mcpToken}`} : {})
        },
        body: JSON.stringify({jsonrpc: '2.0', id: String(mcpCallId++), method, params: params || {}})
    });
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.error) throw new Error(`MCP: ${json.error.message || JSON.stringify(json.error)}`);
    return json.result;
}

async function callMcpTool(mcpEndpoint, mcpToken, toolName, params) {
    return mcpJsonRpc(mcpEndpoint, mcpToken, 'tools/call', {name: toolName, arguments: params || {}});
}

// Extract the inner JSON payload from an MCP text-envelope result
function unwrapMcpResult(result) {
    try {
        if (result?.content && Array.isArray(result.content)) {
            const text = result.content.find(c => c.type === 'text')?.text;
            if (text) return JSON.parse(text);
        }
    } catch {}
    return result;
}

function rewrap(inner) {
    return {content: [{type: 'text', text: JSON.stringify(inner)}]};
}

// Type-aware summarizer: return only what the LLM needs, strip full schemas / long descriptions
function summarizeForLlm(result) {
    const data = unwrapMcpResult(result);
    if (!data || typeof data !== 'object') return result;

    // site.list
    if (Array.isArray(data.sites)) {
        return rewrap({
            count: data.count,
            sites: data.sites.map(s => ({siteKey: s.siteKey, title: s.title, defaultLanguage: s.defaultLanguage, languages: s.languages}))
        });
    }

    // content.list_definitions — schemas are huge; keep only names + supertypes
    if (Array.isArray(data.definitions)) {
        return rewrap({
            count: data.definitions.length,
            definitions: data.definitions.map(d => ({
                name: d.name,
                title: d.title,
                supertypes: d.supertypes
            }))
        });
    }

    // content.type — keep properties summary, not full schema
    if (data.name && data.properties && Array.isArray(data.properties)) {
        return rewrap({
            name: data.name,
            title: data.title,
            supertypes: data.supertypes,
            properties: data.properties.map(p => ({name: p.name, type: p.requiredType, mandatory: p.mandatory}))
        });
    }

    // content.list / content.search — keep path + type + title only
    if (Array.isArray(data.nodes)) {
        return rewrap({
            count: data.nodes.length,
            nodes: data.nodes.slice(0, 30).map(n => ({path: n.path, type: n.type, title: n.title || n.name}))
        });
    }

    // page.list
    if (Array.isArray(data.pages)) {
        return rewrap({
            count: data.pages.length,
            pages: data.pages.slice(0, 30).map(p => ({path: p.path, title: p.title, template: p.template}))
        });
    }

    // page.templates
    if (Array.isArray(data.templates)) {
        return rewrap({templates: data.templates.map(t => ({name: t.name, title: t.title}))});
    }

    // page.structure — strip deep content trees, keep top 2 levels
    if (data.path && data.children) {
        const trimChildren = (node, depth) => depth > 2 ? {path: node.path, type: node.type} : {
            path: node.path, type: node.type, title: node.title,
            children: node.children?.slice(0, 10).map(c => trimChildren(c, depth + 1))
        };
        return rewrap(trimChildren(data, 0));
    }

    // tools/list
    if (Array.isArray(data.tools)) {
        return rewrap({tools: data.tools.map(t => ({name: t.name, description: (t.description || '').slice(0, 80)}))});
    }

    // content.get — full node, keep essential fields only
    if (data.path && data.type && data.properties && !data.children) {
        const keepProps = ['jcr:title', 'jcr:description', 'j:nodename', 'j:published'];
        const props = {};
        for (const [k, v] of Object.entries(data.properties || {})) {
            if (keepProps.includes(k) || !k.startsWith('j') && !k.startsWith('jcr:')) props[k] = v;
        }
        return rewrap({path: data.path, type: data.type, name: data.name, title: data.title, properties: props});
    }

    // site.get — strip internal config, keep essentials
    if (data.siteKey && data.title) {
        return rewrap({siteKey: data.siteKey, title: data.title, defaultLanguage: data.defaultLanguage, languages: data.languages, serverName: data.serverName});
    }

    // page.preview — may contain full HTML, just return the URL hint
    if (typeof data === 'string' && data.trim().startsWith('<')) {
        return '[HTML preview — not shown to save tokens]';
    }

    // workflow.tasks
    if (Array.isArray(data.tasks)) {
        return rewrap({count: data.tasks.length, tasks: data.tasks.slice(0, 20).map(t => ({id: t.id, name: t.name, state: t.state}))});
    }

    // scheduler.jobs
    if (Array.isArray(data.jobs)) {
        return rewrap({count: data.jobs.length, jobs: data.jobs.slice(0, 20).map(j => ({name: j.name, state: j.state, group: j.group}))});
    }

    // Generic fallback
    const str = JSON.stringify(result);
    return str.length > 3000 ? str.slice(0, 3000) + ' [truncated]' : result;
}

function truncateForLlm(result) {
    const summarized = summarizeForLlm(result);
    const str = typeof summarized === 'string' ? summarized : JSON.stringify(summarized);
    return str.length > 4000 ? str.slice(0, 4000) + ' [truncated]' : str;
}

export async function fetchMcpTools(mcpEndpoint, mcpToken) {
    try {
        const result = await mcpJsonRpc(mcpEndpoint, mcpToken, 'tools/list', {});
        return result?.tools || [];
    } catch {
        return [];
    }
}

function formatToolSignature(tool) {
    const schema = tool.inputSchema || tool.input_schema;
    const props = schema?.properties || {};
    const required = new Set(schema?.required || []);
    const params = Object.entries(props).map(([name, def]) => {
        const type = def.type || (def.enum ? 'enum' : 'any');
        const opt = required.has(name) ? '' : '?';
        const hint = def.description ? ` // ${def.description.slice(0, 60)}` : '';
        return `  ${name}${opt}: ${type}${hint}`;
    }).join('\n');
    const desc = tool.description ? ` — ${tool.description.slice(0, 100)}` : '';
    return params
        ? `${tool.name}${desc}\n${params}`
        : `${tool.name}${desc}`;
}

function buildSystemPrompt(mcpEndpoint, skills, mcpTools, siteKey, systemPromptAppendix) {
    const siteCtx = siteKey ? `\nThe user is currently working on site: **${siteKey}**. Use this as the default site for all operations unless told otherwise.\n` : '';

    const toolCatalog = mcpTools && mcpTools.length > 0
        ? '\n\n## MCP Tool Catalog\n\n```\n' +
          mcpTools.map(formatToolSignature).join('\n\n') +
          '\n```'
        : '';

    const skillsText = skills.length > 0
        ? '\n\n## Loaded Skills\n\n' + skills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
        : '';

    return `You are a Jahia CMS assistant. You manage content, pages, and sites via the \`mcp_call\` tool.
${siteCtx}
## Tool-first rule (most important)
For ANY request that involves the Jahia site — listing content, creating nodes, checking pages, reading configuration, anything — you MUST call \`mcp_call\` immediately. Do not answer from memory or training data. Do not describe what you are about to do. Call the tool first, then respond based on what it returns.

The only exception is a purely conversational message with no site action needed (e.g. "thanks", "what is a CND file?").

## Behavior
- Chain tool calls automatically — keep going until the task is fully done without waiting for the user.
- Before creating content, call \`content.type\` or \`page.templates\` to verify what types and templates exist on the current site. Never invent type names.
- Summarize results in plain language. Never paste raw JSON.
- For destructive operations (delete, unpublish all), ask once before executing.
${toolCatalog}${skillsText}${systemPromptAppendix ? '\n\n## Client-specific instructions\n\n' + systemPromptAppendix : ''}`;
}

// Compress older tool result messages to avoid accumulating huge contexts across iterations
function compressOldToolMessages(msg) {
    if (!msg || !Array.isArray(msg.content)) return msg;
    // Compress tool_result blocks in user messages (these grow largest)
    if (msg.role === 'user') {
        return {
            ...msg,
            content: msg.content.map(c => {
                if (c.type !== 'tool_result') return c;
                const str = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
                if (str.length <= 500) return c;
                return {...c, content: str.slice(0, 500) + ' [compressed]'};
            })
        };
    }
    // Strip tool_use input details from assistant messages (keep type + id only)
    if (msg.role === 'assistant') {
        return {
            ...msg,
            content: msg.content.map(c => {
                if (c.type !== 'tool_use') return c;
                return {type: 'tool_use', id: c.id, name: c.name, input: {}};
            })
        };
    }
    return msg;
}

// Agentic loop for Anthropic: streams response, executes tool calls, continues until end_turn
async function* runAnthropicLoop(apiKey, model, messages, systemPrompt, onToolUse, signal, maxTokens = 4096) {
    let currentMessages = messages.map(m => ({role: m.role, content: m.content}));

    while (!signal?.aborted) {
        const res = await fetch(LLM_PROXY, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-LLM-Provider': 'anthropic'},
            body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                system: systemPrompt,
                tools: MCP_TOOL_DEFINITIONS,
                messages: currentMessages,
                stream: true
            }),
            signal
        });

        if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let stopReason = null;
        const assistantContentBlocks = []; // full content for next-turn message
        let currentBlock = null;
        let inputBuf = '';
        let textBuf = '';
        let inputTokens = 0;
        let outputTokens = 0;

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            buf += decoder.decode(value, {stream: true});
            const lines = buf.split('\n');
            buf = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;
                try {
                    const ev = JSON.parse(data);
                    if (ev.type === 'message_start' && ev.message?.usage) {
                        inputTokens += ev.message.usage.input_tokens || 0;
                    }
                    if (ev.type === 'message_delta') {
                        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
                        if (ev.usage) outputTokens += ev.usage.output_tokens || 0;
                    }
                    if (ev.type === 'content_block_start') {
                        currentBlock = ev.content_block;
                        if (currentBlock.type === 'text') textBuf = '';
                        if (currentBlock.type === 'tool_use') inputBuf = '';
                    }
                    if (ev.type === 'content_block_delta') {
                        if (ev.delta?.type === 'text_delta') {
                            textBuf += ev.delta.text;
                            yield {type: 'text', content: ev.delta.text};
                        }
                        if (ev.delta?.type === 'input_json_delta') {
                            inputBuf += ev.delta.partial_json;
                        }
                    }
                    if (ev.type === 'content_block_stop' && currentBlock) {
                        if (currentBlock.type === 'text') {
                            assistantContentBlocks.push({type: 'text', text: textBuf});
                        }
                        if (currentBlock.type === 'tool_use') {
                            let toolInput = {};
                            try { toolInput = JSON.parse(inputBuf); } catch {}
                            assistantContentBlocks.push({
                                type: 'tool_use',
                                id: currentBlock.id,
                                name: currentBlock.name,
                                input: toolInput
                            });
                        }
                        currentBlock = null;
                    }
                } catch {}
            }
        }

        // Emit usage after each API round-trip
        if (inputTokens || outputTokens) {
            yield {type: 'usage', input: inputTokens, output: outputTokens};
        }

        const toolUseBlocks = assistantContentBlocks.filter(b => b.type === 'tool_use');
        // Continue if stop was tool_use, or if max_tokens hit but tool calls were already assembled
        if (stopReason !== 'tool_use' && toolUseBlocks.length === 0) break;

        // Execute all tool calls from this turn
        const toolResults = [];
        for (const tu of toolUseBlocks) {
            yield {type: 'tool_start', name: tu.name, input: tu.input, id: tu.id};
            const result = await onToolUse(tu.id, tu.name, tu.input);
            yield {type: 'tool_result', id: tu.id, result};
            toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: truncateForLlm(result)
            });
        }

        // Add assistant turn + tool results; compress older tool data to save tokens
        currentMessages = [
            ...currentMessages.map(m => compressOldToolMessages(m)),
            {role: 'assistant', content: assistantContentBlocks},
            {role: 'user', content: toolResults}
        ];
    }
}

// Agentic loop for OpenAI-compatible APIs (OpenAI, DeepSeek)
async function* runOpenAILoop(apiKey, model, messages, systemPrompt, onToolUse, signal, provider = 'openai', maxTokens = 4096) {
    const tools = MCP_TOOL_DEFINITIONS.map(t => ({
        type: 'function',
        function: {name: t.name, description: t.description, parameters: t.input_schema}
    }));
    let currentMessages = [
        {role: 'system', content: systemPrompt},
        ...messages.map(m => ({role: m.role, content: m.content}))
    ];

    while (!signal?.aborted) {
        const res = await fetch(LLM_PROXY, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-LLM-Provider': provider},
            body: JSON.stringify({model, messages: currentMessages, tools, stream: true, max_tokens: maxTokens, stream_options: {include_usage: true}}),
            signal
        });

        if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let stopReason = null;
        let assistantText = '';
        const toolCallBuf = {};

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            buf += decoder.decode(value, {stream: true});
            const lines = buf.split('\n');
            buf = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;
                try {
                    const ev = JSON.parse(data);
                    const choice = ev.choices?.[0];
                    if (choice?.finish_reason) stopReason = choice.finish_reason;
                    if (ev.usage) {
                        yield {type: 'usage', input: ev.usage.prompt_tokens || 0, output: ev.usage.completion_tokens || 0};
                    }
                    const delta = choice?.delta;
                    if (!delta) continue;
                    if (delta.content) {
                        assistantText += delta.content;
                        yield {type: 'text', content: delta.content};
                    }
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            if (!toolCallBuf[tc.index]) toolCallBuf[tc.index] = {id: '', name: '', args: ''};
                            if (tc.id) toolCallBuf[tc.index].id += tc.id;
                            if (tc.function?.name) toolCallBuf[tc.index].name += tc.function.name;
                            if (tc.function?.arguments) toolCallBuf[tc.index].args += tc.function.arguments;
                        }
                    }
                } catch {}
            }
        }

        const pendingToolCalls = Object.keys(toolCallBuf).length > 0;
        if (stopReason !== 'tool_calls' && !pendingToolCalls) break;

        const assistantMsg = {role: 'assistant', content: assistantText || null, tool_calls: []};
        const toolResults = [];

        for (const tc of Object.values(toolCallBuf)) {
            let args = {};
            try { args = JSON.parse(tc.args); } catch {}
            assistantMsg.tool_calls.push({
                id: tc.id, type: 'function',
                function: {name: tc.name, arguments: tc.args}
            });
            yield {type: 'tool_start', name: tc.name, input: args, id: tc.id};
            const result = await onToolUse(tc.id, tc.name, args);
            yield {type: 'tool_result', id: tc.id, result};
            toolResults.push({role: 'tool', tool_call_id: tc.id, content: truncateForLlm(result)});
        }

        currentMessages = [...currentMessages, assistantMsg, ...toolResults];
    }
}

const HISTORY_KEY = 'jahia-mcp-chat:history';
const MAX_STORED_MESSAGES = 100;

function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        // Strip streaming flags left over from a crash/close mid-stream
        return parsed.map(m => ({...m, streaming: false}));
    } catch {
        return [];
    }
}

function saveHistory(messages) {
    try {
        const toStore = messages.slice(-MAX_STORED_MESSAGES).map(m => ({
            ...m,
            streaming: false,
            toolCalls: m.toolCalls?.map(tc => ({
                ...tc,
                // Store summarized result as-is (already a string or small object)
                result: tc.result ? summarizeForLlm(tc.result) : tc.result
            }))
        }));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(toStore));
    } catch {}
}

export function useMcpChat(settings, mcpTools, siteKey, osgiConfig = {}) {
    const [messages, setMessages] = useState(loadHistory);
    const [isStreaming, setIsStreaming] = useState(false);
    const abortRef = useRef(null);

    const sendMessage = useCallback(async userText => {
        if (!userText.trim() || isStreaming) return;

        const userMsg = {role: 'user', content: userText};
        const history = [...messages, userMsg];
        setMessages(history);
        setIsStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        // Resolve effective values: user preference overrides OSGi default
        const mcpEndpoint   = osgiConfig.mcpEndpoint || 'http://localhost:8080/modules/mcp';
        const provider      = (settings.llmProvider && osgiConfig.availableProviders?.includes(settings.llmProvider))
                                ? settings.llmProvider
                                : osgiConfig.defaultProvider || 'anthropic';
        const model         = settings.selectedModel || osgiConfig.defaultModel || 'claude-sonnet-4-6';
        const maxTokens     = settings.maxTokens || osgiConfig.maxTokens || 4096;

        const onToolUse = async (id, name, input) => {
            if (!mcpEndpoint) return {error: 'MCP endpoint not configured'};
            try {
                if (name === 'mcp_call') {
                    return await callMcpTool(mcpEndpoint, settings.mcpToken, input.tool, input.params);
                }
            } catch (err) {
                return {error: err.message};
            }
            return {error: `Unknown tool: ${name}`};
        };

        const systemPrompt = buildSystemPrompt(mcpEndpoint, settings.skills || [], mcpTools, siteKey, osgiConfig.systemPromptAppendix || '');

        // Keep last 20 messages; truncate old text content to save tokens
        const trimmedHistory = history.slice(-20).map((m, i, arr) => {
            const isRecent = i >= arr.length - 4;
            if (isRecent || typeof m.content !== 'string') return m;
            return {...m, content: m.content.length > 400 ? m.content.slice(0, 400) + ' [truncated]' : m.content};
        });

        let assistantText = '';
        const toolCalls = [];
        let usageInput = 0;
        let usageOutput = 0;

        setMessages(prev => [...prev, {role: 'assistant', content: '', streaming: true}]);

        try {
            const useOpenAICompat = provider === 'openai' || provider === 'deepseek';
            const stream = useOpenAICompat
                ? runOpenAILoop(null, model, trimmedHistory, systemPrompt, onToolUse, controller.signal, provider, maxTokens)
                : runAnthropicLoop(null, model, trimmedHistory, systemPrompt, onToolUse, controller.signal, maxTokens);

            for await (const event of stream) {
                if (controller.signal.aborted) break;

                if (event.type === 'text') {
                    assistantText += event.content;
                } else if (event.type === 'tool_start') {
                    toolCalls.push({name: event.name, input: event.input, id: event.id});
                } else if (event.type === 'tool_result') {
                    const tc = toolCalls.find(t => t.id === event.id) || toolCalls[toolCalls.length - 1];
                    if (tc) tc.result = event.result;
                } else if (event.type === 'usage') {
                    usageInput += event.input;
                    usageOutput += event.output;
                }

                setMessages(prev => [
                    ...prev.slice(0, -1),
                    {role: 'assistant', content: assistantText, streaming: true, toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined}
                ]);
            }
        } catch (err) {
            if (!controller.signal.aborted) {
                assistantText = `Error: ${err.message}`;
            }
        }

        const usage = (usageInput || usageOutput) ? {input: usageInput, output: usageOutput} : undefined;

        setMessages(prev => {
            const updated = [
                ...prev.slice(0, -1),
                {role: 'assistant', content: assistantText || '(stopped)', toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined, usage}
            ];
            saveHistory(updated);
            return updated;
        });
        setIsStreaming(false);
        abortRef.current = null;
    }, [messages, isStreaming, settings, mcpTools]);

    const stopStreaming = useCallback(() => { abortRef.current?.abort(); }, []);
    const clearMessages = useCallback(() => {
        setMessages([]);
        localStorage.removeItem(HISTORY_KEY);
    }, []);

    return {messages, isStreaming, sendMessage, stopStreaming, clearMessages};
}
