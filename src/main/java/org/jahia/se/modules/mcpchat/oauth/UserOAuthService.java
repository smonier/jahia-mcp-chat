package org.jahia.se.modules.mcpchat.oauth;

import org.jahia.se.modules.mcpchat.config.McpServer;
import org.jahia.services.content.JCRNodeWrapper;
import org.jahia.services.content.JCRSessionWrapper;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.osgi.framework.BundleContext;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.jcr.RepositoryException;
import javax.servlet.http.HttpSession;
import java.io.File;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.StringJoiner;

/**
 * Per-user OAuth sign-in to remote MCP servers (authorization code + PKCE), the way MCP clients do it:
 * the module registers itself with the server's authorization server (dynamic client registration, RFC 7591)
 * unless a client id is configured, each Jahia user signs in once, and the user's tokens are kept under
 * {@code mcpchat.oauth.<server>} properties of the user node, written with the user's own session and never sent to the browser.
 * <p>
 * Registered clients are kept in the bundle's data folder ({@code oauth-clients.properties}), keyed by server
 * URL and redirect URI. Thread-safe.
 */
@Component(service = UserOAuthService.class, immediate = true)
public class UserOAuthService {

    private static final Logger logger = LoggerFactory.getLogger(UserOAuthService.class);
    // A user node accepts no nt:unstructured child; its residual properties hold the tokens instead
    private static final String TOKENS_PREFIX = "mcpchat.oauth.";
    private static final String PENDING_ATTR = "jahia-mcp-chat.oauth.pending";
    private static final long PENDING_TTL_MS = 600_000;
    private static final long EARLY_REFRESH_MS = 30_000;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private File clientsFile;
    private final Properties clients = new Properties();

    @Activate
    protected void activate(BundleContext context) {
        clientsFile = context.getDataFile("oauth-clients.properties");
        if (clientsFile != null && clientsFile.isFile()) {
            try (Reader in = Files.newBufferedReader(clientsFile.toPath(), StandardCharsets.UTF_8)) {
                clients.load(in);
            } catch (IOException e) {
                logger.warn("Could not read registered OAuth clients: {}", e.getMessage());
            }
        }
    }

    /** Outcome of a sign-in callback. */
    public static final class Callback {
        public final String serverName;
        public final String error;

        Callback(String serverName, String error) {
            this.serverName = serverName;
            this.error = error;
        }
    }

    /**
     * Prepares a sign-in and returns the authorization URL to send the user's browser to.
     *
     * @param server      a remote server with {@link McpServer.Snapshot#usesUserSignIn()}
     * @param redirectUri the module's callback URL as the browser reaches it
     * @param session     the user's HTTP session, which keeps the PKCE verifier until the callback
     * @param userName    the signed-in Jahia user
     */
    public String authorizationUrl(McpServer.Snapshot server, String redirectUri, HttpSession session, String userName)
            throws IOException, InterruptedException {
        OAuthDiscovery.Metadata meta = OAuthDiscovery.get(client, server.url);
        String authorize = meta.authServer.optString("authorization_endpoint", "");
        if (!authorize.startsWith("https://")) {
            throw new IOException("no authorization endpoint for " + server.name);
        }
        JSONObject registered = registeredClient(server, meta, redirectUri);

        String verifier = random(48);
        String state = random(24);
        JSONObject pending = new JSONObject()
                .put("server", server.name).put("url", server.url).put("user", userName)
                .put("verifier", verifier).put("redirectUri", redirectUri)
                .put("clientId", registered.getString("client_id"))
                .put("clientSecret", registered.optString("client_secret", ""))
                .put("configuredClient", !server.oauthClientId.isEmpty())
                .put("at", System.currentTimeMillis());
        synchronized (session) {
            pendingMap(session).put(state, pending.toString());
        }

        String scope = server.oauthScope.isEmpty() ? meta.scopes() : server.oauthScope;
        StringJoiner q = new StringJoiner("&", authorize + (authorize.contains("?") ? "&" : "?"), "");
        q.add("response_type=code");
        q.add("client_id=" + enc(registered.getString("client_id")));
        q.add("redirect_uri=" + enc(redirectUri));
        q.add("state=" + state);
        q.add("code_challenge=" + challenge(verifier));
        q.add("code_challenge_method=S256");
        q.add("resource=" + enc(server.url));
        if (!scope.isEmpty()) {
            q.add("scope=" + enc(scope));
        }
        return q.toString();
    }

