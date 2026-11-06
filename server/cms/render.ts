/**
 * Applies CMS content to the existing page templates by their data-cms markers.
 * Text is always inserted as text (escaped); only inline/rich fields that were sanitised on save
 * are inserted as HTML. The page layout and markup outside the markers is never changed.
 */
import { load, type CheerioAPI } from 'cheerio';
import { SECTIONS } from './schema.js';
import { sanitizeInline } from './content.js';
import type { ImageValue } from './content.js';

export type SiteContent = Record<string, Record<string, unknown>>;

export interface HomeRenderOptions {
    /** Insert the contact form (only when the backend that receives it is configured). */
    contactForm?: boolean;
    newsCount?: number;
    jobsCount?: number;
    /** Admin preview: adds a banner, <base href="/"> and noindex. */
    preview?: { label: string };
}

export function defaultContent(): SiteContent {
    return Object.fromEntries(SECTIONS.map((s) => [s.key, structuredClone(s.defaults)]));
}

/** Merges stored content over defaults section by section. */
export function mergeContent(stored: SiteContent): SiteContent {
    const out = defaultContent();
    for (const [k, v] of Object.entries(stored)) if (out[k]) out[k] = { ...out[k], ...v };
    return out;
}

export const esc = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function resolvePath(content: SiteContent, path: string): unknown {
    const parts = path.split('.');
    let cur: unknown = content[`${parts[0]}.${parts[1]}`];
    for (const p of parts.slice(2)) {
        if (cur === null || cur === undefined) return undefined;
        cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
}

const icon = (id: string, cls = 'icon icon--sm') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const TRAVEL_ICONS = ['plane', 'bed', 'car', 'bus', 'compass'];
const SOCIAL = [
    ['facebook', 'Facebook'],
    ['instagram', 'Instagram'],
    ['tiktok', 'TikTok'],
    ['linkedin', 'LinkedIn'],
] as const;

type Item = Record<string, unknown>;

function listMarkup(path: string, content: SiteContent): string | null {
    const value = resolvePath(content, path);
    if (path.endsWith('.features')) {
        const items = (value as Item[] | undefined) ?? [];
        const travel = path.startsWith('platform.travel_tour');
        return items.map((it, i) => `<li>${icon(travel ? TRAVEL_ICONS[i % TRAVEL_ICONS.length] : 'check')}${esc(it.value)}</li>`).join('\n');
    }
    switch (path) {
        case 'home.about.offices': {
            const items = (value as Item[] | undefined) ?? [];
            return `<dt>Office</dt>${items.map((it) => `<dd${it.muted ? ' class="about__soon"' : ''}>${esc(it.value)}</dd>`).join('')}`;
        }
        case 'home.faq.items': {
            const items = (value as Item[] | undefined) ?? [];
            return items.map((it) => `
                    <details class="faq__item">
                        <summary>${esc(it.question)}</summary>
                        <p>${sanitizeInline(String(it.answer ?? ''))}</p>
                    </details>`).join('');
        }
        case 'home.partners.items': {
            const items = (value as Item[] | undefined) ?? [];
            return items.map((it) => {
                const logo = (it.logo ?? {}) as ImageValue;
                const size = logo.width && logo.height ? ` width="${logo.width}" height="${logo.height}"` : ' width="400" height="200"';
                return `
                    <li>
                        <a class="partner" href="${esc(it.url)}" target="_blank" rel="noopener">
                            <span class="partner__logo"><img src="${esc(logo.url)}" alt="${esc(logo.alt || it.name)}"${size} loading="lazy"></span>
                            <span class="partner__meta">
                                <span class="partner__site">${esc(it.domain)}${icon('external')}</span>
                                <span class="partner__role">${esc(it.role)}</span>
                            </span>
                            <span class="sr-only">Visit ${esc(it.name)} (opens in a new tab)</span>
                        </a>
                    </li>`;
            }).join('');
        }
        case 'site.social': {
            const social = (content['site.social'] ?? {}) as Record<string, string>;
            return SOCIAL.filter(([k]) => social[k]).map(([k, label]) =>
                `<li><a href="${esc(social[k])}" target="_blank" rel="noopener" aria-label="SUSKII on ${label}">${icon(k)}</a></li>`).join('\n');
        }
    }
    return null;
}

function applyMarkers($: CheerioAPI, content: SiteContent): void {
    $('[data-cms]').each((_, el) => {
        const v = resolvePath(content, $(el).attr('data-cms')!);
        if (typeof v === 'string' || typeof v === 'number') $(el).text(String(v));
    });
    $('[data-cms-html]').each((_, el) => {
        const v = resolvePath(content, $(el).attr('data-cms-html')!);
        if (typeof v === 'string') $(el).html(sanitizeInline(v));
    });
    $('[data-cms-attr]').each((_, el) => {
        for (const pair of $(el).attr('data-cms-attr')!.split(';')) {
            const i = pair.indexOf('=');
            if (i < 1) continue;
            const attr = pair.slice(0, i);
            let missing = false;
            const value = pair.slice(i + 1).replace(/\{([\w.]+)\}/g, (_m, p: string) => {
                const v = resolvePath(content, p);
                if (v === undefined || v === null || v === '') missing = true;
                return String(v ?? '');
            });
            if (!missing) $(el).attr(attr, value);
        }
    });
    $('[data-cms-list]').each((_, el) => {
        const html = listMarkup($(el).attr('data-cms-list')!, content);
        if (html !== null) $(el).html(`${html}\n                `);
    });
    $('[data-cms-banner]').each((_, el) => {
        const img = resolvePath(content, $(el).attr('data-cms-banner')!) as ImageValue | null | undefined;
        if (!img?.url) return;
        const size = img.width && img.height ? ` width="${img.width}" height="${img.height}"` : '';
        $(el).html(`<figure class="platform__banner"><img src="${esc(img.url)}" alt="${esc(img.alt)}"${size} loading="lazy"></figure>`);
    });
}

function updateJsonLd($: CheerioAPI, content: SiteContent): void {
    const node = $('script[data-cms-jsonld]');
    if (!node.length) return;
    try {
        const data = JSON.parse(node.html() ?? '');
        const org = (data['@graph'] ?? []).find((n: Item) => n['@type'] === 'Organization');
        if (org) {
            const contact = content['site.contact'] as Item;
            const social = content['site.social'] as Record<string, string>;
            if (contact?.email) org.email = contact.email;
            org.sameAs = SOCIAL.map(([k]) => social?.[k]).filter(Boolean);
        }
        node.text(`\n    ${JSON.stringify(data, null, 2).replace(/\n/g, '\n    ')}\n    `);
    } catch {
        /* keep the original block if it cannot be parsed */
    }
}

export function contactFormMarkup(): string {
    return `
                <form class="contact-form reveal" action="/api/public/inquiries" method="post" data-contact-form novalidate>
                    <h3 class="contact-form__title">Send us a message</h3>
                    <div class="contact-form__grid">
                        <label class="field"><span>Name</span><input name="name" type="text" autocomplete="name" required maxlength="120"></label>
                        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required maxlength="254"></label>
                        <label class="field"><span>Phone (optional)</span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
                        <label class="field"><span>Topic</span>
                            <select name="topic">
                                <option value="general">General</option>
                                <option value="marketplace">SUSKII Marketplace</option>
                                <option value="errands">SUSKII Errands</option>
                                <option value="travel_tour">SUSKII Travel &amp; Tours</option>
                                <option value="partnership">Partnerships</option>
                                <option value="press">Press</option>
                            </select>
                        </label>
                        <label class="field field--wide"><span>Message</span><textarea name="message" rows="5" required maxlength="4000"></textarea></label>
                        <label class="contact-form__trap" aria-hidden="true">Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
                    </div>
                    <div class="contact-form__actions">
                        <button class="btn btn--dark" type="submit">Send message</button>
                        <p class="contact-form__status" role="status" aria-live="polite"></p>
                    </div>
                </form>`;
}

export function renderHome(template: string, content: SiteContent, opts: HomeRenderOptions = {}): string {
    const $ = load(template);
    applyMarkers($, content);
    updateJsonLd($, content);

    const company = $('[data-cms-company-links]');
    if (opts.newsCount) company.append('\n                        <li><a href="/news/">News</a></li>');
    if (opts.jobsCount) company.append('\n                        <li><a href="/careers/">Careers</a></li>');
    if (opts.contactForm) $('[data-cms-slot="contact-form"]').html(contactFormMarkup());

    if (opts.preview) {
        $('head').prepend('<base href="/"><meta name="robots" content="noindex, nofollow">');
        $('body').prepend(`<div class="cms-preview-bar" role="status">Preview · ${esc(opts.preview.label)} · not published</div>`);
    }
    return $.html();
}
