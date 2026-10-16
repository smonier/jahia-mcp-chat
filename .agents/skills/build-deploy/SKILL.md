---
name: build-deploy
description: Build jahia-mcp-chat, deploy it to a local Jahia and check it works (bundle state, config files, CSRF, MCP servers, sign-in)
---

# Build, deploy and check jahia-mcp-chat

1. Build with Java 17 (Java 25 breaks `maven-bundle-plugin`):
   ```bash
   JAVA_HOME=/opt/homebrew/opt/openjdk@17 mvn clean install -q
   ```
   The jar must contain `javascript/apps/remoteEntry.js`, `OSGI-INF/metatype/...McpServerConfig.xml` and the
   three files of `META-INF/configurations/`.
2. Find the Jahia port first (`docker ps`): it is not always 8080. Deploy:
   ```bash
   curl -s -u root:<password> -X POST http://localhost:<port>/modules/api/bundles \
     -F "bundle=@target/jahia-mcp-chat-1.0.0-SNAPSHOT.jar" -F "start=true"
   curl -s -u root:<password> "http://localhost:<port>/modules/api/bundles/org.jahia.se.modules/org.jahia.se.modules.jahiaMcpChat/1.0.0.SNAPSHOT/_localInfo"
   ```
   Expect `ACTIVE` / `STARTED`. The local tools need the `mcp-server` module too: `/modules/mcp` answering 404
   means it is missing.
3. Read the deployed configuration back from the container (`karaf/etc`): a file with the
   `# default configuration` marker is never replaced by a redeploy. The CSRF guard cfg must contain the
   `whitelist` line.
4. Check the factory: `/tools/osgi/console/configMgr` lists `org.jahia.se.modules.mcpchat.server~<name>`.
5. Check `/config` from a signed-in browser (curl without the CSRF token is refused with a 302 to
   `/error.html`, which is the guard working): fetch the master token from `/modules/CsrfServlet`, POST it for
   page tokens, then call `/config?site=<key>` three times in a row; all must answer 200.
6. A remote OAuth server: `curl -u root:<password> -D - ".../modules/jahia-mcp-chat/oauth/start?server=<name>&site=<key>"`
   must redirect to the server's authorization endpoint (not `/error.html`). Failures are logged by
   `UserOAuthService` and `McpProxyServlet`: `docker logs --since 10m <container> | grep -E "UserOAuthService|McpProxyServlet"`.
7. Update `CHANGELOG.md` and the README in the same commit.
