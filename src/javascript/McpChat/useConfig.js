import {useState, useEffect} from 'react';
import {getCsrfHeaders, storeResponseToken} from './csrfToken';

const ctx = () => window.contextJsParameters?.contextPath || '';
const CONFIG_API = () => `${ctx()}/modules/jahia-mcp-chat/config`;

const EMPTY_CONFIG = {
    availableProviders: [],
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    maxTokens: 4096,
    mcpServers: [],
    systemPromptAppendix: ''
};

export function useConfig(siteKey) {
    const [config, setConfig] = useState(EMPTY_CONFIG);
    const [configLoaded, setConfigLoaded] = useState(false);

    useEffect(() => {
        const path = '/modules/jahia-mcp-chat/config';
        getCsrfHeaders(path).then(csrfHdrs =>
            fetch(`${CONFIG_API()}?site=${encodeURIComponent(siteKey || '')}`, {credentials: 'same-origin', headers: csrfHdrs})
                .then(r => { storeResponseToken(path, r); return r.ok ? r.json() : null; })
                .then(data => { if (data) setConfig({...EMPTY_CONFIG, ...data}); })
                .catch(() => {})
                .finally(() => setConfigLoaded(true))
        );
    }, [siteKey]);

    return {config, configLoaded};
}
