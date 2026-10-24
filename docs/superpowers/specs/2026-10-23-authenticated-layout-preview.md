# Authenticated workspace layout preview

Reference: inspected the user's live Customer.io workspace and People screen, alongside Estori's current profile page. Adapt the pale navigation surface, grouped sidebar, compact global search and utility controls, large white rounded canvas, and restrained table borders. Use Estori blue for selected navigation and primary actions.

This is an explicitly requested exploratory test view, before any rollout. Route: `/layout-preview`, outside the existing AppShell; the current layout remains unchanged. Local development allows review without a second sign-in because the content is fictional. Production retains the normal protected-page wrapper. No account, database, AI-credit or external-service mutations occur.

Includes sample store search, Published/Draft filters, row selection, store detail drawer, local draft creation, profile preview and local profile editing, help and notifications panels, agent interaction simulation, collapsible desktop navigation and mobile navigation. Existing-feature links exit the preview to their original pages. English-only prototype copy; localization and backend integration belong to any later approved rollout.

Validation: root typecheck; focused ESLint; desktop and 390px browser review; search/filter/sample creation, profile, drawer, simulated agent and navigation collapse checks. No horizontal viewport overflow on mobile; table scrolls within its panel. Before broad adoption, agree navigation groups, content density and the distinction between workspace and store-level navigation.


## Store workspace extension

Requested as another review-only preview. Inspected the open Whop Test workspace Home, Analytics and Products views; used the supplied Patreon screenshot for the compact global rail and store identity with horizontal navigation. Keep the light Estori palette from the workspace test view.

Clicking a sample store now opens a dedicated store workspace at `/layout-preview?store=1&section=home`. Home, Analytics, Products, Customers and Payments use query-string navigation with browser back/forward support. The rail switches sample stores and returns to the original workspace preview. Home combines an editorial store card, an agent prompt, metrics, collection and recent payments. Analytics includes a 7/30-day selector, illustrative trend, funnel and source breakdown. Lists support search; products and payments support status filters. Details open in native modal dialogs. A sample storefront and a prewritten agent response are available.

Product drafts exist in component state only, resetting on store switch/reload; switching management sections retains them. Draft stores show no sales/customers/payments. All customer and transaction records are fictional. Real store routes, payment processing, backend services, authentication and persisted data remain untouched.

Validation: typecheck, scoped ESLint, build, store click-through, store switching, reporting range, product search/filter/creation, customer search/details, payment filtering/details, storefront preview, desktop/mobile sizing. This remains an exploratory prototype, not a production-ready replacement.
