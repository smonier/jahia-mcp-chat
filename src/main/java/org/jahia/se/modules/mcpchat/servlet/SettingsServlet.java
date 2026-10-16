package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.content.JCRSessionWrapper;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.servlet.Servlet;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.Reader;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Persists per-user chat preferences as a JSON blob in the {@code mcpchat.settings} property of the current user's node.
 * Restricted to authenticated users (guests receive 401).
 * The mcpToken field is stripped server-side before storage — tokens must not be persisted in JCR.
 *
 * GET  /modules/jahia-mcp-chat/settings  — returns stored JSON, or {} if not set
 * POST /modules/jahia-mcp-chat/settings  — saves JSON body to JCR
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/settings", "allow-api-token=true"},
        immediate = true)
public class SettingsServlet extends HttpServlet {

    private static final Logger logger = LoggerFactory.getLogger(SettingsServlet.class);
    private static final String SETTINGS_PROP = "mcpchat.settings";
    private static final int MAX_BODY_BYTES = 65_536; // 64 KB — settings are small

    // Strip any mcpToken value that a client might submit — tokens must not be stored in JCR
    private static final Pattern MCP_TOKEN_PATTERN =
            Pattern.compile("\"mcpToken\"\\s*:\\s*\"[^\"]*\"\\s*,?");

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {
        res.setHeader("Cache-Control", "no-store, private");
        res.setContentType("application/json;charset=UTF-8");

        if (isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }

        try {
            JCRSessionWrapper session = JCRSessionFactory.getInstance().getCurrentUserSession();
            String json = readSettings(session);
            res.getWriter().write(json != null ? json : "{}");
        } catch (RepositoryException e) {
            logger.warn("Failed to read MCP chat settings from JCR", e);
            res.getWriter().write("{}");
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {
        res.setHeader("Cache-Control", "no-store, private");
        res.setContentType("application/json;charset=UTF-8");

        if (isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }

        String body = readBodyCapped(req);
        if (body == null) {
            res.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "Request too large");
            return;
        }
        body = body.trim();
        if (body.isEmpty() || !body.startsWith("{")) {
            res.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid request");
            return;
        }

        // Never persist any token value a client may have submitted
        body = MCP_TOKEN_PATTERN.matcher(body).replaceAll("");

        try {
            JCRSessionWrapper session = JCRSessionFactory.getInstance().getCurrentUserSession();
            writeSettings(session, body);
            res.getWriter().write("{\"ok\":true}");
        } catch (RepositoryException e) {
            logger.error("Failed to save MCP chat settings to JCR", e);
            res.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR, "Save failed");
        }
    }

    // A user node accepts no nt:unstructured child; its residual properties hold the settings instead
    private String readSettings(JCRSessionWrapper session) throws RepositoryException {
        JCRNodeWrapper userNode = session.getNode(session.getUser().getLocalPath());
        return userNode.hasProperty(SETTINGS_PROP) ? userNode.getProperty(SETTINGS_PROP).getString() : null;
    }

    private void writeSettings(JCRSessionWrapper session, String json) throws RepositoryException {
        session.getNode(session.getUser().getLocalPath()).setProperty(SETTINGS_PROP, json);
        session.save();
    }

    private boolean isGuest() {
        try {
            return "guest".equals(JCRSessionFactory.getInstance().getCurrentUser().getName());
        } catch (Exception e) {
            return true;
        }
    }

    private String readBodyCapped(HttpServletRequest req) throws IOException {
        int cl = req.getContentLength();
        if (cl > MAX_BODY_BYTES) return null;
        StringBuilder sb = new StringBuilder();
        char[] chunk = new char[4096];
        int total = 0;
        try (Reader reader = req.getReader()) {
            int n;
            while ((n = reader.read(chunk)) != -1) {
                total += n;
                if (total > MAX_BODY_BYTES) return null;
                sb.append(chunk, 0, n);
            }
        }
        return sb.toString();
    }
}
