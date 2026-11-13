# Architecture

## Front-end (React 18, `src/javascript/`)

- `init.js` registers one action, `jahia-mcp-chat`, on `headerPrimaryActions:999`. On narrow screens jContent
  folds header actions into its "Actions" menu: test at 1920 px wide before concluding the button is missing.
- `McpChatAction` renders the button and, while open only, portals `McpChatDrawer` into `document.body`. No
  `useNodeChecks`, no `requireModuleInstalledOnSite`: both hid the button (see decisions).
- `McpChatDrawer` is a non-modal `<dialog open>` placed by `useDock.js` (copied from content-governance's
  `drawer/useDock.js`: keep them in step) in `main .moonstone-layoutContent`, beside `#page-builder-frame-1`'s
  wrapper, whose `margin-right` it sets while open. Below 380 px of drawer + 360 px of page it covers the page
  instead. Chat and Settings are Moonstone `Tab`s. At narrow widths jContent folds header actions into its
  "Actions" menu and unmounts the button, which closes the drawer.
- `useConfig(siteKey)` reads `/config?site=` and genai-connector's `/modules/genai/status` (tiers, tools) together;
  `reloadConfig()` re-reads both, when the drawer opens and after a sign-in. `genai === null` means the connector
  is not installed.
- `useMcpChat.js` owns a conversation: text attachments inline, images as `images` (JPEG, PNG, GIF, WebP), every
  image or binary file posted to `/attachments` and named in the message with its `attachmentId`; history as
  text turns (last 20, older ones cut to 400 characters); each turn's tool calls and results summarised in the history (`toolSummary`), so the model remembers them;
  `maxToolIterations` 30 and 4,096 output tokens by default; a run ended by `MAX_ITERATIONS` is continued
  automatically (3 times at most), any other early stop sets `stopped` on the message and the drawer offers
  **Continue**; `allowedTools` = the connector's tools minus
  `config.blockedTools` (remote servers not allowed on the site); `resolveTier()` = user's tier, else
  `DEFAULT_TIER`, else the first tier with `agentAvailable`.
- `genaiAgent.js`: `fetchGenAiStatus()`, `runAgent()` (SSE frames `start`, `partial`, `tool_call`,
  `approval_required`, `tool_result`, `complete`, `error`, each tool frame with its `callId`),
  `confirmToolCall()`, `storeAttachment()`. The connector's endpoints are under `/modules/genai`, whitelisted by
  its own CSRF config: the chat sends `X-Requested-With` and a JSON body, no token.
- `mcpClient.js`: `signIn()` popup and the callback page's `postMessage`, `signOut()`. The browser never calls an
  MCP server.
- `csrfToken.js`: GET `/modules/CsrfServlet` (master token), POST it (per-URI page tokens), send the page
  token; the `CSRFTOKEN` response header is `{"pageTokens":{...}}` JSON to merge, never a bare token.
- Labels: `src/main/resources/javascript/locales/{en,fr}.json` (the ones `init.js` imports).
  `src/javascript/locales/` is not loaded.

## Back-end (`src/main/java/org/jahia/se/modules/mcpchat/`)

| Class | Role |
|---|---|
| `config.McpChatConfigService` | Main PID `org.jahia.se.modules.mcpchat`: `DEFAULT_TIER`, `MAX_TOKENS` (ceiling), `SYSTEM_PROMPT_APPENDIX`, `PUBLIC_BASE_URL`; warns on the old provider keys |
| `config.McpServer` + `McpServerConfig` | Factory PID `org.jahia.se.modules.mcpchat.server`, `@Designate(factory = true)`; one immutable `Snapshot` per file |
| `config.McpServerRegistry` | Dynamic multiple reference on `McpServer`; `getServers(site)` filters by `enabled` and `sites`; `getRemoteServers()` ignores sites (for the bridge); default `jahia` server when none configured |
| `remote.RemoteToolBridge` | Registers one `JahiaMcpTool` per remote tool (`<server>.<tool>`); syncs with the registry every 60 s; reads shared-credential lists every 30 min, per-user lists on sign-in and on `/config` when older than an hour; cache `remote-tools.json` in the bundle data folder; `call()` resolves the credential and retries once after a 401 |
| `remote.RemoteMcpTool` | The tool: name, description `[label] ...`, input schema as served, safety from `annotations` (`readOnlyHint` READ_ONLY, `destructiveHint` DESTRUCTIVE, else MUTATING) |
| `remote.RemoteMcpClient` | JSON-RPC over streamable HTTP: `initialize` once per server and caller, `Mcp-Session-Id`, JSON or SSE answers, 401 as `UnauthorizedException`, 404 on a session as expired |
| `attachment.AttachmentStore` | Attached files in memory, 30 min, 10 MB, 20 per user |
| `attachment.UploadAttachmentTool` | `chat.upload_attachment` (MUTATING): writes the file under `/sites/<site>/files/<folder>` with the user's session |
| `servlet.ConfigServlet` | `/config?site=`: `defaultTier`, `maxTokens`, `systemPromptAppendix`, servers `{name,label,local,signIn,signedIn,tools}`, `blockedTools` |
| `servlet.AttachmentServlet` | `POST /attachments?name=`: keeps a file, answers its id (CSRF token required) |
| `servlet.OAuthServlet` | `/oauth/start`, `/oauth/callback` (CSRF-whitelisted; the callback refreshes the server's tool list), `/oauth/signout` |
| `oauth.OAuthTokens` | Client-credentials tokens, cached per server |
| `oauth.OAuthDiscovery` | Protected-resource then authorization-server metadata, cached an hour |
| `oauth.UserOAuthService` | Client registration (bundle data file), PKCE pending state in the HTTP session, per-user tokens and refresh |
| `servlet.SettingsServlet` | `/settings`: per-user preferences |

## Kinds of MCP server

| `url` | Tools reach the agent | Auth |
|---|---|---|
| Relative (`/modules/mcp`) | In-process, mcp-server's own `JahiaMcpTool` services | The user's Jahia session |
| Absolute, `authValue` set | Bridged | Fixed header |
| Absolute, `oauthGrant=client_credentials` | Bridged | One token for every user |
| Absolute, otherwise | Bridged, once a user has signed in | The calling user's token; "sign in first" otherwise |

## Data

| What | Where |
|---|---|
| Preferences (`tier`, `maxTokens`) | Property `mcpchat.settings` of the user node |
| User tokens | Property `mcpchat.oauth.<server>` of the user node: JSON with url, token endpoint, client id, tokens, expiry; ignored when the server's url changed |
| Registered OAuth clients | `oauth-clients.properties` in the bundle data folder, key `<server url> <redirect uri>` |
| Remote tool lists | `remote-tools.json` in the bundle data folder: `{server: {url, refreshedAt, tools}}` |
| Pending sign-ins | HTTP session attribute `jahia-mcp-chat.oauth.pending`, 10 min |
| Attachments | `AttachmentStore`, memory, 30 min |
