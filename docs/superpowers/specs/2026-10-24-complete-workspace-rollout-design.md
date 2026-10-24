# Complete authenticated workspace rollout

The user approved autonomous continuation of the /layout-preview design throughout the authenticated app and explicitly requires Emails and Translations inside each store. This extends the prior account-settings rollout; retain the current branch and real services. No additional design approval is needed because the user opted out of questions while away.

## Design
Use Estori DM Sans, brand blue, Kumo controls, neutral surfaces and Whop's compact tables/charts. Workspace routes retain grouped global navigation. Store management uses the preview's narrow store-switching rail, store identity and horizontal section navigation. Top-right account menu, real settings, billing/usage controls, builder/editor actions and authentication remain available.

Store sections: Home, Analytics, Products, Customers, Payments, Emails, Translations and Settings. Email/translation panels reuse complete existing store-scoped services; legacy URLs become store launchers. Products read the actual published manifest through a new owner-only API; details show variants/prices/availability and editing stays in the real builder. Customers derive from order records and open order details; payments preserve refund/shipment workflows and account-wide payout setup. Settings reuses publication/draft/domain controls rather than reproducing backend logic.

## Decisions
Keep Recharts: Whop's exact chart library is unverified and switching does not improve the required appearance. Match thin lines, restrained fill/grid, readable ticks and compact metric panels. Do not fabricate traffic, inventory counts, customers, products, notifications, AI answers or financial balances. Preview-only controls become genuine links, existing mutations or clearly labeled empty states. Existing feature flags and billing gates remain enforced.

## Approaches considered
1. Cosmetic CSS-only rollout: low effort but leaves navigation and functionality gaps; rejected.
2. Shared shell plus embedded real domain views and targeted missing read APIs: selected by implementation judgment, fulfills the request with existing services.
3. Rewrite all domain screens/backends: risks losing mature billing/editor/order flows and inventing unsupported product operations; rejected.

## Acceptance
Every authenticated route has coherent typography, canvas, navigation, tables and forms. Store tools never default to another store. Owner checks precede private requests. Switching stores/accounts clears ephemeral views and cached private data. Desktop/mobile, keyboard, back/forward, EN/ES/PT, light/dark and errors/empty states work. Independent browser review compares production against Whop and preview. Destructive/payment/email-send operations are tested with fixtures, not performed on live user data.
