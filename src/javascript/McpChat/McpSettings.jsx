import React from 'react';
import {useTranslation} from 'react-i18next';
import {SkillsManager} from './SkillsManager';
import styles from './McpSettings.module.css';

const ANTHROPIC_MODELS = [
    {id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6'},
    {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
    {id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5'}
];

const OPENAI_MODELS = [
    {id: 'gpt-4o', label: 'GPT-4o'},
    {id: 'gpt-4o-mini', label: 'GPT-4o Mini'},
    {id: 'o1', label: 'o1'},
    {id: 'o3-mini', label: 'o3-mini'}
];

const DEEPSEEK_MODELS = [
    {id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash'},
    {id: 'deepseek-chat', label: 'DeepSeek Chat (V3)'},
    {id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)'}
];

const MODEL_MAP = {
    anthropic: ANTHROPIC_MODELS,
    openai: OPENAI_MODELS,
    deepseek: DEEPSEEK_MODELS
};

const DEFAULT_MODEL = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    deepseek: 'deepseek-v4-flash'
};

export function McpSettings({settings, onUpdate, onAddSkill, onRemoveSkill}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const models = MODEL_MAP[settings.llmProvider] || ANTHROPIC_MODELS;

    const handleProviderChange = e => {
        const provider = e.target.value;
        onUpdate({llmProvider: provider, selectedModel: DEFAULT_MODEL[provider] || DEFAULT_MODEL.anthropic});
    };

    return (
        <div className={styles.panel}>
            <div className={styles.body}>
                <section className={styles.section}>
                    <h4 className={styles.sectionTitle}>{t('settings.mcp')}</h4>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('settings.mcpEndpoint')}</span>
                        <input
                            className={styles.input}
                            type="url"
                            value={settings.mcpEndpoint}
                            onChange={e => onUpdate({mcpEndpoint: e.target.value})}
                            placeholder="http://localhost:8080/modules/mcp"
                        />
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('settings.mcpToken')}</span>
                        <input
                            className={styles.input}
                            type="password"
                            value={settings.mcpToken}
                            onChange={e => onUpdate({mcpToken: e.target.value})}
                            placeholder={t('settings.mcpTokenPlaceholder')}
                            autoComplete="off"
                        />
                    </label>
                </section>

                <section className={styles.section}>
                    <h4 className={styles.sectionTitle}>{t('settings.llm')}</h4>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('settings.provider')}</span>
                        <select
                            className={styles.select}
                            value={settings.llmProvider}
                            onChange={handleProviderChange}
                        >
                            <option value="anthropic">Anthropic</option>
                            <option value="openai">OpenAI</option>
                            <option value="deepseek">DeepSeek</option>
                        </select>
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('settings.model')}</span>
                        <select
                            className={styles.select}
                            value={settings.selectedModel}
                            onChange={e => onUpdate({selectedModel: e.target.value})}
                        >
                            {models.map(m => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                        </select>
                    </label>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('settings.apiKey')}</span>
                        <input
                            className={styles.input}
                            type="password"
                            value={settings.llmApiKey}
                            onChange={e => onUpdate({llmApiKey: e.target.value})}
                            placeholder={t('settings.apiKeyPlaceholder')}
                            autoComplete="off"
                        />
                    </label>
                </section>

                <SkillsManager
                    skills={settings.skills || []}
                    onAdd={onAddSkill}
                    onRemove={onRemoveSkill}
                />
            </div>
        </div>
    );
}
