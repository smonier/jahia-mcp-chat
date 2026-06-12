import {useState, useCallback} from 'react';

const STORAGE_KEY = 'jahia-mcp-chat-settings';

const DEFAULTS = {
    mcpEndpoint: 'http://localhost:8080/modules/mcp',
    mcpToken: '',
    llmProvider: 'anthropic',
    llmApiKey: '',
    selectedModel: 'claude-sonnet-4-6',
    skills: []
};

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? {...DEFAULTS, ...JSON.parse(raw)} : {...DEFAULTS};
    } catch {
        return {...DEFAULTS};
    }
}

function persist(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // localStorage may be unavailable
    }
}

export function useSettings() {
    const [settings, setSettings] = useState(loadSettings);

    const updateSettings = useCallback(patch => {
        setSettings(prev => {
            const next = {...prev, ...patch};
            persist(next);
            return next;
        });
    }, []);

    const addSkill = useCallback(skill => {
        setSettings(prev => {
            const next = {...prev, skills: [...prev.skills, skill]};
            persist(next);
            return next;
        });
    }, []);

    const removeSkill = useCallback(name => {
        setSettings(prev => {
            const next = {...prev, skills: prev.skills.filter(s => s.name !== name)};
            persist(next);
            return next;
        });
    }, []);

    return {settings, updateSettings, addSkill, removeSkill};
}
