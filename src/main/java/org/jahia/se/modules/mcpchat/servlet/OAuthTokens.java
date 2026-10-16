package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.se.modules.mcpchat.oauth.OAuthDiscovery;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Client-credentials OAuth tokens (one account for every Jahia user) for remote MCP servers, cached per server until 30 s before they expire.
 * The token endpoint comes from the configuration, or from {@link OAuthDiscovery}.
 * Thread-safe; two concurrent misses may both fetch a token, which is harmless.
 */
final class OAuthTokens {

    private static final long EARLY_REFRESH_MS = 30_000;

    private static final class Cached {
        final String token;
        final long expiresAt;

        Cached(String token, long expiresAt) {
            this.token = token;
            this.expiresAt = expiresAt;
        }
    }

    private final HttpClient client;
    private final Map<String, Cached> tokens = new ConcurrentHashMap<>();

    OAuthTokens(HttpClient client) {
        this.client = client;
    }

    /**
     * @param server a server with {@link McpServer.Snapshot#usesClientCredentials()}
     * @return a valid access token
     * @throws IOException when discovery or the token request fails
     */
    String get(McpServer.Snapshot server) throws IOException, InterruptedException {
        String key = key(server);
        Cached cached = tokens.get(key);
        if (cached != null && System.currentTimeMillis() < cached.expiresAt) {
            return cached.token;
        }
        String tokenUrl = server.oauthTokenUrl.isEmpty()
                ? OAuthDiscovery.get(client, server.url).authServer.getString("token_endpoint") : server.oauthTokenUrl;

        StringBuilder form = new StringBuilder("grant_type=client_credentials");
        if (!server.oauthScope.isEmpty()) {
            form.append("&scope=").append(URLEncoder.encode(server.oauthScope, StandardCharsets.UTF_8));
        }
        String basic = Base64.getEncoder().encodeToString(
                (enc(server.oauthClientId) + ":" + enc(server.oauthClientSecret)).getBytes(StandardCharsets.UTF_8));
        HttpResponse<String> res = client.send(HttpRequest.newBuilder(URI.create(tokenUrl))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json")
                .header("Authorization", "Basic " + basic)
                .POST(HttpRequest.BodyPublishers.ofString(form.toString()))
                .build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new IOException("token endpoint answered " + res.statusCode());
        }
        try {
            JSONObject json = new JSONObject(res.body());
            String token = json.getString("access_token");
            long ttlMs = json.optLong("expires_in", 300) * 1000;
            tokens.put(key, new Cached(token, System.currentTimeMillis() + Math.max(ttlMs - EARLY_REFRESH_MS, 0)));
            return token;
        } catch (JSONException e) {
            throw new IOException("token endpoint answered no access_token");
        }
    }

    /** Drops the cached token, after the server refused it. */
    void invalidate(McpServer.Snapshot server) {
        tokens.remove(key(server));
    }

    private static String key(McpServer.Snapshot s) {
        return s.name + '|' + s.url + '|' + s.oauthClientId + '|' + s.oauthScope + '|' + s.oauthTokenUrl;
    }

    private static String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }
}
