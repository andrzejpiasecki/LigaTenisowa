# LigaTenisowa

Projekt został przeniesiony na `Next.js` i ma teraz:

- publiczny dashboard ligi oparty o istniejący frontend,
- logowanie i profil użytkownika przez `Clerk`,
- admin-only podstronę `/umawianie-meczow` do planowania meczów.

## Wymagane zmienne środowiskowe

Utwórz `.env.local` z wartościami Clerk:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
DATABASE_URL=
DATABASE_URL_UNPOOLED=
DATABASE_SCHEMA=liga_tenisowa
OPENAI_API_KEY=
OPENAI_SMS_MODEL=gpt-4o-mini
OPENAI_MATCHMAKER_MODEL=gpt-4o-mini
```

`DATABASE_SCHEMA` domyślnie jest ustawiany na `liga_tenisowa`, żeby ten projekt nie dotykał tabel z innych aplikacji w tej samej bazie.

## Uruchomienie

```bash
yarn install
yarn db:generate
yarn dev
```

Przy pierwszym uruchomieniu bazy wykonaj migrację:

```bash
yarn db:migrate
```

Domyślne trasy:

- `/dashboard` - publiczny dashboard ligi,
- `/umawianie-meczow` - panel admina do planowania meczów,
- `/api/sms/inbound` - publiczny webhook do odbioru SMS-ów,
- `/api/scheduler/overview` - pełny overview modułu admina i ręczne przeliczenie smart proposals,
- `/sign-in` - logowanie,
- `/user-profile` - zarządzanie kontem przez Clerk.

## Uwagi techniczne

- Dashboard ligi działa na dotychczasowym skrypcie i proxuje zapytania do `http://tenisv.pl` przez route handler `Next.js`.
- Baza danych działa przez `Prisma + PostgreSQL`, w tym samym stylu co `cashflow-real`.
- Projekt wymusza własny schema bazy `liga_tenisowa` przez `DATABASE_SCHEMA`, dzięki czemu może współdzielić jedną bazę z inną aplikacją bez konfliktu migracji.
- Model terminarza jest w `prisma/schema.prisma`, a połączenie w `src/lib/db.ts`.
- Uprawnienie admina jest czytane z Clerk `publicMetadata.role`. Aby nadać dostęp, ustaw użytkownikowi w panelu Clerk:
  `{"role":"admin"}`.
- Moduł umawiania meczów zapisuje przychodzące SMS-y, mapuje je do zawodnika po numerze telefonu i zapisuje dostępność/blokady do bazy. Dla Twilio ustaw inbound webhook numeru na `POST /api/sms/inbound`.
- Webhook przyjmuje `application/x-www-form-urlencoded` z polami typu `From`, `To`, `Body`, `MessageSid` albo JSON z własnej bramki SMS.
- Parser SMS działa przez OpenAI z wymuszonym JSON Schema i wyciąga: dostępność, ramy czasowe, powód oraz ewentualny okres nieaktywności.
- AI matchmaker generuje drafty meczów na podstawie stanu ligi, historii rozegranych meczów, dostępności zawodników i dostępności kortów. Admin widzi je w sidebarze `Smart Proposals` i może je zaakceptować albo odrzucić.
