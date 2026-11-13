package org.jahia.se.modules.mcpchat.remote;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.jahia.modules.mcp.spi.tool.JahiaMcpTool;
import org.jahia.modules.mcp.spi.tool.ToolContext;
import org.jahia.modules.mcp.spi.tool.ToolResult;
import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.se.modules.mcpchat.config.McpServerRegistry;
import org.jahia.se.modules.mcpchat.oauth.OAuthTokens;
import org.jahia.se.modules.mcpchat.oauth.UserOAuthService;
import org.jahia.services.content.JCRSessionWrapper;
import org.osgi.framework.BundleContext;
import org.osgi.framework.ServiceRegistration;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import java.io.File;
import java.io.IOException;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Offers the tools of remote MCP servers to Jahia: each tool becomes a {@link JahiaMcpTool} service named
 * {@code <server>.<tool>}, which genai-connector's agent runs like the Jahia tools, and which the Jahia MCP server
 * also lists to its own clients.
 * <p>
 * A tool runs with the credential of its server: the calling user's own sign-in, one client-credentials account,
 * or a fixed header. A server's tool list is read with that credential: periodically for a shared credential, and
 * when a user is signed in for a per-user one; the last list is kept in the bundle's data folder
 * ({@code remote-tools.json}) so the tools are registered again after a restart. Thread-safe.
 */
@Component(service = RemoteToolBridge.class, immediate = true)
public class RemoteToolBridge {

    private static final Logger logger = LoggerFactory.getLogger(RemoteToolBridge.class);
    private static final long SHARED_REFRESH_MS = 30 * 60_000L;
    private static final long USER_REFRESH_MS = 60 * 60_000L;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private final RemoteMcpClient client = new RemoteMcpClient(http);
    private final OAuthTokens sharedTokens = new OAuthTokens(http);
    private final ObjectMapper mapper = new ObjectMapper();

    private final Map<String, Registered> registered = new HashMap<>();
    private ObjectNode cache;
    private File cacheFile;
    private BundleContext bundleContext;
    private ScheduledExecutorService executor;

    @Reference
    private McpServerRegistry serverRegistry;

    @Reference
    private UserOAuthService userOAuth;

    private static final class Registered {
        final String url;
        final List<ServiceRegistration<JahiaMcpTool>> registrations = new ArrayList<>();
        final List<String> names = new ArrayList<>();

        Registered(String url) {
            this.url = url;
        }
    }

