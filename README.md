# Kedo — AI network operator

Marketing website for **Kedo** (kedo.im), published with GitHub Pages.

- `index.html` — the full site (self-contained bundle exported from the design tool; fonts, React and assets are embedded and unpacked in the browser on load).
- `.nojekyll` — tells GitHub Pages to serve files as-is.

## Custom domain (kedo.im)
1. Add a file named `CNAME` containing `kedo.im`.
2. At the DNS provider, add A records for `kedo.im` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 (and optionally `www` CNAME → `kedo-im.github.io`).
3. In repo Settings → Pages, set the custom domain and enable "Enforce HTTPS".
