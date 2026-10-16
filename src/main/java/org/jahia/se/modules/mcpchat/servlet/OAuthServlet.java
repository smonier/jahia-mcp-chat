package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.se.modules.mcpchat.config.McpServerRegistry;
import org.jahia.se.modules.mcpchat.oauth.UserOAuthService;
import org.jahia.services.content.JCRSessionFactory;
import org.jahia.services.content.JCRSessionWrapper;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.servlet.Servlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;

/**
 * Per-user sign-in to remote MCP servers. Authenticated users only.
 * <ul>
 *   <li>GET  {@code /modules/jahia-mcp-chat/oauth/start?server=<name>&site=<key>} - redirects to the server's
 *       sign-in page. Whitelisted in the CSRF guard: a top-level navigation opened by the chat, which only
 *       prepares a sign-in bound to the HTTP session.</li>
 *   <li>GET  {@code /modules/jahia-mcp-chat/oauth/callback} - where the authorization server sends the browser
 *       back. Whitelisted in the CSRF guard: the OAuth {@code state}, single-use and bound to the session and the
 *       user, is the cross-site protection.</li>
 *   <li>POST {@code /modules/jahia-mcp-chat/oauth/signout?server=<name>} - forgets the user's tokens; under the
 *       CSRF guard.</li>
 * </ul>
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/oauth"},
        immediate = true)
public class OAuthServlet extends HttpServlet {

    private static final Logger logger = LoggerFactory.getLogger(OAuthServlet.class);
    static final String MESSAGE_TYPE = "jahia-mcp-chat-oauth";

    @Reference
    private McpServerRegistry serverRegistry;

    @Reference
    private McpChatConfigService configService;

    @Reference
    private UserOAuthService userOAuth;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");
        if (ServletSupport.isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }
        String path = req.getPathInfo() == null ? "" : req.getPathInfo();
        try {
            if ("/start".equals(path)) {
                start(req, res);
            } else if ("/callback".equals(path)) {
                callback(req, res);
            } else {
                res.sendError(HttpServletResponse.SC_NOT_FOUND);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            page(res, null, "The sign-in was interrupted.");
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");
        if (ServletSupport.isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }
        if (!"/signout".equals(req.getPathInfo())) {
            res.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        String server = String.valueOf(req.getParameter("server"));
        try {
            userOAuth.signOut(server, JCRSessionFactory.getInstance().getCurrentUserSession());
            res.setContentType("application/json;charset=UTF-8");
            res.getWriter().write("{\"ok\":true}");
        } catch (RepositoryException e) {
            logger.warn("Could not forget MCP tokens of server {}: {}", server, e.getMessage());
            res.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR, "Sign-out failed");
        }
    }

    private void start(HttpServletRequest req, HttpServletResponse res) throws IOException, InterruptedException {
        String siteKey = ServletSupport.accessibleSite(req.getParameter("site"));
        Optional<McpServer.Snapshot> server = siteKey == null ? Optional.empty()
                : serverRegistry.find(String.valueOf(req.getParameter("server")), siteKey);
        if (server.isEmpty() || !server.get().usesUserSignIn()) {
            page(res, null, "This MCP server is not available here.");
            return;
        }
        try {
            String url = userOAuth.authorizationUrl(server.get(), redirectUri(req), req.getSession(true),
                    JCRSessionFactory.getInstance().getCurrentUser().getName());
            res.sendRedirect(url);
        } catch (IOException e) {
            logger.warn("Cannot start the sign-in to MCP server {}: {}", server.get().name, e.getMessage());
            page(res, server.get().name, "The sign-in to " + server.get().label + " cannot start: " + e.getMessage());
        }
    }

    private void callback(HttpServletRequest req, HttpServletResponse res) throws IOException, InterruptedException {
        JCRSessionWrapper userSession;
        try {
            userSession = JCRSessionFactory.getInstance().getCurrentUserSession();
        } catch (RepositoryException e) {
            page(res, null, "The sign-in could not be completed.");
            return;
        }
        UserOAuthService.Callback result = userOAuth.complete(req.getParameter("code"), req.getParameter("state"),
                req.getParameter("error"), req.getSession(true),
                JCRSessionFactory.getInstance().getCurrentUser().getName(), userSession);
        page(res, result.serverName, result.error);
    }

    private String redirectUri(HttpServletRequest req) {
        String base = configService.getPublicBaseUrl();
        if (base.isEmpty()) {
            boolean defaultPort = ("http".equals(req.getScheme()) && req.getServerPort() == 80)
                    || ("https".equals(req.getScheme()) && req.getServerPort() == 443);
            base = req.getScheme() + "://" + req.getServerName() + (defaultPort ? "" : ":" + req.getServerPort())
                    + org.jahia.bin.Jahia.getContextPath();
        }
        return base + "/modules/jahia-mcp-chat/oauth/callback";
    }

    /** A page that tells the chat window the outcome, then closes the popup. */
    private static void page(HttpServletResponse res, String server, String error) throws IOException {
        res.setContentType("text/html;charset=UTF-8");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
        String message = "{\"type\":" + ServletSupport.json(MESSAGE_TYPE)
                + ",\"server\":" + ServletSupport.json(server == null ? "" : server)
                + ",\"ok\":" + (error == null)
                + ",\"error\":" + ServletSupport.json(error == null ? "" : error) + "}";
        String text = error == null ? "Signed in. You can close this window." : error;
        res.getWriter().write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Jahia MCP Chat</title></head>"
                + "<body style=\"font-family:sans-serif;padding:2rem\"><p>" + html(text) + "</p><script>"
                + "try{if(window.opener){window.opener.postMessage(" + message + ",location.origin);window.close();}}catch(e){}"
                + "</script></body></html>");
    }

    private static String html(String v) {
        return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
