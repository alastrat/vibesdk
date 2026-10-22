# English marketing copy

Edit `en.json` to refine the landing page and the shared public navigation, footer, capability labels and section copy. Components read it through `src/content/marketing-copy.ts`. The landing page metadata uses the same source on the frontend and in the Worker.

The keys describe where the text belongs, for example `home.hero.title`, `home.features.cards.catalog.body` and `navigation.signIn`. Keep the keys stable when changing the wording. Keep the JSON structure and value types intact; the TypeScript imports check the fields used by the components.

`{platformFee}` is filled from the platform's fee constant. Preserve that placeholder when editing its sentences; the price belongs in code. Destinations, feature IDs, capability availability, legal documents, sample illustration data and sellers' own store content keep their existing sources.

This is an English content source while the wording is being refined. It deliberately serves English for every selected app language. Spanish and Portuguese marketing catalogs and localized URLs are deferred. The existing app translation catalogs in `shared/i18n/catalogs/` are separate and unchanged.
