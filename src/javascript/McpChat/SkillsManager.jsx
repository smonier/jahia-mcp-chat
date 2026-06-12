import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import styles from './McpChat.module.css';

export function SkillsManager({skills, onAdd, onRemove}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const [githubUrl, setGithubUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleFileUpload = e => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = ev => {
                onAdd({name: file.name, content: ev.target.result, source: 'upload'});
            };
            reader.readAsText(file);
        });
        e.target.value = '';
    };

    const handleGithubPull = async () => {
        if (!githubUrl.trim()) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(githubUrl.trim());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const content = await res.text();
            const name = githubUrl.split('/').pop() || 'skill.md';
            onAdd({name, content, source: 'github', url: githubUrl.trim()});
            setGithubUrl('');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.skillsManager}>
            <h4 className={styles.settingsSectionTitle}>{t('skills.title')}</h4>

            <div className={styles.skillsActions}>
                <label className={styles.uploadButton}>
                    {t('skills.upload')}
                    <input
                        type="file"
                        accept=".md,.txt"
                        multiple
                        onChange={handleFileUpload}
                        style={{display: 'none'}}
                        aria-label={t('skills.upload')}
                    />
                </label>

                <div className={styles.githubRow}>
                    <input
                        className={styles.input}
                        type="url"
                        value={githubUrl}
                        onChange={e => setGithubUrl(e.target.value)}
                        placeholder={t('skills.githubPlaceholder')}
                        aria-label={t('skills.githubLabel')}
                        onKeyDown={e => e.key === 'Enter' && handleGithubPull()}
                    />
                    <button
                        className={styles.buttonSecondary}
                        onClick={handleGithubPull}
                        disabled={loading || !githubUrl.trim()}
                        aria-label={t('skills.pull')}
                    >
                        {loading ? '...' : t('skills.pull')}
                    </button>
                </div>
                {error && <p className={styles.errorText}>{error}</p>}
            </div>

            {skills.length > 0 && (
                <div className={styles.skillChips}>
                    {skills.map(s => (
                        <div key={s.name} className={styles.skillChip}>
                            <span className={styles.skillChipName} title={s.url || s.name}>{s.name}</span>
                            <button
                                className={styles.skillChipRemove}
                                onClick={() => onRemove(s.name)}
                                aria-label={t('skills.remove', {name: s.name})}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
