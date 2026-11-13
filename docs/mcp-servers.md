# Adding MCP servers to the chat

The chat's assistant uses the tools of every MCP server configured for the site: the Jahia MCP server of the
instance itself, and any remote MCP server you add. This page explains how servers are configured, how to add
one, and how to check it works.

## How it is configured: one factory instance per server

MCP servers are an **OSGi factory configuration**:

| | |
|---|---|
| Factory PID | `org.jahia.se.modules.mcpchat.server` |
| Name in the OSGi configuration screen | **Jahia MCP Chat - MCP server** |
| One instance = one server | file `org.jahia.se.modules.mcpchat.server-<name>.cfg`, console id `org.jahia.se.modules.mcpchat.server~<name>` |
| Where the files live | `digital-factory-data/karaf/etc/` |
| When a change applies | at once: adding, editing or deleting an instance adds, changes or removes the server, no redeploy |

The module ships one instance, `server-jahia.cfg`, which names this Jahia's own MCP server (`url=/modules/mcp`)
in the chat settings. Every other server is one more instance of the same factory.

The general settings of the chat (default model tier, output ceiling, prompt appendix, public URL) are a
separate, single configuration, `org.jahia.se.modules.mcpchat`. They are not per server.

## Before you start

- The server speaks **MCP over HTTP** (streamable HTTP; JSON or SSE answers) at an `https://` URL that the Jahia
  server can reach. A server that only runs as a local command (stdio) must first be exposed over HTTP.
- You know how it authenticates callers: each user signs in with OAuth, a fixed key or token, one shared OAuth
  account, or nothing.
- You choose a short **name**: lowercase letters, digits, `-` and single `_` (no `__`). The server's tools reach
  the assistant as `<name>.<tool>`, so keep it short and do not change it later.

## Add a server

### From the browser (also on Jahia Cloud)

1. Sign in as a server administrator and open `/tools/osgi/console/configMgr`.
2. Find **Jahia MCP Chat - MCP server** and click **+** (create a new factory configuration).
3. Fill in at least **Name**, **Label** and **URL**, then the fields of its authentication (see below).
4. Save. The instance is written to `karaf/etc` and the server is live.

To change a server, open its instance (`org.jahia.se.modules.mcpchat.server~<name>`) and save; to remove it, delete
the instance.

### As a file

Create `digital-factory-data/karaf/etc/org.jahia.se.modules.mcpchat.server-<name>.cfg`, owned by the user Jahia
runs as (`tomcat` in the Docker image; a file owned by root is read, but the screen cannot save it):

```properties
name=<name>
label=<name shown in the chat settings>
url=https://<server>/mcp
```

The part of the file name after the dash is the instance id; when `name` is empty it is also the server's name.

## Settings of a server

| Key | Default | Description |
|---|---|---|
| `name` | file suffix | Prefix of the server's tools (`<name>.<tool>`). Lowercase letters, digits, `-`, single `_` |
| `label` | `name` | Name shown in the chat settings and given to the assistant |
| `url` | (required) | `https://...` for a remote server. A relative URL (`/modules/mcp`) names this Jahia's own server |
| `authHeader` | `Authorization` | Header that carries a fixed credential |
| `authValue` | empty | Its value, e.g. `Bearer <token>`. A password field in the screen; never sent to the browser |
| `oauthGrant` | `authorization_code` | `authorization_code`: each user signs in. `client_credentials`: one account for every user |
| `oauthClientId` | empty | For `authorization_code`, a client the server gave you (empty: the module registers itself). Required for `client_credentials` |
| `oauthClientSecret` | empty | Secret of that client, when it has one |
| `oauthScope` | empty | Scopes to request. Empty: the scopes the server advertises |
| `oauthTokenUrl` | empty | Token endpoint for `client_credentials`. Empty: discovered from the server's metadata |
| `timeoutMs` | `60000` | Timeout of a call to the server |
| `sites` | empty | Comma-separated site keys whose chat may use the server. Empty: every site |
| `enabled` | `true` | `false` hides the server and its tools |

