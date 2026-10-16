package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.se.modules.mcpchat.config.McpServerRegistry;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.Servlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;

/**
 * Forwards JSON-RPC calls to a remote MCP server configured in {@link McpServerRegistry}, adding the
 * server's credentials server-side so they never reach the browser. Local servers (relative URL) are refused:
 * the browser calls them directly with the user's own session.
 * <p>
 * Open to authenticated users with jContent access to the site named in {@code X-Site-Key}, and only for
 * servers allowed on that site. The target URL comes from the configuration, never from the request.
 *
 * POST /modules/jahia-mcp-chat/mcp?server=&lt;name&gt;  (headers X-Site-Key, optional Mcp-Session-Id)
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/mcp", "allow-api-token=true"},
        immediate = true)
public class McpProxyServlet extends HttpServlet {

    private static final Logger logger = LoggerFactory.getLogger(McpProxyServlet.class);
    private static final int MAX_BODY_BYTES = 1_048_576;
    private static final String SESSION_HEADER = "Mcp-Session-Id";

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Reference
    private McpServerRegistry serverRegistry;

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");

        if (ServletSupport.isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }
        String siteKey = ServletSupport.accessibleSite(req.getHeader("X-Site-Key"));
        Optional<McpServer.Snapshot> found = siteKey == null ? Optional.empty()
                : serverRegistry.find(String.valueOf(req.getParameter("server")), siteKey);
        if (found.isEmpty() || found.get().isLocal()) {
            res.sendError(HttpServletResponse.SC_NOT_FOUND, "Unknown MCP server");
            return;
        }
        McpServer.Snapshot server = found.get();

        byte[] body = readBodyCapped(req);
        if (body == null) {
            res.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "Request too large");
            return;
        }

        HttpRequest.Builder upstream = HttpRequest.newBuilder(URI.create(server.url))
                .timeout(Duration.ofMillis(server.timeoutMs))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
        if (!server.authValue.isEmpty()) {
            upstream.header(server.authHeader, server.authValue);
        }
        String sessionId = req.getHeader(SESSION_HEADER);
        if (sessionId != null && !sessionId.isBlank()) {
            upstream.header(SESSION_HEADER, sessionId);
        }

        HttpResponse<InputStream> answer;
        try {
            answer = client.send(upstream.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            res.sendError(HttpServletResponse.SC_GATEWAY_TIMEOUT, "MCP server did not answer");
            return;
        } catch (IOException e) {
            logger.warn("MCP server {} unreachable: {}", server.name, e.getMessage());
            res.sendError(HttpServletResponse.SC_BAD_GATEWAY, "MCP server unreachable");
            return;
        }

        res.setStatus(answer.statusCode());
        res.setContentType(answer.headers().firstValue("Content-Type").orElse("application/json"));
        answer.headers().firstValue(SESSION_HEADER).ifPresent(v -> res.setHeader(SESSION_HEADER, v));
        res.setHeader("X-Accel-Buffering", "no");

        try (InputStream in = answer.body(); OutputStream out = res.getOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                out.flush();
            }
        } catch (IOException e) {
            logger.debug("MCP proxy stream closed: {}", e.getMessage());
        }
    }

    private static byte[] readBodyCapped(HttpServletRequest req) throws IOException {
        if (req.getContentLength() > MAX_BODY_BYTES) {
            return null;
        }
        try (InputStream in = req.getInputStream()) {
            byte[] body = in.readNBytes(MAX_BODY_BYTES + 1);
            return body.length > MAX_BODY_BYTES ? null : body;
        }
    }
}
