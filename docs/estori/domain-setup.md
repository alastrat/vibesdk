# Set up estori.app

`estori.app` was bought in the Estori account (`6d16ad8a9f081e4939993391bd35ca4e`), so its zone already lives there. `getestori.com` and the Pluriza account are not part of this launch; do not change them.

1. Domains → `estori.app`: the zone shows Active.
2. SSL/TLS → Overview: mode Full (strict). Edge Certificates: the Universal certificate covers `estori.app` and `*.estori.app`.
3. DNS → Records → Add: type `AAAA`, name `preview`, IPv6 `100::`, Proxied (orange cloud). The app host `estori.app` gets its record from the Worker custom domain on first deploy.
4. Verify:
```bash
dig +short NS estori.app
echo | openssl s_client -connect preview.estori.app:443 -servername preview.estori.app 2>/dev/null | openssl x509 -noout -ext subjectAltName
```
Expect: two Cloudflare nameservers; a SAN list covering `preview.estori.app` (for example `*.estori.app`).