Credentials (`authValue`, client secrets, users' tokens) stay on the server: the chat's configuration answer never
contains them, nor a remote server's URL.

## Examples by authentication

### Each user signs in with OAuth

```properties
name=analytics
label=Analytics
url=https://mcp.example.com/mcp
```

Nothing else is needed when the server supports dynamic client registration: the module reads its OAuth metadata,
registers itself as "Jahia MCP Chat", and each user clicks **Connect** in the chat settings once. If the server
refuses self-registration (a 403 whose reason the chat shows, for example a "Trusted Hosts" policy), ask its
operator for a client whose redirect URI is `<PUBLIC_BASE_URL>/modules/jahia-mcp-chat/oauth/callback` and set
`oauthClientId` (and `oauthClientSecret` for a confidential client). Behind a reverse proxy, set `PUBLIC_BASE_URL`
in `org.jahia.se.modules.mcpchat.cfg` so that URI matches what the operator registered.

### A fixed key or token

```properties
name=crm
label=CRM
url=https://crm.example.com/mcp
authHeader=Authorization
authValue=Bearer <token>
```

Some servers take another header, e.g. `authHeader=X-API-Key` and `authValue=<key>`.

### One shared account for every user

```properties
name=catalog
label=Product catalog
url=https://catalog.example.com/mcp
oauthGrant=client_credentials
oauthClientId=<client id>
oauthClientSecret=<client secret>
oauthScope=catalog:read
```

### Only on some sites

Add `sites=digitall,intranet` to any of the above: the server shows in the chat of those sites only, and the
assistant is not given its tools elsewhere.

## Check that it works

1. Open the chat on a site the server is allowed on, tab **Settings**, section **MCP servers**. The server is
   listed with a status:
   - **Connected** and a tool count: ready.
   - **Not connected - sign in required**: click **Connect** (per-user OAuth servers).
   - **Unavailable**: no tool could be read yet; see below.
2. Its tools appear about a minute after the configuration is saved for a server with a fixed or shared
   credential, and right after **Connect** for a per-user server (its tool list is read with a user's token).
3. Ask the assistant something only that server can answer. Its tool calls show in the conversation as
   `<name>.<tool>`; a call that changes something waits for **Allow**.

As an administrator you can also open `/modules/genai/status`: the server's tools are listed there with the
Jahia tools, named `<name>.<tool>`.

## When it does not work

| Symptom | Likely cause |
|---|---|
| The server is not in the chat settings | `enabled=false`, a `name` with forbidden characters, a `url` that is neither `http(s)://...` nor relative, or a `sites` list without this site |
| **Unavailable** | The server cannot be reached from the Jahia server, or it refused the credential. The Jahia log says which: `grep RemoteToolBridge` (`Could not list the tools of MCP server <name>: ...`) |
| **Connect** fails with a 403 | The server refuses self-registration: get a client id from its operator (see "Each user signs in") |
| **Connect** fails on the callback | The redirect URI the server knows differs from Jahia's public URL: set `PUBLIC_BASE_URL` |
| The assistant answers "sign in first" | The user has not clicked **Connect**, or their sign-in expired and could not be refreshed |
| Tools listed, calls fail | Read the tool's error in the conversation (open its details). The log has it at debug level: `Remote tool call to <name> failed` |

The module keeps the last tool list of each server in its data folder (`remote-tools.json`), so the tools come
back after a restart before the server is reached again.

## What happens behind the scenes

genai-connector's agent runs the tools registered in Jahia as `JahiaMcpTool` services. For each remote server, the
module reads the server's tool list and registers one such service per tool, named `<name>.<tool>`; a call goes to
the server with the server's credential: the calling user's own token, the shared token, or the fixed header.
Those services are also listed by the Jahia MCP server at `/modules/mcp`, so other MCP clients of the instance see
the tools too, each call still made with that user's own credential. Details: the module's
[`.agents/context/architecture.md`](../.agents/context/architecture.md).
