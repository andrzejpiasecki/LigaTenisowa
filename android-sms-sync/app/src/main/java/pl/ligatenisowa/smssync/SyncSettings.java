package pl.ligatenisowa.smssync;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SyncSettings {
    private static final String KEY_ALIAS = "liga.sms.sync.token";
    final String origin;
    final String token;

    private SyncSettings(String origin, String token) {
        this.origin = origin;
        this.token = token;
    }

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("sms_sync", Context.MODE_PRIVATE);
    }

    static void save(Context context, String server, String token) throws Exception {
        URI uri;
        try { uri = URI.create(server.trim()); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Podaj adres HTTPS aplikacji ligi."); }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) {
            throw new IllegalArgumentException("Podaj sam adres HTTPS, np. https://liga.example.pl.");
        }
        if (!token.matches("[A-Za-z0-9_-]{32,128}")) {
            throw new IllegalArgumentException("Podaj poprawny token synchronizacji (32–128 znaków).");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        byte[] combined = Arrays.copyOf(iv, iv.length + encrypted.length);
        System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
        if (!preferences(context).edit().putString("origin", "https://" + uri.getRawAuthority())
                .putString("token", Base64.encodeToString(combined, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("Nie udało się zapisać ustawień.");
        }
    }

    static SyncSettings load(Context context) throws Exception {
        SharedPreferences prefs = preferences(context);
        String origin = prefs.getString("origin", "");
        String encoded = prefs.getString("token", "");
        if (origin.isEmpty() || encoded.isEmpty()) throw new IllegalStateException("Najpierw zapisz adres i token synchronizacji.");
        byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, combined, 0, 12));
        return new SyncSettings(origin, new String(cipher.doFinal(combined, 12, combined.length - 12), StandardCharsets.UTF_8));
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (key != null) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
}
