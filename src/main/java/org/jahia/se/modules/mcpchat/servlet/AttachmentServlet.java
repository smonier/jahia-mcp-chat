package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.attachment.AttachmentStore;
import org.jahia.services.content.JCRSessionFactory;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.servlet.Servlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.util.regex.Pattern;

/**
 * Receives a file attached to a chat message and keeps it for the {@code chat.upload_attachment} tool.
 * Authenticated users only; under the CSRF guard (the chat sends the token).
 *
 * POST /modules/jahia-mcp-chat/attachments?name=&lt;file name&gt;  body: the file, Content-Type: its type
 * Response: { "id": "..." }
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/attachments"},
        immediate = true)
public class AttachmentServlet extends HttpServlet {

    private static final Pattern MIME = Pattern.compile("[a-z0-9.+-]+/[a-z0-9.+-]+");

    @Reference
    private AttachmentStore store;

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res) throws IOException {
        res.setHeader("Cache-Control", "no-store, private");
        if (ServletSupport.isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }
        String name = String.valueOf(req.getParameter("name")).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (name.isEmpty() || "null".equals(name) || name.length() > 200) {
            res.sendError(HttpServletResponse.SC_BAD_REQUEST, "A file name is required");
            return;
        }
        String type = req.getContentType() == null ? "" : req.getContentType().split(";")[0].trim().toLowerCase();
        if (!MIME.matcher(type).matches()) {
            type = "application/octet-stream";
        }
        if (req.getContentLength() > AttachmentStore.MAX_BYTES) {
            res.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "File too large");
            return;
        }
        byte[] bytes;
        try (InputStream in = req.getInputStream()) {
            bytes = in.readNBytes(AttachmentStore.MAX_BYTES + 1);
        }
        if (bytes.length == 0 || bytes.length > AttachmentStore.MAX_BYTES) {
            res.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "File empty or too large");
            return;
        }
        try {
            String id = store.put(JCRSessionFactory.getInstance().getCurrentUser().getName(), name, type, bytes);
            res.setContentType("application/json;charset=UTF-8");
            res.getWriter().write("{\"id\":" + ServletSupport.json(id) + "}");
        } catch (IllegalStateException e) {
            res.sendError(429, e.getMessage());
        }
    }
}
