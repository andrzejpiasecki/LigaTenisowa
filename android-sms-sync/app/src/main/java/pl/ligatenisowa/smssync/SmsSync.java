package pl.ligatenisowa.smssync;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.Telephony.Sms;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

final class SmsSync {
    private static final AtomicBoolean RUNNING = new AtomicBoolean();
    private static final int BATCH_SIZE = 25;

    static String run(Context context, boolean rescan) {
        if (!RUNNING.compareAndSet(false, true)) return "Synchronizacja już trwa.";
        try {
            String summary = sync(context, rescan);
            saveStatus(context, summary);
            return summary;
        } catch (SyncException error) {
            saveStatus(context, error.getMessage());
            return error.getMessage();
        } catch (SecurityException error) {
            String message = "Android nie pozwolił odczytać SMS-ów. Sprawdź uprawnienia aplikacji.";
            saveStatus(context, message);
            return message;
        } catch (Exception error) {
            String message = "Synchronizacja nie powiodła się. Sprawdź połączenie, adres serwera i ustawienia.";
            saveStatus(context, message);
            return message;
        } finally { RUNNING.set(false); }
    }

    static boolean hasPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    private static void saveStatus(Context context, String status) {
        SyncSettings.preferences(context).edit().putString("status", status).putLong("lastRun", System.currentTimeMillis()).apply();
    }

    private static String sync(Context context, boolean rescan) throws Exception {
        if (!hasPermission(context)) throw new SyncException("Zezwól aplikacji na odczyt SMS-ów.");
        SyncSettings settings;
        try { settings = SyncSettings.load(context); }
        catch (Exception error) { throw new SyncException("Najpierw zapisz poprawny adres i token synchronizacji."); }
        JSONObject allowlist = request(settings, null);
        JSONArray allowed = allowlist.getJSONArray("phones");
        Set<String> phones = new HashSet<>();
        for (int i = 0; i < allowed.length(); i++) phones.add(allowed.getString(i));
        if (phones.isEmpty()) return "Brak numerów graczy dostępnych do synchronizacji.";

        // A changed allowlist triggers a fresh import, even if a number has been assigned to a different player.
        String scope = sha256(settings.origin + "\n" + settings.token + "\n" + allowlist.getString("revision"));
        int inserted = 0;
        int checked = 0;
        JSONArray batch = new JSONArray();
        List<String> hashes = new ArrayList<>();
        String[] columns = {Sms._ID, Sms.ADDRESS, Sms.TYPE, Sms.DATE, Sms.BODY};
        try (AckStore store = new AckStore(context);
             Cursor cursor = context.getContentResolver().query(Sms.CONTENT_URI, columns,
                     Sms.TYPE + " IN (?, ?)", new String[]{String.valueOf(Sms.MESSAGE_TYPE_INBOX),
                     String.valueOf(Sms.MESSAGE_TYPE_SENT)}, Sms._ID + " ASC")) {
            if (cursor == null) throw new SyncException("Android nie udostępnił skrzynki SMS.");
            Set<String> known = rescan ? new HashSet<>() : store.load(scope);
            while (cursor.moveToNext()) {
                if (Thread.currentThread().isInterrupted()) throw new SyncException("Synchronizacja przerwana. Następna próba wznowi import.");
                String phone = normalizePhone(cursor.getString(1));
                if (!phones.contains(phone)) continue;
                String body = cursor.getString(4);
                long timestamp = cursor.getLong(3);
                if (body == null || body.trim().isEmpty() || body.length() > 12000 || body.indexOf(0) >= 0
                        || timestamp <= 0 || timestamp > System.currentTimeMillis() + 86400000L) continue;
                String direction = cursor.getInt(2) == Sms.MESSAGE_TYPE_INBOX ? "incoming" : "outgoing";
                String hash = sha256(cursor.getLong(0) + "\n" + phone + "\n" + direction + "\n" + timestamp + "\n" + body);
                if (known.contains(hash)) continue;
                batch.put(new JSONObject().put("phone", phone).put("direction", direction).put("body", body).put("timestamp", timestamp));
                hashes.add(hash);
                checked++;
                if (batch.length() == BATCH_SIZE) {
                    inserted += upload(settings, store, scope, batch, hashes);
                    batch = new JSONArray();
                    hashes.clear();
                }
            }
            if (batch.length() > 0) inserted += upload(settings, store, scope, batch, hashes);
        }
        return "Zapisano nowych SMS-ów: " + inserted + ". Przesłano do sprawdzenia: " + checked + ".";
    }

    private static int upload(SyncSettings settings, AckStore store, String scope, JSONArray batch, List<String> hashes) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new SyncException("Synchronizacja przerwana. Następna próba wznowi import.");
        JSONObject result = request(settings, new JSONObject().put("messages", batch));
        JSONArray acknowledged = result.getJSONArray("acknowledged");
        List<String> accepted = new ArrayList<>();
        for (int i = 0; i < acknowledged.length(); i++) accepted.add(hashes.get(acknowledged.getInt(i)));
        store.save(scope, accepted);
        return result.getInt("inserted");
    }

    private static JSONObject request(SyncSettings settings, JSONObject payload) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(settings.origin + "/api/sms/sync").openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Authorization", "Bearer " + settings.token);
            connection.setRequestProperty("Accept", "application/json");
            if (payload != null) {
                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (var output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) throw new SyncException("Serwer odrzucił token synchronizacji.");
            if (status == 404 || status == 405) throw new SyncException("Pod tym adresem nie ma endpointu synchronizacji.");
            if (status != 200) throw new SyncException("Serwer nie przyjął synchronizacji (HTTP " + status + ").");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream response = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (response.size() + count > 1024 * 1024) throw new IOException("Response too large");
                    response.write(buffer, 0, count);
                }
                return new JSONObject(new String(response.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
    }

    static String normalizePhone(String raw) {
        if (raw == null) return "";
        String phone = raw.replaceAll("[\\p{Z}\\s\\uFEFF()-]", "");
        if (phone.matches("[0-9]{9}")) phone = "+48" + phone;
        if (phone.startsWith("00")) phone = "+" + phone.substring(2);
        return phone.matches("\\+[1-9][0-9]{7,14}") ? phone : "";
    }

    private static String sha256(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(64);
        for (byte b : bytes) hex.append(Character.forDigit((b >>> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        return hex.toString();
    }

    private static final class SyncException extends Exception {
        SyncException(String message) { super(message); }
    }
}
