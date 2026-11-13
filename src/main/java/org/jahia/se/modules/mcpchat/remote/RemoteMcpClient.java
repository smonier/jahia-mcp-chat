package org.jahia.se.modules.mcpchat.remote;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jahia.se.modules.mcpchat.config.McpServer;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * JSON-RPC client for remote MCP servers over streamable HTTP: the {@code initialize} handshake once per server
 * and caller, the {@code Mcp-Session-Id} it returns, and answers sent as JSON or as an SSE stream. The target is
 * always the configured URL; redirects are not followed. Thread-safe.
 */
public final class RemoteMcpClient {

    /** The server refused the credential (HTTP 401). */
    public static final class UnauthorizedException extends IOException {
        private static final long serialVersionUID = 1L;

        UnauthorizedException(String server) {
            super(server + " refused the credential (401)");
        }
    }

    private static final String SESSION_HEADER = "Mcp-Session-Id";
    private static final String PROTOCOL_VERSION = "2025-03-26";

    private final HttpClient client;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, String> sessions = new ConcurrentHashMap<>();
    private final AtomicLong ids = new AtomicLong(1);

    public RemoteMcpClient(HttpClient client) {
        this.client = client;
    }

    /**
     * Sends one JSON-RPC request.
     *
     * @param server    the remote server
     * @param callerKey who calls (a user name, or "" for the server's own credential): sessions are not shared
     * @param bearer    the access token sent as {@code Authorization: Bearer}, or {@code null} to use the server's
     *                  fixed header, if any
     * @param method    JSON-RPC method
     * @param params    its params, possibly {@code null}
     * @return the {@code result} member
     * @throws UnauthorizedException on HTTP 401
     * @throws IOException           on any other failure, the server's JSON-RPC error included
     */
    public JsonNode request(McpServer.Snapshot server, String callerKey, String bearer, String method, JsonNode params)
            throws IOException, InterruptedException {
        String key = server.name + '|' + server.url + '|' + callerKey;
        if (!sessions.containsKey(key)) {
            handshake(server, key, bearer);
        }
        try {
            return send(server, key, bearer, method, params);
        } catch (SessionExpiredException e) {
            sessions.remove(key);
            handshake(server, key, bearer);
            return send(server, key, bearer, method, params);
        }
    }

    /** Forgets the sessions opened for a caller, after a new sign-in or a sign-out. */
    public void forget(String serverName, String callerKey) {
        sessions.keySet().removeIf(k -> k.startsWith(serverName + '|') && k.endsWith('|' + callerKey));
    }

    private static final class SessionExpiredException extends IOException {
        private static final long serialVersionUID = 1L;
    }

    private void handshake(McpServer.Snapshot server, String key, String bearer) throws IOException, InterruptedException {
        ObjectNode params = mapper.createObjectNode().put("protocolVersion", PROTOCOL_VERSION);
        params.putObject("capabilities");
        params.putObject("clientInfo").put("name", "jahia-mcp-chat").put("version", "1.0.0");
        ObjectNode body = mapper.createObjectNode().put("jsonrpc", "2.0").put("id", String.valueOf(ids.getAndIncrement()))
                .put("method", "initialize");
        body.set("params", params);
        HttpResponse<String> res = post(server, null, bearer, body);
        if (res.statusCode() == 401) {
            throw new UnauthorizedException(server.label);
        }
        String sessionId = res.headers().firstValue(SESSION_HEADER).orElse("");
        sessions.put(key, sessionId);
        if (res.statusCode() < 300) {
            ObjectNode note = mapper.createObjectNode().put("jsonrpc", "2.0").put("method", "notifications/initialized");
            post(server, sessionId, bearer, note);
        }
    }

    private JsonNode send(McpServer.Snapshot server, String key, String bearer, String method, JsonNode params)
            throws IOException, InterruptedException {
        String id = String.valueOf(ids.getAndIncrement());
        ObjectNode body = mapper.createObjectNode().put("jsonrpc", "2.0").put("id", id).put("method", method);
        body.set("params", params == null ? mapper.createObjectNode() : params);
        String sessionId = sessions.getOrDefault(key, "");
        HttpResponse<String> res = post(server, sessionId, bearer, body);
        if (res.statusCode() == 401) {
            throw new UnauthorizedException(server.label);
        }
        if (res.statusCode() == 404 && !sessionId.isEmpty()) {
            throw new SessionExpiredException();
        }
        if (res.statusCode() >= 300) {
            throw new IOException(server.label + " answered HTTP " + res.statusCode());
        }
        JsonNode message = parse(res, id);
        if (message.hasNonNull("error")) {
            throw new IOException(server.label + ": " + message.get("error").path("message").asText("error"));
        }
        return message.path("result");
    }

    private HttpResponse<String> post(McpServer.Snapshot server, String sessionId, String bearer, JsonNode body)
            throws IOException, InterruptedException {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(server.url))
                .timeout(Duration.ofMillis(server.timeoutMs))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
        if (bearer != null) {
            req.header("Authorization", "Bearer " + bearer);
        } else if (!server.authValue.isEmpty()) {
            req.header(server.authHeader, server.authValue);
        }
        if (sessionId != null && !sessionId.isEmpty()) {
            req.header(SESSION_HEADER, sessionId);
        }
        return client.send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode parse(HttpResponse<String> res, String id) throws IOException {
        String type = res.headers().firstValue("Content-Type").orElse("");
        if (!type.contains("text/event-stream")) {
            return mapper.readTree(res.body());
        }
        JsonNode last = null;
        for (String line : res.body().split("\n")) {
            if (!line.startsWith("data:")) {
                continue;
            }
            try {
                JsonNode msg = mapper.readTree(line.substring(5).trim());
                if (id.equals(msg.path("id").asText())) {
                    return msg;
                }
                last = msg;
            } catch (IOException ignored) {
                // a keep-alive or a partial frame
            }
        }
        if (last == null) {
            throw new IOException("empty answer");
        }
        return last;
    }
}
