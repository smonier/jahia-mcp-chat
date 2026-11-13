package org.jahia.se.modules.mcpchat.attachment;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jahia.modules.mcp.spi.tool.JahiaMcpTool;
import org.jahia.modules.mcp.spi.tool.ToolContext;
import org.jahia.modules.mcp.spi.tool.ToolResult;
import org.jahia.modules.mcp.spi.tool.ToolSafety;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import javax.jcr.PathNotFoundException;
import javax.jcr.RepositoryException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * {@code chat.upload_attachment}: puts a file the user attached to the current chat message into the site's media
 * library, {@code /sites/<siteKey>/files/<folder>}, with the user's own session (default workspace, not published).
 * Only the user who attached the file can upload it. Returns the path of the file node, for image and file fields.
 */
@Component(service = JahiaMcpTool.class, immediate = true)
public class UploadAttachmentTool implements JahiaMcpTool {

    static final String NAME = "chat.upload_attachment";
    private static final Pattern KEY = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern FOLDER = Pattern.compile("[A-Za-z0-9 _.-]{1,64}");
    private final ObjectMapper mapper = new ObjectMapper();
    private JsonNode schema;

    @Reference
    private AttachmentStore store;

    @Activate
    protected void activate() throws IOException {
        schema = mapper.readTree("{\"type\":\"object\",\"properties\":{"
                + "\"attachmentId\":{\"type\":\"string\",\"description\":\"The attachment id given with the file in the user's message\"},"
                + "\"siteKey\":{\"type\":\"string\",\"description\":\"Key of the site whose media library receives the file\"},"
                + "\"folder\":{\"type\":\"string\",\"description\":\"Folder under /sites/<siteKey>/files, created if missing. Default chat-uploads\"}},"
                + "\"required\":[\"attachmentId\",\"siteKey\"]}");
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public String description() {
        return "Upload a file the user attached to the current chat message into the site's media library. "
                + "Returns the JCR path of the created file node: use it as the value of image or file fields.";
    }

    @Override
    public JsonNode inputSchema() {
        return schema;
    }

    @Override
    public ToolSafety safety() {
        return ToolSafety.MUTATING;
    }

    @Override
    public Set<String> tags() {
        return Set.of("media", "chat");
    }

    @Override
    public ToolResult execute(JsonNode input, ToolContext ctx) {
        String id = input.path("attachmentId").asText("");
        String siteKey = input.path("siteKey").asText("");
        String folder = input.path("folder").asText("chat-uploads").trim();
        if (!KEY.matcher(siteKey).matches() || !FOLDER.matcher(folder).matches() || folder.startsWith(".")) {
            return ToolResult.error("invalid_input", "Invalid siteKey or folder.", null);
        }
        Optional<AttachmentStore.Attachment> found = store.get(ctx.username(), id);
        if (found.isEmpty()) {
            return ToolResult.error("attachment_not_found", "No attachment with this id for this user (they expire after 30 minutes).",
                    "Ask the user to attach the file again.");
        }
        AttachmentStore.Attachment a = found.get();
        try {
            String path = ctx.withUserSession(session -> {
                JCRSessionWrapper s = (JCRSessionWrapper) session;
                JCRNodeWrapper files = s.getNode("/sites/" + siteKey + "/files");
                JCRNodeWrapper target;
                try {
                    target = files.getNode(folder);
                } catch (PathNotFoundException e) {
                    target = files.addNode(folder, "jnt:folder");
                }
                String name = uniqueName(target, a.name);
                JCRNodeWrapper file = target.uploadFile(name, new ByteArrayInputStream(a.bytes), a.mimeType);
                s.save();
                return file.getPath();
            });
            ObjectNode out = mapper.createObjectNode().put("uploaded", a.name).put("path", path).put("sizeBytes", a.bytes.length);
            return ToolResult.ok(out);
        } catch (PathNotFoundException e) {
            return ToolResult.error("site_not_found", "No media library at /sites/" + siteKey + "/files.", null);
        } catch (RepositoryException e) {
            return ToolResult.error("upload_failed", "The file could not be saved: " + e.getMessage(), null);
        }
    }

    private static String uniqueName(JCRNodeWrapper folder, String name) throws RepositoryException {
        if (!folder.hasNode(name)) {
            return name;
        }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; ; i++) {
            String candidate = base + "-" + i + ext;
            if (!folder.hasNode(candidate)) {
                return candidate;
            }
        }
    }
}
