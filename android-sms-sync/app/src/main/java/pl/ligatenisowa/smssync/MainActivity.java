package pl.ligatenisowa.smssync;

import android.Manifest;
import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;

public final class MainActivity extends Activity {
    private static final int SMS_PERMISSION = 10;
    private SharedPreferences prefs;
    private EditText server;
    private EditText token;
    private TextView status;
    private TextView config;
    private Button sync;
    private Button rescan;
    private boolean manualRunning;
    private boolean requestedRescan;
    private boolean requestedAutomatic;
    private Switch automatic;
    private boolean updatingSwitch;
    private final SharedPreferences.OnSharedPreferenceChangeListener statusListener = (p, key) -> {
        if ("lastRun".equals(key) || "status".equals(key)) runOnUiThread(this::showLastRun);
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = SyncSettings.preferences(this);

        ScrollView root = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(20);
        content.setPadding(padding, padding, padding, padding);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        root.addView(content);
        setContentView(root);

        TextView heading = text("Synchronizacja SMS", 26);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
        content.addView(heading);
        content.addView(text("Importuje odebrane i wysłane SMS-y tylko z numerami zawodników ligi.", 16));
        content.addView(text("Adres aplikacji ligi (HTTPS)", 16));
        server = new EditText(this);
        server.setSingleLine(true);
        server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        server.setHint("https://liga.example.pl");
        server.setText(prefs.getString("origin", ""));
        content.addView(server);

        content.addView(text("Token synchronizacji", 16));
        token = new EditText(this);
        token.setSingleLine(true);
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        token.setHint(prefs.contains("token") ? "Wpisz tylko, jeśli zmieniasz konfigurację" : "Token od administratora");
        token.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        content.addView(token);

        Button save = new Button(this);
        save.setText("Zapisz połączenie");
        save.setOnClickListener(view -> saveSettings());
        content.addView(save);

        config = text("", 14);
        content.addView(config);
        showConfig();

        sync = new Button(this);
        sync.setText("Synchronizuj teraz");
        sync.setOnClickListener(view -> requestSync(false));
        content.addView(sync);

        rescan = new Button(this);
        rescan.setText("Zeskanuj całą historię ponownie");
        rescan.setOnClickListener(view -> requestSync(true));
        content.addView(rescan);

        automatic = new Switch(this);
        automatic.setText("Synchronizuj okresowo w tle");
        automatic.setChecked(prefs.getBoolean("automatic", false));
        automatic.setOnCheckedChangeListener((view, checked) -> {
            if (updatingSwitch) return;
            if (!checked) { setAutomatic(false); return; }
            if (!prefs.contains("token")) {
                updateSwitch(false);
                status.setText("Najpierw zapisz połączenie.");
                return;
            }
            if (!SmsSync.hasPermission(this)) {
                updateSwitch(false);
                requestedAutomatic = true;
                requestPermissions(new String[]{Manifest.permission.READ_SMS}, SMS_PERMISSION);
                return;
            }
            setAutomatic(true);
        });
        content.addView(automatic);

        status = text("", 16);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(status);
        showLastRun();
    }

    @Override protected void onStart() {
        super.onStart();
        prefs.registerOnSharedPreferenceChangeListener(statusListener);
        if (!manualRunning) showLastRun();
    }
    @Override protected void onStop() {
        prefs.unregisterOnSharedPreferenceChangeListener(statusListener);
        super.onStop();
    }

    private void saveSettings() {
        try {
            SyncSettings.save(this, server.getText().toString(), token.getText().toString().trim());
            token.setText("");
            showConfig();
            status.setText("Połączenie zapisane. Uruchom synchronizację, aby je sprawdzić.");
        } catch (IllegalArgumentException error) {
            status.setText(error.getMessage());
        } catch (Exception error) {
            status.setText("Nie udało się bezpiecznie zapisać tokenu na tym telefonie.");
        }
    }

    private void showConfig() {
        String origin = prefs.getString("origin", "");
        config.setText(origin.isEmpty() ? "Brak zapisanego połączenia." : "Zapisane połączenie: " + origin);
    }

    private void updateSwitch(boolean enabled) {
        updatingSwitch = true;
        automatic.setChecked(enabled);
        updatingSwitch = false;
    }

    private void setAutomatic(boolean enabled) {
        boolean scheduled = SyncJob.schedule(this, enabled);
        prefs.edit().putBoolean("automatic", enabled && scheduled).apply();
        updateSwitch(enabled && scheduled);
        status.setText(!scheduled ? "Android nie zaplanował synchronizacji. Nadal możesz uruchomić ją ręcznie."
                : enabled ? "Włączono synchronizację okresową. Android ustala moment jej uruchomienia."
                : "Wyłączono synchronizację okresową.");
    }

    private void requestSync(boolean full) {
        if (!prefs.contains("token")) {
            status.setText("Najpierw zapisz połączenie.");
            return;
        }
        if (SmsSync.hasPermission(this)) startSync(full);
        else {
            requestedRescan = full;
            requestPermissions(new String[]{Manifest.permission.READ_SMS}, SMS_PERMISSION);
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != SMS_PERMISSION) return;
        boolean enableAutomatic = requestedAutomatic;
        requestedAutomatic = false;
        if (!SmsSync.hasPermission(this)) {
            status.setText("Brak dostępu do SMS-ów. Sprawdź uprawnienia aplikacji i sposób jej instalacji.");
            return;
        }
        if (enableAutomatic) setAutomatic(true);
        else startSync(requestedRescan);
    }

    private void startSync(boolean full) {
        manualRunning = true;
        sync.setEnabled(false);
        rescan.setEnabled(false);
        status.setText("Synchronizacja trwa…");
        new Thread(() -> {
            String result = SmsSync.run(getApplicationContext(), full);
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                manualRunning = false;
                sync.setEnabled(true);
                rescan.setEnabled(true);
                status.setText(result);
            });
        }, "liga-manual-sms-sync").start();
    }

    private void showLastRun() {
        if (manualRunning) return;
        long lastRun = prefs.getLong("lastRun", 0);
        status.setText(lastRun == 0 ? "Synchronizacja jeszcze nie była uruchamiana."
                : DateFormat.getDateTimeInstance().format(new Date(lastRun)) + "\n" + prefs.getString("status", ""));
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setPadding(0, dp(8), 0, dp(8));
        return view;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
