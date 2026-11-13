import {useCallback, useRef, useState} from 'react';
import {availableTiers, confirmToolCall, IMAGE_TYPES, runAgent, storeAttachment} from './genaiAgent';

const HISTORY_KEY = 'jahia-mcp-chat:history';
const MAX_STORED_MESSAGES = 100;
const HISTORY_TURNS = 20;

function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        // Strip streaming flags left over from a close mid-stream
        return JSON.parse(raw).map(m => ({...m, streaming: false}));
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
                result: typeof tc.result === 'string' && tc.result.length > 2000 ? tc.result.slice(0, 2000) : tc.result
            }))
        }));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(toStore));
    } catch {}
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function buildInstructions(servers, skills, siteKey, appendix) {
    const site = siteKey ? `The user is working on site **${siteKey}**: use it as the default site unless told otherwise.\n\n` : '';
    const remote = servers.filter(s => !s.local);
    const services = remote.length > 0
        ? '\n\n## Connected services\n\n' + remote.map(s => `- ${s.label}: tools named \`${s.name}.<tool>\``).join('\n') +
          '\nIf a tool answers that the user is not signed in, tell them to click Connect next to that service in the chat settings.'
        : '';
    const skillsText = skills.length > 0
        ? '\n\n## Loaded Skills\n\n' + skills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
        : '';
    return `You are a helpful assistant inside Jahia, a CMS. You can manage content, pages and sites with the Jahia tools, and use the connected services through their tools.
${site}## When to use tools
- For anything about this Jahia site or a connected service, call the tools first and answer from what they return, never from memory. Do not describe what you are about to do; call the tool.
- For everything else (general knowledge, writing, translation, explanations, code), answer directly without tools.

## Behavior
- Chain tool calls until the task is done.
- Before creating content, check the content types and templates the site offers; never invent type names. To create a page, list the templates, create the page, then use the structure it returns to place content.
- A file the user attached comes with an attachment id: to put it in the media library, call \`chat.upload_attachment\` with that id and the site key, and use the returned path in image or file fields. Upload each image before creating the content that uses it.
- Summarize results in plain language, never raw JSON. Ask once before deleting or unpublishing.${services}${skillsText}${appendix ? '\n\n## Client-specific instructions\n\n' + appendix : ''}`;
}

// Text of the message with its attachments: text files inline, images also sent as images, and every image or
// binary file kept for chat.upload_attachment
async function prepareAttachments(text, attachments) {
    const notes = [];
    const images = [];
    for (const att of attachments || []) {
        const kb = Math.max(1, Math.round((att.size || 0) / 1024));
        if (att.kind === 'text') {
            const ext = att.name.split('.').pop() || '';
            notes.push(`--- File: ${att.name} ---\n\`\`\`${ext}\n${att.text}\n\`\`\`\n---`);
            continue;
        }
        if (att.kind === 'image' && IMAGE_TYPES.includes(att.type)) {
            images.push({mediaType: att.type, data: att.data});
        }
        let id = '';
        try {
            id = await storeAttachment(att, base64ToBytes(att.data));
        } catch {}
        notes.push(id
            ? `[Attached file "${att.name}" (${att.type}, ${kb} KB), attachmentId: ${id}]`
            : `[Attached file "${att.name}" (${att.type}, ${kb} KB): it could not be kept for upload]`);
    }
    return {input: [text, ...notes].filter(Boolean).join('\n\n'), images};
}

function historyTurns(messages) {
    return messages.slice(-HISTORY_TURNS).map((m, i, arr) => {
        let text = typeof m.content === 'string' ? m.content : '';
        if (m.attachments?.length) {
            text += '\n' + m.attachments.map(a => `[Attached file "${a.name}"]`).join(' ');
        }
        const recent = i >= arr.length - 4;
        if (!recent && text.length > 400) text = text.slice(0, 400) + ' [truncated]';
        return {role: m.role, text};
    }).filter(t => t.text.trim());
}

export function resolveTier(settings, config, genai) {
    const tiers = availableTiers(genai);
    if (settings.tier && tiers.includes(settings.tier)) return settings.tier;
    if (config.defaultTier && tiers.includes(config.defaultTier)) return config.defaultTier;
    return tiers[0] || '';
}

export function useMcpChat(settings, siteKey, config = {}, genai = null) {
    const [messages, setMessages] = useState(loadHistory);
    const [isStreaming, setIsStreaming] = useState(false);
    const [pendingApproval, setPendingApproval] = useState(null);
    const abortRef = useRef(null);

    const sendMessage = useCallback(async (userText, attachments = []) => {
        const text = userText || '';
        if (!text.trim() && (!attachments || attachments.length === 0)) return;
        if (isStreaming) return;

        const userMsg = {
            role: 'user',
            content: text,
            attachments: attachments?.length > 0
                ? attachments.map(({name, type, size, kind}) => ({name, type, size, kind}))
                : undefined
        };
        const previous = messages;
        setMessages([...previous, userMsg, {role: 'assistant', content: '', streaming: true}]);
        setIsStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        const tier = resolveTier(settings, config, genai);
        const ceiling = config.maxTokens || 0;
        const asked = settings.maxTokens || 0;
        const maxTokens = ceiling && asked ? Math.min(ceiling, asked) : (asked || ceiling || undefined);
        const blocked = new Set(config.blockedTools || []);
        const allowedTools = blocked.size > 0 && genai?.tools
            ? genai.tools.map(t => t.name).filter(n => !blocked.has(n))
            : undefined;

        let assistantText = '';
        const toolCalls = [];
        let usageInput = 0;
        let usageOutput = 0;

        try {
            if (!tier) throw new Error('genai-connector has no model tier able to run the agent.');
            const {input, images} = await prepareAttachments(text, attachments);
            const stream = runAgent({
                input,
                images,
                history: historyTurns(previous),
                tier,
                instructions: buildInstructions(config.mcpServers || [], settings.skills || [], siteKey, config.systemPromptAppendix || ''),
                maxTokens,
                locale: (document.documentElement.lang || '').replace('_', '-') || undefined,
                allowedTools,
                signal: controller.signal
            });

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
    }, [messages, isStreaming, settings, siteKey, config, genai]);

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
