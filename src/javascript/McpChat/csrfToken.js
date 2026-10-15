const ctx = () => window.contextJsParameters?.contextPath || '';

let tokenCache = null;
let tokenFetch = null;

/** Fetch (and cache) the Jahia CSRF token. Re-fetches after 10 minutes. */
export async function getCsrfToken() {
    if (tokenCache) return tokenCache;
    if (!tokenFetch) {
        tokenFetch = fetch(`${ctx()}/modules/CsrfServlet`, {credentials: 'include'})
            .then(r => r.ok ? r.text() : '')
            .then(t => {
                tokenCache = t;
                // Invalidate after 10 minutes
                setTimeout(() => { tokenCache = null; tokenFetch = null; }, 600_000);
                return t;
            })
            .catch(() => { tokenFetch = null; return ''; });
    }
    return tokenFetch;
}
