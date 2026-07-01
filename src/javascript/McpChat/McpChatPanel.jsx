import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useMcpChat} from './useMcpChat';
import {useSettings} from './useSettings';
import {ChatMessage} from './ChatMessage';
import {ModelSelector} from './ModelSelector';
import {McpSettings} from './McpSettings';
import styles from './McpChat.module.css';

const TEXT_EXTENSIONS = /\.(md|txt|csv|json|xml|yaml|yml|ts|tsx|js|jsx|css|html|htm|sql|sh|py|java|c|cpp|h|rs|go|rb|php)$/i;

function readFile(file) {
    return new Promise(resolve => {
        const reader = new FileReader();
        const isImage = file.type.startsWith('image/');
        const isText = file.type.startsWith('text/') ||
            ['application/json', 'application/xml', 'application/javascript'].includes(file.type) ||
            TEXT_EXTENSIONS.test(file.name);

        if (isImage) {
            reader.onload = e => resolve({
                name: file.name, type: file.type, size: file.size, kind: 'image',
                data: e.target.result.split(',')[1]
            });
            reader.readAsDataURL(file);
        } else if (isText) {
            reader.onload = e => resolve({
                name: file.name, type: file.type || 'text/plain', size: file.size, kind: 'text',
                text: e.target.result
            });
            reader.readAsText(file);
        } else {
            reader.onload = e => resolve({
                name: file.name, type: file.type, size: file.size, kind: 'binary',
                data: e.target.result.split(',')[1]
            });
            reader.readAsDataURL(file);
        }
    });
}

export function McpChatPanel() {
    const {t} = useTranslation('jahia-mcp-chat');
    const {settings, updateSettings, addSkill, removeSkill} = useSettings();
    const {messages, isStreaming, sendMessage, stopStreaming, clearMessages} = useMcpChat(settings);
    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState([]);
    const [showSettings, setShowSettings] = useState(false);
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages]);

    const handleFileChange = async e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const read = await Promise.all(files.map(readFile));
        setAttachments(prev => [...prev, ...read]);
        e.target.value = '';
    };

    const removeAttachment = index => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text && attachments.length === 0) return;
        const toSend = attachments;
        setInput('');
        setAttachments([]);
        sendMessage(text, toSend);
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
                {attachments.length > 0 && (
                    <div className={styles.attachmentList}>
                        {attachments.map((att, i) => (
                            <div key={i} className={styles.attachmentChip}>
                                <span className={styles.attachmentIcon} aria-hidden="true">
                                    {att.kind === 'image' ? '🖼' : '📄'}
                                </span>
                                <span className={styles.attachmentName} title={att.name}>{att.name}</span>
                                <button
                                    className={styles.attachmentRemove}
                                    onClick={() => removeAttachment(i)}
                                    aria-label={t('input.removeAttachment', {name: att.name})}
                                    type="button"
                                >×</button>
                            </div>
                        ))}
                    </div>
                )}
                <div className={styles.inputRow}>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className={styles.fileInput}
                        onChange={handleFileChange}
                        aria-hidden="true"
                        tabIndex={-1}
                    />
                    <button
                        className={styles.uploadButton}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming}
                        title={t('input.attach')}
                        aria-label={t('input.attach')}
                        type="button"
                    >
                        📎
                    </button>
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
                        disabled={!isStreaming && !input.trim() && attachments.length === 0}
                        aria-label={isStreaming ? t('input.stop') : t('input.send')}
                        title={isStreaming ? t('input.stop') : t('input.send')}
                    >
                        {isStreaming ? '■' : '▶'}
                    </button>
                </div>
            </div>
        </div>
    );
}
