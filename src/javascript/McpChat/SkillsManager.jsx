import React, {useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Banner, Button, Chip, Close, Input, Paper, Typography, Upload} from '@jahia/moonstone';
import styles from './SkillsManager.module.css';

export function SkillsManager({skills, onAdd, onRemove}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const [githubUrl, setGithubUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const fileRef = useRef(null);

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
        <Paper className={styles.card}>
            <Typography variant="subheading" weight="bold" component="h3">{t('skills.title')}</Typography>

            <div className={styles.row}>
                <input ref={fileRef} type="file" accept=".md,.txt" multiple className={styles.fileInput}
                       tabIndex={-1} aria-hidden="true" onChange={handleFileUpload}/>
                <Button variant="outlined" icon={<Upload/>} label={t('skills.upload')} onClick={() => fileRef.current?.click()}/>
            </div>

            <div className={styles.row}>
                <div className={styles.url}>
                    <Input value={githubUrl}
                           placeholder={t('skills.githubPlaceholder')}
                           aria-label={t('skills.githubPlaceholder')}
                           onChange={e => setGithubUrl(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handlePull()}/>
                </div>
                <Button label={loading ? '...' : t('skills.pull')}
                        isDisabled={loading || !githubUrl.trim()}
                        onClick={handlePull}/>
            </div>

            {error && (
                <div className={styles.banner}>
                    <Banner variant="danger" title={t('skills.pullFailed')}>
                        <Typography>{error}</Typography>
                    </Banner>
                </div>
            )}

            {skills.length > 0 && (
                <ul className={styles.chips}>
                    {skills.map(s => (
                        <li key={s.name} className={styles.skill}>
                            <span title={s.url || s.name}><Chip label={s.name}/></span>
                            <Button variant="ghost" size="small" icon={<Close/>}
                                    aria-label={t('skills.remove', {name: s.name})}
                                    onClick={() => onRemove(s.name)}/>
                        </li>
                    ))}
                </ul>
            )}
        </Paper>
    );
}
