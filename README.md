# Jahia MCP Chat

A **Jahia jContent UI extension** that adds a side-drawer chat panel powered by an LLM of your choice. The assistant is connected to the [Jahia MCP server](https://github.com/Jahia/jahia-mcp), giving it full access to your site's content, pages, and configuration — all from a natural-language conversation inside jContent.

---

## What it does

- Opens a chat drawer directly in the jContent back-office (left nav icon)
- Routes your messages to an LLM (Anthropic, OpenAI, or DeepSeek)
- The LLM calls Jahia MCP tools autonomously — listing sites, browsing content types, creating or updating nodes, listing pages, and more
- Runs an agentic loop: the assistant chains tool calls until the task is fully complete, without stopping after each step
- Shows a live token counter per response (input / output / total)
- Persists chat history across panel close/reopen via `localStorage`
- Supports custom Skills (upload `.md` files or pull from a GitHub raw URL) to extend what the assistant knows

---

## Screenshots

> Chat panel inside jContent with tool call trace and token counter

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
                    ├── useMcpChat (agentic loop, history, streaming)
                    ├── ChatMessage (bubbles, tool call blocks, token badge)
                    ├── McpSettings (MCP endpoint + LLM config + Skills)
                    └── SkillsManager (upload .md / pull from GitHub)

Java OSGi layer
    └── LlmProxyServlet  ← server-side CORS proxy
            ├── → api.anthropic.com/v1/messages
            ├── → api.openai.com/v1/chat/completions
            └── → api.deepseek.com/v1/chat/completions

Jahia MCP server (separate module)
    └── /modules/mcp  ← JSON-RPC 2.0 endpoint for Jahia tools
```

The LLM API is **never called directly from the browser**. All requests go through `LlmProxyServlet`, a Jahia-registered OSGi servlet at `/modules/jahia-mcp-chat/llm-proxy`, which forwards the request server-side and streams the SSE response back.

---

## Supported LLM providers

| Provider | Models |
|---|---|
| **Anthropic** | Claude Sonnet 4.6, Claude Opus 4.8, Claude Haiku 4.5 |
| **OpenAI** | GPT-4o, GPT-4o Mini, o1, o3-mini |
| **DeepSeek** | DeepSeek V4 Flash, DeepSeek Chat (V3), DeepSeek Reasoner (R1) |

Provider and model are selected in the settings panel. Your API key is stored in `localStorage` and sent via the `X-API-Key` header to the proxy servlet — it never leaves your machine in plaintext.

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

# Front-end build
yarn install
yarn build

# Maven build + deploy
JAVA_HOME=/path/to/java17 mvn clean install
# Copy target/jahia-mcp-chat-*.jar to $JAHIA_HOME/data/modules/
# or: mvn jahia:deploy (if jahia-maven-plugin is configured)
```

### Option B — Install the JAR directly

Download the latest release JAR from the [Releases](https://github.com/smonier/jahia-mcp-chat/releases) page and drop it into your Jahia modules folder.

---

## Configuration

Open jContent and click the **chat bubble icon** in the left navigation bar. The first time, go to **Settings** (gear icon) and fill in:

| Field | Description |
|---|---|
| **MCP Endpoint URL** | URL of your Jahia MCP server, e.g. `http://localhost:8080/modules/mcp` |
| **API Token** | Your Jahia personal API token (used to authenticate MCP calls) |
| **Provider** | Anthropic, OpenAI, or DeepSeek |
| **Model** | Model to use for this provider |
| **API Key** | Your LLM provider API key (`sk-ant-…`, `sk-…`, or DeepSeek key) |

Settings are persisted in `localStorage` per browser.

---

## Skills

Skills are Markdown documents that extend what the assistant knows. They are prepended to the system prompt on every message.

**Upload a `.md` file** — click the upload button in the Skills section of settings and pick any Markdown file from your machine.

**Pull from GitHub** — paste a raw GitHub URL (e.g. `https://raw.githubusercontent.com/org/repo/main/SKILL.md`) and click Pull.

Loaded skills appear as chips and can be removed individually.

---

## Token consumption

Each assistant response shows a small badge:

```
◈  1.2k↑  342↓  1.5k
```

- `↑` input tokens (prompt + history + system prompt + tool results)
- `↓` output tokens (assistant response + tool call arguments)
- last number: total for that response

Numbers above 1 000 are shown as `1.2k`. Hover the badge for the exact counts.

---

## Project structure

```
jahia-mcp-chat/
├── pom.xml                              # Maven OSGi bundle
├── package.json / webpack.config.js     # Front-end build
├── src/
│   ├── javascript/
│   │   ├── index.js                     # jahiaApp-init:50 registration
│   │   ├── init.js                      # loadNamespaces + register drawer action
│   │   └── McpChat/
│   │       ├── McpChatDrawer.jsx        # Main drawer shell
│   │       ├── ChatMessage.jsx          # Bubbles, tool call blocks, token badge
│   │       ├── McpSettings.jsx          # Settings panel (MCP + LLM + Skills)
│   │       ├── SkillsManager.jsx        # Upload / GitHub pull for .md skills
│   │       ├── useMcpChat.js            # Agentic loop, streaming, history
│   │       └── useSettings.js           # localStorage persistence
│   └── main/
│       └── java/.../servlet/
│           └── LlmProxyServlet.java     # Server-side LLM proxy (CORS, streaming)
└── src/main/resources/
    ├── javascript/apps/                 # Webpack output (committed)
    └── javascript/locales/              # en.json, fr.json
```

---

## Development

```bash
# Watch build (human dev only — never use in agents)
yarn dev

# One-shot build
yarn build

# Build + deploy to running Jahia
yarn build && yarn jahia-deploy   # if jahia-deploy script is configured
# or
JAVA_HOME=/path/to/java17 mvn install
```

Front-end changes: edit files under `src/javascript/`, run `yarn build`, redeploy the bundle.

Java changes (proxy servlet): run `mvn install` — this rebuilds both front-end and Java, repackages the OSGi bundle.

---

## How the agentic loop works

1. User sends a message
2. The LLM receives the full system prompt (MCP tool catalog + loaded skills + site context)
3. If the LLM calls `mcp_call`, the hook executes the tool against the Jahia MCP server
4. The tool result is summarized (to save tokens) and fed back to the LLM
5. Steps 3-4 repeat until the LLM returns `stop_reason: end_turn`
6. The final text response is displayed; older turns are compressed to keep token usage low

Chat history is trimmed to the last 20 turns; old tool result blocks are capped at 500 characters.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

## Related

- [Jahia MCP Server](https://github.com/Jahia/jahia-mcp) — the MCP tools this chat panel connects to
- [Jahia JavaScript Modules](https://github.com/Jahia/javascript-modules) — the React 19 template set framework
- [Jahia UI Extender](https://github.com/Jahia/javascript-components) — the React 18 back-office extension framework used here
