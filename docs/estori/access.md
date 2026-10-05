# Cloudflare Access for the Estori beta

In the Estori account: Zero Trust (free, up to 50 users).

1. Create the Zero Trust organization (team name, for example `estori`) if prompted.
2. Settings → Authentication → Login methods: enable One-time PIN.
3. Access → Applications → Add → Self-hosted:
   - Name `Estori`, domain `app.getestori.com`, path empty (all paths).
   - Session duration: 24 hours.
4. Policy `Beta invitees`: Action Allow; Include → Emails → the invitee list (add `Emails ending in` a domain if wanted).
5. Access → Service Auth → Service Tokens → Create `estori-ci-smoke`. Copy the Client ID and Client Secret into the GitHub `production` environment as `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET`.
6. Policy `CI smoke`: Action Service Auth; Include → Service Token → `estori-ci-smoke`.
7. Do not create an application for `*.apps.getestori.com`. Previews are protected by signed URLs and must load without Access.

Inviting someone: add their email to `Beta invitees`. No deploy needed.
