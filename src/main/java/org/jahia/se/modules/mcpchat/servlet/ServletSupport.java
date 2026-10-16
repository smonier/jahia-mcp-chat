package org.jahia.se.modules.mcpchat.servlet;

import org.jahia.services.content.JCRSessionFactory;

import java.util.regex.Pattern;

/** Helpers shared by the module's servlets. Stateless and thread-safe. */
final class ServletSupport {

    private static final Pattern SITE_KEY = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private ServletSupport() {
    }

    /** @return {@code true} when the request runs as the guest user (or the user cannot be resolved) */
    static boolean isGuest() {
        try {
            return "guest".equals(JCRSessionFactory.getInstance().getCurrentUser().getName());
        } catch (Exception e) {
            return true;
        }
    }

    /**
     * @param siteKey a site key sent by the browser
     * @return the key when the current user has jContent access to that site, else {@code null}
     */
    static String accessibleSite(String siteKey) {
        if (siteKey == null || !SITE_KEY.matcher(siteKey).matches()) {
            return null;
        }
        try {
            return JCRSessionFactory.getInstance().getCurrentUserSession()
                    .getNode("/sites/" + siteKey).hasPermission("jContentAccess") ? siteKey : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** @return the value as a JSON string literal, quotes included */
    static String json(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20 || c == '<' || c == '>' || c == '&') {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }
}
