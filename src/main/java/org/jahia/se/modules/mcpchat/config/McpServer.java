package org.jahia.se.modules.mcpchat.config;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.ConfigurationPolicy;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.metatype.annotations.Designate;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * One MCP server the chat can call, from a factory configuration
 * {@code org.jahia.se.modules.mcpchat.server-<name>.cfg} in {@code karaf/etc}.
 * <p>
 * A relative {@code url} (starting with {@code /}) is a server on this Jahia instance: the browser calls it
 * directly with the user's own session. An absolute {@code url} is a remote server: the browser calls it
 * through {@code /modules/jahia-mcp-chat/mcp}, which adds {@code authHeader}/{@code authValue} server-side.
 * Instances are immutable; a configuration change replaces the component.
 */
@Component(
        service = McpServer.class,
        configurationPid = "org.jahia.se.modules.mcpchat.server",
        configurationPolicy = ConfigurationPolicy.REQUIRE)
@Designate(ocd = McpServerConfig.class, factory = true)
public class McpServer {

    static final String FACTORY_PID = "org.jahia.se.modules.mcpchat.server";

    /** Server names prefix tool names as {@code <name>__<tool>}, so they cannot contain {@code __}. */
    private static final Pattern NAME = Pattern.compile("[a-z0-9](?:[a-z0-9-]|_(?!_))*");

    private volatile Snapshot snapshot;

    @Activate
    @Modified
    protected void activate(McpServerConfig config, Map<String, Object> properties) {
        this.snapshot = Snapshot.from(config, fileSuffix(properties));
    }

    /** @return the {@code <name>} of {@code org.jahia.se.modules.mcpchat.server-<name>.cfg}, or "" */
    private static String fileSuffix(Map<String, Object> properties) {
        Object file = properties.get("felix.fileinstall.filename");
        if (file == null) {
            return "";
        }
        String f = String.valueOf(file);
        String base = f.substring(f.lastIndexOf('/') + 1);
        String prefix = FACTORY_PID + "-";
        return base.startsWith(prefix) && base.endsWith(".cfg")
                ? base.substring(prefix.length(), base.length() - 4) : "";
    }

    /** @return the immutable settings of this server, never {@code null} once activated */
    public Snapshot get() {
        return snapshot;
    }

    /** Settings of one MCP server. */
    public static final class Snapshot {
        public final String name;
        public final String label;
        public final String url;
        public final boolean enabled;
        public final String authHeader;
        public final String authValue;
        public final int timeoutMs;
        public final String oauthGrant;
        public final String oauthClientId;
        public final String oauthClientSecret;
        public final String oauthScope;
        public final String oauthTokenUrl;
        /** Site keys allowed to use the server; empty means every site. */
        public final Set<String> sites;

        Snapshot(String name, String label, String url, boolean enabled, String authHeader,
                 String authValue, int timeoutMs, String oauthGrant, String oauthClientId, String oauthClientSecret,
                 String oauthScope, String oauthTokenUrl, Set<String> sites) {
            this.name = name;
            this.label = label;
            this.url = url;
            this.enabled = enabled;
            this.authHeader = authHeader;
            this.authValue = authValue;
            this.timeoutMs = timeoutMs;
            this.oauthGrant = oauthGrant;
            this.oauthClientId = oauthClientId;
            this.oauthClientSecret = oauthClientSecret;
            this.oauthScope = oauthScope;
            this.oauthTokenUrl = oauthTokenUrl;
            this.sites = sites;
        }

        static Snapshot from(McpServerConfig c, String fileSuffix) {
            String name = trim(c.name()).isEmpty() ? fileSuffix.toLowerCase() : trim(c.name()).toLowerCase();
            String url = trim(c.url());
            return new Snapshot(
                    name,
                    trim(c.label()).isEmpty() ? name : trim(c.label()),
                    url,
                    c.enabled() && NAME.matcher(name).matches() && isValidUrl(url),
                    trim(c.authHeader()).isEmpty() ? "Authorization" : trim(c.authHeader()),
                    trim(c.authValue()),
                    c.timeoutMs() > 0 ? c.timeoutMs() : 60_000,
                    "client_credentials".equals(trim(c.oauthGrant())) ? "client_credentials" : "authorization_code",
                    trim(c.oauthClientId()),
                    trim(c.oauthClientSecret()),
                    trim(c.oauthScope()),
                    trim(c.oauthTokenUrl()),
                    Collections.unmodifiableSet(Arrays.stream(trim(c.sites()).split(","))
                            .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet())));
        }

        private static String trim(String v) {
            return v == null ? "" : v.trim();
        }

        /** @return {@code true} when calls carry one client-credentials token shared by every user */
        public boolean usesClientCredentials() {
            return "client_credentials".equals(oauthGrant) && !oauthClientId.isEmpty();
        }

        /** @return {@code true} when a 401 from the server means the user must sign in to it */
        public boolean usesUserSignIn() {
            return !isLocal() && !usesClientCredentials() && authValue.isEmpty();
        }

        /** @return {@code true} when the browser calls the server itself (same Jahia instance) */
        public boolean isLocal() {
            return url.startsWith("/");
        }

        /** @return {@code true} when the server may be used from the given site */
        public boolean allowsSite(String siteKey) {
            return sites.isEmpty() || (siteKey != null && sites.contains(siteKey));
        }

        private static boolean isValidUrl(String url) {
            return (url.startsWith("/") && !url.startsWith("//")) || url.startsWith("https://") || url.startsWith("http://");
        }
    }
}