    /**
     * Completes a sign-in: checks the state against the session and the user, exchanges the code and stores the
     * tokens under the user's node.
     */
    public Callback complete(String code, String state, String error, HttpSession session, String userName,
                             JCRSessionWrapper userSession) throws InterruptedException {
        String raw;
        synchronized (session) {
            raw = state == null ? null : pendingMap(session).remove(state);
        }
        if (raw == null) {
            return new Callback(null, "This sign-in link expired. Start it again from the chat.");
        }
        JSONObject p = new JSONObject(raw);
        String serverName = p.getString("server");
        if (!userName.equals(p.getString("user")) || System.currentTimeMillis() - p.getLong("at") > PENDING_TTL_MS) {
            return new Callback(serverName, "This sign-in link expired. Start it again from the chat.");
        }
        if (error != null || code == null) {
            return new Callback(serverName, "The server refused the sign-in" + (error == null ? "." : ": " + error));
        }
        try {
            OAuthDiscovery.Metadata meta = OAuthDiscovery.get(client, p.getString("url"));
            String tokenEndpoint = meta.authServer.getString("token_endpoint");
            JSONObject tokens = tokenRequest(tokenEndpoint, p.getString("clientId"), p.getString("clientSecret"),
                    "grant_type=authorization_code&code=" + enc(code)
                            + "&redirect_uri=" + enc(p.getString("redirectUri"))
                            + "&code_verifier=" + enc(p.getString("verifier"))
                            + "&resource=" + enc(p.getString("url")));
            // A configured client secret stays in the configuration; only a registered client's secret is kept
            boolean registered = !p.optBoolean("configuredClient", false);
            store(userSession, serverName, p.getString("url"), tokenEndpoint, p.getString("clientId"),
                    registered ? p.getString("clientSecret") : "", tokens, null);
            return new Callback(serverName, null);
        } catch (IOException | JSONException | RepositoryException e) {
            logger.warn("OAuth sign-in to MCP server {} failed: {}", serverName, e.getMessage());
            return new Callback(serverName, "The sign-in could not be completed.");
        }
    }

    /**
     * @return the user's access token for the server, refreshed when it expired, or {@code null} when the user
     * has not signed in (or the refresh failed)
     */
    public String accessToken(McpServer.Snapshot server, JCRSessionWrapper userSession) throws InterruptedException {
        JSONObject t = read(userSession, server);
        if (t == null) {
            return null;
        }
        if (System.currentTimeMillis() < t.optLong("expiresAt", 0)) {
            return t.getString("accessToken");
        }
        return refresh(server, userSession, t);
    }

    /** Refreshes after the server refused the current token; drops the tokens when that fails. */
    public String refreshAfterRefusal(McpServer.Snapshot server, JCRSessionWrapper userSession) throws InterruptedException {
        JSONObject t = read(userSession, server);
        return t == null ? null : refresh(server, userSession, t);
    }

    /** @return {@code true} when the user holds tokens for the server */
    public boolean isSignedIn(McpServer.Snapshot server, JCRSessionWrapper userSession) {
        return read(userSession, server) != null;
    }

    /** Forgets the user's tokens for the server. */
    public void signOut(String serverName, JCRSessionWrapper userSession) throws RepositoryException {
        JCRNodeWrapper node = userNode(userSession);
        if (node.hasProperty(TOKENS_PREFIX + serverName)) {
            node.getProperty(TOKENS_PREFIX + serverName).remove();
            userSession.save();
        }
    }

    private String refresh(McpServer.Snapshot server, JCRSessionWrapper userSession, JSONObject t) throws InterruptedException {
        String refreshToken = t.optString("refreshToken", "");
        try {
            if (refreshToken.isEmpty()) {
                signOut(server.name, userSession);
                return null;
            }
            String secret = t.getString("clientId").equals(server.oauthClientId)
                    ? server.oauthClientSecret : t.optString("clientSecret", "");
            JSONObject tokens = tokenRequest(t.getString("tokenEndpoint"), t.getString("clientId"), secret,
                    "grant_type=refresh_token&refresh_token=" + enc(refreshToken) + "&resource=" + enc(server.url));
            return store(userSession, server.name, server.url, t.getString("tokenEndpoint"), t.getString("clientId"),
                    t.optString("clientSecret", ""), tokens, refreshToken);
        } catch (IOException | JSONException | RepositoryException e) {
            logger.info("OAuth refresh for MCP server {} failed, the user must sign in again: {}", server.name, e.getMessage());
            try {
                signOut(server.name, userSession);
            } catch (RepositoryException ignored) {
                // the next call retries
            }
            return null;
        }
    }

