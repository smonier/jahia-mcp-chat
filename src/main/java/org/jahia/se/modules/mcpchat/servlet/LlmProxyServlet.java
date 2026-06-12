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
 * Proxies LLM API requests (Anthropic, OpenAI) to avoid CORS restrictions.
 * Registered at /modules/jahia-mcp-chat/llm-proxy.
 * The API key is passed in X-API-Key; the provider in X-LLM-Provider.
 */
@Component(
    service = Servlet.class,
    property = {
        "alias=/modules/jahia-mcp-chat/llm-proxy",
        "init.timeout:Integer=60"
    }
)
public class LlmProxyServlet extends HttpServlet {

    private static final Logger logger = LoggerFactory.getLogger(LlmProxyServlet.class);

    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
    private static final String OPENAI_URL = "https://api.openai.com/v1/chat/completions";

    @Override
    protected void doOptions(HttpServletRequest req, HttpServletResponse res) {
        addCorsHeaders(res);
        res.setStatus(HttpServletResponse.SC_OK);
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse res)
            throws ServletException, IOException {

        addCorsHeaders(res);

        String provider = req.getHeader("X-LLM-Provider");
        String apiKey = req.getHeader("X-API-Key");

        if (apiKey == null || apiKey.isBlank()) {
            res.sendError(HttpServletResponse.SC_BAD_REQUEST, "Missing X-API-Key header");
            return;
        }

        String targetUrl = "openai".equalsIgnoreCase(provider) ? OPENAI_URL : ANTHROPIC_URL;

        String requestBody = req.getReader().lines().collect(Collectors.joining("\n"));

        HttpURLConnection conn = (HttpURLConnection) new URL(targetUrl).openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(120_000);

        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "text/event-stream");

        if ("openai".equalsIgnoreCase(provider)) {
            conn.setRequestProperty("Authorization", "Bearer " + apiKey);
        } else {
            conn.setRequestProperty("x-api-key", apiKey);
            conn.setRequestProperty("anthropic-version", "2023-06-01");
            conn.setRequestProperty("anthropic-beta", "messages-2023-12-15");
        }

        try (OutputStream out = conn.getOutputStream()) {
            out.write(requestBody.getBytes(StandardCharsets.UTF_8));
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

        try (InputStream in = upstream;
             OutputStream clientOut = res.getOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                clientOut.write(buf, 0, n);
                clientOut.flush();
            }
        } catch (IOException e) {
            // Client disconnected — normal for stop
            logger.debug("LLM proxy stream closed: {}", e.getMessage());
        } finally {
            conn.disconnect();
        }
    }

    private void addCorsHeaders(HttpServletResponse res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers",
            "Content-Type, X-API-Key, X-LLM-Provider, Authorization");
    }
}
