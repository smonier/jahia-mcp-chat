package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.se.modules.mcpchat.config.McpServerRegistry;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.servlet.Servlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.stream.Collectors;

/**
 * Exposes non-sensitive OSGi configuration to the front-end.
 * API keys and MCP server credentials are never included; a remote server's URL is not either.
 * Open to authenticated users only (guests receive 401).
 *
 * GET /modules/jahia-mcp-chat/config?site=&lt;siteKey&gt;
 * Response: { availableProviders, defaultProvider, defaultModel, maxTokens, systemPromptAppendix,
 *             mcpServers: [{ name, label, local, url? }] } - servers filtered for that site
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

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");

        if (ServletSupport.isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }

        res.setContentType("application/json;charset=UTF-8");

        String providersJson = configService.getAvailableProviders().stream()
                .map(ServletSupport::json)
                .collect(Collectors.joining(",", "[", "]"));

        String siteKey = ServletSupport.accessibleSite(req.getParameter("site"));
        String serversJson = siteKey == null ? "[]" : serverRegistry.getServers(siteKey).stream()
                .map(ConfigServlet::serverJson)
                .collect(Collectors.joining(",", "[", "]"));

        res.getWriter().write("{\"availableProviders\":" + providersJson
                + ",\"defaultProvider\":" + ServletSupport.json(configService.getDefaultProvider())
                + ",\"defaultModel\":" + ServletSupport.json(configService.getDefaultModel())
                + ",\"maxTokens\":" + configService.getMaxTokens()
                + ",\"systemPromptAppendix\":" + ServletSupport.json(configService.getSystemPromptAppendix())
                + ",\"mcpServers\":" + serversJson + "}");
    }

    private static String serverJson(McpServer.Snapshot s) {
        return "{\"name\":" + ServletSupport.json(s.name)
                + ",\"label\":" + ServletSupport.json(s.label)
                + ",\"local\":" + s.isLocal()
                + (s.isLocal() ? ",\"url\":" + ServletSupport.json(s.url) : "")
                + "}";
    }
}
