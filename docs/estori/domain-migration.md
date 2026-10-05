# Move getestori.com into the Estori Cloudflare account

Target account: Estori (`6d16ad8a9f081e4939993391bd35ca4e`). Do this before the first deploy; Worker routes need the zone in the same account.

## Before you start
- Estori account is on Workers Paid (Workers & Pages → Plans).
- Know the registrar: Cloudflare Registrar (in the old account) or external.

## 1. Old account
1. DNS → Records → Export: save the BIND file.
2. Note SSL/TLS mode, and any Redirect, Page, or Configuration Rules.
3. DNS → Settings → DNSSEC: disable. If the registrar is external, also delete the DS record there.
4. SSL/TLS → Edge Certificates: cancel Advanced Certificate Manager. Ask Cloudflare billing about prorating.

## 2. Estori account
1. Add a domain → `getestori.com` → Free plan.
2. DNS → Records → Import the BIND file. Set every imported record to DNS only (grey cloud).
3. Check the apex and `www` still point at Vercel (`76.76.21.21` or the Vercel CNAME), and that MX/TXT/SPF records match the export.
4. Buy Advanced Certificate Manager and order a certificate for `getestori.com`, `*.getestori.com`, `*.apps.getestori.com`.
5. Add the preview wildcard record: type `AAAA`, name `*.apps`, content `100::`, Proxied (orange cloud).

## 3. Switch authority
- External registrar: replace the nameservers with the two shown on the Estori zone's Overview.
- Cloudflare Registrar: old account → Domain Registration → Manage → Configuration → move to account `6d16ad8a9f081e4939993391bd35ca4e`. Accept in the Estori account within 5 days. The registration is transfer-locked for 30 days after.

## 4. Wait and verify
```bash
dig +short NS getestori.com
dig +short getestori.com
curl -sI https://getestori.com | grep -i '^server'
dig +short MX getestori.com
```
Expect: the Estori nameserver pair; the Vercel address; `server: Vercel`; the original MX records. Zone and ACM certificate both show Active in the dashboard. Then delete the zone from the old account.
