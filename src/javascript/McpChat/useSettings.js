import {useState, useCallback, useEffect, useRef} from 'react';

const STORAGE_KEY = 'jahia-mcp-chat-settings';
const SETTINGS_API = '/modules/jahia-mcp-chat/settings';

const DEFAULTS = {
    mcpEndpoint: 'http://localhost:8080/modules/mcp',
    mcpToken: '',
    llmProvider: 'anthropic',
    llmApiKey: '',
    selectedModel: 'claude-sonnet-4-6',
    maxTokens: 4096,
    skills: []
};

// Read from localStorage (used as fast initial state while JCR loads)
function loadLocal() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? {...DEFAULTS, ...JSON.parse(raw)} : {...DEFAULTS};
    } catch {
        return {...DEFAULTS};
    }
}

function saveLocal(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
}

async function fetchFromServer() {
    const res = await fetch(SETTINGS_API, {credentials: 'include'});
    if (!res.ok) throw new Error(`settings fetch ${res.status}`);
    const json = await res.json();
    return Object.keys(json).length > 0 ? {...DEFAULTS, ...json} : null;
}

async function saveToServer(settings) {
    // Never persist skills to JCR — they can be large and are managed separately
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

    // On mount: load from JCR and merge, overriding localStorage
    useEffect(() => {
        fetchFromServer()
            .then(serverSettings => {
                if (serverSettings) {
                    // Merge: server wins for all scalar fields; keep local skills
                    const local = loadLocal();
                    const merged = {...serverSettings, skills: local.skills};
                    setSettings(merged);
                    saveLocal(merged);
                }
            })
            .catch(err => {
                // JCR unavailable or not authenticated — stay on localStorage
                console.debug('MCP chat: could not load settings from JCR', err);
            });
    }, []);

    // Debounced server save: wait 800ms after last change before posting
    const persistToServer = useCallback(next => {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveToServer(next).catch(err =>
                console.warn('MCP chat: failed to save settings to JCR', err)
            );
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
