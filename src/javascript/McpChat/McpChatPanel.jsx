import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useMcpChat} from './useMcpChat';
import {useSettings} from './useSettings';
import {ChatMessage} from './ChatMessage';
import {ModelSelector} from './ModelSelector';
import {McpSettings} from './McpSettings';
import styles from './McpChat.module.css';

export function McpChatPanel() {
    const {t} = useTranslation('jahia-mcp-chat');
    const {settings, updateSettings, addSkill, removeSkill} = useSettings();
    const {messages, isStreaming, sendMessage, stopStreaming, clearMessages} = useMcpChat(settings);
    const [input, setInput] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages]);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;
        setInput('');
        sendMessage(text);
    };

    const handleKeyDown = e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const needsConfig = !settings.llmApiKey;

    return (
        <div className={styles.panel}>
            <header className={styles.header}>
                <div className={styles.headerTitle}>
                    <span className={styles.headerIcon} aria-hidden="true">💬</span>
                    <span>{t('panel.title')}</span>
                </div>
                <div className={styles.headerActions}>
                    {messages.length > 0 && (
                        <button
                            className={styles.iconButton}
                            onClick={clearMessages}
                            title={t('panel.clear')}
                            aria-label={t('panel.clear')}
                        >
                            ↺
                        </button>
                    )}
                    <button
                        className={`${styles.iconButton} ${showSettings ? styles.iconButtonActive : ''}`}
                        onClick={() => setShowSettings(s => !s)}
                        title={t('settings.title')}
                        aria-label={t('settings.title')}
                        aria-expanded={showSettings}
                    >
                        ⚙
                    </button>
                </div>
            </header>

            <div className={styles.modelBar}>
                <ModelSelector
                    provider={settings.llmProvider}
                    selectedModel={settings.selectedModel}
                    onProviderChange={p => {
                        const defaultModel = p === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6';
                        updateSettings({llmProvider: p, selectedModel: defaultModel});
                    }}
                    onModelChange={m => updateSettings({selectedModel: m})}
                />
            </div>

            {showSettings && (
                <McpSettings
                    settings={settings}
                    onUpdate={updateSettings}
                    onAddSkill={addSkill}
                    onRemoveSkill={removeSkill}
                    onClose={() => setShowSettings(false)}
                />
            )}

            <div className={styles.messages} role="log" aria-live="polite" aria-label={t('panel.messages')}>
                {messages.length === 0 && (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon} aria-hidden="true">🤖</div>
                        <p className={styles.emptyText}>{t('panel.empty')}</p>
                        {needsConfig && (
                            <p className={styles.emptyHint}>
                                {t('panel.configHint')}
                                <button
                                    className={styles.linkButton}
                                    onClick={() => setShowSettings(true)}
                                >
                                    {t('panel.configLink')}
                                </button>
                            </p>
                        )}
                    </div>
                )}
                {messages.map((msg, i) => (
                    <ChatMessage key={i} message={msg} />
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className={styles.inputArea}>
                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('input.placeholder')}
                    disabled={isStreaming}
                    rows={3}
                    aria-label={t('input.placeholder')}
                />
                <button
                    className={`${styles.sendButton} ${isStreaming ? styles.sendButtonStop : ''}`}
                    onClick={isStreaming ? stopStreaming : handleSend}
                    disabled={!isStreaming && !input.trim()}
                    aria-label={isStreaming ? t('input.stop') : t('input.send')}
                    title={isStreaming ? t('input.stop') : t('input.send')}
                >
                    {isStreaming ? '■' : '▶'}
                </button>
            </div>
        </div>
    );
}
