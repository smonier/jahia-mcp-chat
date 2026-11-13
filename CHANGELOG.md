# Changelog

All notable changes to Jahia MCP Chat. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.2] - 2026-11-13

### Added

- End-to-end tests in `tests/` (Cypress 13, `@jahia/cypress`): the servlets' access rules and CSRF decisions, no
  server URL or credential in the browser's configuration, servers per site, attachments; the drawer's docking,
  Settings, Markdown answers, tool calls and approvals with genai-connector stubbed, and an axe WCAG 2.1 AA check.
- `docs/mcp-servers.md`: how to add an MCP server (the factory configuration, from the console or as a file),
  every setting, examples per authentication, checks and troubleshooting. The README links to it.

### Fixed

- The Chat and Settings tab labels failed WCAG AA contrast (Moonstone's #00a0e3 selected, 2.9:1, and #7a7f88
  unselected, 4.0:1): they use jContent's darker accent and dark grey.

## [1.0.1] - 2026-11-13

### Fixed

- Answers the model wraps in a ```markdown fence, or indents by four spaces, rendered as one block of raw Markdown
  (the indentation made it a code block). The fence is unwrapped, the indentation the lines share is removed, and
  a fenced block marked `markdown` renders as Markdown.

### Changed

- Answers are a card across the drawer's width: headings with an accent rule, accent list markers, tables in their
  own scroll box with a tinted header and striped rows, code in a monospace font, styled quotes and rules.

## [1.0.0] - 2026-11-13

First release. A jContent chat drawer, docked beside the page under edit, that runs on genai-connector's agent
with the Jahia MCP tools and the tools of any remote MCP server configured for the site. The module holds no LLM
key and talks to no LLM provider itself. Requires Jahia 8.2, mcp-server 0.5+ and genai-connector with a model
tier able to run the agent. Breaking for any instance that ran an October development build (see below).

### Changed

- Every conversation runs on genai-connector's streamed agent (`/modules/genai/agent/stream`) on a model tier
  (`advanced`, `balanced`, `lite`). The settings offer the tiers the connector can run, with their provider and
  model, instead of a provider and a model.
- `org.jahia.se.modules.mcpchat.cfg`: `DEFAULT_TIER` replaces `DEFAULT_PROVIDER` and `DEFAULT_MODEL`;
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` are no longer read (the log names any left);
  `MAX_TOKENS` is a ceiling, 0 for the tier's own value.
- Remote MCP servers are bridged: the module registers each of their tools as a `JahiaMcpTool` service named
  `<server>.<tool>`, which the agent runs with the calling user's sign-in, a shared client-credentials token or
  a fixed header. Tool lists are read with that credential and kept in `remote-tools.json`. The servers' `sites`
  restrict the tools the chat lets the agent use. The bridged tools are also listed by the Jahia MCP server.
- The Jahia tools run in-process in the connector under the user's permissions, instead of the browser calling
  `/modules/mcp`.
- Attached images go to the model as images; images and other files are kept 30 minutes for the new
  `chat.upload_attachment` tool (`AttachmentServlet`, `UploadAttachmentTool`), which puts them in the media
  library with the user's session.
- A tool that changes something waits for **Allow** / **Deny** in the chat; destructive tools are not offered.
- `mcp-server` is a module dependency.
- A refused client registration shows the authorization server's reason and what to do (trust the Jahia host,
  or register a client and set `oauthClientId`), instead of a bare status code. BotRank refuses self-registration
  from non-localhost hosts ("Trusted Hosts" policy).

- The drawer docks in jContent's content area beside the page under edit, like content-governance's (`useDock`:
  the page narrows, the width is dragged on the left edge and remembered, Escape closes), with **Chat** and
  **Settings** tabs. The whole UI is built from Moonstone components (`Paper`, `Tab`, `Banner`, `Chip`, `Button`,
  `Dropdown`, `Input`, `Textarea`, `Typography`, `Loader`); custom CSS is layout only.

- Answers render as Markdown (`react-markdown` with `remark-gfm`: lists, tables, code, links in a new tab). Raw HTML
  in an answer is ignored and unsafe link protocols are dropped: answers are model output.

### Removed

