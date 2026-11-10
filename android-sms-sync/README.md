# Liga Tenisowa · SMS

Natywna aplikacja Android (Android 8.0 lub nowszy) do jednostronnego importu SMS z telefonu organizatora do bazy ligi. Obsługuje skrzynkę odebraną i wysłaną; nie wysyła SMS, nie odczytuje MMS ani RCS i nie uruchamia analizy AI.

## Uruchomienie

1. W projekcie Vercel ustaw prywatną zmienną `SMS_SYNC_TOKEN`. Losowy token można wygenerować poleceniem `openssl rand -hex 32`. Nie umieszczaj go w repozytorium ani w APK.
2. Zastosuj migrację `20261110120000_add_sms_sync` na właściwej bazie (`npx prisma migrate deploy`) i wdróż backend z `/api/sms/sync`. Telefon potrzebuje publicznego adresu HTTPS backendu dostępnego bez dodatkowej strony logowania hostingu.
3. Zainstaluj podpisany APK na telefonie organizatora. W aplikacji wpisz sam adres backendu (bez końcówki `/api/sms/sync`) i ten sam token. Zapisz połączenie.
4. Wybierz **Synchronizuj teraz** i udziel dostępu do SMS. Sprawdź liczbę zapisanych wiadomości. Opcjonalnie włącz **Synchronizuj okresowo w tle**. Android planuje pracę w odstępach co najmniej 15 minut; system może ją opóźnić.
5. W razie potrzeby wybierz **Zeskanuj całą historię ponownie**, np. po przywróceniu bazy z kopii. Ponowny import nie tworzy duplikatów.

Android oznacza `READ_SMS` jako uprawnienie ograniczone. Na docelowym telefonie trzeba sprawdzić, czy jego instalator pozwala nadać dostęp. Jeśli system odmawia, aplikacja nie odczytuje historii. [Dokumentacja Androida](https://developer.android.com/reference/android/Manifest.permission#READ_SMS)

## Zakres danych

Telefon pobiera tylko numery jednoznacznie przypisane do zawodników. Wysyła wyłącznie SMS-y powiązane z tymi numerami, a backend sprawdza listę jeszcze raz dla każdej paczki. Numery krajowe i międzynarodowe są normalizowane tak samo jak przy logowaniu gracza. Gdy ten sam numer po normalizacji wskazuje dwóch zawodników, telefon go nie importuje.

Backend zapisuje kierunek, oryginalny czas, treść i powiązanie z zawodnikiem w tabeli `SyncedSms`. Zapis jest idempotentny. Telefon zachowuje jedynie potwierdzenia w postaci skrótów i token zaszyfrowany przez Android Keystore; nie tworzy osobnej lokalnej kopii treści SMS. Dostęp aplikacji do backendu można odwołać, zmieniając token na serwerze.

## Budowanie

Potrzebny jest JDK 17 lub 21 oraz Android SDK z platformą 35. Z katalogu `android-sms-sync`:

```bash
./gradlew :app:assembleDebug
./gradlew :app:assembleRelease
```

Kompilacja release daje niepodpisany APK. Używaj tego samego prywatnego klucza podpisu dla kolejnych aktualizacji.
