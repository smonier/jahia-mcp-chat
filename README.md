# Jahia MCP Chat

A **Jahia jContent UI extension** that adds a chat drawer to the back-office. The assistant runs on
[genai-connector](https://github.com/Jahia/genai-connector), Jahia's single gateway to LLMs, and works with
the tools of the [Jahia MCP server](https://github.com/Jahia/mcp-server) and of any remote MCP server (an
analytics service such as BotRank, a CRM...). Editors manage content, pages and sites in plain language, and can
combine Jahia with the other services in one conversation.

The module holds no LLM key and talks to no LLM provider itself: models, providers, keys, rate limits and audit
logging are genai-connector's.

---

## What it does

- Opens a chat drawer from the **MCP Chat** button of the jContent header toolbar, docked in jContent's content
  area beside the page under edit (which narrows to make room), resizable from its left edge, as content-governance's
  drawer; built from Moonstone components (`Paper`, `Tab`, `Banner`, `Chip`, `Button`, `Dropdown`, `Textarea`)
- Runs each conversation on genai-connector's streamed agent: the model chains tool calls until the task is done
- Offers the **Jahia MCP tools**, run in-process under the user's own permissions
- Offers the **tools of remote MCP servers**, one OSGi factory configuration each, named `<server>.<tool>`
- Signs each user in to a remote server that requires OAuth, **the way MCP clients do it**: the module registers
  itself with the server, the user signs in once in a popup, tokens are refreshed automatically
- Asks the user to **Allow** or **Deny** each tool call that changes something
- Sends attached images to the model, and puts attached files in the site's media library on request
- Shows each server and its **connection status** in the chat settings, with **Connect** / **Disconnect**
- Shows a token counter per response, keeps the chat history in the browser and the preferences in JCR
- Loads custom **Skills** (Markdown uploaded or pulled from a GitHub raw URL) into the instructions

---

## Architecture

```
jContent browser (React 18, Module Federation)
    └── McpChatAction  (headerPrimaryActions)
            └── McpChatDrawer  non-modal <dialog> docked by useDock, Chat and Settings tabs
                    ├── useMcpChat     conversation, attachments, history, approvals
                    ├── genaiAgent     /modules/genai/status, /agent/stream (SSE), /agent/confirm
                    ├── mcpClient      sign-in popup and sign-out for remote servers
                    ├── useConfig      module configuration for the site + genai-connector status
                    ├── McpSettings    model tier, MCP servers and their status, Skills
                    └── ChatMessage    bubbles, tool call blocks, token badge

genai-connector (separate module)
    └── /modules/genai/agent/stream   model call + tool loop, every JahiaMcpTool service as a tool

jahia-mcp-chat, Java (/modules/jahia-mcp-chat/...)
    ├── RemoteToolBridge      one JahiaMcpTool service per tool of each remote MCP server
    ├── UploadAttachmentTool  JahiaMcpTool chat.upload_attachment
    ├── ConfigServlet         GET  /config?site=<key>        tier, MCP servers of the site (no secrets)
    ├── AttachmentServlet     POST /attachments               keeps an attached file 30 minutes
    ├── OAuthServlet          GET  /oauth/start, /oauth/callback, POST /oauth/signout
    ├── SettingsServlet       GET/POST /settings              per-user preferences
    └── McpServerRegistry, UserOAuthService, OAuthTokens, RemoteMcpClient

mcp-server (separate module)
    └── the Jahia tools (JahiaMcpTool services), also served to MCP clients at /modules/mcp
```

---

## Prerequisites

- Jahia 8.2+ (tested on 8.2.3.2)
- [mcp-server](https://github.com/Jahia/mcp-server) 0.5+ (a dependency: the module does not start without it)
- [genai-connector](https://github.com/Jahia/genai-connector) with at least one model tier that can run the
  agent (`/modules/genai/status` shows `agentAvailable`). Without it the chat opens and says what is missing.
- To build: Java 17 (`JAVA_HOME` pointing to it) and Maven 3.8. Maven downloads Node and Yarn itself through
  `frontend-maven-plugin`. mcp-server must be in the local Maven repository (`mvn install` it first).

---

## Installation

```bash
git clone https://github.com/smonier/jahia-mcp-chat.git
cd jahia-mcp-chat
JAVA_HOME=/path/to/java17 mvn clean install
```

Deploy `target/jahia-mcp-chat-<version>.jar` from the module administration, or:

```bash
curl -u root:<password> -X POST http://localhost:8080/modules/api/bundles \
  -F "bundle=@target/jahia-mcp-chat-<version>.jar" -F "start=true"
```

Then give genai-connector a model: `karaf/etc/org.jahia.modules.genai.cfg` (`provider`, `api.key`, `model`, and
per tier `<tier>.model` when needed). The shipped default is the Jahia AI gateway, which needs a key.

---

## Configuration

All server-side configuration lives in `digital-factory-data/karaf/etc/` and is picked up without a redeploy.
It can also be edited from **Administration > Server > Configuration > OSGi configurations**, where
"Jahia MCP Chat - MCP server" is a factory: one instance per server.

### Main - `org.jahia.se.modules.mcpchat.cfg`

| Key | Description |
|---|---|
| `DEFAULT_TIER` | Model tier used when a user has not chosen one: `advanced`, `balanced` (default) or `lite` |
| `MAX_TOKENS` | Ceiling on output tokens per model call; 0 keeps the tier's own value |
| `SYSTEM_PROMPT_APPENDIX` | Instructions appended to the assistant's (site conventions, tone, forbidden operations) |
| `PUBLIC_BASE_URL` | Base URL users reach Jahia at, for the OAuth redirect URI. Blank: taken from the request. Set it behind a reverse proxy |

The provider keys of 1.0.0 development builds (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
`DEFAULT_PROVIDER`, `DEFAULT_MODEL`) are no longer read; the log names any left in the file.

### MCP servers - a factory configuration, one instance per server

Each MCP server is one instance of the OSGi factory configuration `org.jahia.se.modules.mcpchat.server`
("Jahia MCP Chat - MCP server" in `/tools/osgi/console/configMgr`, **+** to add one), stored as
`karaf/etc/org.jahia.se.modules.mcpchat.server-<name>.cfg`. Adding, editing or deleting an instance applies at once.
The module ships `server-jahia.cfg` for this Jahia's own MCP server; a remote server is three lines:

```properties
name=analytics
label=Analytics
url=https://mcp.example.com/mcp
```

plus the fields of its authentication: nothing for a per-user OAuth sign-in (users click **Connect**),
`authHeader`/`authValue` for a fixed key, `oauthGrant=client_credentials` with a client id and secret for one shared
account, and `sites=` to limit it to some sites. Its tools reach the assistant as `<name>.<tool>`.

**Full guide:** [docs/mcp-servers.md](docs/mcp-servers.md): every setting, examples per authentication, how
remote tools reach the agent, checking a server, troubleshooting.

### User preferences (gear icon in the chat)

| Section | Content |
|---|---|
| **Model** | Model tier (among those genai-connector can run, with their provider and model), max output tokens (capped by `MAX_TOKENS`) |
| **MCP servers** | Every server of the site with its status (Connected, Not connected, Unavailable) and tool count; **Connect** / **Disconnect** for servers that need a sign-in |
| **Skills** | Markdown files added to the instructions |

### Tool approvals and attachments

A tool that changes something (genai-connector's `MUTATING` tools, remote tools without a `readOnlyHint`) waits
for the user: the chat shows **Allow** / **Deny** above the input. Destructive tools are not offered.

Attached text files are put in the message. Images (JPEG, PNG, GIF, WebP) are sent to the model, which needs a
tier whose model reads images. Every image or other file is also kept 30 minutes for `chat.upload_attachment`,
which puts it in `/sites/<site>/files/<folder>` with the user's session when the model is asked to (not
published).

---

## Security

| Concern | How it is handled |
|---|---|
| LLM keys | None in this module: genai-connector holds them |
| Remote MCP credentials | `authValue`, client secrets and user tokens stay on the server; `/config` never returns them, nor a remote server's URL |
| Who may call | Every servlet refuses guests. `/config` and `/oauth/start` require jContent access to the site; tools run under the calling user |
| Remote calls | Always the configured URL, never a URL from the request; redirects are not followed |
| Attachments | Kept in memory 30 minutes, 10 MB each, 20 per user; only the user who sent one can upload it |
| CSRF | Everything under `/modules/jahia-mcp-chat/*` is under the CSRF guard. Only `/oauth/start` and `/oauth/callback` are whitelisted: they are top-level navigations, and the callback is protected by the OAuth `state` (single use, bound to the session and the user, 10 minutes). genai-connector whitelists its own endpoints, which check the user and a JSON body |
| User tokens | JCR property `mcpchat.oauth.<server>` of the user node, written with the user's own session |

---

## Data kept

| What | Where |
|---|---|
| Tier, max tokens | JCR property `mcpchat.settings` of the user node |
| MCP sign-ins (access and refresh tokens) | JCR properties `mcpchat.oauth.<server>` of the user node |
| OAuth clients the module registered | `oauth-clients.properties` in the bundle's data folder |
| Remote servers' tool lists | `remote-tools.json` in the bundle's data folder |
| Attachments | Memory, 30 minutes |
| Chat history, Skills | Browser `localStorage` |

---

## Project structure

```
jahia-mcp-chat/
├── pom.xml                                  # OSGi bundle, Jahia 8.2 parent, depends on mcp-server
├── package.json / webpack.config.js         # Webpack 5 + Module Federation
├── src/javascript/
│   ├── init.js                              # registers the header action
│   └── McpChat/
│       ├── McpChatAction.jsx / McpChatDrawer.jsx
│       ├── McpSettings.jsx                  # tier, MCP servers, Skills
│       ├── genaiAgent.js                    # genai-connector status, agent stream, approvals, attachments
│       ├── mcpClient.js                     # sign-in popup, sign-out
│       ├── useMcpChat.js                    # conversation
│       ├── csrfToken.js, useConfig.js, useSettings.js
│       └── ChatMessage.jsx, SkillsManager.jsx, fileAttachments.js
├── src/main/java/org/jahia/se/modules/mcpchat/
│   ├── attachment/                          # AttachmentStore, UploadAttachmentTool
│   ├── config/                              # McpChatConfigService, McpServer (+Config), McpServerRegistry
│   ├── oauth/                               # OAuthDiscovery, OAuthTokens, UserOAuthService
│   ├── remote/                              # RemoteMcpClient, RemoteMcpTool, RemoteToolBridge
│   └── servlet/                             # Attachment, Config, OAuth, Settings servlets
└── src/main/resources/
    ├── META-INF/configurations/             # main cfg, server-jahia.cfg, CSRF guard cfg
    └── javascript/apps/, javascript/locales/ # webpack output (committed), en.json, fr.json
```

---

## Development

```bash
JAVA_HOME=/path/to/java17 mvn clean install
curl -u root:<password> -X POST http://localhost:8080/modules/api/bundles \
  -F "bundle=@target/jahia-mcp-chat-<version>.jar" -F "start=true"
```

Never run `yarn dev` from an automated process: it is an interactive watcher. See [CHANGELOG.md](CHANGELOG.md)
for the changes, and [`.agents/`](.agents/README.md) for the notes AI agents read before working on the module.

---

## Related

- [genai-connector](https://github.com/Jahia/genai-connector): the models, and the agent the chat runs on
- [Jahia MCP Server](https://github.com/Jahia/mcp-server): the Jahia tools
- [Jahia UI Extender](https://github.com/Jahia/javascript-components): the React 18 back-office extension framework
- [Model Context Protocol, authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization): the sign-in flow the module follows
