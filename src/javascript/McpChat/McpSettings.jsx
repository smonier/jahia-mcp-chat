import React from 'react';
import {useTranslation} from 'react-i18next';
import {SkillsManager} from './SkillsManager';
import styles from './McpChat.module.css';

export function McpSettings({settings, onUpdate, onAddSkill, onRemoveSkill, onClose}) {
    const {t} = useTranslation('jahia-mcp-chat');

    return (
        <div className={styles.settingsPanel} role="dialog" aria-label={t('settings.title')}>
            <div className={styles.settingsHeader}>
                <h3 className={styles.settingsTitle}>{t('settings.title')}</h3>
                <button className={styles.iconButton} onClick={onClose} aria-label={t('settings.close')}>×</button>
            </div>

            <div className={styles.settingsBody}>
                <section className={styles.settingsSection}>
                    <h4 className={styles.settingsSectionTitle}>{t('settings.mcp')}</h4>
                    <label className={styles.label}>
                        {t('settings.mcpEndpoint')}
                        <input
                            className={styles.input}
                            type="url"
                            value={settings.mcpEndpoint}
                            onChange={e => onUpdate({mcpEndpoint: e.target.value})}
                            placeholder="http://localhost:8080/modules/mcp"
                        />
                    </label>
                    <label className={styles.label}>
                        {t('settings.mcpToken')}
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

                <section className={styles.settingsSection}>
                    <h4 className={styles.settingsSectionTitle}>{t('settings.llm')}</h4>
                    <label className={styles.label}>
                        {t('settings.apiKey')}
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
