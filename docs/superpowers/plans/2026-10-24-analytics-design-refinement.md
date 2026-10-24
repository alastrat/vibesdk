# Analytics reference correction

User direction: match the authenticated Whop reference, blue and green charts, visible traffic selectors, compact polished cards, functional observed-visit globe, independent design QA after implementation. Existing autonomous implementation authorization applies.

Implementation: retain Kumo and visx, replace purple tokens throughout store charts, use thin linear current/prior series and green change/event states. Traffic selector sits in its card heading with gray segmented backing and raised selected button. Reduce chart/card height and improve typography density. Reuse landing sphere projection/land points for a light dotted globe driven only by observed country aggregates and recent events. Country selection filters recent events and focuses the map; expansion provides an accessible map and country controls. Honor reduced motion. Geographic precision remains country-level.

Validation: targeted chart/widget and geography tests, typecheck/lint/build, actual Whop vs Estori screenshots and interaction checks, independent QA/design review at desktop/mobile with fixes before delivery. No production deployment is part of this change.

## Delivered and verified

- Actual Whop analytics reviewed in the signed-in browser. Current series use #1955e6 blue, pale-blue comparisons, and green event/change indicators. Kumo segmented controls visibly switch Visitors, Page views, and Checkouts. Cards use compact typography, restrained borders, and aligned traffic/event heights.
- The light globe reuses landing-page land points and sphere projection. It plots recorded country aggregates, focuses selected countries, filters the event feed, opens an accessible expanded map, and cycles observed locations. Motion pauses offscreen/in hidden tabs and honors reduced motion. Locations are approximate country centers; unsupported locations remain available in the country list instead of being plotted inaccurately.
- Global comparison now controls traffic overlays and legend as well as order charts. A regression test reproduced the original failure before the fix. Integer count ticks now align with actual integer values; a regression covers the one-checkout case.
- Spanish and Portuguese strings included. Test data stays labeled and isolated from Live; empty Live reports show no visit markers.

Validation: 62 focused tests across five chart/widget/globe/i18n files passed using the temporary frontend Node harness. Root typecheck passed. Lint: zero errors, six pre-existing Fast Refresh warnings. Production build passed. No Worker or database implementation changed in this refinement.

Independent analytics_design_qa compared the actual Whop and Estori pages and exercised desktop and 390px layouts, each traffic metric, pointer/keyboard tooltips, globe expansion, keyboard country selection, event filtering/reset, empty Live state and comparison on/off. Its axis and mobile domain-wrapping findings were fixed and rechecked. No remaining findings. Reduced-motion behavior was reviewed in code. Existing Sentry configuration warnings are unrelated.

Screenshot evidence is saved locally in the task's workspace-rollout visualization directory: analytics-refine-qa-desktop-final.jpg and analytics-refine-qa-mobile-sources-final.jpg, plus the final dashboard proof. Local fixture, TLS, and test harness files remain untracked. Production collection still requires the previously documented migration/deployment; this change does not deploy it.
