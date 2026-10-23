# Public marketing copy

`en.json` is the canonical English copy shared by public pages and Worker metadata. `es.json` and `pt-BR.json` mirror its exact structure in neutral Latin American Spanish and Brazilian Portuguese. Keep stable keys, placeholders, tags, and value types aligned when editing all three files.

Components use the existing `t`/`useI18n` API at render time. `catalog.ts` matches content paths to English keys; `catalog-loader.ts` lazily merges the selected marketing catalog and its `.extra.json` dictionary with the app catalog. Extra dictionaries hold public-page and curated Discover copy outside the central content tree. Do not call translation functions at module scope or cache translated text without a locale dependency.

The header language selector updates the public pages immediately and remembers the choice. Routes remain unchanged; no locale URL prefixes are introduced. Prices stay in USD and use locale formatting. Worker metadata keeps canonical English until the browser renders the selected language.

Follow `shared/i18n/glossary.md`: direct, friendly sentences; Spanish tú and Portuguese você; infinitive buttons. Keep brand and plan names, user content, identifiers, URLs, and original template names unchanged. Legal bodies and downloadable template demos retain their original language; localized legal links identify English documents.

Run the marketing catalog and public locale rendering tests, `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build` after changes.
