// Sign-in to remote MCP servers that need one. The calls themselves run on the server (genai-connector's agent
// and this module's bridge); the browser only opens the sign-in page and asks to forget the tokens.
import {getCsrfHeaders, storeResponseToken, invalidateTokens} from './csrfToken';

const ctx = () => window.contextJsParameters?.contextPath || '';
const OAUTH_MESSAGE = 'jahia-mcp-chat-oauth';

// Opens the server's sign-in page in a popup; resolves with {ok, error} when the module's callback page reports.
// Call it straight from a click handler, or the browser blocks the popup.
export function signIn(server, siteKey) {
    const url = `${ctx()}/modules/jahia-mcp-chat/oauth/start?server=${encodeURIComponent(server.name)}&site=${encodeURIComponent(siteKey || '')}`;
    const popup = globalThis.open(url, `jahia-mcp-chat-oauth-${server.name}`, 'popup,width=520,height=720');
    if (!popup) return Promise.resolve({ok: false, error: 'popupBlocked'});
    return new Promise(resolve => {
        let done = false;
        const finish = result => {
            if (done) return;
            done = true;
            globalThis.removeEventListener('message', onMessage);
            clearInterval(timer);
            resolve(result);
        };
        const onMessage = e => {
            if (e.origin !== globalThis.location.origin || e.data?.type !== OAUTH_MESSAGE) return;
            finish({ok: Boolean(e.data.ok), error: e.data.error || ''});
        };
        globalThis.addEventListener('message', onMessage);
        const timer = setInterval(() => {
            if (popup.closed) finish({ok: false, error: ''});
        }, 500);
    });
}

export async function signOut(server) {
    const path = '/modules/jahia-mcp-chat/oauth/signout';
    const res = await fetch(`${ctx()}${path}?server=${encodeURIComponent(server.name)}`, {
        method: 'POST', credentials: 'same-origin', headers: await getCsrfHeaders(path)
    });
    if (!res.ok || res.redirected) {
        invalidateTokens();
        return false;
    }
    storeResponseToken(path, res);
    return true;
}
