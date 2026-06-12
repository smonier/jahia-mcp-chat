import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import styles from './SkillsManager.module.css';

export function SkillsManager({skills, onAdd, onRemove}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const [githubUrl, setGithubUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleFileUpload = e => {
        Array.from(e.target.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = ev => onAdd({name: file.name, content: ev.target.result, source: 'upload'});
            reader.readAsText(file);
        });
        e.target.value = '';
    };

    const handlePull = async () => {
        if (!githubUrl.trim()) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(githubUrl.trim());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const content = await res.text();
            onAdd({name: githubUrl.split('/').pop() || 'skill.md', content, source: 'github', url: githubUrl.trim()});
            setGithubUrl('');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.root}>
            <h4 className={styles.title}>{t('skills.title')}</h4>

            <div className={styles.actions}>
                <label className={styles.uploadBtn}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                        <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
                    </svg>
                    {t('skills.upload')}
                    <input type="file" accept=".md,.txt" multiple onChange={handleFileUpload} style={{display: 'none'}} />
                </label>

                <div className={styles.githubRow}>
                    <input
                        className={styles.input}
                        type="url"
                        value={githubUrl}
                        onChange={e => setGithubUrl(e.target.value)}
                        placeholder={t('skills.githubPlaceholder')}
                        onKeyDown={e => e.key === 'Enter' && handlePull()}
                    />
                    <button className={styles.pullBtn} onClick={handlePull} disabled={loading || !githubUrl.trim()}>
                        {loading ? '...' : t('skills.pull')}
                    </button>
                </div>
                {error && <p className={styles.error}>{error}</p>}
            </div>

            {skills.length > 0 && (
                <div className={styles.chips}>
                    {skills.map(s => (
                        <span key={s.name} className={styles.chip}>
                            <span className={styles.chipName} title={s.url || s.name}>{s.name}</span>
                            <button className={styles.chipRemove} onClick={() => onRemove(s.name)} aria-label={t('skills.remove', {name: s.name})}>×</button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
