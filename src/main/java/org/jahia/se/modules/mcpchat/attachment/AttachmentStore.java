package org.jahia.se.modules.mcpchat.attachment;

import org.osgi.service.component.annotations.Component;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Files a user attached to a chat message, held in memory for 30 minutes so that the {@code chat.upload_attachment}
 * tool can put them in the site's media library when the model asks for it. An attachment belongs to the user who
 * sent it; at most {@value #MAX_PER_USER} per user, {@value #MAX_BYTES} bytes each. Thread-safe.
 */
@Component(service = AttachmentStore.class)
public class AttachmentStore {

    public static final int MAX_BYTES = 10 * 1024 * 1024;
    static final int MAX_PER_USER = 20;
    private static final long TTL_MS = 30 * 60_000L;
    private static final SecureRandom RANDOM = new SecureRandom();

    /** One attached file. */
    public static final class Attachment {
        public final String user;
        public final String name;
        public final String mimeType;
        public final byte[] bytes;
        final long at = System.currentTimeMillis();

        Attachment(String user, String name, String mimeType, byte[] bytes) {
            this.user = user;
            this.name = name;
            this.mimeType = mimeType;
            this.bytes = bytes;
        }
    }

    private final Map<String, Attachment> attachments = new ConcurrentHashMap<>();

    /**
     * @return the id of the stored attachment
     * @throws IllegalStateException when the user already holds {@value #MAX_PER_USER} attachments
     */
    public String put(String user, String name, String mimeType, byte[] bytes) {
        purge();
        long held = attachments.values().stream().filter(a -> a.user.equals(user)).count();
        if (held >= MAX_PER_USER) {
            throw new IllegalStateException("Too many attachments; send them again in a few minutes.");
        }
        byte[] id = new byte[18];
        RANDOM.nextBytes(id);
        String key = Base64.getUrlEncoder().withoutPadding().encodeToString(id);
        attachments.put(key, new Attachment(user, name, mimeType, bytes));
        return key;
    }

    /** @return the attachment with that id when it belongs to the user and has not expired */
    public Optional<Attachment> get(String user, String id) {
        purge();
        Attachment a = id == null ? null : attachments.get(id);
        return a != null && a.user.equals(user) ? Optional.of(a) : Optional.empty();
    }

    private void purge() {
        long now = System.currentTimeMillis();
        attachments.values().removeIf(a -> now - a.at > TTL_MS);
    }
}
