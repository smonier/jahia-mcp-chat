# Architecture

## Front-end (React 18, `src/javascript/`)

- `init.js` registers one action, `jahia-mcp-chat`, on `headerPrimaryActions:999`. On narrow screens jContent
  folds header actions into its "Actions" menu: test at 1920 px wide before concluding the button is missing.
- `McpChatAction` renders the button and portals `McpChatDrawer` into `document.body`. No `useNodeChecks`, no
  `requireModuleInstalledOnSite`: both hid the button (see decisions).
- `useConfig(siteKey)` reads `/config?site=`; `reloadConfig()` re-reads it after a sign-in.
- `mcpClient.js` owns every MCP call: per-server `initialize` + `Mcp-Session-Id`, SSE answers, tool names
  `<server>__<tool>`, `SignInRequiredError` on `{"error":"sign_in_required"}`, `signIn()` popup and
  `postMessage` from the callback page, `signOut()`.
- `useMcpChat.js` runs the agentic loop through `/llm-proxy` with two tools: `mcp_call {tool, params}` and
  `upload_attachment` (uses the first local server's `media.upload.*` tools).
- `genaiAgent.js`: the Jahia GenAI provider. `fetchGenAiStatus()` (`/modules/genai/status`) adds `genai` to the
  providers; `runGenAiAgentLoop()` posts to `/modules/genai/agent/stream` (input, instructions, text history) and
  maps its SSE frames (`start`, `partial`, `tool_call`, `approval_required`, `tool_result`, `complete`, `error`)
  to the chat's events; `tool_result` frames carry no `callId`, so results are matched to calls by tool name in
  order. `confirmToolCall()` answers `/modules/genai/agent/confirm`.
- `csrfToken.js`: GET `/modules/CsrfServlet` (master token), POST it (per-URI page tokens), send the page
  token; the `CSRFTOKEN` response header is `{"pageTokens":{...}}` JSON to merge, never a bare token.
- Labels: `src/main/resources/javascript/locales/{en,fr}.json` (the ones `init.js` imports).
  `src/javascript/locales/` is not loaded.

## Back-end (`src/main/java/org/jahia/se/modules/mcpchat/`)

| Class | Role |
|---|---|
| `config.McpChatConfigService` | Main PID `org.jahia.se.modules.mcpchat`: LLM keys, defaults, `SYSTEM_PROMPT_APPENDIX`, `PUBLIC_BASE_URL` |
| `config.McpServer` + `McpServerConfig` | Factory PID `org.jahia.se.modules.mcpchat.server`, `@Designate(factory = true)`; one immutable `Snapshot` per file |
| `config.McpServerRegistry` | Dynamic multiple reference on `McpServer`; filters by `enabled` and `sites`; default `jahia` server when none configured |
| `servlet.ConfigServlet` | `/config?site=`: providers, defaults, servers `{name,label,local,signIn,signedIn,url?}` |
| `servlet.LlmProxyServlet` | `/llm-proxy`: provider from `X-LLM-Provider`, `max_tokens` clamped, SSE streamed |
| `servlet.McpProxyServlet` | `/mcp?server=` + `X-Site-Key`: remote servers only; bearer from client credentials, user OAuth or fixed header; one retry after 401; `sign_in_required` JSON when the user must sign in |
| `servlet.OAuthServlet` | `/oauth/start`, `/oauth/callback` (CSRF-whitelisted), `/oauth/signout` |
| `servlet.OAuthTokens` | Client-credentials tokens, cached per server |
| `oauth.OAuthDiscovery` | Protected-resource then authorization-server metadata, cached an hour |
| `oauth.UserOAuthService` | Client registration (bundle data file), PKCE pending state in the HTTP session, per-user tokens and refresh |
| `servlet.SettingsServlet` | `/settings`: per-user preferences |

## Kinds of MCP server

| `url` | Called by | Auth |
|---|---|---|
| Relative (`/modules/mcp`) | The browser, same origin | The user's Jahia session |
| Absolute, `authValue` set | `McpProxyServlet` | Fixed header |
| Absolute, `oauthGrant=client_credentials` | `McpProxyServlet` | One token for every user |
| Absolute, otherwise | `McpProxyServlet` | Per-user sign-in on the first 401 |

## Data

| What | Where |
|---|---|
| Preferences | Property `mcpchat.settings` of the user node |
| User tokens | Property `mcpchat.oauth.<server>` of the user node: JSON with url, token endpoint, client id, tokens, expiry; ignored when the server's url changed |
| Registered OAuth clients | `oauth-clients.properties` in the bundle data folder, key `<server url> <redirect uri>` |
| Pending sign-ins | HTTP session attribute `jahia-mcp-chat.oauth.pending`, 10 min |
