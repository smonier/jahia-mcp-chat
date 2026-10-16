package org.jahia.se.modules.mcpchat.config;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.component.annotations.ReferenceCardinality;
import org.osgi.service.component.annotations.ReferencePolicy;

import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

/**
 * Collects the MCP servers configured as factory configurations. Adding, editing or removing a
 * {@code org.jahia.se.modules.mcpchat.server-<name>.cfg} file takes effect without a redeploy.
 * When no server is configured, the local Jahia MCP server ({@code /modules/mcp}) is used.
 * Thread-safe.
 */
@Component(service = McpServerRegistry.class, immediate = true)
public class McpServerRegistry {

    private static final McpServer.Snapshot DEFAULT_SERVER = new McpServer.Snapshot(
            "jahia", "Jahia", "/modules/mcp", true, "Authorization", "", 60_000, Collections.emptySet());

    private final List<McpServer> servers = new CopyOnWriteArrayList<>();

    @Reference(service = McpServer.class, cardinality = ReferenceCardinality.MULTIPLE,
            policy = ReferencePolicy.DYNAMIC, unbind = "removeServer")
    protected void addServer(McpServer server) {
        servers.add(server);
    }

    protected void removeServer(McpServer server) {
        servers.remove(server);
    }

    /**
     * @param siteKey the site the chat runs on, or {@code null}
     * @return the enabled servers allowed on that site, sorted by name; the first one with a duplicate name wins
     */
    public List<McpServer.Snapshot> getServers(String siteKey) {
        List<McpServer.Snapshot> configured = servers.stream().map(McpServer::get).collect(Collectors.toList());
        if (configured.isEmpty()) {
            return List.of(DEFAULT_SERVER);
        }
        return configured.stream()
                .filter(s -> s.enabled && s.allowsSite(siteKey))
                .collect(Collectors.toMap(s -> s.name, s -> s, (a, b) -> a))
                .values().stream()
                .sorted(Comparator.comparing(s -> s.name))
                .collect(Collectors.toList());
    }

    /** @return the enabled server with that name allowed on the site, if any */
    public Optional<McpServer.Snapshot> find(String name, String siteKey) {
        return getServers(siteKey).stream().filter(s -> s.name.equals(name)).findFirst();
    }
}
