#!/usr/bin/env node
/**
 * SUSKII site check — zero-dependency static validation.
 *
 *   npm test               structural checks (offline)
 *   npm run test:links     also requests every external URL
 *
 * Fails when:
 *  - a local href/src points to a missing file
 *  - an in-page or cross-page #anchor has no matching id
 *  - an external link is not on the VERIFIED_URLS list below
 *  - a link is empty or "#", or target="_blank" lacks rel="noopener"
 *  - an <img> has no alt attribute, or no width/height
 *  - an id is duplicated, or a JSON-LD block is invalid JSON
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ONLINE = process.argv.includes('--online');

/**
 * Every external URL the site may link to. Only add a URL here after
 * confirming it is live and official — never guess store or website links.
 */
const VERIFIED_URLS = [
    // SUSKII Marketplace (web app + Android)
    'https://suskii.com/',
    'https://suskii.com/referral',
    'https://play.google.com/store/apps/details?id=com.plugz.suskii.app&hl=en_AU',
    // Office location, as linked from suskii.com/contact
    'https://www.google.com/maps/search/?api=1&query=Kigali%20Kisimenti%2C%20Opposite%20Jollof%20Kigali',
    // Social profiles
    'https://www.facebook.com/profile.php?id=61592829380893',
    'https://www.instagram.com/suskiiapp',
    'https://www.tiktok.com/@suskii2026',
    'https://www.linkedin.com/in/suskii2026/',
    // Partners (supplied by SUSKII)
    'https://myeyahomes.com/',
    'https://eyaautos.com/',
];

/**
 * Partner sites SUSKII asked to link before they were live. The online check
 * reports them as warnings instead of failures; remove an entry once its site is up.
 */
const NOT_YET_LIVE = new Set(['https://myeyahomes.com/', 'https://eyaautos.com/']);

/** This site's own production origin (canonical, Open Graph and schema URLs). */
const SITE_ORIGIN = 'https://suskii-website.vercel.app/';

const decode = (s) => s.replace(/&amp;/g, '&');
const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const idsByPage = new Map();
const docs = new Map();

for (const page of pages) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    docs.set(page, html);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) fail(page, `duplicate id "${id}"`);
        seen.add(id);
    }
    idsByPage.set(page, seen);
}

const externalUrls = new Set();

for (const [page, html] of docs) {
    // Ignore the contents of JSON-LD for link checks; validate it separately.
    const markup = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (_, json) => {
        try { JSON.parse(json); } catch (e) { fail(page, `invalid JSON-LD: ${e.message}`); }
        return '';
    });

    for (const [, tag] of markup.matchAll(/<a\b([^>]*)>/g)) {
        const href = /\shref="([^"]*)"/.exec(tag)?.[1];
        if (href === undefined) { fail(page, `<a> without href: <a${tag}>`); continue; }
        if (href === '' || href === '#') fail(page, `placeholder link href="${href}"`);
        if (/target="_blank"/.test(tag) && !/rel="[^"]*noopener/.test(tag)) fail(page, `target=_blank without rel=noopener: ${href}`);
    }

    for (const [, attr, raw] of markup.matchAll(/\s(href|src)="([^"]+)"/g)) {
        const url = decode(raw);
        if (/^(mailto|tel):/.test(url)) continue;
        if (url.startsWith('#')) {
            if (url.length > 1 && !idsByPage.get(page).has(url.slice(1))) fail(page, `missing anchor ${url}`);
            continue;
        }
        if (url.startsWith(SITE_ORIGIN)) {
            const path = url.slice(SITE_ORIGIN.length).split(/[?#]/)[0];
            if (path && !existsSync(join(ROOT, path))) fail(page, `own-site URL has no local file: ${url}`);
            continue;
        }
        if (/^https?:\/\//.test(url)) {
            externalUrls.add(url);
            if (!VERIFIED_URLS.includes(url)) fail(page, `unverified external ${attr}: ${url}`);
            continue;
        }
        const [path, hash] = url.split('#');
        const local = join(ROOT, path.split('?')[0].replace(/^\//, ''));
        if (!existsSync(local)) { fail(page, `missing file ${url}`); continue; }
        if (hash && path.endsWith('.html')) {
            const target = path.replace(/^\//, '');
            if (!idsByPage.get(target)?.has(hash)) fail(page, `missing anchor ${url}`);
        }
    }

    for (const [img] of markup.matchAll(/<img\b[^>]*>/g)) {
        if (!/\salt="/.test(img)) fail(page, `<img> without alt: ${img}`);
        if (!/\swidth="/.test(img) || !/\sheight="/.test(img)) fail(page, `<img> without width/height: ${img}`);
    }

    if (!/<title[^>]*>[^<]+<\/title>/.test(html)) fail(page, 'missing <title>');
    if (!/<meta[^>]*\sname="description"/.test(html) && page !== 'referral.html') fail(page, 'missing meta description');
}

// CSS url() references
const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');
for (const [, ref] of css.matchAll(/url\(["']?(?!data:)([^"')]+)["']?\)/g)) {
    if (!existsSync(join(ROOT, 'css', ref))) fail('css/styles.css', `missing url(${ref})`);
}

if (ONLINE) {
    for (const url of externalUrls) {
        try {
            const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (SUSKII link check)' } });
            // LinkedIn answers bots with 999; treat that as reachable.
            const ok = res.ok || res.status === 999;
            console.log(`${ok ? 'ok ' : 'ERR'} ${res.status} ${url}`);
            if (!ok && !NOT_YET_LIVE.has(url)) fail('links', `${url} returned ${res.status}`);
        } catch (e) {
            if (NOT_YET_LIVE.has(url)) console.warn(`WARN ${url} is not reachable yet (${e.cause?.code ?? e.message})`);
            else fail('links', `${url} failed: ${e.message}`);
        }
    }
}

if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
    process.exit(1);
}
console.log(`✓ ${pages.length} pages checked (${externalUrls.size} external URLs, all verified)${ONLINE ? ' — links reachable' : ''}`);
