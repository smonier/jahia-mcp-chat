# Jahia MCP Chat

A **Jahia jContent UI extension** that adds a side-drawer chat panel powered by an LLM of your choice. The assistant is connected to the [Jahia MCP server](https://github.com/Jahia/jahia-mcp), giving it full access to your site's content, pages, and configuration — all from a natural-language conversation inside jContent.

---

## What it does

- Opens a chat drawer directly in the jContent back-office (left nav icon)
- Routes your messages to an LLM (Anthropic, OpenAI, or DeepSeek)
- Runs a full **agentic loop** — the assistant chains tool calls until the task is fully complete, without stopping after each step
- Shows a **live token counter** per response (input / output / total)
- **Persists settings in JCR** under each user's node — survives browser restarts, machine changes, and Jahia restarts
- Persists chat history across panel close/reopen via `localStorage`
- Supports custom **Skills** (upload `.md` files or pull from a GitHub raw URL) to extend what the assistant knows

---

## UI overview

```
┌──────────────────────────────────────────┐
│ Jahia MCP Chat           [🔄] [⚙] [✕]   │
├──────────────────────────────────────────┤
│ ⚙ Tools (32)                            │
├──────────────────────────────────────────┤
│                                          │
│  🔧 site.list ✓                         │
│     3 sites: digitall, acme, test        │
│                                          │
│  Here are the sites on your Jahia        │
│  instance: digitall, acme, test.         │
│                                          │
│  ◈ 1.2k↑ 342↓  1.5k                    │
├──────────────────────────────────────────┤
│  Ask anything…              [▶]          │
└──────────────────────────────────────────┘
```

---

## Architecture

```
jContent browser
    └── McpChatPanel (React 18, Module Federation)
            └── McpChatDrawer
                    ├── useMcpChat      agentic loop, streaming, history
                    ├── useSettings     JCR-backed persistence + localStorage cache
                    ├── ChatMessage     bubbles, tool call blocks, token badge
                    ├── McpSettings     MCP endpoint + LLM config + Skills
                    └── SkillsManager   upload .md / pull from GitHub

Java OSGi layer
    ├── LlmProxyServlet   /modules/jahia-mcp-chat/llm-proxy
    │       ├── → api.anthropic.com/v1/messages
    │       ├── → api.openai.com/v1/chat/completions
    │       └── → api.deepseek.com/v1/chat/completions
    └── SettingsServlet   /modules/jahia-mcp-chat/settings
            └── JCR: {userNode}/mcp-chat-settings (jnt:content, data property)

Jahia MCP server (separate module)
    └── /modules/mcp   JSON-RPC 2.0 endpoint for Jahia tools
```

**LLM API calls** are never made from the browser — `LlmProxyServlet` forwards them server-side and streams the SSE response back, avoiding all CORS issues.

**Settings** are read and written by `SettingsServlet` using the current user's authenticated JCR session. No credentials are stored in plain text anywhere on the server.

---

## Supported LLM providers

| Provider | Models |
|---|---|
| **Anthropic** | Claude Sonnet 4.6, Claude Opus 4.8, Claude Haiku 4.5 |
| **OpenAI** | GPT-4o, GPT-4o Mini, o1, o3-mini |
| **DeepSeek** | DeepSeek V4 Flash, DeepSeek Chat (V3), DeepSeek Reasoner (R1) |

DeepSeek uses the OpenAI-compatible API format — the same agentic loop handles all three.

---

## Prerequisites

- Jahia 8.2+ running locally or remotely
- [Jahia MCP server](https://github.com/Jahia/jahia-mcp) installed and running
- A personal API token for your Jahia instance
- An API key for at least one LLM provider
- Node 18+ and Yarn 1.x (for front-end development)
- Java 17 (for Maven build)

---

## Installation

### Option A — Build from source

```bash
git clone https://github.com/smonier/jahia-mcp-chat.git
cd jahia-mcp-chat

# Front-end + Java build
JAVA_HOME=/path/to/java17 mvn clean install

# Copy target/jahia-mcp-chat-*.jar to $JAHIA_HOME/data/modules/
# or: mvn jahia:deploy (if jahia-maven-plugin is configured)
```

### Option B — Install the JAR directly

Download the latest release JAR from the [Releases](https://github.com/smonier/jahia-mcp-chat/releases) page and drop it into your Jahia modules folder.

---

## Configuration

Open jContent and click the **chat bubble icon** in the left navigation bar. Go to **Settings** (gear icon) on first use:

### MCP Server

| Field | Description |
|---|---|
| **Endpoint URL** | URL of your Jahia MCP server, e.g. `http://localhost:8080/modules/mcp` |
| **API Token** | Your Jahia personal API token (authenticates MCP tool calls) |

### LLM Provider

| Field | Description |
|---|---|
| **Provider** | Anthropic, OpenAI, or DeepSeek |
| **Model** | Model for the selected provider (defaults to the recommended model) |
| **API Key** | Your LLM provider API key (`sk-ant-…`, `sk-…`, or DeepSeek key) |
| **Max output tokens** | Output token budget per LLM response (default: 4096, range: 256–32000) |

**Settings are stored in JCR** under your user node — they persist across browser restarts and are tied to your Jahia account, not the browser. On panel open, settings are loaded from the server first; `localStorage` is kept as a fast-read cache.

---

## Skills

Skills are Markdown documents prepended to the system prompt on every message. They extend what the assistant knows — custom workflows, content conventions, site-specific rules.

**Upload a `.md` file** — click the upload button in the Skills section of settings.

**Pull from GitHub** — paste a raw GitHub URL (e.g. `https://raw.githubusercontent.com/org/repo/main/SKILL.md`) and click Pull.

Loaded skills appear as chips and can be removed individually. Skills are stored in `localStorage` (per browser) since they can be large files.

---

## Token consumption

Each assistant response shows a small badge under the message bubble:

```
◈  1.2k↑  342↓  1.5k
```

| Symbol | Meaning |
|---|---|
| `↑` | Input tokens — prompt + history + system prompt + tool results |
| `↓` | Output tokens — assistant text + tool call arguments |
| last value | Total for that response |

Numbers ≥ 1000 are shown as `1.2k`. Hover the badge for exact counts.

The token budget per response is controlled by **Max output tokens** in settings. If the LLM hits the limit mid-response, the agentic loop detects assembled tool calls and continues anyway rather than dropping work silently.

---

## Settings persistence

| What | Where | Survives restart? |
|---|---|---|
| MCP endpoint, API keys, model, max tokens | JCR `{userNode}/mcp-chat-settings` | Yes — server-side, per user |
| Chat history | `localStorage` | Yes — browser-local |
| Skills | `localStorage` | Yes — browser-local |

If the JCR servlet is unreachable (e.g. not logged in), the panel falls back to `localStorage` silently.

---

## Project structure

```
jahia-mcp-chat/
├── pom.xml                              # Maven OSGi bundle (Java 17, Jahia 8.2)
├── package.json / webpack.config.js     # Webpack 5 + Module Federation
├── src/
│   ├── javascript/
│   │   ├── index.js                     # jahiaApp-init:50 registration callback
│   │   ├── init.js                      # loadNamespaces + register drawer action
│   │   └── McpChat/
│   │       ├── McpChatDrawer.jsx        # Main drawer shell + header
│   │       ├── ChatMessage.jsx          # Message bubbles, tool call blocks, token badge
│   │       ├── McpSettings.jsx          # Settings panel (MCP + LLM + Skills)
│   │       ├── SkillsManager.jsx        # Upload / GitHub pull for .md skills
│   │       ├── useMcpChat.js            # Agentic loop, SSE streaming, history
│   │       └── useSettings.js           # JCR-backed settings with localStorage cache
│   └── main/java/.../servlet/
│       ├── LlmProxyServlet.java         # Server-side LLM proxy — CORS + SSE streaming
│       └── SettingsServlet.java         # Per-user JCR settings GET/POST
└── src/main/resources/
    ├── javascript/apps/                 # Webpack output (committed)
    └── javascript/locales/              # en.json, fr.json
```

---

## Development

```bash
# Front-end only (fast iteration)
yarn build

# Full build (front-end + Java OSGi bundle)
JAVA_HOME=/path/to/java17 mvn clean install

# Deploy JAR to running Jahia
cp target/jahia-mcp-chat-*.jar $JAHIA_HOME/data/modules/
```

> Never run `yarn dev` from an automated process — it is an interactive file watcher for human use only.

---

## How the agentic loop works

1. User sends a message
2. The LLM receives a system prompt containing: MCP tool catalog with full parameter signatures, loaded Skills, and the current jContent site context
3. If the LLM emits a `mcp_call` tool use block, the hook executes it against the Jahia MCP server and feeds the summarized result back
4. Steps 3 repeat until `stop_reason: end_turn` — the LLM decides when the task is done
5. The final text response is displayed with a token usage badge

**Token optimization:** results are summarized by type before being fed back to the LLM (e.g. a 200-node list becomes a 30-item summary). Older turns in the history are progressively compressed. History is trimmed to the last 20 turns.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

## Related

- [Jahia MCP Server](https://github.com/Jahia/jahia-mcp) — the MCP tools this chat panel connects to
- [Jahia JavaScript Modules](https://github.com/Jahia/javascript-modules) — the React 19 template set framework
- [Jahia UI Extender](https://github.com/Jahia/javascript-components) — the React 18 back-office extension framework used here
