import {useState, useEffect} from 'react';

const CONFIG_API = '/modules/jahia-mcp-chat/config';

const EMPTY_CONFIG = {
    availableProviders: [],
    defaultProvider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
    maxTokens: 4096,
    mcpEndpoint: 'http://localhost:8080/modules/mcp',
    systemPromptAppendix: ''
};

export function useConfig() {
    const [config, setConfig] = useState(EMPTY_CONFIG);
    const [configLoaded, setConfigLoaded] = useState(false);

    useEffect(() => {
        fetch(CONFIG_API, {credentials: 'include'})
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data) setConfig({...EMPTY_CONFIG, ...data});
            })
            .catch(() => {})
            .finally(() => setConfigLoaded(true));
    }, []);

    return {config, configLoaded};
}
