# Jahia MCP Chat

A **Jahia jContent UI extension** that adds a chat drawer to the back-office, powered by the LLM of your choice
(Anthropic, OpenAI or DeepSeek) and connected to one or more **MCP servers**: the
[Jahia MCP server](https://github.com/Jahia/jahia-mcp) of the instance itself, and any remote MCP server
(a CRM, an analytics service such as BotRank...). Editors manage content, pages and sites in plain language,
and can combine Jahia with the other services in one conversation.

---

## What it does

- Opens a chat drawer from the **MCP Chat** button of the jContent header toolbar
- Routes messages to an LLM through a server-side proxy: API keys never reach the browser
- Runs a full **agentic loop**: the assistant chains tool calls until the task is done
- Talks to **several MCP servers**, one OSGi factory configuration each; tools reach the LLM as `<server>__<tool>`
- Signs each user in to a remote server that requires OAuth, **the way MCP clients do it**: the module registers
  itself with the server, the user signs in once in a popup, tokens are refreshed automatically
- Shows each server and its **connection status** in the chat settings, with **Connect** / **Disconnect**
- Uploads chat attachments (images, files) to the site's media library on request
- Shows a token counter per response, keeps the chat history in the browser and the preferences in JCR
- Loads custom **Skills** (Markdown uploaded or pulled from a GitHub raw URL) into the system prompt

---

## Architecture

```
jContent browser (React 18, Module Federation)
    └── McpChatAction  (headerPrimaryActions)
            └── McpChatDrawer
                    ├── useMcpChat     agentic loop, SSE streaming, history
                    ├── mcpClient      MCP servers: handshake, tool catalog, <server>__<tool> calls, sign-in popup
                    ├── csrfToken      CSRF guard client (per-URI page tokens)
                    ├── useConfig      server configuration for the current site
                    ├── useSettings    per-user preferences (JCR + localStorage cache)
                    ├── McpSettings    LLM preferences, MCP servers and their status, Skills
                    └── ChatMessage    bubbles, tool call blocks, token badge

Java OSGi layer (/modules/jahia-mcp-chat/...)
    ├── ConfigServlet     GET  /config?site=<key>        providers, defaults, MCP servers of the site (no secrets)
    ├── LlmProxyServlet   POST /llm-proxy                → Anthropic / OpenAI / DeepSeek, SSE streamed back
    ├── McpProxyServlet   POST /mcp?server=<name>        → remote MCP servers, credentials added server-side
    ├── OAuthServlet      GET  /oauth/start, /oauth/callback, POST /oauth/signout
    ├── SettingsServlet   GET/POST /settings             per-user preferences
    ├── McpServerRegistry collects the McpServer factory configurations
    └── UserOAuthService  client registration, PKCE, per-user tokens

MCP servers
    ├── local:  /modules/mcp on this Jahia, called by the browser with the user's own session
    └── remote: https://..., called through McpProxyServlet
```

---

## Supported LLM providers

| Provider | Models |
|---|---|
| **Anthropic** | Claude Sonnet 4.6, Claude Opus 4.8, Claude Haiku 4.5 |
| **OpenAI** | GPT-4o, GPT-4o Mini, o1, o3-mini |
| **DeepSeek** | DeepSeek V4 Flash, DeepSeek Chat (V3), DeepSeek Reasoner (R1) |

DeepSeek uses the OpenAI-compatible API format: the same agentic loop handles all three.

### Jahia GenAI connector

When the [genai-connector](https://github.com/Jahia/genai-connector) module is installed and configured
(`/modules/genai/status` reports the agent available), **Jahia GenAI** is offered as one more provider, with the
provider and model of the connector's own configuration. With it selected:

- the agentic loop runs on the server (`/modules/genai/agent/stream`), the Jahia MCP tools in-process under the
  user's session, and the module's provider keys are not used;
- a tool call the connector flags for approval pauses the run: the chat shows **Allow** / **Deny** above the input;
- remote MCP servers and images are not available, because the connector's agent offers only the Jahia tools and
  takes text turns. Pick another provider for those conversations.
- `content.create` and `content.update` are left out for now: the connector drops the root `$defs` of their
  schema and the provider refuses the request ([Jahia/genai-connector#15](https://github.com/Jahia/genai-connector/issues/15)).
  The chat sends `allowedTools` without the Jahia tools whose schema uses `$ref`.

Set `DEFAULT_PROVIDER=genai` to make it the default.

---

## Prerequisites

- Jahia 8.2+ (tested on 8.2.3.2, jahia-csrf-guard 4.3.0)
- The [Jahia MCP server](https://github.com/Jahia/jahia-mcp) module installed, for the local tools
- An API key for at least one LLM provider
- To build: Java 17 (`JAVA_HOME` pointing to it: Java 21+ breaks the bundle plugin) and Maven 3.8. Maven
  downloads Node 18 and Yarn itself through `frontend-maven-plugin`.

---

## Installation

```bash
git clone https://github.com/smonier/jahia-mcp-chat.git
cd jahia-mcp-chat
JAVA_HOME=/path/to/java17 mvn clean install
```

Deploy `target/jahia-mcp-chat-1.0.0-SNAPSHOT.jar` from the Jahia module administration, or with the
provisioning API:

```bash
curl -u root:<password> -X POST http://localhost:8080/modules/api/bundles \
  -F "bundle=@target/jahia-mcp-chat-1.0.0-SNAPSHOT.jar" -F "start=true"
```

The chat button shows on every site; the MCP servers it offers depend on the site (see `sites` below).

---

## Configuration

All server-side configuration lives in `digital-factory-data/karaf/etc/` and is picked up without a redeploy.
It can also be edited from **Administration > Server > Configuration > OSGi configurations**, where
"Jahia MCP Chat - MCP server" is a factory: one instance per server.

### LLM providers - `org.jahia.se.modules.mcpchat.cfg`

| Key | Description |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` | A blank key hides the provider |
| `DEFAULT_PROVIDER`, `DEFAULT_MODEL` | Used when a user has no saved preference (`genai` for the Jahia GenAI connector) |
| `MAX_TOKENS` | Upper bound of output tokens per response |
| `SYSTEM_PROMPT_APPENDIX` | Instructions appended to the system prompt (site conventions, tone, forbidden operations) |
| `PUBLIC_BASE_URL` | Base URL users reach Jahia at, for the OAuth redirect URI. Blank: taken from the request. Set it behind a reverse proxy |

### MCP servers - one `org.jahia.se.modules.mcpchat.server-<name>.cfg` per server

| Key | Description |
|---|---|
| `name` | Lowercase letters, digits, `-`, single `_`. Tools reach the LLM as `<name>__<tool>`. Defaults to the file suffix |
| `label` | Name shown to users. Defaults to the name |
| `url` | Relative (`/modules/mcp`): a server on this Jahia, called by the browser with the user's session. Absolute (`https://...`): a remote server, called through the module's proxy |
| `authHeader`, `authValue` | A fixed credential sent to a remote server (e.g. `Authorization` / `Bearer <token>`) |
| `oauthGrant` | For a remote server that requires OAuth. `authorization_code` (default): each user signs in. `client_credentials`: one account for every user |
| `oauthClientId`, `oauthClientSecret` | Optional for `authorization_code` (the module registers itself when empty); required for `client_credentials` |
| `oauthScope` | Scopes to request. Empty: the scopes the server advertises |
| `oauthTokenUrl` | Token endpoint for `client_credentials`. Empty: discovered from the server's metadata |
| `timeoutMs` | Remote request timeout (default 60000) |
| `sites` | Comma-separated site keys allowed to use the server; empty means every site |
| `enabled` | `false` hides the server |

The module ships `server-jahia.cfg` for the local Jahia MCP server. With no server file at all, the chat falls
back to `/modules/mcp`.

#### A remote server with OAuth sign-in (BotRank)

An `mcpServers` entry such as `"botrank": {"type": "http", "url": "https://api.botrank.ai/mcp/public"}`
becomes:

```properties
# karaf/etc/org.jahia.se.modules.mcpchat.server-botrank.cfg
name=botrank
label=BotRank
url=https://api.botrank.ai/mcp/public
```

Nothing else is needed. On the first call the server answers 401, the chat settings show BotRank as
**Not connected** with a **Connect** button, and:

1. The module reads the server's OAuth metadata (`/.well-known/oauth-protected-resource`, then the
   authorization server's metadata).
2. It registers itself as "Jahia MCP Chat" (dynamic client registration, once per server and redirect URI,
   kept in the bundle's data folder).
3. The sign-in page opens in a popup (authorization code with PKCE); the user signs in with their own account.
4. The server sends the browser back to `/modules/jahia-mcp-chat/oauth/callback`; the module exchanges the
   code and keeps the tokens for that user. The settings show **Connected** and the server's tool count.

Tokens are refreshed automatically. **Disconnect** forgets them. A server that offers no client registration
takes a pre-registered `oauthClientId` (and `oauthClientSecret` for a confidential client), with
`<PUBLIC_BASE_URL>/modules/jahia-mcp-chat/oauth/callback` as its redirect URI.

#### A remote server with a fixed credential

```properties
# karaf/etc/org.jahia.se.modules.mcpchat.server-crm.cfg
name=crm
label=CRM
url=https://mcp.example.com/mcp
authHeader=Authorization
authValue=Bearer <token>
sites=digitall
```

#### A remote server with one account for all users

```properties
name=analytics
url=https://mcp.example.com/mcp
oauthGrant=client_credentials
oauthClientId=<client id>
oauthClientSecret=<client secret>
oauthScope=mcp:read
```

### User preferences (gear icon in the chat)

| Section | Content |
|---|---|
| **LLM provider** | Provider (among those with a key), model, max output tokens (capped by `MAX_TOKENS`) |
| **MCP servers** | Every server of the site with its status (Connected, Not connected, Unavailable) and tool count; **Connect** / **Disconnect** for servers that need a sign-in |
| **Skills** | Markdown files added to the system prompt |

---

## Security

| Concern | How it is handled |
|---|---|
| LLM API keys | Only in the OSGi configuration; `LlmProxyServlet` adds them server-side |
| Remote MCP credentials | `authValue`, client secrets and user tokens stay on the server; `/config` never returns them, nor a remote server's URL |
| Who may call | Every servlet refuses guests. `/config`, `/mcp` and `/oauth/start` require jContent access to the site; a server outside its `sites` list is refused |
| Proxy target | Always the configured URL, never a URL from the request; redirects are not followed |
| CSRF | Everything under `/modules/jahia-mcp-chat/*` is under the CSRF guard. Only `/oauth/start` and `/oauth/callback` are whitelisted: they are top-level navigations, and the callback is protected by the OAuth `state` (single use, bound to the session and the user, 10 minutes) |
| User tokens | JCR property `mcpchat.oauth.<server>` of the user node, written with the user's own session |

---

## Data kept

| What | Where |
|---|---|
| Provider, model, max tokens | JCR property `mcpchat.settings` of the user node |
| MCP sign-ins (access and refresh tokens) | JCR properties `mcpchat.oauth.<server>` of the user node |
| OAuth clients the module registered | `oauth-clients.properties` in the bundle's data folder |
| Chat history, Skills | Browser `localStorage` |

---

## Token consumption

Each assistant response shows a badge such as `◈ 1.2k↑ 342↓ 1.5k`: input tokens (prompt, history, tool
results), output tokens, total. Hover it for exact counts. Tool results are summarised by type before they go
back to the LLM, older turns are compressed and the history is trimmed to the last 20 turns.

---

## Project structure

```
jahia-mcp-chat/
├── pom.xml                                  # OSGi bundle, Jahia 8.2 parent
├── package.json / webpack.config.js         # Webpack 5 + Module Federation
├── src/javascript/
│   ├── init.js                              # registers the header action
│   └── McpChat/
│       ├── McpChatAction.jsx / McpChatDrawer.jsx
│       ├── McpSettings.jsx                  # LLM, MCP servers, Skills
│       ├── mcpClient.js                     # MCP calls, tool prefixes, sign-in popup
│       ├── useMcpChat.js                    # agentic loop
│       ├── csrfToken.js, useConfig.js, useSettings.js
│       └── ChatMessage.jsx, SkillsManager.jsx, fileAttachments.js
├── src/main/java/org/jahia/se/modules/mcpchat/
│   ├── config/                              # McpChatConfigService, McpServer (+Config), McpServerRegistry
│   ├── oauth/                               # OAuthDiscovery, UserOAuthService
│   └── servlet/                             # Config, LlmProxy, McpProxy, OAuth, Settings servlets
└── src/main/resources/
    ├── META-INF/configurations/             # main cfg, server-jahia.cfg, CSRF guard cfg
    └── javascript/apps/, javascript/locales/ # webpack output (committed), en.json, fr.json
```

---

## Development

```bash
JAVA_HOME=/path/to/java17 mvn clean install
curl -u root:<password> -X POST http://localhost:8080/modules/api/bundles \
  -F "bundle=@target/jahia-mcp-chat-1.0.0-SNAPSHOT.jar" -F "start=true"
```

Never run `yarn dev` from an automated process: it is an interactive watcher. See [CHANGELOG.md](CHANGELOG.md)
for the changes, and [`.agents/`](.agents/README.md) for the notes AI agents read before working on the module.

---

## Related

- [Jahia MCP Server](https://github.com/Jahia/jahia-mcp): the Jahia tools the chat calls
- [Jahia UI Extender](https://github.com/Jahia/javascript-components): the React 18 back-office extension framework
- [Model Context Protocol, authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization): the sign-in flow the module follows
