# Estori in Spanish and Portuguese

Date: 2026-10-21.

The owner asked for the app to be multilingual, in Spanish and Portuguese for now, covering Estori's own app and not generated sites. The owner was away and asked for autonomous work, so every decision below the request is the coordinator's and is listed in section 9 for review.

## 1. Intent

Sellers in Latin America and Brazil should be able to use Estori in their own language, from signing in to building, publishing, billing and the emails Estori sends them. Mexico and Brazil are the next markets (see the expansion decision).

**Success means:**
- A seller who picks Español or Português sees the app in that language.
- The AI answers them in it.
- Their Estori emails arrive in it.
- Prices, dates and numbers read naturally for them.
- Nothing ships half-translated.

## 2. Scope

**In:**
- The signed-in app: the shell, home, the chat and editor, publishing and Go live, drafts, discover, orders, the emails page, the catalog, payments setup, settings, profile, billing, checkout and the card page.
- The sign-in and sign-up pages and dialogs.
- Server messages the app shows: API errors, pause messages and billing messages.
- Estori's emails to sellers: billing, account, orders and domains.
- The AI's chat replies.

**Out, for a follow-up:**
- **Marketing pages:** landing, pricing, features, industries, solutions and the blog. They need a URL and SEO plan (`/es/…`, hreflang, sitemap).
- **Legal documents:** the English Terms and Privacy Policy stay binding, and translations need the lawyer.
- **Admin pages:** staff only.
- **The developer debug panel.**

**Out, by the owner's request:** generated sites and stores, including the emails stores send their shoppers. Sellers write those.

## 3. Languages

| Code | Name shown | Variety |
| --- | --- | --- |
| `en` | English | default, source language |
| `es` | Español | Latin American Spanish: neutral, "tú", Mexican usage where words differ |
| `pt-BR` | Português (Brasil) | Brazilian Portuguese, "você" |

Brand and plan names stay as they are: Estori, Basic, Pro, Premium. A shared glossary keeps the product's terms consistent in each language, for example store, draft, live store, Go live, AI credits and catalog. It lives at `shared/i18n/glossary.md`.

## 4. How strings are written: English as the key

The code keeps its English text, wrapped in a call:
- `t('Save card')`
- `t('Renews on {date}', { date })`
- `tn('{count} credit', '{count} credits', count)`, for plurals
- `<T>` for text with links or emphasis: `t` with tags, rendered by a small component

Each language has a catalog that maps the English string to its translation. A string with no translation falls back to English, and a completeness test keeps that from ever shipping.

Why this approach:
- The code stays readable in English.
- No build-time macros are needed, so the Worker, built by Wrangler, uses the same functions.
- The many guard tests that read source files for English text keep working, because the English stays in the source.
- Placeholders are named (`{date}`), so translators can reorder them.
- Plurals use `Intl.PluralRules` for each language. Portuguese counts 0 as singular, for example.

**Catalogs:**
- They are JSON files in `shared/i18n/catalogs/` (`es.json`, `pt-BR.json`), keyed by the English text. A plural entry is keyed by `singular|plural` and holds `{ one, other }`.
- The browser loads only the chosen language's catalog, split into its own chunk. English loads no catalog.
- The Worker bundles both.

**Server strings:**
- A string the server sends to the app is marked with `msg('…')`. It returns the English text, and the marker lets the extractor find it.
- The response boundary translates it into the request's language. Strings with values use `t(locale, 'Text {x}', { x })`.

**Tooling:**
- A script, `scripts/i18n-extract.ts`, uses the TypeScript parser to find every `t`, `tn`, `msg` and `<T>` call. It adds new keys to the catalogs and lists missing or unused ones.
- Tests fail when a key lacks a Spanish or Portuguese translation, when the placeholders differ between languages, or when a covered folder has English text outside `t`.

## 5. Choosing the language

**Order:**
1. The seller's saved choice.
2. For anyone not signed in, or with no choice yet: a choice saved in the browser, then the browser's languages (`navigator.languages`). In the server, the `Accept-Language` header.
3. English.

