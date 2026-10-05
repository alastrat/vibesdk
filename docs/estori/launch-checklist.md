# First launch checklist

Run after the first successful deploy and smoke test.

1. Private window → `https://estori.app` → Access asks for an email. A non-invited email gets no PIN or is refused. An invited email receives a PIN and gets through.
2. `curl -sI https://estori.app/api/health` (no credentials) → a 302 to `*.cloudflareaccess.com`, never `200`.
3. Sign up with email and password.
4. Create an app ("Create a habit tracker"). The agent streams; the preview loads from `https://preview.estori.app/space/...`.
5. Repo tab shows at least one commit (Artifacts).
6. Ask "Who are you?" → the answer names Estori.
7. While signed in, trigger a redeploy: re-run the last deploy run (`gh run rerun <run id> --repo alastrat/vibesdk`, or Re-run all jobs on its page) and approve it. Reload the app: still signed in.
8. Devtools on `estori.app` → Application → Cookies: `CF_Authorization` and `accessToken` have no `Domain` attribute covering subdomains, and requests to `preview.estori.app` (Network tab) carry neither cookie.
9. No Deploy button in the chat header.
