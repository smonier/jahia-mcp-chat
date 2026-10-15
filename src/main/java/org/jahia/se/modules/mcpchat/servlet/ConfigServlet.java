package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
import org.jahia.services.content.JCRSessionFactory;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.servlet.Servlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Exposes non-sensitive OSGi configuration to the front-end.
 * API keys and the MCP JWT token are never included.
 * Open to authenticated users only (guests receive 401).
 *
 * GET /modules/jahia-mcp-chat/config
 * Response: { availableProviders, defaultProvider, defaultModel, maxTokens,
 *             mcpEndpoint, systemPromptAppendix }
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/config", "allow-api-token=true"},
        immediate = true)
public class ConfigServlet extends HttpServlet {

    @Reference
    private McpChatConfigService configService;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");

        if (isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }

        res.setContentType("application/json;charset=UTF-8");

        List<String> providers = configService.getAvailableProviders();

        String providersJson = providers.stream()
                .map(p -> "\"" + p + "\"")
                .collect(Collectors.joining(",", "[", "]"));

        String appendix = configService.getSystemPromptAppendix()
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "");

        res.getWriter().write(String.format(
                "{\"availableProviders\":%s,\"defaultProvider\":\"%s\",\"defaultModel\":\"%s\"," +
                "\"maxTokens\":%d,\"mcpEndpoint\":\"%s\",\"systemPromptAppendix\":\"%s\"}",
                providersJson,
                configService.getDefaultProvider(),
                configService.getDefaultModel(),
                configService.getMaxTokens(),
                configService.getMcpEndpoint(),
                appendix
        ));
    }

    private boolean isGuest() {
        try {
            return "guest".equals(JCRSessionFactory.getInstance().getCurrentUser().getName());
        } catch (Exception e) {
            return true;
        }
    }
}
