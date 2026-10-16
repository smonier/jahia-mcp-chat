package org.jahia.se.modules.mcpchat.oauth;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * OAuth metadata of an MCP server: its protected-resource metadata (RFC 9728) and its authorization
 * server's metadata (RFC 8414, then OpenID discovery). Cached per server URL for an hour. Thread-safe.
 */
public final class OAuthDiscovery {

    private static final long TTL_MS = 3_600_000;
    private static final Map<String, Metadata> CACHE = new ConcurrentHashMap<>();

    /** Metadata of one protected MCP server. */
    public static final class Metadata {
        public final JSONObject resource;
        public final JSONObject authServer;
        final long loadedAt = System.currentTimeMillis();

        Metadata(JSONObject resource, JSONObject authServer) {
            this.resource = resource;
            this.authServer = authServer;
        }

        /** @return the scopes the server advertises, space-separated, or "" */
        public String scopes() {
            JSONArray a = resource.optJSONArray("scopes_supported");
            if (a == null) {
                return "";
            }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < a.length(); i++) {
                sb.append(i == 0 ? "" : " ").append(a.optString(i));
            }
            return sb.toString();
        }
    }

    private OAuthDiscovery() {
    }

    /**
     * @param client       HTTP client to use
     * @param resourceUrl  the MCP server URL
     * @return the metadata, from the cache when fresh
     * @throws IOException when the server publishes no usable OAuth metadata
     */
    public static Metadata get(HttpClient client, String resourceUrl) throws IOException, InterruptedException {
        Metadata cached = CACHE.get(resourceUrl);
        if (cached != null && System.currentTimeMillis() - cached.loadedAt < TTL_MS) {
            return cached;
        }
        URI resource = URI.create(resourceUrl);
        String origin = resource.getScheme() + "://" + resource.getRawAuthority();
        String path = resource.getRawPath() == null ? "" : resource.getRawPath();
        JSONObject prm = getJson(client, origin + "/.well-known/oauth-protected-resource" + path);
        if (prm == null && !path.isEmpty()) {
            prm = getJson(client, origin + "/.well-known/oauth-protected-resource");
        }
        JSONArray servers = prm == null ? null : prm.optJSONArray("authorization_servers");
        if (servers == null || servers.length() == 0) {
            throw new IOException("no OAuth protected-resource metadata at " + origin);
        }
        String issuer = servers.getString(0).replaceAll("/+$", "");
        URI is = URI.create(issuer);
        String isOrigin = is.getScheme() + "://" + is.getRawAuthority();
        String isPath = is.getRawPath() == null ? "" : is.getRawPath();
        for (String candidate : new String[]{
                isOrigin + "/.well-known/oauth-authorization-server" + isPath,
                issuer + "/.well-known/oauth-authorization-server",
                issuer + "/.well-known/openid-configuration"}) {
            JSONObject as = getJson(client, candidate);
            if (as != null && as.optString("token_endpoint", "").startsWith("https://")) {
                Metadata m = new Metadata(prm, as);
                CACHE.put(resourceUrl, m);
                return m;
            }
        }
        throw new IOException("no token endpoint in the metadata of " + issuer);
    }

    static JSONObject getJson(HttpClient client, String url) throws InterruptedException {
        try {
            HttpResponse<String> res = client.send(HttpRequest.newBuilder(URI.create(url))
                            .timeout(Duration.ofSeconds(15)).header("Accept", "application/json").GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            return res.statusCode() == 200 ? new JSONObject(res.body()) : null;
        } catch (IOException | JSONException | IllegalArgumentException e) {
            return null;
        }
    }
}
