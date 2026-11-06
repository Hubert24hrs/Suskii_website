# SUSKII — Corporate Ecosystem Website

The corporate website for **SUSKII**, the parent brand of three independent digital platforms:

| Platform | Category | Status | Website | Android | iOS |
|---|---|---|---|---|---|
| **SUSKII Marketplace** | Online P2P marketplace | Live | [suskii.com](https://suskii.com/) | [Google Play](https://play.google.com/store/apps/details?id=com.plugz.suskii.app&hl=en_AU) | Coming soon |
| **SUSKII Errands** | Services marketplace | Coming soon | Not public yet | Coming soon | Coming soon |
| **SUSKII Travel & Tours** | Travel and tourism | In development | Not public yet | In development | In development |

Only verified URLs are linked. Anything not publicly available is shown as **Coming soon** or **In development**, never as a live link.

## Stack

A plain static site (HTML, CSS and vanilla JS) with no framework and no build step, deployed on Vercel.

```
index.html            Home page: hero, ecosystem, platforms, why, about, FAQ, partners, contact, footer
privacy.html          Privacy Policy
terms.html            Terms of Service
404.html              Not-found page (served by Vercel for unknown paths)
referral.html         Legacy URL; forwards to https://suskii.com/referral, keeping the query string
css/styles.css        The full design system: tokens, components, sections, motion, responsive rules
js/main.js            Progressive enhancement: header state, platforms menu, mobile drawer,
                      scroll reveal, active-section nav
assets/brand/         Official SUSKII logo (transparent PNG/WebP), favicon and app icons
assets/img/           Optimised WebP images used by the page mockups
assets/og/            Open Graph / social share image (1200×630)
assets/images/        Original images (app icon source, QR code, legacy OG image)
favicon.ico, site.webmanifest, robots.txt, sitemap.xml
scripts/check-site.mjs  Zero-dependency site validator (see Testing)
vercel.json           Security headers and asset caching
```

Every section and link works without JavaScript. JS only adds motion and menu behaviour, and it respects `prefers-reduced-motion`.

## Design system

- **Parent brand:** the official SUSKII logo (`assets/brand/suskii-logo.*`) on a deep ink `#0A0F24` / white palette.
- **Platform identities**, set as CSS custom properties on each `.platform--*` block:
  - Marketplace: orange (`--c-market`, from the original SUSKII brand colour)
  - Errands: teal (`--c-errands`)
  - Travel & Tours: indigo/sky on a dark stage (`--c-travel`)
- **Type:** [Geist](https://fonts.google.com/specimen/Geist) (Google Fonts, `display=swap`).
- **Reusable components:** `.btn`, `.status` (`--live` / `--soon` / `--dev`), `.app-tile`, `.store-badge` (`--soon`, `--light`, `--glass`), `.feature-list`, `.platform`, `.bento__tile`, `.contact-card`.

The store badges are styled to match the official artwork. If brand guidelines require Google's and Apple's official badge images, drop those images into the `.store-badge` links.

## Updating platform links

When SUSKII Errands or Travel & Tours launches, or the Marketplace iOS app goes live:

1. Swap the relevant `<span class="store-badge … store-badge--soon">` for an `<a class="store-badge" href="…" target="_blank" rel="noopener">`, and change the `status--soon` / `status--dev` pill to `status--live`. Places to update in `index.html`: the platform showcase, the footer "Get the apps" column and the FAQ.
2. Add each new URL to `VERIFIED_URLS` in `scripts/check-site.mjs`. The check fails on any external link that isn't on that list, which keeps invented links out of the site.
3. Run `npm test && npm run test:links`.

## Partners

A **Partners** section, placed right after the FAQ, links to SUSKII's partners: **My Eya Homes** (https://myeyahomes.com/) and **Eya Autos** (https://eyaautos.com/). Logos live in `assets/partners/`. Neither domain resolved when the links were added, so `scripts/check-site.mjs` lists them in `NOT_YET_LIVE`. That makes `npm run test:links` warn about them instead of failing. Remove them from that set once the sites are up.

## Local development

```bash
npm run dev          # python -m http.server 5173, then open http://localhost:5173
```

Any static server works. When you change `css/styles.css` or `js/main.js`, bump the `?v=` query on their `<link>`/`<script>` tags in every HTML file. Vercel caches `/css` and `/js` for 7 days.

## Testing

```bash
npm install          # installs html-validate (dev only)
npm test             # structural checks: local files, #anchors, verified external URLs,
                     # rel=noopener, img alt/width/height, duplicate ids, JSON-LD validity
npm run test:links   # the same, plus a live request to every external URL
npm run lint         # html-validate (recommended rules) on every page
```

## SEO

- Per-page `<title>`, meta description, canonical URL, Open Graph and Twitter card tags
- JSON-LD `@graph` with `Organization` (contact, office address, social profiles, brands), `WebSite` and `MobileApplication` (Marketplace Android app)
- `sitemap.xml`, `robots.txt` and `site.webmanifest`
- Canonical and OG URLs use the current production origin, `https://suskii-website.vercel.app`. If the site moves to a custom domain, search-and-replace that origin in the HTML files, `sitemap.xml`, `robots.txt` and `SITE_ORIGIN` in `scripts/check-site.mjs`.

## Deployment (Vercel)

The project is already linked to Vercel (`.vercel/project.json`, project `suskii-website`). Deploy as a static site with no build command and the repository root as the output directory. `.vercelignore` keeps dev tooling (`scripts/`, `package.json`, `node_modules`, this README) out of the upload, so Vercel serves the files as they are.

```bash
vercel          # preview deployment
vercel --prod   # production
```

Pushing to the connected Git branch also deploys, if Git integration is enabled on the Vercel project.
