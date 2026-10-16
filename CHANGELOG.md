# Changelog

All notable changes to Jahia MCP Chat. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 1.0.0-SNAPSHOT

### Added

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
  servers and images stay on the module's own providers.

### Changed

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
