# Decisions

## 2026-11-13 - The assistant acts or asks, and the chat re-engages

User rule: the assistant never just stops. A run that hits the connector's tool-round limit (`MAX_ITERATIONS`,
8 by default, the chat asks for 30) is continued by the chat itself, up to three times, with the request and a
summary of the tools already run in the history. A run that stops on the operator's token budget, an error or the
user's Stop shows why and a **Continue** button: the chat does not spend past a budget by itself. The instructions
tell the model to call the tool or ask one explicit question, never to end on a plan.

## 2026-11-13 - Everything on genai-connector, remote servers bridged

The chat runs only on genai-connector's streamed agent, like automatic-content-tags 2.0: no LLM key, no provider
code, a tier instead of a provider and model. The connector's agent offers only `JahiaMcpTool` services
(Jahia/genai-connector#14 closed: external tools are not in its v1), so the module bridges remote MCP servers:
one `JahiaMcpTool` service per remote tool, run with the calling user's credential. Accepted side effect: the
Jahia MCP server lists these tools to its own MCP clients too. `sites` is enforced by the chat's `allowedTools`
only. Browser-held attachments go through `/attachments` and `chat.upload_attachment`, because the connector's
agent cannot run a tool in the browser. The hybrid of 2026-10-16 (connector as one provider among the module's
own) is replaced; `LlmProxyServlet` and `McpProxyServlet` are gone.

## 2026-10-16 - genai-connector as a provider, hybrid (superseded 2026-11-13)

The connector was one provider among the module's own Anthropic, OpenAI and DeepSeek loops, because its agent
offered only the Jahia tools and text turns. Replaced by the decision above once images, call ids and the
`$defs` fix shipped upstream.

## 2026-10-16 - MCP servers are factory configurations

LLM settings stay in the main PID; each MCP server is one `server-<name>.cfg`. `McpServer` carries
`@Designate(factory = true)`: without it the OSGi configurations screen shows each file as a plain
configuration and offers no way to add one. Pasting an `mcpServers` JSON in an admin screen was considered and
not wanted: cfg files are enough.

## 2026-10-16 - Local servers browser-direct, remote servers proxied (superseded 2026-11-13: the agent runs
both server-side)

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
