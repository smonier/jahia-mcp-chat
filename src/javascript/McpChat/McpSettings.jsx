import React, {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Banner, Button, Chip, Dropdown, Input, Paper, Typography} from '@jahia/moonstone';
import {SkillsManager} from './SkillsManager';
import {signIn, signOut} from './mcpClient';
import {availableTiers} from './genaiAgent';
import {resolveTier} from './useMcpChat';
import styles from './McpSettings.module.css';

const STATUS_COLOR = {checking: 'default', connected: 'success', signInRequired: 'warning', unavailable: 'danger'};

function serverStatus(server, toolCount, toolsLoading) {
    if (toolsLoading) return 'checking';
    if (server.signIn && !server.signedIn) return 'signInRequired';
    return toolCount > 0 ? 'connected' : 'unavailable';
}

function McpServers({servers, siteKey, mcpTools, toolsLoading, onServersChanged}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const remotePrefixes = servers.filter(s => !s.local).map(s => s.name + '.');

    // A remote server counts the tools the module registered for it; the Jahia server counts every other tool
    const countTools = server => (server.local
        ? mcpTools.filter(tool => !remotePrefixes.some(p => tool.name.startsWith(p))).length
        : (server.tools || []).length);

    const connect = async server => {
        setBusy(server.name);
        setError('');
        const result = await signIn(server, siteKey);
        setBusy('');
        if (!result.ok && result.error) setError(result.error === 'popupBlocked' ? t('settings.popupBlocked') : result.error);
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
        <Paper className={styles.card}>
            <Typography variant="subheading" weight="bold" component="h3">{t('settings.mcpServers')}</Typography>
            {servers.length === 0 && <Typography>{t('settings.noMcpServers')}</Typography>}
            <ul className={styles.serverList}>
                {servers.map(server => {
                    const toolCount = countTools(server);
                    const status = serverStatus(server, toolCount, toolsLoading);
                    const meta = [
                        status === 'connected' ? t('settings.toolCount', {count: toolCount}) : null,
                        server.local ? t('settings.thisJahia') : null
                    ].filter(Boolean).join(' - ');
                    return (
                        <li key={server.name} className={styles.serverRow}>
                            <div className={styles.serverText}>
                                <Typography weight="semiBold">{server.label}</Typography>
                                {meta && <Typography variant="caption" className={styles.muted}>{meta}</Typography>}
                            </div>
                            <Chip color={STATUS_COLOR[status]} label={t(`settings.status.${status}`)}/>
                            {server.signIn && !server.signedIn && (
                                <Button color="accent" label={t('settings.connect')} isDisabled={busy === server.name}
                                        onClick={() => connect(server)}/>
                            )}
                            {server.signIn && server.signedIn && (
                                <Button variant="outlined" label={t('settings.disconnect')} isDisabled={busy === server.name}
                                        onClick={() => disconnect(server)}/>
                            )}
                        </li>
                    );
                })}
            </ul>
            {error && (
                <div className={styles.banner}>
                    <Banner variant="danger" title={t('settings.signInFailed')}>
                        <Typography>{error}</Typography>
                    </Banner>
                </div>
            )}
        </Paper>
    );
}

export function McpSettings({settings, config, genai, onUpdate, onAddSkill, onRemoveSkill,
                                siteKey, mcpTools = [], toolsLoading, onServersChanged}) {
    const {t} = useTranslation('jahia-mcp-chat');
    const tiers = availableTiers(genai);
    const tier = resolveTier(settings, config || {}, genai);
    const ceiling = config?.maxTokens || 0;
    const tierData = tiers.map(id => {
        const info = genai?.tiers?.[id] || {};
        const model = [info.provider, info.model].filter(Boolean).join(' / ');
        return {label: t(`settings.tiers.${id}`) + (model ? ` - ${model}` : ''), value: id};
    });

    return (
        <div className={styles.panel}>
            <Paper className={styles.card}>
                <Typography variant="subheading" weight="bold" component="h3">{t('settings.llm')}</Typography>
                {!genai && <Typography>{t('panel.noConnector')}</Typography>}
                {genai && tiers.length === 0 && <Typography>{t('panel.noTier')}</Typography>}
                {tiers.length > 0 && (
                    <>
                        <div className={styles.field}>
                            <Typography variant="caption" weight="semiBold">{t('settings.tier')}</Typography>
                            <Dropdown data={tierData}
                                      value={tier}
                                      label={tierData.find(d => d.value === tier)?.label || ''}
                                      className={styles.dropdown}
                                      onChange={(e, item) => item?.value && onUpdate({tier: item.value})}/>
                        </div>
                        <div className={styles.field}>
                            <Typography variant="caption" weight="semiBold">{t('settings.maxTokens')}</Typography>
                            <Input value={settings.maxTokens ? String(settings.maxTokens) : ''}
                                   placeholder={ceiling ? t('settings.maxTokensCeiling', {count: ceiling}) : t('settings.maxTokensDefault')}
                                   aria-label={t('settings.maxTokens')}
                                   onChange={e => onUpdate({maxTokens: Math.max(parseInt(e.target.value, 10) || 0, 0)})}/>
                        </div>
                    </>
                )}
            </Paper>

            <McpServers servers={config?.mcpServers || []}
                        siteKey={siteKey}
                        mcpTools={mcpTools}
                        toolsLoading={toolsLoading}
                        onServersChanged={onServersChanged}/>

            <SkillsManager skills={settings.skills || []} onAdd={onAddSkill} onRemove={onRemoveSkill}/>
        </div>
    );
}
