import React, {useState} from 'react';
import styles from './ChatMessage.module.css';

function summarizeInput(name, input) {
    if (!input || Object.keys(input).length === 0) return null;
    if (name === 'mcp_call') {
        const params = input.params && Object.keys(input.params).length > 0
            ? ' ' + Object.entries(input.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
            : '';
        return `${input.tool || '?'}${params}`;
    }
    return Object.entries(input).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') || null;
}

function summarizeResult(name, result) {
    if (!result) return null;
    if (result.error) return `Error: ${result.error}`;

    // tools_list
    if (result.tools && Array.isArray(result.tools)) {
        return `${result.tools.length} tools available: ${result.tools.map(t => t.name).join(', ')}`;
    }

    // site.list
    const text = extractText(result);
    if (text) {
        try {
            const parsed = JSON.parse(text);
            if (parsed.sites) return `${parsed.count || parsed.sites.length} sites: ${parsed.sites.map(s => s.siteKey).join(', ')}`;
            if (parsed.definitions) return `${parsed.definitions.length} content types found`;
            if (parsed.nodes) return `${parsed.nodes.length} nodes found`;
            if (parsed.node) return `Node: ${parsed.node.path || parsed.node.name || 'ok'}`;
            if (parsed.count !== undefined) return `${parsed.count} results`;
            if (typeof parsed === 'object') {
                const keys = Object.keys(parsed);
                if (keys.length <= 3) return keys.map(k => `${k}: ${JSON.stringify(parsed[k])}`).join(', ');
            }
        } catch {}
        return text.length > 120 ? text.slice(0, 120) + '…' : text;
    }

    if (typeof result === 'object') {
        const keys = Object.keys(result);
        if (keys.length === 0) return 'Done';
        if (keys.length <= 3) return keys.map(k => `${k}: ${JSON.stringify(result[k])}`).join(', ');
        return `${keys.length} fields returned`;
    }
    return String(result).slice(0, 120);
}

function extractText(result) {
    if (typeof result === 'string') return result;
    if (result?.content) {
        const items = Array.isArray(result.content) ? result.content : [result.content];
        const texts = items.filter(c => c?.type === 'text' || typeof c === 'string').map(c => c?.text || c);
        if (texts.length) return texts.join('\n');
    }
    return null;
}

function ToolCallBlock({toolCall}) {
    const [expanded, setExpanded] = useState(false);
    const hasResult = toolCall.result !== undefined;
    const inputSummary = summarizeInput(toolCall.name, toolCall.input);
    const resultSummary = hasResult ? summarizeResult(toolCall.name, toolCall.result) : null;
    const hasDetail = toolCall.result && !toolCall.result?.error;

    return (
        <div className={styles.toolCall}>
            <button
                className={styles.toolCallHeader}
                onClick={() => hasDetail && setExpanded(e => !e)}
                aria-expanded={expanded}
                disabled={!hasDetail}
                style={{cursor: hasDetail ? 'pointer' : 'default'}}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="currentColor" className={styles.toolCallIcon} aria-hidden="true">
                    <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
                </svg>
                <span className={styles.toolCallName}>
                    {toolCall.name === 'mcp_call' ? (toolCall.input?.tool || 'mcp_call') : toolCall.name}
                </span>
                {inputSummary && toolCall.name !== 'mcp_call' && (
                    <span className={styles.toolCallArgs}>{inputSummary}</span>
                )}
                {hasResult
                    ? <span className={`${styles.toolCallStatus} ${styles.done}`}>
                        {toolCall.result?.error ? '✗' : '✓'}
                    </span>
                    : <span className={`${styles.toolCallStatus} ${styles.running}`}>
                        <span className={styles.spinner} aria-hidden="true" />
                    </span>
                }
                {hasDetail && (
                    <span className={styles.toolCallChevron} aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                )}
            </button>
            {resultSummary && (
                <div className={`${styles.toolCallSummary} ${toolCall.result?.error ? styles.toolCallError : ''}`}>
                    {resultSummary}
                </div>
            )}
            {expanded && hasDetail && (
                <pre className={styles.toolCallDetail}>
                    {JSON.stringify(toolCall.result, null, 2)}
                </pre>
            )}
        </div>
    );
}

function MessageText({text, streaming}) {
    return (
        <div className={styles.bubble}>
            {text}
            {streaming && <span className={styles.cursor} aria-hidden="true" />}
        </div>
    );
}

function TokenBadge({usage}) {
    if (!usage) return null;
    const total = (usage.input || 0) + (usage.output || 0);
    const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    return (
        <div className={styles.tokenBadge} title={`${usage.input} input + ${usage.output} output tokens`}>
            <span className={styles.tokenIcon} aria-hidden="true">◈</span>
            {fmt(usage.input)}↑ {fmt(usage.output)}↓
            <span className={styles.tokenTotal}> {fmt(total)}</span>
        </div>
    );
}

export function ChatMessage({message}) {
    const isUser = message.role === 'user';
    const isEmpty = !message.content && !message.toolCalls?.length;

    return (
        <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
            {!isUser && (
                <div className={styles.avatar} aria-hidden="true">J</div>
            )}
            <div className={styles.content}>
                {message.toolCalls?.map((tc, i) => (
                    <ToolCallBlock key={i} toolCall={tc} />
                ))}
                {message.content && (
                    <MessageText text={message.content} streaming={message.streaming} />
                )}
                {message.attachments?.length > 0 && (
                    <div className={styles.attachmentChips}>
                        {message.attachments.map((att, i) => (
                            <span key={i} className={styles.attachmentChip} title={att.name}>
                                <span aria-hidden="true">{att.kind === 'image' ? '🖼' : '📄'}</span>
                                {att.name}
                            </span>
                        ))}
                    </div>
                )}
                {isEmpty && message.streaming && (
                    <div className={styles.bubble}>
                        <div className={styles.typingDots} aria-label="typing">
                            <span /><span /><span />
                        </div>
                    </div>
                )}
                {!message.streaming && message.usage && (
                    <TokenBadge usage={message.usage} />
                )}
            </div>
        </div>
    );
}
