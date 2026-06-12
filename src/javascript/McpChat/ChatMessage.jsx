import React from 'react';
import styles from './McpChat.module.css';

function ToolCallBlock({toolCall}) {
    const hasResult = toolCall.result !== undefined;
    return (
        <div className={styles.toolCall}>
            <div className={styles.toolCallHeader}>
                <span className={styles.toolCallIcon}>⚙</span>
                <span className={styles.toolCallName}>{toolCall.name}</span>
                {hasResult
                    ? <span className={styles.toolCallDone}>done</span>
                    : <span className={styles.toolCallRunning}>running...</span>
                }
            </div>
            {toolCall.input && (
                <pre className={styles.toolCallCode}>
                    {JSON.stringify(toolCall.input, null, 2)}
                </pre>
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
        <div className={`${styles.message} ${isUser ? styles.messageUser : styles.messageAssistant}`}>
            {!isUser && (
                <div className={styles.messageAvatar}>J</div>
            )}
            <div className={styles.messageBubble}>
                {message.content && (
                    <div className={styles.messageText}>
                        {message.content}
                        {message.streaming && <span className={styles.cursor} />}
                    </div>
                )}
                {isEmpty && message.streaming && (
                    <div className={styles.typingDots}>
                        <span /><span /><span />
                    </div>
                )}
                {message.toolCalls?.map((tc, i) => (
                    <ToolCallBlock key={i} toolCall={tc} />
                ))}
            </div>
        </div>
    );
}
