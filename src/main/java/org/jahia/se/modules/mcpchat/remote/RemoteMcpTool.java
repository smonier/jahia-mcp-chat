package org.jahia.se.modules.mcpchat.remote;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jahia.modules.mcp.spi.tool.JahiaMcpTool;
import org.jahia.modules.mcp.spi.tool.ToolContext;
import org.jahia.modules.mcp.spi.tool.ToolResult;
import org.jahia.modules.mcp.spi.tool.ToolSafety;

import java.util.Set;

/**
 * One tool of a remote MCP server, offered to Jahia as a {@link JahiaMcpTool} service so that genai-connector's
 * agent (and the Jahia MCP server) can call it. The call itself is delegated to {@link RemoteToolBridge}, which
 * resolves the calling user's credential. Immutable.
 */
final class RemoteMcpTool implements JahiaMcpTool {

    private final RemoteToolBridge bridge;
    private final String serverName;
    private final String remoteName;
    private final String name;
    private final String description;
    private final JsonNode inputSchema;
    private final ToolSafety safety;

    RemoteMcpTool(RemoteToolBridge bridge, String serverName, String serverLabel, JsonNode remote) {
        this.bridge = bridge;
        this.serverName = serverName;
        this.remoteName = remote.path("name").asText();
        this.name = toolName(serverName, remoteName);
        String desc = remote.path("description").asText("");
        this.description = "[" + serverLabel + "] " + (desc.length() > 1000 ? desc.substring(0, 1000) : desc);
        JsonNode schema = remote.get("inputSchema");
        this.inputSchema = schema != null && schema.isObject() ? schema
                : JsonNodeFactory.instance.objectNode().put("type", "object");
        this.safety = safetyOf(remote.path("annotations"));
    }

    /** @return the Jahia tool name of a remote tool: {@code <server>.<tool>}, restricted to safe characters */
    static String toolName(String serverName, String remoteName) {
        return serverName + "." + remoteName.replaceAll("[^A-Za-z0-9_.-]", "_");
    }

    private static ToolSafety safetyOf(JsonNode annotations) {
        if (annotations.path("readOnlyHint").asBoolean(false)) {
            return ToolSafety.READ_ONLY;
        }
        return annotations.path("destructiveHint").asBoolean(false) ? ToolSafety.DESTRUCTIVE : ToolSafety.MUTATING;
    }

    @Override
    public String name() {
        return name;
    }

    @Override
    public String description() {
        return description;
    }

    @Override
    public JsonNode inputSchema() {
        return inputSchema;
    }

    @Override
    public ToolSafety safety() {
        return safety;
    }

    @Override
    public Set<String> tags() {
        return Set.of("remote", serverName);
    }

    @Override
    public ToolResult execute(JsonNode input, ToolContext ctx) {
        ObjectNode params = JsonNodeFactory.instance.objectNode().put("name", remoteName);
        params.set("arguments", input == null || input.isNull() ? JsonNodeFactory.instance.objectNode() : input);
        return bridge.call(serverName, params, ctx);
    }
}