**Where it's saved:**
- The account stores the choice in `users.preferences` (`locale`), with no migration, next to the analytics setting.
- Sign-up saves the language the visitor was using, so emails start in it.

**Where it can be changed:**
- A "Language" card in Settings.
- A small language picker on the sign-in and sign-up pages.
- Changing it re-renders the app without a reload, and updates `<html lang>`.

**API:**
- The profile answer carries `locale`.
- `PUT /api/user/locale` saves it, with a CSRF check like other writes.

## 6. Formatting

- **Money** stays in US dollars, written the local way with `Intl.NumberFormat`'s default currency display, so it can't be mistaken for pesos or reais: "$49" (en-US), "USD 49" (es-419), "US$ 49" (pt-BR). Cents show only when present, as `formatUsd` does today ("$24.50", "USD 24,50", "US$ 24,50").
- **Formatting locale:** `es` formats as `es-419`, so numbers read "100,000" as in Mexico; `pt-BR` formats as `pt-BR`, so "100.000".
- **Numbers and dates** are formatted per language: `formatCredits`, `formatBillingDate`, `toLocaleDateString` calls.
- **Relative times** from date-fns use its locale objects.
- **API:** the existing helpers (`formatUsd`, `formatCredits`, `formatBillingDate`, `formatCents`, `formatTemplatePrice`) gain an optional locale, defaulting to `en-US`, so existing callers and tests keep working.

## 7. Emails and the AI

- **Seller emails** (19 templates) render in the recipient's saved language: subject, body and buttons.
  - Recipients without a saved language get English.
  - Shopper emails stay out of scope.
- **The AI** gets one line in its system prompt: reply to the seller in their language, by name, for example "Reply in Brazilian Portuguese".
  - It says nothing about the language of the store's content, which follows what the seller asks for.
  - Fixed status text in the editor ("Thinking…", tool labels) is app text and is translated like the rest.

## 8. Quality

- **Translations** are written with the code, task by task, following the glossary.
- **Reviews:** the final whole-branch review includes a fluent-speaker pass on both languages for accuracy, tone, consistency and length, so labels still fit buttons.
- **Text expansion:** Spanish and Portuguese run about 20–30% longer than English. Layouts must not overflow, and buttons and badges are checked in the local walkthrough at phone and desktop widths.
- **Done** means:
  - every covered folder has no untranslated text;
  - the completeness test passes;
  - a walkthrough of the main flows in both languages finds nothing in English except brand names, user content and the legal documents.

## 9. Decisions

| Decision | Why | If wrong |
| --- | --- | --- |
| Spanish is Latin American, with "tú"; Portuguese is Brazilian | the next markets are Mexico and Brazil | add `es-ES` or `pt-PT` catalogs later |
| English text as the key, with a small in-house `t`; no i18n library | readable code, no build macros (the Worker is bundled by Wrangler), and guard tests keep their English | move to i18next or Lingui; the catalogs carry over |
| Marketing pages, legal documents, admin and the debug panel are out of this round | marketing needs a URL and SEO plan; legal translations need the lawyer; admin is staff only | translate them in a follow-up |
| Shopper emails and generated stores are out | the owner said not site generations; sellers own their store's words | add per-store languages later |
| The language is saved in `users.preferences`, with no migration | the column holds per-account settings already | move it to its own column |
| Sign-up saves the visitor's language | emails should start in it | default to English |
| Prices stay in US dollars, formatted per language | billing and payouts are in USD | show local-currency estimates later |
| Plan names stay Basic, Pro and Premium | they are brand names | translate them |
| The AI replies in the seller's language; store content follows what they ask | chat is the app; the store is the seller's product | also default store content to their language |
| Server strings are translated at the response boundary using `msg()` markers | one place to translate about 140 distinct messages | translate them in the browser by error code |
| Translations are written by the coordinator's implementers and reviewed in the final review | no translator is available tonight | have a native speaker review before launch |
