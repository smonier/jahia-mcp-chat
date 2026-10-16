package org.jahia.se.modules.mcpchat.config;

import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.AttributeType;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;

/**
 * OSGi metatype of ONE MCP server. Factory configuration: each
 * {@code karaf/etc/org.jahia.se.modules.mcpchat.server-<name>.cfg} file declares one server.
 */
@ObjectClassDefinition(
        name = "Jahia MCP Chat - MCP server",
        description = "One MCP server the chat can call (factory configuration: "
                + "org.jahia.se.modules.mcpchat.server-<name>.cfg).")
public @interface McpServerConfig {

    @AttributeDefinition(name = "Name",
            description = "Lowercase letters, digits, '-' and single '_'. Prefixes the tool names the LLM sees "
                    + "(<name>__<tool>). Defaults to the suffix of the .cfg file name.")
    String name() default "";

    @AttributeDefinition(name = "Label", description = "Name shown to users. Defaults to the name.")
    String label() default "";

    @AttributeDefinition(name = "URL",
            description = "Relative (/modules/mcp): a server on this Jahia, called by the browser with the user's session. "
                    + "Absolute (https://...): a remote server, called through the module's proxy.")
    String url() default "";

    @AttributeDefinition(name = "Auth header", description = "Header sent to a remote server.")
    String authHeader() default "Authorization";

    @AttributeDefinition(name = "Auth value", description = "Value of the auth header, e.g. 'Bearer <token>'. "
            + "Never sent to the browser.", type = AttributeType.PASSWORD)
    String authValue() default "";

    @AttributeDefinition(name = "Timeout (ms)", description = "Request timeout for a remote server.")
    int timeoutMs() default 60_000;

    @AttributeDefinition(name = "Sites", description = "Comma-separated site keys allowed to use the server; "
            + "empty means every site.")
    String sites() default "";

    @AttributeDefinition(name = "Enabled", description = "Unchecked hides the server.")
    boolean enabled() default true;
}
