package org.jahia.se.modules.mcpchat.config;

import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.AttributeType;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;
import org.osgi.service.metatype.annotations.Option;

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

    @AttributeDefinition(name = "OAuth grant",
            description = "For a remote server that requires OAuth. authorization_code (default): each Jahia user "
                    + "signs in to the server once from the chat; the module registers itself with the server when no "
                    + "client id is set. client_credentials: one account for every user, with the client id and secret below.",
            options = {
                    @Option(label = "Each user signs in (authorization code)", value = "authorization_code"),
                    @Option(label = "One account for all users (client credentials)", value = "client_credentials")})
    String oauthGrant() default "authorization_code";

    @AttributeDefinition(name = "OAuth client id",
            description = "Optional for authorization_code (the module registers itself when empty), required for "
                    + "client_credentials.")
    String oauthClientId() default "";

    @AttributeDefinition(name = "OAuth client secret", type = AttributeType.PASSWORD)
    String oauthClientSecret() default "";

    @AttributeDefinition(name = "OAuth scope", description = "Space-separated scopes to request; empty for the client's defaults.")
    String oauthScope() default "";

    @AttributeDefinition(name = "OAuth token URL",
            description = "Token endpoint. Empty: discovered from the server's OAuth metadata "
                    + "(/.well-known/oauth-protected-resource, then the authorization server's metadata).")
    String oauthTokenUrl() default "";

    @AttributeDefinition(name = "Timeout (ms)", description = "Request timeout for a remote server.")
    int timeoutMs() default 60_000;

    @AttributeDefinition(name = "Sites", description = "Comma-separated site keys allowed to use the server; "
            + "empty means every site.")
    String sites() default "";

    @AttributeDefinition(name = "Enabled", description = "Unchecked hides the server.")
    boolean enabled() default true;
}
