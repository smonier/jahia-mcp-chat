import {useState, useCallback, useEffect, useRef} from 'react';

const STORAGE_KEY = 'jahia-mcp-chat-settings';
const SETTINGS_API = '/modules/jahia-mcp-chat/settings';

// Per-user preferences only — API keys and MCP endpoint come from OSGi config
const DEFAULTS = {
    mcpToken: '',
    llmProvider: '',      // empty = use OSGi default
    selectedModel: '',    // empty = use OSGi default
    maxTokens: 0,         // 0 = use OSGi default
    skills: []
};

function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? {...DEFAULTS, ...JSON.parse(raw)} : {...DEFAULTS};
    } catch {
        return {...DEFAULTS};
    }
}

function saveLocal(settings) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

async function fetchFromServer() {
    const res = await fetch(SETTINGS_API, {credentials: 'include'});
    if (!res.ok) throw new Error(`settings fetch ${res.status}`);
    const json = await res.json();
    return Object.keys(json).length > 0 ? {...DEFAULTS, ...json} : null;
}

async function saveToServer(settings) {
    const {skills, ...rest} = settings;
    await fetch(SETTINGS_API, {
        method: 'POST',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(rest)
    });
}

export function useSettings() {
    const [settings, setSettings] = useState(loadLocal);
    const saveTimerRef = useRef(null);

    useEffect(() => {
        fetchFromServer()
            .then(serverSettings => {
                if (serverSettings) {
                    const local = loadLocal();
                    const merged = {...serverSettings, skills: local.skills};
                    setSettings(merged);
                    saveLocal(merged);
                }
            })
            .catch(() => {});
    }, []);

    const persistToServer = useCallback(next => {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveToServer(next).catch(() => {});
        }, 800);
    }, []);

    const updateSettings = useCallback(patch => {
        setSettings(prev => {
            const next = {...prev, ...patch};
            saveLocal(next);
            persistToServer(next);
            return next;
        });
    }, [persistToServer]);

    const addSkill = useCallback(skill => {
        setSettings(prev => {
            const next = {...prev, skills: [...prev.skills, skill]};
            saveLocal(next);
            return next;
        });
    }, []);

    const removeSkill = useCallback(name => {
        setSettings(prev => {
            const next = {...prev, skills: prev.skills.filter(s => s.name !== name)};
            saveLocal(next);
            return next;
        });
    }, []);

    return {settings, updateSettings, addSkill, removeSkill};
}
