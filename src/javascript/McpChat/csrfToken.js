/**
 * Jahia CSRF guard client (jahia-csrf-guard 4.x).
 *
 * The guard protects /modules/jahia-mcp-chat/* for signed-in users.
 * Every fetch to those paths must carry:
 *   X-Requested-With: XMLHttpRequest
 *   CSRFTOKEN: <master or per-URI token>
 *
 * The master token is embedded in /modules/CsrfServlet's JS response.
 * A first request with the master token creates a per-URI token returned
 * in the CSRFTOKEN response header. Subsequent requests should use the
 * per-URI token (master token is accepted ~2 s after URI token creation).
 * A refused request (302 /error.html) rotates all tokens of the session.
 *
 * Reference: efficy-jahia csrfGuard.ts
 */

const MASTER_TOKEN_RE =
    /var\s+[\w$]+\s*=\s*'([A-Za-z][A-Za-z0-9_-]*)'\s*,\s*[\w$]+\s*=\s*'([A-Za-z0-9-]{8,})'/;

const ctx = () => window.contextJsParameters?.contextPath || '';

// Cache: { tokenName, masterToken, pageTokens: {uri -> token}, loadedAt }
let cache = null;

async function loadFromGuardScript() {
    // Prefer the already-loaded script element (jContent page injects it)
    const scriptEl = document.querySelector('script[src*="/CsrfServlet"]');
    const url = scriptEl
        ? new URL(scriptEl.src, location.href).origin + new URL(scriptEl.src, location.href).pathname
        : `${ctx()}/modules/CsrfServlet`;

    const res = await fetch(url, {credentials: 'same-origin', cache: 'no-store'});
    if (!res.ok) return null;
    const src = await res.text();
    const m = MASTER_TOKEN_RE.exec(src);
    if (!m) return null;
    const [, tokenName, masterToken] = m;
    return {tokenName, masterToken, pageTokens: {}, loadedAt: Date.now()};
}

let loadPromise = null;

async function ensureLoaded() {
    if (cache && Date.now() - cache.loadedAt < 300_000) return cache; // 5-min TTL
    if (!loadPromise) {
        loadPromise = loadFromGuardScript().then(c => {
            cache = c;
            loadPromise = null;
            return c;
        }).catch(() => { loadPromise = null; return null; });
    }
    return loadPromise;
}

/**
 * Returns { tokenName, token } to include in a protected fetch.
 * The caller path (e.g. '/modules/jahia-mcp-chat/llm-proxy') is used to
 * look up a per-URI token when available.
 */
export async function getCsrfHeaders(path) {
    const c = await ensureLoaded();
    if (!c) return {};
    const token = (path && c.pageTokens[path]) || c.masterToken;
    return {
        'X-Requested-With': 'XMLHttpRequest',
        [c.tokenName]: token
    };
}

/**
 * Call after receiving a response to store the per-URI token the guard
 * returns in the response CSRFTOKEN header (avoids burning the master token).
 */
export function storeResponseToken(path, response) {
    if (!cache || !path) return;
    const returned = response.headers?.get(cache.tokenName);
    if (returned) {
        cache.pageTokens[path] = returned;
    }
}

/**
 * Mark tokens stale (e.g. after a 302 /error.html refusal from the guard).
 * The next call to getCsrfHeaders will reload from the servlet.
 */
export function invalidateTokens() {
    cache = null;
}
