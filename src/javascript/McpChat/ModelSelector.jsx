import React from 'react';
import {useTranslation} from 'react-i18next';
import styles from './McpChat.module.css';

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

export function ModelSelector({provider, selectedModel, onProviderChange, onModelChange}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const models = provider === 'openai' ? OPENAI_MODELS : ANTHROPIC_MODELS;

    return (
        <div className={styles.modelSelector}>
            <select
                className={styles.select}
                value={provider}
                onChange={e => onProviderChange(e.target.value)}
                aria-label={t('modelSelector.provider')}
            >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
            </select>
            <select
                className={styles.select}
                value={selectedModel}
                onChange={e => onModelChange(e.target.value)}
                aria-label={t('modelSelector.model')}
            >
                {models.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                ))}
            </select>
        </div>
    );
}
