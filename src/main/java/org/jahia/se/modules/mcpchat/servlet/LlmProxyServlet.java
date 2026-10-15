package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
import org.jahia.services.content.JCRSessionFactory;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.Servlet;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Proxies LLM API requests server-side to keep API keys out of the browser.
 * Restricted to authenticated Jahia users. Guests receive 401.
 * Provider must be one of: anthropic, openai, deepseek.
 * max_tokens in the body is clamped to the operator-configured maximum.
 */
@Component(
        service = {HttpServlet.class, Servlet.class},
        property = {"alias=/jahia-mcp-chat/llm-proxy", "allow-api-token=true"},
        immediate = true)
public class LlmProxyServlet extends HttpServlet {

    private static final Logger logger = LoggerFactory.getLogger(LlmProxyServlet.class);

    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
    private static final String OPENAI_URL    = "https://api.openai.com/v1/chat/completions";
    private static final String DEEPSEEK_URL  = "https://api.deepseek.com/v1/chat/completions";

    private static final Set<String> ALLOWED_PROVIDERS = Set.of("anthropic", "openai", "deepseek");
    private static final int MAX_BODY_BYTES = 1_048_576; // 1 MB
    private static final Pattern MAX_TOKENS_PATTERN = Pattern.compile("\"max_tokens\"\\s*:\\s*(\\d+)");

    @Reference
    private McpChatConfigService configService;

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {

        res.setHeader("Cache-Control", "no-store, private");

        if (isGuest()) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Authentication required");
            return;
        }

        String provider = req.getHeader("X-LLM-Provider");
        if (provider == null || !ALLOWED_PROVIDERS.contains(provider.toLowerCase())) {
            res.sendError(HttpServletResponse.SC_BAD_REQUEST, "Unknown provider");
            return;
        }
        provider = provider.toLowerCase();

        String apiKey = configService.getApiKeyForProvider(provider);
        if (apiKey.isBlank()) {
            res.sendError(HttpServletResponse.SC_FORBIDDEN, "Provider not available");
            return;
        }

        String body = readBodyCapped(req);
        if (body == null) {
            res.sendError(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, "Request too large");
            return;
        }

        // Clamp max_tokens to the operator-configured maximum
        body = clampMaxTokens(body, configService.getMaxTokens());

        String targetUrl;
        if ("openai".equals(provider)) {
            targetUrl = OPENAI_URL;
        } else if ("deepseek".equals(provider)) {
            targetUrl = DEEPSEEK_URL;
        } else {
            targetUrl = ANTHROPIC_URL;
        }

        HttpURLConnection conn = (HttpURLConnection) new URL(targetUrl).openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(120_000);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "text/event-stream");

        if ("anthropic".equals(provider)) {
            conn.setRequestProperty("x-api-key", apiKey);
            conn.setRequestProperty("anthropic-version", "2023-06-01");
            conn.setRequestProperty("anthropic-beta", "messages-2023-12-15");
        } else {
            conn.setRequestProperty("Authorization", "Bearer " + apiKey);
        }

        try (OutputStream out = conn.getOutputStream()) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
        }

        int status = conn.getResponseCode();
        res.setStatus(status);
        res.setContentType("text/event-stream;charset=UTF-8");
        res.setCharacterEncoding("UTF-8");
        res.setHeader("Cache-Control", "no-store, private");
        res.setHeader("X-Accel-Buffering", "no");

        InputStream upstream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (upstream == null) return;

        try (InputStream in = upstream; OutputStream out = res.getOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                out.flush();
            }
        } catch (IOException e) {
            logger.debug("LLM proxy stream closed by client: {}", e.getMessage());
        } finally {
            conn.disconnect();
        }
    }

    private boolean isGuest() {
        try {
            return "guest".equals(JCRSessionFactory.getInstance().getCurrentUser().getName());
        } catch (Exception e) {
            return true;
        }
    }

    private String readBodyCapped(HttpServletRequest req) throws IOException {
        int cl = req.getContentLength();
        if (cl > MAX_BODY_BYTES) return null;
        StringBuilder sb = new StringBuilder();
        char[] chunk = new char[4096];
        int total = 0;
        try (Reader reader = req.getReader()) {
            int n;
            while ((n = reader.read(chunk)) != -1) {
                total += n;
                if (total > MAX_BODY_BYTES) return null;
                sb.append(chunk, 0, n);
            }
        }
        return sb.toString();
    }

    private String clampMaxTokens(String body, int maxAllowed) {
        Matcher m = MAX_TOKENS_PATTERN.matcher(body);
        if (!m.find()) return body;
        int requested;
        try { requested = Integer.parseInt(m.group(1)); } catch (NumberFormatException e) { return body; }
        if (requested <= maxAllowed) return body;
        return body.substring(0, m.start(1)) + maxAllowed + body.substring(m.end(1));
    }
}
