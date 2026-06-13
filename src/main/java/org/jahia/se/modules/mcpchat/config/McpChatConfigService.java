package org.jahia.se.modules.mcpchat.config;

import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Modified;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * OSGi-managed configuration for Jahia MCP Chat.
 * Edit digital-factory-data/karaf/etc/org.jahia.se.modules.mcpchat.cfg at runtime
 * — changes are picked up immediately via @Modified without redeployment.
 */
@Component(
        service = McpChatConfigService.class,
        configurationPid = "org.jahia.se.modules.mcpchat",
        immediate = true)
public class McpChatConfigService {

    private volatile Snapshot config = Snapshot.defaults();

    @Activate
    @Modified
    protected void activate(Map<String, Object> properties) {
        this.config = Snapshot.from(properties);
    }

    public String getMcpEndpoint() {
        return config.mcpEndpoint;
    }

    public String getApiKeyForProvider(String provider) {
        if ("openai".equalsIgnoreCase(provider)) return config.openaiApiKey;
        if ("deepseek".equalsIgnoreCase(provider)) return config.deepseekApiKey;
        return config.anthropicApiKey;
    }

    public boolean hasProvider(String provider) {
        return !getApiKeyForProvider(provider).isBlank();
    }

    public List<String> getAvailableProviders() {
        List<String> providers = new ArrayList<>();
        if (!config.anthropicApiKey.isBlank()) providers.add("anthropic");
        if (!config.openaiApiKey.isBlank())    providers.add("openai");
        if (!config.deepseekApiKey.isBlank())  providers.add("deepseek");
        return providers;
    }

    public String getDefaultProvider() {
        return config.defaultProvider;
    }

    public String getDefaultModel() {
        return config.defaultModel;
    }

    public int getMaxTokens() {
        return config.maxTokens;
    }

    public String getSystemPromptAppendix() {
        return config.systemPromptAppendix;
    }

    // Immutable snapshot — a single volatile read gives a fully-consistent config view
    private static final class Snapshot {

        final String mcpEndpoint;
        final String anthropicApiKey;
        final String openaiApiKey;
        final String deepseekApiKey;
        final String defaultProvider;
        final String defaultModel;
        final int    maxTokens;
        final String systemPromptAppendix;

        private Snapshot(String mcpEndpoint, String anthropicApiKey, String openaiApiKey,
                         String deepseekApiKey, String defaultProvider, String defaultModel,
                         int maxTokens, String systemPromptAppendix) {
            this.mcpEndpoint          = mcpEndpoint;
            this.anthropicApiKey      = anthropicApiKey;
            this.openaiApiKey         = openaiApiKey;
            this.deepseekApiKey       = deepseekApiKey;
            this.defaultProvider      = defaultProvider;
            this.defaultModel         = defaultModel;
            this.maxTokens            = maxTokens;
            this.systemPromptAppendix = systemPromptAppendix;
        }

        static Snapshot defaults() {
            return new Snapshot(
                "http://localhost:8080/modules/mcp",
                "", "", "",
                "anthropic", "claude-sonnet-4-6",
                4096, ""
            );
        }

        static Snapshot from(Map<String, Object> p) {
            return new Snapshot(
                str(p, "MCP_ENDPOINT",            "http://localhost:8080/modules/mcp"),
                str(p, "ANTHROPIC_API_KEY",        ""),
                str(p, "OPENAI_API_KEY",           ""),
                str(p, "DEEPSEEK_API_KEY",         ""),
                str(p, "DEFAULT_PROVIDER",         "anthropic"),
                str(p, "DEFAULT_MODEL",            "claude-sonnet-4-6"),
                intVal(p, "MAX_TOKENS",            4096),
                str(p, "SYSTEM_PROMPT_APPENDIX",   "")
            );
        }

        private static String str(Map<String, Object> m, String key, String def) {
            Object v = m.get(key);
            if (v instanceof String) {
                String s = (String) v;
                return !s.isBlank() ? s.trim() : def;
            }
            return def;
        }

        private static int intVal(Map<String, Object> m, String key, int def) {
            try { return Integer.parseInt(String.valueOf(m.get(key))); }
            catch (Exception e) { return def; }
        }
    }
}