- `LlmProxyServlet` (`/llm-proxy`) and the Anthropic, OpenAI and DeepSeek loops in the browser.
- `McpProxyServlet` (`/mcp`): remote servers are called from the bridge, never from the browser.
- The `allowedTools` workaround for tool schemas with `$ref`, fixed in genai-connector (Jahia/genai-connector#12).
- The unused `McpChatPanel` and `ModelSelector` components.

## Development builds before 1.0.0 (October 2026, never released)

First release: a jContent chat drawer driving Jahia and other MCP servers with the LLM of your choice.

Requires Jahia 8.2 (tested on 8.2.3.2 with jahia-csrf-guard 4.3.0) and the Jahia MCP server module for the local
tools; genai-connector is optional.

### Upgrading from a development build

- Move `MCP_ENDPOINT` out of `org.jahia.se.modules.mcpchat.cfg`: the local server is now
  `org.jahia.se.modules.mcpchat.server-jahia.cfg`, shipped with the module. `MCP_JWT_TOKEN` is gone.
- Saved preferences from earlier builds were never stored (see Fixed): users pick their provider and model once.

### Added

- LLM chat drawer from the **MCP Chat** button of the jContent header toolbar: Anthropic, OpenAI and DeepSeek
  through a server-side proxy (`LlmProxyServlet`), agentic tool loop, streaming, token counter, history in the
  browser, Skills (Markdown added to the system prompt).
- Several MCP servers, one OSGi factory configuration each
  (`org.jahia.se.modules.mcpchat.server-<name>.cfg`, "Jahia MCP Chat - MCP server" in the OSGi configurations
  screen). The module ships `server-jahia.cfg` for the local Jahia MCP server and falls back to `/modules/mcp`
  when no server is configured.
- Tools reach the LLM as `<server>__<tool>`; the system prompt lists the servers.
- Remote MCP servers (absolute `url`) are called through `McpProxyServlet` (`/modules/jahia-mcp-chat/mcp`),
  which adds the server's credentials server-side. Local servers stay browser-direct with the user's session.
- MCP handshake (`initialize`, `Mcp-Session-Id`) and SSE answers from streamable HTTP servers.
- Per-user OAuth sign-in to remote servers, as MCP clients do it: metadata discovery (RFC 9728, RFC 8414),
  dynamic client registration (RFC 7591), authorization code with PKCE, tokens per user refreshed
  automatically (`OAuthServlet`, `UserOAuthService`). Works with BotRank from its URL alone.
- `oauthGrant=client_credentials` for one account shared by every user, `authHeader`/`authValue` for a fixed
  credential.
- Per-server `sites` allow-list, `enabled`, `timeoutMs`; servers offered only on a site the user has
  jContent access to.
- MCP servers section in the chat settings: status (Connected, Not connected, Unavailable), tool count,
  Connect / Disconnect. EN and FR labels.
- `PUBLIC_BASE_URL` in the main configuration, for the OAuth redirect URI behind a reverse proxy.
- `upload_attachment` tool: chat attachments uploaded to the site's media library.
- `.docx` attachments read in the browser (converted to HTML).
- **Jahia GenAI** provider when the genai-connector module is installed: the conversation runs on the connector's
  server-side agent with the Jahia MCP tools, with Allow / Deny for tool calls that need approval. Remote MCP
  servers and images stay on the module's own providers. Jahia tools whose schema uses `$ref` (`content.create`,
  `content.update`) are left out until Jahia/genai-connector#15 is fixed. Tested on 8.2.3.2 with DeepSeek.

### Changed

- The system prompt answers general questions (knowledge, writing, translation, code) directly, and calls tools
  only for the site and the connected services.
- `MCP_ENDPOINT` and `MCP_JWT_TOKEN` are removed from `org.jahia.se.modules.mcpchat.cfg`: MCP servers have
  their own files.
- `/config` takes `?site=<key>` and returns the site's MCP servers, without credentials or remote URLs.
- Per-user preferences are stored in the `mcpchat.settings` property of the user node.
- The CSRF guard configuration ships without the `# default configuration` marker, so a new release replaces
  it on instances that already ran the module.

### Fixed

- CSRF: the client asks the guard for per-URI page tokens (the master token is refused about 2 s after its
  first use) and merges the `pageTokens` JSON the guard answers in its `CSRFTOKEN` response header. Before, the
  JSON was sent back as the token and every request after the first one went to `/error.html`.
- Per-user preferences were never saved: a user node accepts no `nt:unstructured` child node.
- The MCP Chat button did not show: `requireModuleInstalledOnSite` used the Maven artifact id instead of the
  bundle symbolic name, and `useNodeChecks` rendered nothing while loading. Both removed.

### Security

- Guests refused on every servlet; API keys and MCP credentials kept server-side; CORS and token exposure
  fixed; user-submitted MCP tokens never stored.

[Unreleased]: https://github.com/smonier/jahia-mcp-chat/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/smonier/jahia-mcp-chat/releases/tag/v1.0.2
[1.0.1]: https://github.com/smonier/jahia-mcp-chat/releases/tag/v1.0.1
[1.0.0]: https://github.com/smonier/jahia-mcp-chat/releases/tag/v1.0.0
