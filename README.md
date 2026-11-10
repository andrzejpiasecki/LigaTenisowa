# LigaTenisowa

Aplikacja Next.js z publicznymi wynikami ligi, administracyjnym terminarzem i panelem gracza.

## Uruchomienie

Skopiuj `.env.example` do `.env.local` i uzupełnij połączenie z PostgreSQL oraz klucze Clerk dla administratora. `DATABASE_SCHEMA` domyślnie wynosi `liga_tenisowa`, co oddziela tabele tej aplikacji od innych projektów.

```bash
yarn install
yarn db:generate
# Zastosuj zapisane migracje na docelowej bazie:
yarn prisma migrate deploy
yarn dev
```

Administrator nadal loguje się przez Clerk (`/sign-in`) i potrzebuje `publicMetadata.role = "admin"`. Gracze używają osobnych kont z numerem telefonu i hasłem; nie wymagają kont Clerk.

## Umawianie meczów

1. Administrator uzupełnia telefony graczy w bazie zawodników oraz korty i godziny otwarcia. Numer krajowy `600123456`, `+48600123456` oraz `0048600123456` są traktowane identycznie. Unikaj przypisywania tego samego numeru do wielu zawodników.
2. W `/umawianie-meczow` wybiera **Przygotuj jednorazowe zaproszenia**. Konto i jeden SMS powstają atomowo; powtórzenie operacji nie tworzy kolejnego zaproszenia. Wiadomości są przygotowywane tylko dla aktywnych graczy z poprawnym telefonem. `APP_PUBLIC_URL` musi wskazywać tę aplikację.
3. Administrator przegląda treść i wybiera **Wyślij SMS przez telefon** przy wybranej wiadomości. Link jest ważny 30 dni i pozwala jednorazowo ustawić hasło (6–128 znaków). Otwieranie linku samo nie zużywa zaproszenia. Token jest w fragmencie URL, a baza przechowuje jego hash; treść przygotowanego SMS jest dostępna tylko administratorowi.
4. Gracz korzysta z `/gracz`: dodaje daty lub stałą dostępność tygodniową, wpisuje blokady, usuwa swoje terminy oraz potwierdza/odrzuca propozycje meczów. Powraca przez `/gracz/logowanie`, używając numeru i hasła. Hasła są hashowane scrypt, sesje są w ciasteczkach HttpOnly, a próby logowania mają limit w bazie.
5. **Przelicz propozycje** szuka wspólnych 90 minut w najbliższych 21 dniach, na siatce co 30 minut. Uwzględnia pełną dostępność obu graczy, jednorazowe blokady, godziny kortów, historię i zaplanowane mecze. LLM porządkuje wyłącznie istniejące, sprawdzone kandydatury. Propozycje są ponownie weryfikowane przy akceptacji.
6. **Zaproponuj graczom** zapisuje mecz oczekujący na odpowiedzi. **Przygotuj SMS z terminami** tworzy po jednym SMS na gracza i wersję terminu. Link prowadzi do panelu gracza i wymaga zalogowania. Stan `potwierdzony` powstaje po zgodzie obu zawodników. Odmowa jest widoczna jako propozycja wymagająca zmiany. Zmiana godziny, kortu, lokalizacji lub uczestników unieważnia stare potwierdzenia; stare, niewysłane SMS z terminem są anulowane przy próbie wysyłki.

Nie odbieramy SMS od graczy. `/api/sms/inbound` zwraca HTTP 410 i niczego nie zapisuje. Starsze rekordy SMS pozostają w bazie, lecz nie są źródłem nowych propozycji.

Administrator może również wejść w **Baza zawodników → zawodnik → Hasło do konta gracza** i ustawić pierwsze lub nowe hasło (6–128 znaków). Zawodnik musi mieć poprawny numer telefonu. Operacja tworzy konto, jeśli jeszcze go nie ma, unieważnia dotychczasowe sesje i link zaproszenia, anuluje niewysłany SMS zapraszający i odblokowuje próby logowania. Hasło należy przekazać graczowi samodzielnie; aplikacja nie pokazuje zapisanych haseł i nie wysyła ich SMS-em.

## Wysyłanie SMS z telefonu i PWA

Zainstalowana strona PWA nie ma przeglądarkowego API do cichego wysyłania SMS przez kartę SIM. Implementacja używa aplikacji **SMS Gateway for Android** na telefonie z kartą SIM i jej Web API, wywoływanego przez serwer ligi. Klucze bramki nigdy nie trafiają do przeglądarki.

