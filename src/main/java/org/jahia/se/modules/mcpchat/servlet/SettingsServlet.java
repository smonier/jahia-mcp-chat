package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.content.JCRSessionWrapper;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.PathNotFoundException;
import javax.jcr.RepositoryException;
import javax.servlet.Servlet;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.stream.Collectors;

/**
 * Persists per-user chat settings as a JSON blob in JCR under the current user's node.
 * Stored at: {userNode}/mcp-chat-settings (jnt:content, property: data)
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
    private static final String SETTINGS_NODE = "mcp-chat-settings";
    private static final String DATA_PROP = "data";
    private static final String NODE_TYPE = "nt:unstructured";

    @Override
    protected void doOptions(HttpServletRequest req, HttpServletResponse res) {
        cors(res);
        res.setStatus(HttpServletResponse.SC_OK);
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {
        cors(res);
        res.setContentType("application/json;charset=UTF-8");

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
        cors(res);
        res.setContentType("application/json;charset=UTF-8");

        String body = req.getReader().lines().collect(Collectors.joining("\n")).trim();
        if (body.isEmpty()) {
            res.sendError(HttpServletResponse.SC_BAD_REQUEST, "Empty body");
            return;
        }

        try {
            JCRSessionWrapper session = JCRSessionFactory.getInstance().getCurrentUserSession();
            writeSettings(session, body);
            res.getWriter().write("{\"ok\":true}");
        } catch (RepositoryException e) {
            logger.error("Failed to save MCP chat settings to JCR", e);
            res.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR, e.getMessage());
        }
    }

    private String readSettings(JCRSessionWrapper session) throws RepositoryException {
        JCRNodeWrapper userNode = session.getNode(session.getUser().getLocalPath());
        try {
            JCRNodeWrapper settingsNode = userNode.getNode(SETTINGS_NODE);
            if (settingsNode.hasProperty(DATA_PROP)) {
                return settingsNode.getProperty(DATA_PROP).getString();
            }
        } catch (PathNotFoundException e) {
            // not yet created — return null so caller emits {}
        }
        return null;
    }

    private void writeSettings(JCRSessionWrapper session, String json) throws RepositoryException {
        JCRNodeWrapper userNode = session.getNode(session.getUser().getLocalPath());
        JCRNodeWrapper settingsNode;
        try {
            settingsNode = userNode.getNode(SETTINGS_NODE);
        } catch (PathNotFoundException e) {
            settingsNode = userNode.addNode(SETTINGS_NODE, NODE_TYPE);
        }
        settingsNode.setProperty(DATA_PROP, json);
        session.save();
    }

    private void cors(HttpServletResponse res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
}
