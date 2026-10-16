import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {SkillsManager} from './SkillsManager';
import {signIn, signOut, TOOL_SEPARATOR} from './mcpClient';
import {GENAI_PROVIDER} from './genaiAgent';
import styles from './McpSettings.module.css';

const MODELS_BY_PROVIDER = {
    anthropic: [
        {id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6'},
        {id: 'claude-opus-4-8',   label: 'Claude Opus 4.8'},
        {id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5'}
    ],
    openai: [
        {id: 'gpt-4o',      label: 'GPT-4o'},
        {id: 'gpt-4o-mini', label: 'GPT-4o Mini'},
        {id: 'o1',          label: 'o1'},
        {id: 'o3-mini',     label: 'o3-mini'}
    ],
    deepseek: [
        {id: 'deepseek-v4-flash',  label: 'DeepSeek V4 Flash'},
        {id: 'deepseek-chat',      label: 'DeepSeek Chat (V3)'},
        {id: 'deepseek-reasoner',  label: 'DeepSeek Reasoner (R1)'}
    ]
};

const PROVIDER_LABELS = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    [GENAI_PROVIDER]: 'Jahia GenAI'
};

function serverStatus(server, toolCount, toolsLoading, needsSignIn) {
    if (toolsLoading) return 'checking';
    if (needsSignIn) return 'signInRequired';
    return toolCount > 0 ? 'connected' : 'unavailable';
}

function McpServers({servers, siteKey, mcpTools, toolsLoading, signInRequired, onServersChanged}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const connect = async server => {
        setBusy(server.name);
        setError('');
        const result = await signIn(server, siteKey);
        setBusy('');
        if (!result.ok && result.error) setError(result.error);
        onServersChanged?.();
    };

    const disconnect = async server => {
        setBusy(server.name);
        setError('');
        await signOut(server);
        setBusy('');
        onServersChanged?.();
    };

    return (
        <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('settings.mcpServers')}</h4>
            {servers.length === 0 && <p className={styles.noProviders}>{t('settings.noMcpServers')}</p>}
            <ul className={styles.serverList}>
                {servers.map(server => {
                    const toolCount = mcpTools.filter(tool => tool.name.startsWith(server.name + TOOL_SEPARATOR)).length;
                    const status = serverStatus(server, toolCount, toolsLoading, signInRequired.includes(server.name));
                    return (
                        <li key={server.name} className={styles.serverRow}>
                            <span className={`${styles.statusDot} ${styles['status_' + status]}`} aria-hidden="true"/>
                            <span className={styles.serverText}>
                                <span className={styles.serverLabel}>{server.label}</span>
                                <span className={styles.serverMeta}>
                                    {t(`settings.status.${status}`)}
                                    {status === 'connected' && ` - ${t('settings.toolCount', {count: toolCount})}`}
                                    {server.local && ` - ${t('settings.thisJahia')}`}
                                </span>
                            </span>
                            {server.signIn && status === 'signInRequired' && (
                                <button type="button" className={styles.serverBtn} disabled={busy === server.name}
                                        onClick={() => connect(server)}>
                                    {t('settings.connect')}
                                </button>
                            )}
                            {server.signIn && server.signedIn && status !== 'signInRequired' && (
                                <button type="button" className={styles.serverBtnSecondary} disabled={busy === server.name}
                                        onClick={() => disconnect(server)}>
                                    {t('settings.disconnect')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
            {error && <p className={styles.serverError} role="alert">{error}</p>}
        </section>
    );
}

export function McpSettings({settings, config, onUpdate, onAddSkill, onRemoveSkill,
                                siteKey, mcpTools = [], toolsLoading, signInRequired = [], onServersChanged}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const availableProviders = config?.availableProviders || [];

    // Resolve effective provider: user pref if valid, else OSGi default, else first available
    const effectiveProvider = (settings.llmProvider && availableProviders.includes(settings.llmProvider))
        ? settings.llmProvider
        : (availableProviders.includes(config?.defaultProvider) ? config.defaultProvider : availableProviders[0]);

    const models = effectiveProvider === GENAI_PROVIDER
        ? [{id: '', label: [config?.genai?.provider, config?.genai?.model].filter(Boolean).join(' / ') || 'Jahia GenAI'}]
        : MODELS_BY_PROVIDER[effectiveProvider] || [];

    // Resolve effective model: user pref if in list, else OSGi default, else first in list
    const configuredModel = (settings.selectedModel && models.find(m => m.id === settings.selectedModel))
        ? settings.selectedModel
        : (config?.defaultModel || models[0]?.id || '');
    const effectiveModel = effectiveProvider === GENAI_PROVIDER ? '' : configuredModel;

    const effectiveMaxTokens = settings.maxTokens || config?.maxTokens || 4096;

    const handleProviderChange = e => {
        const provider = e.target.value;
        const defaultModel = MODELS_BY_PROVIDER[provider]?.[0]?.id || '';
        onUpdate({llmProvider: provider, selectedModel: defaultModel});
    };

    return (
        <div className={styles.panel}>
            <div className={styles.body}>
                {/* LLM preferences — only providers with OSGi-configured keys */}
                <section className={styles.section}>
                    <h4 className={styles.sectionTitle}>{t('settings.llm')}</h4>

                    {availableProviders.length === 0 ? (
                        <p className={styles.noProviders}>{t('settings.noProviders')}</p>
                    ) : (
                        <>
                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{t('settings.provider')}</span>
                                <select
                                    className={styles.select}
                                    value={effectiveProvider}
                                    onChange={handleProviderChange}
                                >
                                    {availableProviders.map(p => (
                                        <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                                    ))}
                                </select>
                            </label>
                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{t('settings.model')}</span>
                                <select
                                    className={styles.select}
                                    value={effectiveModel}
                                    onChange={e => onUpdate({selectedModel: e.target.value})}
                                >
                                    {models.map(m => (
                                        <option key={m.id} value={m.id}>{m.label}</option>
                                    ))}
                                </select>
                            </label>
                            {effectiveProvider === GENAI_PROVIDER && (
                                <p className={styles.noProviders}>{t('settings.genaiNote')}</p>
                            )}
                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>{t('settings.maxTokens')}</span>
                                <input
                                    className={styles.input}
                                    type="number"
                                    min="256"
                                    max="32000"
                                    step="256"
                                    value={effectiveMaxTokens}
                                    onChange={e => onUpdate({maxTokens: parseInt(e.target.value, 10) || 0})}
                                />
                            </label>
                        </>
                    )}
                </section>

                <McpServers
                    servers={config?.mcpServers || []}
                    siteKey={siteKey}
                    mcpTools={mcpTools}
                    toolsLoading={toolsLoading}
                    signInRequired={signInRequired}
                    onServersChanged={onServersChanged}
                />

                <SkillsManager
                    skills={settings.skills || []}
                    onAdd={onAddSkill}
                    onRemove={onRemoveSkill}
                />
            </div>
        </div>
    );
}
