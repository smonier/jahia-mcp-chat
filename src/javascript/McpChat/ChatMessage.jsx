import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button, Chip, ChevronDown, ChevronUp, File, Image, Loader, Typography} from '@jahia/moonstone';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatMessage.module.css';

const PREVIEW = 160;

function summarizeInput(input) {
    if (!input || Object.keys(input).length === 0) return '';
    return Object.entries(input).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
}

// Tool results arrive as the connector's JSON preview (a string), or {error}
function resultText(result) {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    if (result.error) return String(result.error);
    return JSON.stringify(result);
}

function prettify(text) {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

function ToolCallBlock({toolCall}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const [expanded, setExpanded] = useState(false);
    const done = toolCall.result !== undefined;
    const failed = done && Boolean(toolCall.result?.error);
    const text = resultText(toolCall.result);
    const args = summarizeInput(toolCall.input);

    return (
        <div className={styles.toolCall}>
            <div className={styles.toolCallHeader}>
                <Typography variant="caption" weight="semiBold" className={styles.toolCallName}>{toolCall.name}</Typography>
                {done
                    ? <Chip color={failed ? 'danger' : 'success'} label={t(failed ? 'tool.failed' : 'tool.done')}/>
                    : <span className={styles.running}><Loader size="small"/></span>}
                {text && (
                    <Button variant="ghost"
                            size="small"
                            icon={expanded ? <ChevronUp/> : <ChevronDown/>}
                            aria-expanded={expanded}
                            aria-label={t('tool.details')}
                            title={t('tool.details')}
                            onClick={() => setExpanded(e => !e)}/>
                )}
            </div>
            {args && <Typography variant="caption" className={styles.toolCallArgs}>{args}</Typography>}
            {text && !expanded && (
                <Typography variant="caption" className={failed ? styles.toolCallError : styles.toolCallSummary}>
                    {text.length > PREVIEW ? `${text.slice(0, PREVIEW)}...` : text}
                </Typography>
            )}
            {expanded && <pre className={styles.toolCallDetail}>{prettify(text)}</pre>}
        </div>
    );
}

// Answers are model output: Markdown rendered as React elements, raw HTML ignored (react-markdown's default),
// unsafe link protocols dropped by its URL transform, links opened in a new tab
const MARKDOWN_COMPONENTS = {
    a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer"/>
};

function Markdown({text}) {
    return (
        <div className={styles.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>
        </div>
    );
}

function TokenBadge({usage}) {
    const {t} = useTranslation('jahia-mcp-chat');
    if (!usage) return null;
    const total = (usage.input || 0) + (usage.output || 0);
    const fmt = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
    return (
        <Typography variant="caption" className={styles.tokens}
                    title={t('tokens.detail', {input: usage.input, output: usage.output})}>
            {t('tokens.summary', {input: fmt(usage.input), output: fmt(usage.output), total: fmt(total)})}
        </Typography>
    );
}

export function ChatMessage({message}) {
    const isUser = message.role === 'user';
    const isEmpty = !message.content && !message.toolCalls?.length;

    return (
        <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
            <div className={styles.content}>
                {message.toolCalls?.map(tc => (
                    <ToolCallBlock key={tc.id || tc.name} toolCall={tc}/>
                ))}
                {message.content && (
                    <div className={styles.bubble}>
                        {isUser
                            ? <Typography className={styles.text}>{message.content}</Typography>
                            : <Markdown text={message.content}/>}
                    </div>
                )}
                {message.attachments?.length > 0 && (
                    <div className={styles.attachments}>
                        {message.attachments.map((att, i) => (
                            <span key={`${att.name}-${i}`} title={att.name}>
                                <Chip label={att.name} icon={att.kind === 'image' ? <Image/> : <File/>}/>
                            </span>
                        ))}
                    </div>
                )}
                {isEmpty && message.streaming && (
                    <div className={styles.bubble}><Loader size="small"/></div>
                )}
                {!message.streaming && <TokenBadge usage={message.usage}/>}
            </div>
        </div>
    );
}
