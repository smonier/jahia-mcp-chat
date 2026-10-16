import {useCallback, useRef, useState} from 'react';
import {getCsrfHeaders, storeResponseToken, invalidateTokens} from './csrfToken';
import {callTool, fetchAllTools, serverUrl, TOOL_SEPARATOR} from './mcpClient';
import {confirmToolCall, GENAI_PROVIDER, runGenAiAgentLoop} from './genaiAgent';

const ctx = () => window.contextJsParameters?.contextPath || '';
const LLM_PROXY = () => `${ctx()}/modules/jahia-mcp-chat/llm-proxy`;

const MCP_TOOL_DEFINITIONS = [
    {
        name: 'mcp_call',
        description: `Call an MCP tool. "tool" is <server>${TOOL_SEPARATOR}<tool> as listed in the tool catalog.`,
        input_schema: {
            type: 'object',
            properties: {
                tool: {type: 'string'},
                params: {type: 'object'}
            },
            required: ['tool']
        }
    },
    {
        name: 'upload_attachment',
        description: 'Upload a file the user attached to the CURRENT chat message into the Jahia DAM (/sites/<siteKey>/files/<folder>). The chat client holds the file bytes and performs the upload itself (media.upload ticket flow). Returns the JCR path of the created file node — use it as the value of image/file weakreference properties when creating content.',
        input_schema: {
            type: 'object',
            properties: {
                attachmentName: {type: 'string', description: 'Exact file name of an attachment on the current user message'},
                siteKey: {type: 'string', description: 'Target site key'},
                folder: {type: 'string', description: 'Folder under /sites/<siteKey>/files (created if missing). Defaults to "chat-uploads".'}
            },
            required: ['attachmentName', 'siteKey']
        }
    }
];

function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Browser-side DAM upload of a chat attachment: the LLM cannot move binary
// data, but the chat client holds the attached bytes AND talks to the MCP
// server — so the upload (media.upload.create ticket -> PUT -> finalize) runs
// locally and only the resulting JCR path goes back to the model.
async function uploadAttachment(servers, siteKey, input, attachments) {
    const local = (servers || []).find(s => s.local);
    if (!local) return {error: 'No MCP server on this Jahia instance is configured; attachments cannot be uploaded.'};
    const call = (tool, args) => callTool([local], siteKey, tool, args);
    const att = (attachments || []).find(a => a.name === input.attachmentName);
    if (!att) {
        const names = (attachments || []).map(a => a.name).join(', ') || '(none)';
        return {error: `No attachment named "${input.attachmentName}" on the current message. Available: ${names}`};
    }
    if (!att.data) {
        return {error: `Attachment "${att.name}" carries no binary data (kind: ${att.kind}). Only image/binary attachments can be uploaded.`};
    }
    const folder = input.folder || 'chat-uploads';
    const bytes = base64ToBytes(att.data);
    const mimeType = att.type || 'application/octet-stream';

    // The DAM folder must exist before finalize (locale required even for folders)
    try {
        await call('content.create', {
            parentPath: `/sites/${input.siteKey}/files`,
            name: folder, nodeType: 'jnt:folder', locale: 'en'
        });
    } catch {} // already there

    const ticketRes = unwrapMcpResult(await call('media.upload.create', {
        siteKey: input.siteKey, folder,
        fileName: att.name, mimeType, sizeBytes: bytes.length
    }));
    const uploadUrl = ticketRes.uploadUrl || ticketRes.url;
    const token = ticketRes.token;
    if (!uploadUrl || !token) return {error: `Unexpected media.upload.create reply: ${JSON.stringify(ticketRes)}`};

    const putUrl = new URL(uploadUrl, serverUrl(local)).toString();
    const putRes = await fetch(putUrl, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {'Content-Type': mimeType},
        body: bytes
    });
    if (!putRes.ok) return {error: `Upload PUT failed: HTTP ${putRes.status}`};

    const fin = unwrapMcpResult(await call('media.upload.finalize', {token}));
    const path = fin.path || fin.nodePath;
    if (!path) return {error: `Unexpected media.upload.finalize reply: ${JSON.stringify(fin)}`};
    return rewrap({uploaded: att.name, path, sizeBytes: bytes.length});
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

