import React, {useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {ArrowUp, Banner, Button, Cancel, Chip, Close, Delete, File, Image, Tab, TabItem, Textarea, Typography, Upload} from '@jahia/moonstone';
import {resolveTier, useMcpChat} from './useMcpChat';
import {useSettings} from './useSettings';
import {useConfig} from './useConfig';
import {useDock} from './useDock';
import {ChatMessage} from './ChatMessage';
import {McpSettings} from './McpSettings';
import {readFile} from './fileAttachments';
import styles from './McpChatDrawer.module.css';

const TITLE_ID = 'jahia-mcp-chat-drawer-title';

export function McpChatDrawer({onClose}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const {settings, updateSettings, addSkill, removeSkill} = useSettings();
    const siteKey = useSelector(state => state.site);
    const {config, genai, configLoaded, reloadConfig} = useConfig(siteKey);
    const {messages, isStreaming, sendMessage, stopStreaming, clearMessages, pendingApproval, answerApproval} = useMcpChat(settings, siteKey, config, genai);
    const [input, setInput] = useState('');
    const [attachments, setAttachments] = useState([]);
    const [tab, setTab] = useState('chat');
    const drawerRef = useRef(null);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const dock = useDock(drawerRef);

    // The tools the agent may call on this site: every tool the connector offers, minus remote servers not
    // allowed here
    const blocked = new Set(config.blockedTools || []);
    const mcpTools = (genai?.tools || []).filter(tool => !blocked.has(tool.name));
    const tier = resolveTier(settings, config, genai);
    const ready = Boolean(genai) && Boolean(tier);
    const tierInfo = genai?.tiers?.[tier];

    // Take focus on open and give it back on close: a portal has no place in the page's focus order
    useEffect(() => {
        const previous = document.activeElement;
        drawerRef.current?.focus();
        return () => {
            if (typeof previous?.focus === 'function') previous.focus();
        };
    }, []);

    // Escape closes. The panel is not modal: focus moves freely between it and the page under edit.
    useEffect(() => {
        const node = drawerRef.current;
        if (!node) return undefined;
        const onKeyDown = e => {
            if (e.key === 'Escape' && !e.defaultPrevented) onClose();
        };
        node.addEventListener('keydown', onKeyDown);
        return () => node.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages, pendingApproval]);

    const handleFileChange = async e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const read = await Promise.all(files.map(readFile));
        setAttachments(prev => [...prev, ...read]);
        e.target.value = '';
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

    const subtitle = [
        tierInfo ? [t(`settings.tiers.${tier}`), tierInfo.model].filter(Boolean).join(' - ') : null,
        mcpTools.length > 0 ? t('settings.toolCount', {count: mcpTools.length}) : null
    ].filter(Boolean).join(' | ');

    return (
        // A non-modal <dialog> rendered open (showModal() would put it above Content Editor and jContent's
        // menus); useDock places it in jContent's content area, beside the page under edit.
        <dialog ref={drawerRef} open className={styles.drawer} aria-labelledby={TITLE_ID} tabIndex={-1}>
            <button type="button"
                    aria-label={t('panel.resize')}
                    title={t('panel.resize')}
                    className={styles.resize}
                    onPointerDown={dock.onPointerDown}
                    onKeyDown={dock.onKeyDown}/>
            <header className={styles.header}>
                <div className={styles.headerText}>
                    <Typography id={TITLE_ID} variant="heading" component="h2">{t('panel.title')}</Typography>
                    {subtitle && <Typography variant="caption" className={styles.subtitle}>{subtitle}</Typography>}
                </div>
                <div className={styles.headerActions}>
                    {messages.length > 0 && (
                        <Button variant="ghost" icon={<Delete/>} aria-label={t('panel.clear')} title={t('panel.clear')}
                                isDisabled={isStreaming} onClick={clearMessages}/>
                    )}
                    <Button variant="ghost" icon={<Close/>} aria-label={t('panel.close')} title={t('panel.close')} onClick={() => onClose()}/>
                </div>
            </header>

            <div className={styles.tabBar}>
                <Tab className={styles.tabs} role="tablist" aria-label={t('panel.title')}>
                    {['chat', 'settings'].map(id => (
                        <TabItem key={id}
                                 id={`jahia-mcp-chat-tab-${id}`}
                                 role="tab"
                                 aria-selected={tab === id}
                                 aria-controls={`jahia-mcp-chat-panel-${id}`}
                                 label={t(`panel.tabs.${id}`)}
                                 isSelected={tab === id}
                                 onClick={() => setTab(id)}/>
                    ))}
                </Tab>
            </div>

            <div id="jahia-mcp-chat-panel-settings" role="tabpanel" aria-labelledby="jahia-mcp-chat-tab-settings"
                 className={styles.settingsPanel} hidden={tab !== 'settings'}>
                <McpSettings settings={settings}
                             config={config}
                             genai={genai}
                             onUpdate={updateSettings}
                             onAddSkill={addSkill}
                             onRemoveSkill={removeSkill}
                             siteKey={siteKey}
                             mcpTools={mcpTools}
                             toolsLoading={!configLoaded}
                             onServersChanged={reloadConfig}/>
            </div>

            <div id="jahia-mcp-chat-panel-chat" role="tabpanel" aria-labelledby="jahia-mcp-chat-tab-chat"
                 className={styles.chatPanel} hidden={tab !== 'chat'}>
                <div className={styles.messages} role="log" aria-live="polite" aria-label={t('panel.messages')}>
                    {messages.length === 0 && (
                        <div className={styles.empty}>
                            <Typography>{t('panel.empty')}</Typography>
                            {configLoaded && !ready && (
                                <div className={styles.notice}>
                                    <Banner variant="warning" title={t('panel.notReady')}>
                                        <Typography>{t(genai ? 'panel.noTier' : 'panel.noConnector')}</Typography>
                                    </Banner>
                                </div>
                            )}
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <ChatMessage key={i} message={msg}/>
                    ))}
                    <div ref={messagesEndRef}/>
                </div>

                {pendingApproval && (
                    <div className={styles.approval} role="alertdialog" aria-label={t('approval.title')}>
                        <Banner variant="warning" title={t('approval.question', {tool: pendingApproval.name})}>
                            <div className={styles.approvalBody}>
                                {pendingApproval.argumentsJson && (
                                    <pre className={styles.approvalArgs}>{pendingApproval.argumentsJson}</pre>
                                )}
                                <div className={styles.approvalActions}>
                                    <Button variant="outlined" label={t('approval.deny')} onClick={() => answerApproval(false)}/>
                                    <Button color="accent" label={t('approval.approve')} onClick={() => answerApproval(true)}/>
                                </div>
                            </div>
                        </Banner>
                    </div>
                )}

                <div className={styles.inputArea}>
                    {attachments.length > 0 && (
                        <ul className={styles.attachmentList}>
                            {attachments.map((att, i) => (
                                <li key={`${att.name}-${i}`} className={styles.attachment}>
                                    <Chip label={att.name} icon={att.kind === 'image' ? <Image/> : <File/>}/>
                                    <Button variant="ghost" size="small" icon={<Close/>}
                                            aria-label={t('input.removeAttachment', {name: att.name})}
                                            onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}/>
                                </li>
                            ))}
                        </ul>
                    )}
                    <Textarea className={styles.textarea}
                              value={input}
                              placeholder={t('input.placeholder')}
                              aria-label={t('input.label')}
                              isDisabled={isStreaming}
                              rows={3}
                              onChange={e => setInput(e.target.value)}
                              onKeyDown={handleKeyDown}/>
                    <div className={styles.inputActions}>
                        <input ref={fileInputRef}
                               type="file"
                               multiple
                               className={styles.fileInput}
                               tabIndex={-1}
                               aria-hidden="true"
                               onChange={handleFileChange}/>
                        <Button variant="ghost"
                                icon={<Upload/>}
                                label={t('input.attach')}
                                isDisabled={isStreaming}
                                onClick={() => fileInputRef.current?.click()}/>
                        {isStreaming ? (
                            <Button color="danger" variant="outlined" icon={<Cancel/>} label={t('input.stop')} onClick={stopStreaming}/>
                        ) : (
                            <Button color="accent"
                                    icon={<ArrowUp/>}
                                    label={t('input.send')}
                                    isDisabled={!ready || (!input.trim() && attachments.length === 0)}
                                    onClick={handleSend}/>
                        )}
                    </div>
                </div>
            </div>
        </dialog>
    );
}
