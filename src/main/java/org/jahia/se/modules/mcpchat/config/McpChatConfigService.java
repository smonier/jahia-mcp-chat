package org.jahia.se.modules.mcpchat.config;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Modified;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Main configuration of Jahia MCP Chat (PID {@code org.jahia.se.modules.mcpchat}). The models, their providers
 * and keys belong to genai-connector; this configuration only picks the default model tier and shapes the
 * conversation. MCP servers have their own factory configurations ({@link McpServerRegistry}).
 * Changes apply through {@code @Modified} without a redeploy. Thread-safe: one volatile snapshot.
 */
@Component(
        service = McpChatConfigService.class,
        configurationPid = "org.jahia.se.modules.mcpchat",
        immediate = true)
public class McpChatConfigService {

    private static final Logger logger = LoggerFactory.getLogger(McpChatConfigService.class);
    private static final Set<String> TIERS = Set.of("advanced", "balanced", "lite");
    private static final List<String> LEGACY_KEYS = List.of(
            "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "DEFAULT_PROVIDER", "DEFAULT_MODEL");

    private volatile Snapshot config = Snapshot.from(Map.of());

    @Activate
    @Modified
    protected void activate(Map<String, Object> properties) {
        this.config = Snapshot.from(properties);
        for (String key : LEGACY_KEYS) {
            Object v = properties.get(key);
            if (v instanceof String && !((String) v).isBlank()) {
                logger.warn("{} is no longer read: the chat runs on genai-connector, configure its model tiers "
                        + "(org.jahia.modules.genai) and remove this key", key);
            }
        }
    }

    /** @return the tier used when a user has not chosen one: advanced, balanced or lite */
    public String getDefaultTier() {
        return config.defaultTier;
    }

    /** @return the ceiling on output tokens per model call, or 0 to leave the tier's own value */
    public int getMaxTokens() {
        return config.maxTokens;
    }

    /** @return instructions appended to the system prompt, possibly empty */
    public String getSystemPromptAppendix() {
        return config.systemPromptAppendix;
    }

    /** @return the public base URL of this Jahia (scheme, host, context path) without a trailing slash, or "" */
    public String getPublicBaseUrl() {
        return config.publicBaseUrl;
    }

    private static final class Snapshot {
        final String defaultTier;
        final int maxTokens;
        final String systemPromptAppendix;
        final String publicBaseUrl;

        private Snapshot(String defaultTier, int maxTokens, String systemPromptAppendix, String publicBaseUrl) {
            this.defaultTier = defaultTier;
            this.maxTokens = maxTokens;
            this.systemPromptAppendix = systemPromptAppendix;
            this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
        }

        static Snapshot from(Map<String, Object> p) {
            String tier = str(p, "DEFAULT_TIER", "balanced").toLowerCase();
            return new Snapshot(
                    TIERS.contains(tier) ? tier : "balanced",
                    Math.max(intVal(p, "MAX_TOKENS", 0), 0),
                    str(p, "SYSTEM_PROMPT_APPENDIX", ""),
                    str(p, "PUBLIC_BASE_URL", ""));
        }

        private static String str(Map<String, Object> m, String key, String def) {
            Object v = m.get(key);
            return v instanceof String && !((String) v).isBlank() ? ((String) v).trim() : def;
        }

        private static int intVal(Map<String, Object> m, String key, int def) {
            try {
                return Integer.parseInt(String.valueOf(m.get(key)).trim());
            } catch (NumberFormatException e) {
                return def;
            }
        }
    }
}
