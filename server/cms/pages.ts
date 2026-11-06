/**
 * Public News and Careers pages, generated as static HTML at build time (and on demand for previews).
 * They reuse the site's stylesheet, header and footer so they look like the rest of suskii.com.
 */
import { esc } from './render.js';
import { sanitizeRich, type ImageValue } from './content.js';

export const ASSET_VERSION = '2.7.0';
const ORIGIN = 'https://suskii-website.vercel.app';

interface LayoutOptions {
    title: string;
    description: string;
    path: string;
    body: string;
    preview?: boolean;
    image?: string;
}

const fmtDate = (d: string | Date | null | undefined) => {
    if (!d) return '';
    const date = new Date(d);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export function layout(o: LayoutOptions): string {
    const url = `${ORIGIN}${o.path}`;
    return `<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <script>document.documentElement.classList.replace('no-js', 'js');</script>
    <title>${esc(o.title)} — SUSKII</title>
    <meta name="description" content="${esc(o.description)}">
    <meta name="theme-color" content="#0A0F24">
    ${o.preview ? '<meta name="robots" content="noindex, nofollow">\n    <base href="/">' : `<link rel="canonical" href="${url}">`}
    <meta property="og:type" content="${o.path.split('/').filter(Boolean).length > 1 ? 'article' : 'website'}">
    <meta property="og:site_name" content="SUSKII">
    <meta property="og:title" content="${esc(o.title)}">
    <meta property="og:description" content="${esc(o.description)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${esc(o.image ?? `${ORIGIN}/assets/og/suskii-ecosystem.png`)}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" href="/assets/brand/favicon-32.png" type="image/png" sizes="32x32">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">
    <link rel="preload" href="/assets/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/css/styles.css?v=${ASSET_VERSION}">
</head>
<body>
    <svg class="sprite" aria-hidden="true" focusable="false">
        <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>
    </svg>
    <a class="skip-link" href="#main">Skip to content</a>
    ${o.preview ? '<div class="cms-preview-bar" role="status">Preview · not published</div>' : ''}
    <header class="site-header site-header--solid" id="site-header">
        <div class="container site-header__inner">
            <a class="brand" href="/" aria-label="SUSKII home">
                <img class="brand__mark" src="/assets/brand/suskii-logo-sm.webp" alt="" width="99" height="112">
                <span class="brand__word">SUSKII</span>
            </a>
            <a class="btn btn--dark btn--sm site-header__end" href="/#platforms">Our Platforms</a>
        </div>
    </header>
    <main id="main" class="legal content-page">
        <div class="container">
${o.body}
        </div>
    </main>
    <footer class="site-footer site-footer--compact">
        <div class="container">
            <div class="site-footer__bottom">
                <p>© <span data-year>2026</span> SUSKII. All rights reserved.</p>
                <ul class="site-footer__legal">
                    <li><a href="/">Home</a></li>
                    <li><a href="/news/">News</a></li>
                    <li><a href="/careers/">Careers</a></li>
                    <li><a href="/privacy.html">Privacy Policy</a></li>
                    <li><a href="/terms.html">Terms of Service</a></li>
                </ul>
            </div>
        </div>
    </footer>
    <script src="/js/main.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>
`;
}

type Data = Record<string, unknown>;

export function renderNewsIndex(items: { key: string; data: Data }[]): string {
    const cards = items.map(({ key, data }) => {
        const cover = data.cover as ImageValue | null;
        return `            <article class="news-card">
                ${cover?.url ? `<a class="news-card__media" href="/news/${esc(key)}/" tabindex="-1" aria-hidden="true"><img src="${esc(cover.url)}" alt="" loading="lazy"${cover.width ? ` width="${cover.width}" height="${cover.height}"` : ' width="800" height="450"'}></a>` : ''}
                <div class="news-card__body">
                    <p class="news-card__date">${esc(fmtDate(String(data.date ?? '')))}</p>
                    <h2 class="news-card__title"><a href="/news/${esc(key)}/">${esc(data.title)}</a></h2>
                    <p>${esc(data.summary)}</p>
                </div>
            </article>`;
    }).join('\n');
    return layout({
        title: 'News & announcements',
        description: 'News and announcements from SUSKII and its platforms.',
        path: '/news/',
        body: `            <header class="section-head"><p class="eyebrow">Newsroom</p><h1>News &amp; announcements</h1></header>
            <div class="news-grid">
${cards || '            <p class="empty-note">There are no announcements yet.</p>'}
            </div>`,
    });
}

export function renderArticle(key: string, data: Data, opts: { preview?: boolean } = {}): string {
    const cover = data.cover as ImageValue | null;
    return layout({
        title: String(data.seoTitle || data.title),
        description: String(data.seoDescription || data.summary || ''),
        path: `/news/${key}/`,
        preview: opts.preview,
        image: cover?.url && /^https:/.test(cover.url) ? cover.url : undefined,
        body: `            <article class="article">
                <a class="legal__back" href="/news/"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-arrow"/></svg>All news</a>
                <h1>${esc(data.title)}</h1>
                <p class="legal__updated">${esc(fmtDate(String(data.date ?? '')))}${data.author ? ` · ${esc(data.author)}` : ''}</p>
                ${cover?.url ? `<figure class="article__cover"><img src="${esc(cover.url)}" alt="${esc(cover.alt)}"${cover.width ? ` width="${cover.width}" height="${cover.height}"` : ''}></figure>` : ''}
                <div class="legal__body article__body">
${sanitizeRich(String(data.body ?? ''))}
                </div>
            </article>`,
    });
}

export function renderCareersIndex(items: { key: string; data: Data }[]): string {
    const rows = items.map(({ key, data }) => `            <li class="job-card">
                <a href="/careers/${esc(key)}/">
                    <span class="job-card__title">${esc(data.title)}</span>
                    <span class="job-card__meta">${esc([data.department, data.location, data.employment].filter(Boolean).join(' · '))}</span>
                    <span class="job-card__summary">${esc(data.summary)}</span>
                </a>
            </li>`).join('\n');
    return layout({
        title: 'Careers',
        description: 'Join SUSKII and help build digital platforms for commerce, services and travel.',
        path: '/careers/',
        body: `            <header class="section-head"><p class="eyebrow">Careers</p><h1>Work at SUSKII</h1><p class="section-lead">Help build useful technology for everyday commerce, services and travel.</p></header>
            <ul class="job-list">
${rows || '            <li class="empty-note">There are no open roles right now. Check back soon.</li>'}
            </ul>`,
    });
}

export function renderJob(key: string, data: Data, opts: { preview?: boolean; applyEnabled: boolean }): string {
    const closing = data.closingDate ? `Applications close ${fmtDate(String(data.closingDate))}` : '';
    const closed = data.closingDate ? new Date(`${data.closingDate}T23:59:59Z`).getTime() < Date.now() : false;
    const form = opts.applyEnabled && data.applyOpen && !closed ? `
                <section class="apply" aria-labelledby="apply-title">
                    <h2 id="apply-title">Apply for this role</h2>
                    <form class="contact-form" action="/api/public/applications" method="post" enctype="multipart/form-data" data-apply-form>
                        <input type="hidden" name="job" value="${esc(key)}">
                        <div class="contact-form__grid">
                            <label class="field"><span>Full name</span><input name="name" type="text" autocomplete="name" required maxlength="120"></label>
                            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="254"></label>
                            <label class="field"><span>Phone (optional)</span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
                            <label class="field"><span>LinkedIn or portfolio (optional)</span><input name="profileUrl" type="url" maxlength="500" placeholder="https://"></label>
                            <label class="field field--wide"><span>Cover letter</span><textarea name="coverLetter" rows="6" maxlength="6000"></textarea></label>
                            <label class="field field--wide"><span>CV (PDF, max 4 MB)</span><input name="resume" type="file" accept="application/pdf" required></label>
                            <label class="contact-form__trap" aria-hidden="true">Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
                        </div>
                        <div class="contact-form__actions">
                            <button class="btn btn--dark" type="submit">Submit application</button>
                            <p class="contact-form__status" role="status" aria-live="polite"></p>
                        </div>
                    </form>
                </section>` : '';
    return layout({
        title: String(data.title),
        description: String(data.summary ?? ''),
        path: `/careers/${key}/`,
        preview: opts.preview,
        body: `            <article class="article">
                <a class="legal__back" href="/careers/"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-arrow"/></svg>All roles</a>
                <h1>${esc(data.title)}</h1>
                <p class="legal__updated">${esc([data.department, data.location, data.employment].filter(Boolean).join(' · '))}${closing ? ` · ${esc(closing)}` : ''}</p>
                <div class="legal__body article__body">
${sanitizeRich(String(data.body ?? ''))}
                </div>${form}
                ${closed ? '<p class="notice notice--light">Applications for this role have closed.</p>' : ''}
            </article>`,
    });
}