    @Activate
    protected void activate(BundleContext context) {
        this.bundleContext = context;
        this.cacheFile = context.getDataFile("remote-tools.json");
        this.cache = loadCache();
        this.executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "jahia-mcp-chat-remote-tools");
            t.setDaemon(true);
            return t;
        });
        executor.scheduleWithFixedDelay(this::sync, 2, 60, TimeUnit.SECONDS);
    }

    @Deactivate
    protected synchronized void deactivate() {
        executor.shutdownNow();
        for (Registered r : registered.values()) {
            unregister(r);
        }
        registered.clear();
    }

    /** @return the Jahia names of the tools registered for a server, empty when none */
    public synchronized List<String> toolNames(String serverName) {
        Registered r = registered.get(serverName);
        return r == null ? List.of() : List.copyOf(r.names);
    }

    /** @return the Jahia names of every registered remote tool, by server name */
    public synchronized Map<String, List<String>> allToolNames() {
        Map<String, List<String>> all = new HashMap<>();
        registered.forEach((k, v) -> all.put(k, List.copyOf(v.names)));
        return all;
    }

    /**
     * Reads a per-user server's tool list in the background with a signed-in user's token, when the list is
     * missing or older than an hour (or always, with {@code force}).
     */
    public void refreshForUser(McpServer.Snapshot server, String username, String accessToken, boolean force) {
        if (accessToken == null || (!force && fresh(server, USER_REFRESH_MS))) {
            return;
        }
        client.forget(server.name, username);
        executor.execute(() -> list(server, username, accessToken));
    }

    /** Runs one remote tool for the calling user; the result or the error goes back to the model. */
    ToolResult call(String serverName, JsonNode params, ToolContext ctx) {
        Optional<McpServer.Snapshot> found = serverRegistry.findRemote(serverName);
        if (found.isEmpty()) {
            return ToolResult.error("server_unavailable", "The MCP server " + serverName + " is no longer configured.", null);
        }
        McpServer.Snapshot server = found.get();
        try {
            String callerKey = server.usesUserSignIn() ? ctx.username() : "";
            String bearer = bearer(server, ctx, false);
            if (server.usesUserSignIn() && bearer == null) {
                return signInRequired(server);
            }
            JsonNode result;
            try {
                result = client.request(server, callerKey, bearer, "tools/call", params);
            } catch (RemoteMcpClient.UnauthorizedException e) {
                bearer = bearer(server, ctx, true);
                if (server.usesUserSignIn() && bearer == null) {
                    return signInRequired(server);
                }
                client.forget(server.name, callerKey);
                result = client.request(server, callerKey, bearer, "tools/call", params);
            }
            if (result.path("isError").asBoolean(false)) {
                return ToolResult.error("remote_error", text(result), null);
            }
            return ToolResult.ok(result);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ToolResult.error("interrupted", "The call was interrupted.", null);
        } catch (IOException | RepositoryException e) {
            logger.debug("Remote tool call to {} failed: {}", server.name, e.getMessage());
            return ToolResult.error("remote_unavailable", server.label + " could not be reached: " + e.getMessage(), null);
        }
    }

    private static ToolResult signInRequired(McpServer.Snapshot server) {
        return ToolResult.error("sign_in_required", "The user is not signed in to " + server.label + ".",
                "Tell the user to open the chat settings and click Connect next to " + server.label + ", then ask again.");
    }

    private String bearer(McpServer.Snapshot server, ToolContext ctx, boolean refused)
            throws IOException, InterruptedException, RepositoryException {
        if (server.usesClientCredentials()) {
            if (refused) {
                sharedTokens.invalidate(server);
            }
            return sharedTokens.get(server);
        }
        if (!server.usesUserSignIn()) {
            return null;
        }
        String token = ctx.withUserSession(session -> {
            if (!(session instanceof JCRSessionWrapper)) {
                return null;
            }
            try {
                JCRSessionWrapper wrapper = (JCRSessionWrapper) session;
                return refused ? userOAuth.refreshAfterRefusal(server, wrapper) : userOAuth.accessToken(server, wrapper);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        });
        if (token != null && !refused) {
            refreshForUser(server, ctx.username(), token, false);
        }
        return token;
    }

    private static String text(JsonNode result) {
        StringBuilder sb = new StringBuilder();
        for (JsonNode c : result.path("content")) {
            if ("text".equals(c.path("type").asText())) {
                sb.append(sb.length() == 0 ? "" : "\n").append(c.path("text").asText());
            }
        }
        return sb.length() == 0 ? "The tool reported an error." : sb.toString();
    }

    private void sync() {
        try {
            List<McpServer.Snapshot> servers = serverRegistry.getRemoteServers();
            synchronized (this) {
                List<String> gone = new ArrayList<>();
                registered.forEach((name, r) -> {
                    boolean keep = servers.stream().anyMatch(s -> s.name.equals(name) && s.url.equals(r.url));
                    if (!keep) {
                        gone.add(name);
                    }
                });
                for (String name : gone) {
                    unregister(registered.remove(name));
                }
                for (McpServer.Snapshot s : servers) {
                    JsonNode cached = cache.path(s.name);
                    if (!registered.containsKey(s.name) && s.url.equals(cached.path("url").asText())) {
                        register(s, cached.path("tools"));
                    }
                }
            }
            for (McpServer.Snapshot s : servers) {
                if (!s.usesUserSignIn() && !fresh(s, SHARED_REFRESH_MS)) {
                    list(s, "", s.usesClientCredentials() ? sharedTokens.get(s) : null);
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException | IOException e) {
            logger.warn("Could not refresh the remote MCP tools: {}", e.getMessage());
        }
    }

    private synchronized boolean fresh(McpServer.Snapshot server, long maxAgeMs) {
        JsonNode cached = cache.path(server.name);
        return server.url.equals(cached.path("url").asText())
                && System.currentTimeMillis() - cached.path("refreshedAt").asLong(0) < maxAgeMs;
    }

    private void list(McpServer.Snapshot server, String callerKey, String bearer) {
        try {
            JsonNode tools = client.request(server, callerKey, bearer, "tools/list", null).path("tools");
            if (!tools.isArray()) {
                return;
            }
            synchronized (this) {
                ObjectNode entry = mapper.createObjectNode().put("url", server.url)
                        .put("refreshedAt", System.currentTimeMillis());
                entry.set("tools", tools);
                cache.set(server.name, entry);
                saveCache();
                Registered old = registered.remove(server.name);
                if (old != null) {
                    unregister(old);
                }
                register(server, tools);
            }
            logger.info("Registered {} tools of MCP server {}", tools.size(), server.name);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (IOException | RuntimeException e) {
            logger.warn("Could not list the tools of MCP server {}: {}", server.name, e.getMessage());
        }
    }

    private void register(McpServer.Snapshot server, JsonNode tools) {
        Registered r = new Registered(server.url);
        for (JsonNode tool : tools) {
            if (tool.path("name").asText("").isEmpty()) {
                continue;
            }
            RemoteMcpTool t = new RemoteMcpTool(this, server.name, server.label, tool);
            r.registrations.add(bundleContext.registerService(JahiaMcpTool.class, t, null));
            r.names.add(t.name());
        }
        registered.put(server.name, r);
    }

    private static void unregister(Registered r) {
        for (ServiceRegistration<JahiaMcpTool> reg : r.registrations) {
            try {
                reg.unregister();
            } catch (IllegalStateException ignored) {
                // already gone with the bundle
            }
        }
    }

    private ObjectNode loadCache() {
        if (cacheFile != null && cacheFile.isFile()) {
            try {
                JsonNode n = mapper.readTree(cacheFile);
                if (n instanceof ObjectNode) {
                    return (ObjectNode) n;
                }
            } catch (IOException e) {
                logger.warn("Could not read {}: {}", cacheFile, e.getMessage());
            }
        }
        return mapper.createObjectNode();
    }

    private void saveCache() {
        if (cacheFile == null) {
            return;
        }
        try {
            File tmp = new File(cacheFile.getPath() + ".tmp");
            mapper.writeValue(tmp, cache);
            Files.move(tmp.toPath(), cacheFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            logger.warn("Could not save {}: {}", cacheFile, e.getMessage());
        }
    }
}