    private synchronized JSONObject registeredClient(McpServer.Snapshot server, OAuthDiscovery.Metadata meta,
                                                     String redirectUri) throws IOException, InterruptedException {
        if (!server.oauthClientId.isEmpty()) {
            return new JSONObject().put("client_id", server.oauthClientId).put("client_secret", server.oauthClientSecret);
        }
        String key = server.url + " " + redirectUri;
        String known = clients.getProperty(key);
        if (known != null) {
            return new JSONObject(known);
        }
        String registration = meta.authServer.optString("registration_endpoint", "");
        if (!registration.startsWith("https://")) {
            throw new IOException(server.name + " offers no client registration; set oauthClientId");
        }
        JSONObject body = new JSONObject()
                .put("client_name", "Jahia MCP Chat")
                .put("redirect_uris", new JSONArray().put(redirectUri))
                .put("grant_types", new JSONArray().put("authorization_code").put("refresh_token"))
                .put("response_types", new JSONArray().put("code"))
                .put("token_endpoint_auth_method", "none");
        HttpResponse<String> res = client.send(HttpRequest.newBuilder(URI.create(registration))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json").header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200 && res.statusCode() != 201) {
            throw new IOException("client registration answered " + res.statusCode());
        }
        JSONObject reg = new JSONObject(res.body());
        JSONObject kept = new JSONObject().put("client_id", reg.getString("client_id"))
                .put("client_secret", reg.optString("client_secret", ""));
        clients.setProperty(key, kept.toString());
        saveClients();
        logger.info("Registered with the authorization server of MCP server {} as client {}", server.name, reg.getString("client_id"));
        return kept;
    }

    private void saveClients() {
        if (clientsFile == null) {
            return;
        }
        try {
            File tmp = new File(clientsFile.getPath() + ".tmp");
            try (Writer out = Files.newBufferedWriter(tmp.toPath(), StandardCharsets.UTF_8)) {
                clients.store(out, "OAuth clients registered by Jahia MCP Chat");
            }
            Files.move(tmp.toPath(), clientsFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            logger.warn("Could not save registered OAuth clients: {}", e.getMessage());
        }
    }

    private JSONObject tokenRequest(String tokenEndpoint, String clientId, String clientSecret, String form)
            throws IOException, InterruptedException {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(tokenEndpoint))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Accept", "application/json");
        if (clientSecret.isEmpty()) {
            form = form + "&client_id=" + enc(clientId);
        } else {
            req.header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                    (enc(clientId) + ":" + enc(clientSecret)).getBytes(StandardCharsets.UTF_8)));
        }
        HttpResponse<String> res = client.send(req.POST(HttpRequest.BodyPublishers.ofString(form)).build(),
                HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new IOException("token endpoint answered " + res.statusCode());
        }
        JSONObject json = new JSONObject(res.body());
        if (json.optString("access_token", "").isEmpty()) {
            throw new IOException("token endpoint answered no access_token");
        }
        return json;
    }

    private String store(JCRSessionWrapper userSession, String serverName, String url, String tokenEndpoint,
                         String clientId, String clientSecret, JSONObject tokens, String previousRefresh)
            throws RepositoryException {
        long ttlMs = tokens.optLong("expires_in", 300) * 1000;
        String accessToken = tokens.getString("access_token");
        JSONObject kept = new JSONObject()
                .put("url", url).put("tokenEndpoint", tokenEndpoint)
                .put("clientId", clientId).put("clientSecret", clientSecret)
                .put("accessToken", accessToken)
                .put("refreshToken", tokens.optString("refresh_token", previousRefresh == null ? "" : previousRefresh))
                .put("expiresAt", System.currentTimeMillis() + Math.max(ttlMs - EARLY_REFRESH_MS, 0));
        userNode(userSession).setProperty(TOKENS_PREFIX + serverName, kept.toString());
        userSession.save();
        return accessToken;
    }

    private JSONObject read(JCRSessionWrapper userSession, McpServer.Snapshot server) {
        try {
            JCRNodeWrapper node = userNode(userSession);
            if (!node.hasProperty(TOKENS_PREFIX + server.name)) {
                return null;
            }
            JSONObject t = new JSONObject(node.getProperty(TOKENS_PREFIX + server.name).getString());
            return server.url.equals(t.optString("url")) ? t : null;
        } catch (RepositoryException | JSONException e) {
            return null;
        }
    }

    private static JCRNodeWrapper userNode(JCRSessionWrapper userSession) throws RepositoryException {
        return userSession.getNode(userSession.getUser().getLocalPath());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> pendingMap(HttpSession session) {
        Object m = session.getAttribute(PENDING_ATTR);
        if (!(m instanceof HashMap)) {
            m = new HashMap<String, String>();
            session.setAttribute(PENDING_ATTR, m);
        }
        Map<String, String> map = (Map<String, String>) m;
        long now = System.currentTimeMillis();
        map.values().removeIf(v -> now - new JSONObject(v).optLong("at", 0) > PENDING_TTL_MS);
        return map;
    }

    private static String random(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static String challenge(String verifier) {
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(
                    MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String enc(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }
}
