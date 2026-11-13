import {useCallback, useState, useEffect} from 'react';
import {getCsrfHeaders, storeResponseToken, invalidateTokens} from './csrfToken';
import {fetchGenAiStatus} from './genaiAgent';

const ctx = () => window.contextJsParameters?.contextPath || '';
const CONFIG_PATH = '/modules/jahia-mcp-chat/config';

const EMPTY_CONFIG = {
    defaultTier: 'balanced',
    maxTokens: 0,
    mcpServers: [],
    blockedTools: [],
    systemPromptAppendix: ''
};

// The module's configuration for the site, and genai-connector's status (tiers, tools); null genai means the
// connector is not installed
export function useConfig(siteKey) {
    const [config, setConfig] = useState(EMPTY_CONFIG);
    const [genai, setGenai] = useState(null);
    const [configLoaded, setConfigLoaded] = useState(false);
    const [version, setVersion] = useState(0);
    const reloadConfig = useCallback(() => setVersion(v => v + 1), []);

    useEffect(() => {
        let cancelled = false;
        const loadConfig = async () => {
            const res = await fetch(`${ctx()}${CONFIG_PATH}?site=${encodeURIComponent(siteKey || '')}`, {
                credentials: 'same-origin', headers: await getCsrfHeaders(CONFIG_PATH)
            });
            if (!res.ok || res.redirected) {
                invalidateTokens();
                return null;
            }
            storeResponseToken(CONFIG_PATH, res);
            return res.json();
        };
        Promise.all([loadConfig().catch(() => null), fetchGenAiStatus()])
            .then(([data, status]) => {
                if (cancelled) return;
                if (data) setConfig({...EMPTY_CONFIG, ...data});
                setGenai(status);
            })
            .finally(() => !cancelled && setConfigLoaded(true));
        return () => {
            cancelled = true;
        };
    }, [siteKey, version]);

    return {config, genai, configLoaded, reloadConfig};
}
