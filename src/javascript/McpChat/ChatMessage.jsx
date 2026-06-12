import React from 'react';
import styles from './ChatMessage.module.css';

function ToolCallBlock({toolCall}) {
    const hasResult = toolCall.result !== undefined;
    return (
        <div className={styles.toolCall}>
            <div className={styles.toolCallHeader}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" className={styles.toolCallIcon}>
                    <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
                </svg>
                <span className={styles.toolCallName}>{toolCall.name}</span>
                {hasResult
                    ? <span className={styles.toolCallStatus + ' ' + styles.done}>done</span>
                    : <span className={styles.toolCallStatus + ' ' + styles.running}>
                        <span className={styles.spinner} />running
                    </span>
                }
            </div>
            {toolCall.input && (
                <pre className={styles.toolCallCode}>{JSON.stringify(toolCall.input, null, 2)}</pre>
            )}
            {hasResult && (
                <pre className={styles.toolCallResult}>
                    {typeof toolCall.result === 'object'
                        ? JSON.stringify(toolCall.result, null, 2)
                        : String(toolCall.result)}
                </pre>
            )}
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
                {message.content && (
                    <div className={styles.bubble}>
                        {message.content}
                        {message.streaming && <span className={styles.cursor} aria-hidden="true" />}
                    </div>
                )}
                {isEmpty && message.streaming && (
                    <div className={styles.bubble}>
                        <div className={styles.typingDots} aria-label="typing">
                            <span /><span /><span />
                        </div>
                    </div>
                )}
                {message.toolCalls?.map((tc, i) => (
                    <ToolCallBlock key={i} toolCall={tc} />
                ))}
            </div>
        </div>
    );
}
