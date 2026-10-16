/**
 * Jahia CSRF guard client (jahia-csrf-guard 4.x, servlets under /modules).
 *
 * Flow (verified 2026-10-15, jahia-csrf-guard 4.3.0):
 *   1. GET /modules/CsrfServlet  → master token
 *   2. POST /modules/CsrfServlet with master token → per-URI page tokens
 *   3. Use per-URI token for each protected fetch (master is refused ~2s after first use)
 *   4. On 302 refusal, all session tokens rotate — must reload from step 1
 *
 * Reference: jahia-frontend-backend-patterns.md "CSRF for a servlet under /modules"
 */

const MASTER_TOKEN_RE =
    /var\s+[\w$]+\s*=\s*'([A-Za-z][A-Za-z0-9_-]*)'\s*,\s*[\w$]+\s*=\s*'([A-Za-z0-9-]{8,})'/;

const ctx = () => window.contextJsParameters?.contextPath || '';

// { tokenName, pageTokens: {uri -> token}, loadedAt }
let cache = null;
let loadPromise = null;

async function loadTokens() {
    const url = `${ctx()}/modules/CsrfServlet`;

    // Step 1: get master token from guard script
    const scriptRes = await fetch(url, {credentials: 'same-origin', cache: 'no-store'});
    if (!scriptRes.ok) return null;
    const src = await scriptRes.text();
    const m = MASTER_TOKEN_RE.exec(src);
    if (!m) return null;
    const [, tokenName, masterToken] = m;

    // Step 2: POST with master token → get per-URI page tokens for all our endpoints
    const postRes = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'X-Requested-With': 'XMLHttpRequest', [tokenName]: masterToken}
    });
    if (!postRes.ok) return null;
    const json = await postRes.json();
    const pageTokens = json.pageTokens || {};

    return {tokenName, masterToken, pageTokens, loadedAt: Date.now()};
}

async function ensureLoaded() {
    if (cache && Date.now() - cache.loadedAt < 240_000) return cache; // 4-min TTL
    if (!loadPromise) {
        loadPromise = loadTokens().then(c => {
            cache = c;
            loadPromise = null;
            return c;
        }).catch(() => {
            loadPromise = null;
            return null;
        });
    }
    return loadPromise;
}

export async function getCsrfHeaders(path) {
    const c = await ensureLoaded();
    if (!c) return {};
    const token = (path && c.pageTokens[path]) || c.masterToken;
    return {
        'X-Requested-With': 'XMLHttpRequest',
        [c.tokenName]: token
    };
}

export function storeResponseToken(path, response) {
    if (!cache || !path) return;
    const returned = response.headers?.get(cache.tokenName);
    if (!returned) return;
    // The guard answers rotated tokens as JSON ({"pageTokens": {uri: token}}), not as a bare token
    if (returned.trim().startsWith('{')) {
        try {
            Object.assign(cache.pageTokens, JSON.parse(returned).pageTokens || {});
        } catch {
            invalidateTokens();
        }
        return;
    }
    cache.pageTokens[path] = returned;
}

export function invalidateTokens() {
    cache = null;
    loadPromise = null;
}
