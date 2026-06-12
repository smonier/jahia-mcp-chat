import React from 'react';
import {useTranslation} from 'react-i18next';
import {SkillsManager} from './SkillsManager';
import styles from './McpSettings.module.css';

export function McpSettings({settings, onUpdate, onAddSkill, onRemoveSkill, onClose}) {
    const {t} = useTranslation('jahia-mcp-chat');

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
