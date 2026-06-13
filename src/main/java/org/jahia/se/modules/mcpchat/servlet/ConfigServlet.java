package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
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
 * Exposes the non-sensitive parts of the OSGi configuration to the front-end.
 * API keys are never included — only which providers are available.
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
    protected void doOptions(HttpServletRequest req, HttpServletResponse res) {
        cors(res);
        res.setStatus(HttpServletResponse.SC_OK);
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        cors(res);
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

        String mcpToken = configService.getMcpJwtToken()
                .replace("\\", "\\\\")
                .replace("\"", "\\\"");

        res.getWriter().write(String.format(
                "{\"availableProviders\":%s,\"defaultProvider\":\"%s\",\"defaultModel\":\"%s\"," +
                "\"maxTokens\":%d,\"mcpEndpoint\":\"%s\",\"mcpToken\":\"%s\",\"systemPromptAppendix\":\"%s\"}",
                providersJson,
                configService.getDefaultProvider(),
                configService.getDefaultModel(),
                configService.getMaxTokens(),
                configService.getMcpEndpoint(),
                mcpToken,
                appendix
        ));
    }

    private void cors(HttpServletResponse res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
}