- Zainstaluj bramkę zgodnie z [instrukcją](https://docs.sms-gate.app/getting-started/). Dla publicznie hostowanej aplikacji użyj trybu Cloud albo własnego serwera osiągalnego z backendu ligi; lokalne Wi-Fi telefonu nie jest osiągalne z Vercel.
- Uzupełnij `SMS_GATEWAY_URL`, `SMS_GATEWAY_USERNAME` i `SMS_GATEWAY_PASSWORD` albo `SMS_GATEWAY_TOKEN`. Opcjonalnie wskaż `SMS_GATEWAY_DEVICE_ID`.
- Nie konfiguruj webhooków przychodzących SMS. Telefon musi mieć internet i możliwość wysyłania SMS; operator może naliczać opłaty.
- Stan **Przekazany do bramki** oznacza akceptację żądania HTTP, a nie doręczenie odbiorcy. Doręczenia i błędy telefonu sprawdza się w bramce. Timeout ma stan **Wynik nieznany**; nie ponawiamy automatycznie, aby nie dublować SMS. Po błędzie lub przerwaniu wysyłki najpierw sprawdź bramkę. Ta wersja nie udostępnia automatycznego ponawiania SMS. Administrator może ustawić lub zresetować hasło w szczegółach zawodnika.
- Manifest i service worker umożliwiają instalację strony na ekranie telefonu. Zapisy i wysyłka wymagają internetu. Service worker nie zapisuje danych kont ani API w cache; bez sieci pokazuje komunikat.

## Darmowy LLM

Ustaw `GEMINI_API_KEY` z [Google AI Studio](https://aistudio.google.com/) oraz opcjonalnie `GEMINI_SCHEDULING_MODEL` (domyślnie `gemini-3.1-flash-lite`). Model obsługuje JSON Schema. [Darmowy poziom Gemini](https://ai.google.dev/gemini-api/docs/pricing) ma limity i zależy od konfiguracji projektu Google — wybierz projekt bez płatnego billing, jeśli nie chcesz opłat.

LLM interpretuje wiadomości wpisane w formularzu strony, nie SMS. Rozpoznane daty i godziny wyświetlane są do zatwierdzenia i są walidowane na serwerze. Wszystkie daty są interpretowane w strefie `Europe/Warsaw`, również przy zmianie czasu. Brak klucza, limit albo błąd LLM pozostawia działającą ręczną dostępność i deterministyczne propozycje. Moduł nie używa płatnego OpenAI jako fallbacku. Do LLM nie wysyłamy telefonów, haseł ani tokenów kont.

## Sprawdzenie

```bash
yarn tsc --noEmit
node --experimental-strip-types --test scripts/player-scheduling.test.mjs scripts/match-scoring.test.mjs
yarn build
# Opcjonalny test integracyjny tworzy i usuwa własny schemat testowy w skonfigurowanej bazie:
yarn test:scheduling:db
# Po buildzie można też sprawdzić logowanie i sesje przez HTTP:
TEST_SCHEDULING_HTTP=1 yarn test:scheduling:db
```

Migracja `20260930120000_player_scheduling` dodaje konta, sesje, ograniczenia prób logowania, potwierdzenia i kolejkę wychodzących SMS. Nie usuwa danych poprzedniego modułu. Dashboard nadal pobiera wyniki z `tenisv.pl` przez proxy Next.js.

## Import SMS z telefonu organizatora

Aplikacja Android w [android-sms-sync](android-sms-sync/README.md) synchronizuje odebrane i wysłane SMS tylko dla numerów zawodników, za zgodą organizatora na telefonie. Korzysta z odrębnego endpointu `/api/sms/sync` i zapisuje historię w `SyncedSms`. Nie wywołuje Gemini ani nie wysyła SMS.

## Propozycje meczu przez SMS

W tabeli **Wszystkie mecze** przy przyszłym meczu wybierz **Wyślij propozycję SMS**. Podgląd pokazuje termin, kort, treść i dwa numery z bazy zawodników. Wysyłka następuje po wybraniu **Zatwierdź i wyślij**. Wymaga dwóch różnych polskich numerów oraz skonfigurowanego nadawcy JustSend.

1. Zastosuj migrację `20261110150000_add_match_sms_offers`.
2. Ustaw `JUSTSEND_APP_KEY`, `JUSTSEND_SENDER` (nadpis skonfigurowany w JustSend) i `APP_PUBLIC_URL` (publiczny HTTPS ligi). Integracja korzysta z wariantu PRO / Dynamic: [JustSend API](https://www.justsend.pl/api-docs).
3. Status **Przyjęty przez bramkę** nie potwierdza doręczenia. **Odśwież statusy SMS** pobiera odpowiedzi obu graczy. Jeśli wynik wysyłki jest nieznany, aplikacja nie ponawia jej automatycznie.

Każdy zawodnik dostaje własny link `/answer#…`. Otwarcie linku nie zużywa go. Zapis „Tak”, „Nie” lub „Inny termin” zużywa go raz. Link wygasa po maksymalnie siedmiu dniach, z nadejściem terminu lub po zmianie propozycji. Mecz staje się potwierdzony dopiero po zgodzie obu osób. Kontrpropozycja pojawia się w tabeli jako tekst i nie zajmuje kortu.

## Plan dnia

W panelu **Umawianie meczów** wybierz sezon, a następnie otwórz **Zaplanuj dzień**, aby ułożyć propozycje ze wszystkich jego lig. Domyślnie wybrany jest następny dzień w strefie Europe/Warsaw. Propozycje uwzględniają wpisaną dostępność, historię rozegranych i potwierdzonych terminów, blokady oraz rezerwacje kortów. Każdy zaproponowany slot trwa 90 minut.

Zapisz wybrane mecze, a potem wybierz **Wyślij plan SMS**. Po zatwierdzeniu podglądu JustSend wysyła osobne propozycje z indywidualnymi linkami. Otwarty panel sprawdza odpowiedzi co 20 sekund. Po „Nie” lub „Inny termin” pokazuje nową parę na tym samym korcie o tej samej godzinie, jeśli znajdzie kandydatów. Zapis zastępstwa anuluje poprzednią rezerwację. SMS-y dla nowej pary zatwierdza się osobno.

Funkcja wymaga migracji `20261110160000_add_day_plan` i korzysta z tej samej konfiguracji JustSend co pojedyncze propozycje.