// Resolves to {tools, signInRequired: [server names]}
export function fetchMcpTools(servers, siteKey) {
    return fetchAllTools(servers, siteKey);
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

function buildSystemPrompt(servers, skills, mcpTools, siteKey, systemPromptAppendix) {
    const siteCtx = siteKey ? `\nThe user is currently working on site: **${siteKey}**. Use this as the default site for all operations unless told otherwise.\n` : '';

    const toolCatalog = mcpTools && mcpTools.length > 0
        ? '\n\n## MCP Tool Catalog\n\n```\n' +
          mcpTools.map(formatToolSignature).join('\n\n') +
          '\n```'
        : '';

    const serversText = servers.length > 0
        ? '\n\n## MCP servers\n\n' + servers.map(s => `- \`${s.name}\`: ${s.label}`).join('\n') +
          `\n\nEvery tool name is <server>${TOOL_SEPARATOR}<tool>: pass it exactly as listed in the catalog as the \`tool\` argument of \`mcp_call\` (e.g. \`${servers[0].name}${TOOL_SEPARATOR}site.list\`).`
        : '';

    const skillsText = skills.length > 0
        ? '\n\n## Loaded Skills\n\n' + skills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
        : '';

    return `You are a Jahia CMS assistant. You manage content, pages, and sites via the \`mcp_call\` tool.
${siteCtx}
## Tool-first rule (most important)
For ANY request that involves the Jahia site — listing content, creating nodes, checking pages, reading configuration, anything — you MUST call \`mcp_call\` immediately. Do not answer from memory or training data. Do not describe what you are about to do. Call the tool first, then respond based on what it returns.

The only exception is a purely conversational message with no site action needed (e.g. "thanks", "what is a CND file?").

## Attachments
- Files the user attaches to their message arrive inline (Word documents are pre-converted to HTML — their headings/tables reflect the original structure).
- To place an attached image or binary file into the site's media library, call \`upload_attachment\` with its exact file name and the target siteKey. It returns the JCR path of the created file node — use that path as the value of image/file weakreference properties when creating content. Upload each image BEFORE creating the content that references it.

## Behavior
- Chain tool calls automatically — keep going until the task is fully done without waiting for the user.
- Before creating content, call \`content.type\` or \`page.templates\` to verify what types and templates exist on the current site. Never invent type names.
- Summarize results in plain language. Never paste raw JSON.
- For destructive operations (delete, unpublish all), ask once before executing.

## Page creation workflow (always follow this order)
1. Call \`page.templates\` to list available templates for the site. Pick the right one before proceeding.
2. Call \`page.create\` — it creates the page AND returns the full page structure: available content containers with their paths and content-type constraints. Use this structure to know exactly where and what to add next.
3. If you need to inspect the structure of an **existing** page (not a new one), call \`page.structure\` directly — it returns the same container map as \`page.create\`.
4. To discover all content types available on the current site, call \`site.types\`. Use this before adding content if you are unsure which type name to use.
${serversText}${toolCatalog}${skillsText}${systemPromptAppendix ? '\n\n## Client-specific instructions\n\n' + systemPromptAppendix : ''}`;
}

// The connector's agent offers the Jahia tools itself, under their own names: no mcp_call, no catalog
function buildGenAiInstructions(skills, siteKey, systemPromptAppendix) {
    const siteCtx = siteKey ? `The user is currently working on site: **${siteKey}**. Use it as the default site unless told otherwise.\n\n` : '';
    const skillsText = skills.length > 0
        ? '\n\n## Loaded Skills\n\n' + skills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
        : '';
    return `You are a Jahia CMS assistant. You manage content, pages and sites with the Jahia tools you are given.
${siteCtx}For any request about the site, call the tools first and answer from what they return; never answer from memory.
Chain tool calls until the task is done. Check content types and templates before creating content. Summarize results in plain language, never raw JSON.${skillsText}${systemPromptAppendix ? '\n\n## Client-specific instructions\n\n' + systemPromptAppendix : ''}`;
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
    const path = '/modules/jahia-mcp-chat/llm-proxy';

    while (!signal?.aborted) {
        const csrfHdrs = await getCsrfHeaders(path);
        const res = await fetch(LLM_PROXY(), {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-LLM-Provider': 'anthropic', ...csrfHdrs},
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

        if (!res.ok) {
            if (res.status === 302 || res.status === 403) invalidateTokens();
            throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
        }
        storeResponseToken(path, res);

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
    const path = '/modules/jahia-mcp-chat/llm-proxy';

    while (!signal?.aborted) {
        const csrfHdrs = await getCsrfHeaders(path);
        const res = await fetch(LLM_PROXY(), {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-LLM-Provider': provider, ...csrfHdrs},
            body: JSON.stringify({model, messages: currentMessages, tools, stream: true, max_tokens: maxTokens, stream_options: {include_usage: true}}),
            signal
        });

        if (!res.ok) {
            if (res.status === 302 || res.status === 403) invalidateTokens();
            throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
        }
        storeResponseToken(path, res);

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

function buildLlmContent(userText, attachments, useOpenAIFormat, supportsVision = true) {
    if (!attachments || attachments.length === 0) return userText || '';

    const blocks = [];
    if (userText) blocks.push({type: 'text', text: userText});

    for (const att of attachments) {
        const kb = Math.max(1, Math.round((att.size || 0) / 1024));
        if (att.kind === 'image') {
            // Vision block only for providers that accept images (DeepSeek
            // rejects the image_url content variant with a 400); every
            // provider gets the name note so upload_attachment stays usable.
            if (supportsVision) {
                if (useOpenAIFormat) {
                    blocks.push({type: 'image_url', image_url: {url: `data:${att.type};base64,${att.data}`}});
                } else {
                    blocks.push({type: 'image', source: {type: 'base64', media_type: att.type, data: att.data}});
                }
            }
            blocks.push({type: 'text', text: `\n[Image attached: "${att.name}" (${att.type}, ${kb} KB) — can be pushed to the site DAM with the upload_attachment tool]`});
        } else if (att.kind === 'text') {
            const ext = att.name.split('.').pop() || '';
            blocks.push({type: 'text', text: `\n\n--- File: ${att.name} ---\n\`\`\`${ext}\n${att.text}\n\`\`\`\n---`});
        } else {
            blocks.push({type: 'text', text: `\n\n[Attached file: "${att.name}" (${att.type}, ${kb} KB) — binary content not shown, but it can be pushed to the site DAM with the upload_attachment tool]`});
        }
    }

    if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text;
    return blocks;
}

export function useMcpChat(settings, mcpTools, siteKey, osgiConfig = {}) {
    const [messages, setMessages] = useState(loadHistory);
    const [isStreaming, setIsStreaming] = useState(false);
    const [pendingApproval, setPendingApproval] = useState(null);
    const abortRef = useRef(null);

    const sendMessage = useCallback(async (userText, attachments = []) => {
        const effectiveText = userText || '';
        if (!effectiveText.trim() && (!attachments || attachments.length === 0)) return;
        if (isStreaming) return;

        const userMsg = {
            role: 'user',
            content: effectiveText,
            attachments: attachments?.length > 0
                ? attachments.map(({name, type, size, kind}) => ({name, type, size, kind}))
                : undefined
        };
        const history = [...messages, userMsg];
        setMessages(history);
        setIsStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        // Resolve effective values: user preference overrides OSGi default
        const servers       = osgiConfig.mcpServers || [];
        const provider      = (settings.llmProvider && osgiConfig.availableProviders?.includes(settings.llmProvider))
                                ? settings.llmProvider
                                : osgiConfig.defaultProvider || 'anthropic';
        const model         = settings.selectedModel || osgiConfig.defaultModel || 'claude-sonnet-4-6';
        const maxTokens     = settings.maxTokens || osgiConfig.maxTokens || 4096;
        const useGenAi = provider === GENAI_PROVIDER;
        const useOpenAICompat = provider === 'openai' || provider === 'deepseek';

        const onToolUse = async (id, name, input) => {
            if (servers.length === 0) return {error: 'No MCP server is configured for this site'};
            try {
                if (name === 'mcp_call') {
                    return await callTool(servers, siteKey, input.tool, input.params);
                }
                if (name === 'upload_attachment') {
                    // executed locally: the browser holds the attachment bytes
                    return await uploadAttachment(servers, siteKey, input, attachments);
                }
            } catch (err) {
                return {error: err.message};
            }
            return {error: `Unknown tool: ${name}`};
        };

        const systemPrompt = buildSystemPrompt(servers, settings.skills || [], mcpTools, siteKey, osgiConfig.systemPromptAppendix || '');

        // Keep last 20 messages; truncate old text content to save tokens
        // For the last (current) user message, build multi-modal content with any attachments
        const trimmedHistory = history.slice(-20).map((m, i, arr) => {
            const isLast = i === arr.length - 1;
            if (isLast && m.role === 'user') {
                // Vision blocks only for providers/models that accept them:
                // DeepSeek's API 400s on image_url whatever provider slot it
                // is configured under ("unknown variant `image_url`").
                return {role: m.role, content: buildLlmContent(m.content, attachments, useOpenAICompat,
                    !useGenAi && provider !== 'deepseek' && !/deepseek/i.test(model))};
            }
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
            const stream = useGenAi
                ? runGenAiAgentLoop(trimmedHistory, buildGenAiInstructions(settings.skills || [], siteKey, osgiConfig.systemPromptAppendix || ''),
                    controller.signal, maxTokens, document.documentElement.lang || undefined)
                : useOpenAICompat
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
                } else if (event.type === 'approval_required') {
                    setPendingApproval({streamId: event.streamId, callId: event.callId, name: event.name, argumentsJson: event.argumentsJson});
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
        setPendingApproval(null);
        abortRef.current = null;
    }, [messages, isStreaming, settings, mcpTools, siteKey, osgiConfig]);

    const stopStreaming = useCallback(() => { abortRef.current?.abort(); }, []);
    const answerApproval = useCallback(async approve => {
        const p = pendingApproval;
        if (!p) return;
        setPendingApproval(null);
        await confirmToolCall(p.streamId, p.callId, approve);
    }, [pendingApproval]);
    const clearMessages = useCallback(() => {
        setMessages([]);
        localStorage.removeItem(HISTORY_KEY);
    }, []);

    return {messages, isStreaming, sendMessage, stopStreaming, clearMessages, pendingApproval, answerApproval};
}
