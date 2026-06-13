import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {fetchMcpTools, useMcpChat} from './useMcpChat';
import {useSettings} from './useSettings';
import {useConfig} from './useConfig';
import {ChatMessage} from './ChatMessage';
import {McpSettings} from './McpSettings';
import styles from './McpChatDrawer.module.css';

export function McpChatDrawer({isOpen, onClose}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const {settings, updateSettings, addSkill, removeSkill} = useSettings();
    const {config, configLoaded} = useConfig();
    const siteKey = useSelector(state => state.site);
    const [mcpTools, setMcpTools] = useState([]);
    const [toolsLoading, setToolsLoading] = useState(false);
    const {messages, isStreaming, sendMessage, stopStreaming, clearMessages} = useMcpChat(settings, mcpTools, siteKey, config);
    const [input, setInput] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    const mcpEndpoint = config.mcpEndpoint;
    const loadTools = useCallback(async () => {
        if (!mcpEndpoint || !settings.mcpToken) return;
        setToolsLoading(true);
        const tools = await fetchMcpTools(mcpEndpoint, settings.mcpToken);
        setMcpTools(tools);
        setToolsLoading(false);
    }, [mcpEndpoint, settings.mcpToken]);

    // Fetch tool list whenever the drawer opens or MCP credentials change
    useEffect(() => {
        if (isOpen) loadTools();
    }, [isOpen, loadTools]);

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
        }
    }, [messages, isOpen]);

    useEffect(() => {
        if (isOpen && textareaRef.current) {
            setTimeout(() => textareaRef.current?.focus(), 200);
        }
    }, [isOpen]);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;
        setInput('');
        sendMessage(text);
        setShowSettings(false);
    };

    const handleKeyDown = e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleBackdropClick = e => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className={`${styles.backdrop} ${isOpen ? styles.backdropVisible : ''}`}
                onClick={handleBackdropClick}
                aria-hidden="true"
            />

            {/* Drawer */}
            <aside
                className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}
                role="complementary"
                aria-label={t('panel.title')}
                aria-hidden={!isOpen}
            >
                {/* Header */}
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        <span className={styles.headerIcon} aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
                                <circle cx="9" cy="10" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>
                            </svg>
                        </span>
                        <span className={styles.headerTitle}>{t('panel.title')}</span>
                        {toolsLoading && <span className={styles.toolsBadge}>…</span>}
                        {!toolsLoading && mcpTools.length > 0 && (
                            <span className={styles.toolsBadge} title={mcpTools.map(t => t.name).join(', ')}>
                                {mcpTools.length} tools
                            </span>
                        )}
                    </div>
                    <div className={styles.headerRight}>
                        {messages.length > 0 && (
                            <button
                                className={styles.iconBtn}
                                onClick={clearMessages}
                                title={t('panel.clear')}
                                aria-label={t('panel.clear')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                                </svg>
                            </button>
                        )}
                        <button
                            className={`${styles.iconBtn} ${showSettings ? styles.iconBtnActive : ''}`}
                            onClick={() => setShowSettings(s => !s)}
                            title={t('settings.title')}
                            aria-label={t('settings.title')}
                            aria-expanded={showSettings}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96a7.05 7.05 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.477.477 0 00-.59.22L2.74 8.87a.47.47 0 00.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 00-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                            </svg>
                        </button>
                        <button
                            className={styles.iconBtn}
                            onClick={onClose}
                            title={t('panel.close')}
                            aria-label={t('panel.close')}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                            </svg>
                        </button>
                    </div>
                </header>

                {/* Settings panel (collapsible) */}
                {showSettings && (
                    <McpSettings
                        settings={settings}
                        config={config}
                        onUpdate={updateSettings}
                        onAddSkill={addSkill}
                        onRemoveSkill={removeSkill}
                        onClose={() => setShowSettings(false)}
                    />
                )}

                {/* Messages */}
                <div className={styles.messages} role="log" aria-live="polite" aria-label={t('panel.messages')}>
                    {messages.length === 0 && !showSettings && (
                        <div className={styles.emptyState}>
                            <div className={styles.emptyIcon} aria-hidden="true">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
                                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
                                    <circle cx="9" cy="10" r="1"/><circle cx="12" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>
                                </svg>
                            </div>
                            <p className={styles.emptyTitle}>{t('panel.empty')}</p>
                            {!settings.llmApiKey && (
                                <p className={styles.emptyHint}>
                                    {t('panel.configHint')}
                                    {' '}
                                    <button className={styles.linkBtn} onClick={() => setShowSettings(true)}>
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

                {/* Input */}
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
                        aria-label={t('input.label')}
                    />
                    <button
                        className={`${styles.sendBtn} ${isStreaming ? styles.sendBtnStop : ''}`}
                        onClick={isStreaming ? stopStreaming : handleSend}
                        disabled={!isStreaming && !input.trim()}
                        aria-label={isStreaming ? t('input.stop') : t('input.send')}
                        title={isStreaming ? t('input.stop') : t('input.send')}
                    >
                        {isStreaming
                            ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
                            : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                        }
                    </button>
                </div>
            </aside>
        </>
    );
}
