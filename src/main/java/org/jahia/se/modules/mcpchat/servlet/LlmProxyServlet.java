package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.se.modules.mcpchat.config.McpChatConfigService;
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
import java.util.stream.Collectors;

/**
 * Proxies LLM API requests server-side to avoid browser CORS restrictions.
 * API keys are read from McpChatConfigService (OSGi cfg) — they are never
 * sent from the browser. Provider is identified by the X-LLM-Provider header.
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

    @Reference
    private McpChatConfigService configService;

    @Override
    protected void doOptions(HttpServletRequest req, HttpServletResponse res) {
        cors(res);
        res.setStatus(HttpServletResponse.SC_OK);
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws IOException {
        cors(res);
        res.setContentType("text/plain");
        res.getWriter().write("LLM proxy OK");
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {

        cors(res);

        String provider = req.getHeader("X-LLM-Provider");
        String apiKey   = configService.getApiKeyForProvider(provider);

        if (apiKey.isBlank()) {
            res.sendError(HttpServletResponse.SC_FORBIDDEN,
                    "No API key configured for provider: " + provider);
            return;
        }

        String targetUrl;
        if ("openai".equalsIgnoreCase(provider)) {
            targetUrl = OPENAI_URL;
        } else if ("deepseek".equalsIgnoreCase(provider)) {
            targetUrl = DEEPSEEK_URL;
        } else {
            targetUrl = ANTHROPIC_URL;
        }

        String body = req.getReader().lines().collect(Collectors.joining("\n"));

        HttpURLConnection conn = (HttpURLConnection) new URL(targetUrl).openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(120_000);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "text/event-stream");

        if ("anthropic".equalsIgnoreCase(provider)) {
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
        res.setHeader("Cache-Control", "no-cache");
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

    private void cors(HttpServletResponse res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LLM-Provider");
    }
}
