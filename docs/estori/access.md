# Cloudflare Access for the Estori beta

In the Estori account: Zero Trust (free, up to 50 users). Menu paths follow the Cloudflare One dashboard as of October 2026.

1. Create the Zero Trust organization (team name, for example `estori`) if prompted.
2. Integrations → Identity providers → Add new identity provider → One-time PIN.
3. Access controls → Service credentials → Service Tokens → Create Service Token:
   - Name `estori-ci-smoke`, duration 1 year.
   - Copy the Client ID and Client Secret before closing the dialog; the secret is shown once. They go into the GitHub `production` environment as `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET`.
4. Access controls → Policies → Create a policy, twice:
   - `Beta invitees`: Action Allow; Include → Emails → the invitee list (add `Emails ending in` a domain if wanted).
   - `CI smoke`: Action Service Auth; Include → Service Token → `estori-ci-smoke`.
5. Access controls → Applications → Create new application → Self-hosted and private:
   - Name `Estori`.
   - Add public hostname: Domain `estori.app`, subdomain and path empty. This covers exactly `estori.app`, no subdomain wildcard.
   - Access policies: `Beta invitees` and `CI smoke`.
   - Login methods: One-time PIN.
   - Session Duration: 24 hours.
   - Create.
6. Do not create an application for `preview.estori.app` or `*.estori.app`. Previews are protected by signed URLs and must load without Access.

Inviting someone: add their email to `Beta invitees`. No deploy needed.
