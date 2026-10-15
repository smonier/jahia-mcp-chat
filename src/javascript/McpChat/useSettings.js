import {useState, useCallback, useEffect, useRef} from 'react';
import {getCsrfHeaders, storeResponseToken} from './csrfToken';

const ctx = () => window.contextJsParameters?.contextPath || '';
const SETTINGS_API = () => `${ctx()}/modules/jahia-mcp-chat/settings`;
const STORAGE_KEY = 'jahia-mcp-chat-settings';

// Per-user preferences only — API keys, tokens and MCP endpoint come from OSGi config
const DEFAULTS = {
    llmProvider: '',      // empty = use OSGi default
    selectedModel: '',    // empty = use OSGi default
    maxTokens: 0,         // 0 = use OSGi default
    skills: []
};

function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {...DEFAULTS};
        const parsed = JSON.parse(raw);
        // Drop any legacy mcpToken that may be in localStorage
        const {mcpToken: _dropped, ...rest} = parsed;
        return {...DEFAULTS, ...rest};
    } catch {
        return {...DEFAULTS};
    }
}

function saveLocal(settings) {
    try {
        const {mcpToken: _dropped, ...safe} = settings;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {}
}

async function fetchFromServer() {
    const path = '/modules/jahia-mcp-chat/settings';
    const csrfHdrs = await getCsrfHeaders(path);
    const res = await fetch(SETTINGS_API(), {credentials: 'same-origin', headers: csrfHdrs});
    storeResponseToken(path, res);
    if (!res.ok) throw new Error(`settings fetch ${res.status}`);
    const json = await res.json();
    if (Object.keys(json).length === 0) return null;
    const {mcpToken: _dropped, ...safe} = json;
    return {...DEFAULTS, ...safe};
}

async function saveToServer(settings) {
    // Never send mcpToken or skills to the server
    const {mcpToken: _token, skills: _skills, ...payload} = settings;
    const path = '/modules/jahia-mcp-chat/settings';
    const csrfHdrs = await getCsrfHeaders(path);
    const res = await fetch(SETTINGS_API(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', ...csrfHdrs},
        body: JSON.stringify(payload)
    });
    storeResponseToken(path, res);
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
