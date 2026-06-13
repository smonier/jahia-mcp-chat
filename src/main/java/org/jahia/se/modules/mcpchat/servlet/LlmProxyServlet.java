package org.jahia.se.modules.mcpchat.servlet;

import org.osgi.service.component.annotations.Component;
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
 * Proxies LLM API requests (Anthropic, OpenAI) server-side to avoid browser CORS restrictions.
 * Served at /modules/jahia-mcp-chat/llm-proxy — alias=/jahia-mcp-chat/llm-proxy maps under
 * Jahia's /modules/ prefix. allow-api-token=true bypasses Jahia's locale filter.
 * API key: X-API-Key header. Provider: X-LLM-Provider header (anthropic|openai).
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
        String apiKey   = req.getHeader("X-API-Key");

        if (apiKey == null || apiKey.isBlank()) {
            res.sendError(HttpServletResponse.SC_BAD_REQUEST, "Missing X-API-Key header");
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
            // OpenAI and DeepSeek both use Bearer auth
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
        if (upstream == null) {
            return;
        }

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
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-LLM-Provider");
    }
}
