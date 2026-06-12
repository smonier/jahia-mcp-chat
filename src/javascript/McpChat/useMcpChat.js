import {useState, useRef, useCallback} from 'react';

const MCP_TOOL_DEFINITIONS = [
    {
        name: 'mcp_call',
        description: 'Call a Jahia MCP server tool. Use this to interact with JCR content, manage pages, sites, and content nodes.',
        input_schema: {
            type: 'object',
            properties: {
                tool: {type: 'string', description: 'MCP tool name (e.g. content.list_definitions, page.create, site.get)'},
                params: {type: 'object', description: 'Tool parameters as a JSON object'}
            },
            required: ['tool']
        }
    }
];

async function callMcpTool(mcpEndpoint, mcpToken, toolName, params) {
    const res = await fetch(mcpEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(mcpToken ? {'Authorization': `APIToken ${mcpToken}`} : {})
        },
        body: JSON.stringify({tool: toolName, params: params || {}})
    });
    if (!res.ok) {
        throw new Error(`MCP error ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

function buildSystemPrompt(mcpEndpoint, skills) {
    const skillsText = skills.length > 0
        ? '\n\n## Loaded Skills\n\n' + skills.map(s => `### ${s.name}\n${s.content}`).join('\n\n')
        : '';

    return `You are a Jahia CMS assistant with direct access to the Jahia MCP server at ${mcpEndpoint}.

You can manage JCR content, pages, sites, and content types by calling the mcp_call tool.

Common MCP tools:
- content.list_definitions — list available content types
- content.get — retrieve a node by path
- content.create — create a new content node
- content.update — update node properties
- content.delete — delete a node
- page.create — create a new page
- site.get — get site information
- site.list — list all sites

Always confirm destructive operations with the user before executing them.${skillsText}`;
}

async function* streamAnthropic(apiKey, model, messages, systemPrompt, onToolUse) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'messages-2023-12-15'
        },
        body: JSON.stringify({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            tools: MCP_TOOL_DEFINITIONS,
            messages,
            stream: true
        })
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolUse = null;
    let inputBuffer = '';

    while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;

            try {
                const event = JSON.parse(data);
                if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                    currentToolUse = {id: event.content_block.id, name: event.content_block.name};
                    inputBuffer = '';
                } else if (event.type === 'content_block_delta') {
                    if (event.delta?.type === 'text_delta') {
                        yield {type: 'text', content: event.delta.text};
                    } else if (event.delta?.type === 'input_json_delta') {
                        inputBuffer += event.delta.partial_json;
                    }
                } else if (event.type === 'content_block_stop' && currentToolUse) {
                    let toolInput = {};
                    try { toolInput = JSON.parse(inputBuffer); } catch {}
                    yield {type: 'tool_start', name: currentToolUse.name, input: toolInput};
                    const result = await onToolUse(currentToolUse.id, currentToolUse.name, toolInput);
                    yield {type: 'tool_result', id: currentToolUse.id, result};
                    currentToolUse = null;
                    inputBuffer = '';
                }
            } catch {}
        }
    }
}

async function* streamOpenAI(apiKey, model, messages, systemPrompt, onToolUse) {
    const openAIMessages = [
        {role: 'system', content: systemPrompt},
        ...messages
    ];

    const tools = MCP_TOOL_DEFINITIONS.map(t => ({
        type: 'function',
        function: {name: t.name, description: t.description, parameters: t.input_schema}
    }));

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({model, messages: openAIMessages, tools, stream: true, max_tokens: 4096})
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCallBuffer = {};

    while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
                for (const id of Object.keys(toolCallBuffer)) {
                    const tc = toolCallBuffer[id];
                    let args = {};
                    try { args = JSON.parse(tc.arguments); } catch {}
                    yield {type: 'tool_start', name: tc.name, input: args};
                    const result = await onToolUse(id, tc.name, args);
                    yield {type: 'tool_result', id, result};
                }
                return;
            }

            try {
                const event = JSON.parse(data);
                const delta = event.choices?.[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    yield {type: 'text', content: delta.content};
                }
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (!toolCallBuffer[tc.index]) {
                            toolCallBuffer[tc.index] = {name: '', arguments: ''};
                        }
                        if (tc.function?.name) toolCallBuffer[tc.index].name += tc.function.name;
                        if (tc.function?.arguments) toolCallBuffer[tc.index].arguments += tc.function.arguments;
                    }
                }
            } catch {}
        }
    }
}

export function useMcpChat(settings) {
    const [messages, setMessages] = useState([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const abortRef = useRef(null);

    const sendMessage = useCallback(async userText => {
        if (!userText.trim() || isStreaming) return;

        const userMsg = {role: 'user', content: userText};
        const updatedMessages = [...messages, userMsg];
        setMessages(updatedMessages);
        setIsStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        const onToolUse = async (id, name, input) => {
            if (name === 'mcp_call' && settings.mcpEndpoint) {
                try {
                    return await callMcpTool(settings.mcpEndpoint, settings.mcpToken, input.tool, input.params);
                } catch (err) {
                    return {error: err.message};
                }
            }
            return {error: 'Unknown tool'};
        };

        const systemPrompt = buildSystemPrompt(settings.mcpEndpoint, settings.skills || []);
        const anthropicMessages = updatedMessages.map(m => ({role: m.role, content: m.content}));

        let assistantText = '';
        const toolCalls = [];

        setMessages(prev => [...prev, {role: 'assistant', content: '', streaming: true}]);

        try {
            const stream = settings.llmProvider === 'openai'
                ? streamOpenAI(settings.llmApiKey, settings.selectedModel, anthropicMessages, systemPrompt, onToolUse)
                : streamAnthropic(settings.llmApiKey, settings.selectedModel, anthropicMessages, systemPrompt, onToolUse);

            for await (const event of stream) {
                if (controller.signal.aborted) break;

                if (event.type === 'text') {
                    assistantText += event.content;
                    setMessages(prev => [
                        ...prev.slice(0, -1),
                        {role: 'assistant', content: assistantText, streaming: true}
                    ]);
                } else if (event.type === 'tool_start') {
                    toolCalls.push({name: event.name, input: event.input});
                    setMessages(prev => [
                        ...prev.slice(0, -1),
                        {
                            role: 'assistant',
                            content: assistantText,
                            streaming: true,
                            toolCalls: [...toolCalls]
                        }
                    ]);
                } else if (event.type === 'tool_result') {
                    const last = toolCalls[toolCalls.length - 1];
                    if (last) last.result = event.result;
                    setMessages(prev => [
                        ...prev.slice(0, -1),
                        {
                            role: 'assistant',
                            content: assistantText,
                            streaming: true,
                            toolCalls: [...toolCalls]
                        }
                    ]);
                }
            }
        } catch (err) {
            if (!controller.signal.aborted) {
                assistantText = `Error: ${err.message}`;
            }
        }

        setMessages(prev => [
            ...prev.slice(0, -1),
            {role: 'assistant', content: assistantText || '(stopped)', toolCalls: toolCalls.length > 0 ? toolCalls : undefined}
        ]);
        setIsStreaming(false);
        abortRef.current = null;
    }, [messages, isStreaming, settings]);

    const stopStreaming = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);

    return {messages, isStreaming, sendMessage, stopStreaming, clearMessages};
}
