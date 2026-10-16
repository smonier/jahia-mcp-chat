# Decisions

## 2026-10-16 - genai-connector as a provider, hybrid

The Jahia genai-connector replaces provider plumbing where it can, but its v1 agent offers only the in-process
Jahia MCP tools (`JahiaMcpTool` services), takes text-only turns and runs one configured provider. So it is one
provider among others ("Jahia GenAI", `genai`): with it the loop runs server-side; remote MCP servers, images
and the per-user provider choice stay on the module's own `LlmProxyServlet` loop. Upstream asked for caller-supplied
tools / external MCP servers; when that lands, move the whole loop to `GenAiAgentService` and drop
`LlmProxyServlet`. Its servlets are under `/modules/genai`, outside this module's CSRF patterns, and called
browser-direct with the user's session.
Workaround until Jahia/genai-connector#15: `genAiAllowedTools()` sends `allowedTools` without the local tools whose
schema uses `$ref` (the connector drops the root `$defs`; DeepSeek then refuses the whole request). Remove it when
the fix ships.

## 2026-10-16 - MCP servers are factory configurations

LLM settings stay in the main PID; each MCP server is one `server-<name>.cfg`. `McpServer` carries
`@Designate(factory = true)`: without it the OSGi configurations screen shows each file as a plain
configuration and offers no way to add one. Pasting an `mcpServers` JSON in an admin screen was considered and
not wanted: cfg files are enough.

## 2026-10-16 - Local servers browser-direct, remote servers proxied

A relative URL is called by the browser with the user's own Jahia session: a Jahia Cloud node cannot fetch its
own public URL, and the local MCP server must act as the user. A remote server is always proxied so that its
credentials never reach the browser; the proxy only ever calls the configured URL and follows no redirect.

## 2026-10-16 - Tool names prefixed by server

`<server>__<tool>` (server names cannot contain `__`). An unprefixed name is accepted only when there is a
single server.

## 2026-10-16 - Per-user OAuth sign-in by default

Remote servers that answer 401 are signed in to per user, the way MCP clients do it (BotRank's documented
setup: URL only, the client registers itself, the user signs in). Client credentials remain as
`oauthGrant=client_credentials` for a shared account. Tokens live on the user node, written with the user's
session (no system session); a configured client secret is never copied there.

## 2026-10-16 - Storage on user-node properties

A user node (`jnt:user`) accepts no `nt:unstructured` child, so preferences and tokens are residual
properties of the user node (`mcpchat.settings`, `mcpchat.oauth.<server>`).

## 2026-10-16 - CSRF

Everything under `/modules/jahia-mcp-chat/*` is under the guard (`urlPatterns`). Only `/oauth/start` and
`/oauth/callback` are whitelisted: top-level navigations that cannot carry the token; the callback relies on
the OAuth `state`. The guard cfg is module-owned and ships without the `# default configuration` marker so that
releases replace it.

## 2026-10-15 - No site gate on the action

`requireModuleInstalledOnSite` on the action used the Maven artifact id (`jahia-mcp-chat`) instead of the bundle
symbolic name (`org.jahia.se.modules.jahiaMcpChat`) and silently hid it; `useNodeChecks` rendered nothing while
loading. Both were removed; servers are scoped per site by their `sites` setting instead.
