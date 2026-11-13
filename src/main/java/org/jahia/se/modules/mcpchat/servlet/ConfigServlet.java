package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.se.modules.mcpchat.config.McpServerRegistry;
import org.jahia.se.modules.mcpchat.oauth.UserOAuthService;
import org.jahia.se.modules.mcpchat.remote.RemoteToolBridge;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.content.JCRSessionWrapper;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.jcr.RepositoryException;
import javax.servlet.Servlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Exposes non-sensitive OSGi configuration to the front-end.
 * MCP server credentials are never included, nor a remote server's URL. Models and keys belong to genai-connector.
 * Open to authenticated users only (guests receive 401).
 *
 * GET /modules/jahia-mcp-chat/config?site=&lt;siteKey&gt;
 * Response: { defaultTier, maxTokens, systemPromptAppendix,
 *             mcpServers: [{ name, label, local, signIn, signedIn, tools: [Jahia tool names] }],
 *             blockedTools: [remote tool names of servers not allowed on that site] }
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/config", "allow-api-token=true"},
        immediate = true)
public class ConfigServlet extends HttpServlet {

    @Reference
    private McpChatConfigService configService;

    @Reference
    private McpServerRegistry serverRegistry;

    @Reference
    private UserOAuthService userOAuth;

    @Reference
    private RemoteToolBridge bridge;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");

        if (ServletSupport.isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }

        res.setContentType("application/json;charset=UTF-8");

        String siteKey = ServletSupport.accessibleSite(req.getParameter("site"));
        JCRSessionWrapper userSession = userSession();
        List<McpServer.Snapshot> servers = siteKey == null ? List.of() : serverRegistry.getServers(siteKey);
        String serversJson = servers.stream()
                .map(s -> serverJson(s, signedIn(s, userSession)))
                .collect(Collectors.joining(",", "[", "]"));
        Set<String> allowed = servers.stream().map(s -> s.name).collect(Collectors.toSet());
        String blockedJson = bridge.allToolNames().entrySet().stream()
                .filter(e -> !allowed.contains(e.getKey()))
                .flatMap(e -> e.getValue().stream())
                .map(ServletSupport::json)
                .collect(Collectors.joining(",", "[", "]"));

        res.getWriter().write("{\"defaultTier\":" + ServletSupport.json(configService.getDefaultTier())
                + ",\"maxTokens\":" + configService.getMaxTokens()
                + ",\"systemPromptAppendix\":" + ServletSupport.json(configService.getSystemPromptAppendix())
                + ",\"mcpServers\":" + serversJson
                + ",\"blockedTools\":" + blockedJson + "}");
    }

    /** Signed in to a per-user server; reads its tool list in the background when it is missing or old. */
    private boolean signedIn(McpServer.Snapshot s, JCRSessionWrapper userSession) {
        if (!s.usesUserSignIn() || userSession == null) {
            return false;
        }
        try {
            String token = userOAuth.accessToken(s, userSession);
            if (token != null) {
                bridge.refreshForUser(s, userSession.getUser().getName(), token, false);
            }
            return token != null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static JCRSessionWrapper userSession() {
        try {
            return JCRSessionFactory.getInstance().getCurrentUserSession();
        } catch (RepositoryException e) {
            return null;
        }
    }

    private String serverJson(McpServer.Snapshot s, boolean signedIn) {
        return "{\"name\":" + ServletSupport.json(s.name)
                + ",\"label\":" + ServletSupport.json(s.label)
                + ",\"local\":" + s.isLocal()
                + ",\"signIn\":" + s.usesUserSignIn()
                + ",\"signedIn\":" + signedIn
                + ",\"tools\":" + bridge.toolNames(s.name).stream().map(ServletSupport::json)
                        .collect(Collectors.joining(",", "[", "]"))
                + "}";
    }
}
