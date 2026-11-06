import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { defaultContent, mergeContent, renderHome } from '../server/cms/render.js';
import { sanitizeInline, sanitizeRich, validateContent } from '../server/cms/content.js';
import { COLLECTION_FIELDS, SECTIONS } from '../server/cms/schema.js';

const template = readFileSync('index.html', 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function snapshot(html: string) {
    const $ = load(html);
    $('script:not([type="application/ld+json"])').remove();
    return {
        title: $('title').text(),
        description: $('meta[name="description"]').attr('content'),
        og: $('meta[property^="og:"]').map((_, e) => `${$(e).attr('property')}=${$(e).attr('content')}`).get(),
        canonical: $('link[rel="canonical"]').attr('href'),
        text: norm($('body').text()),
        hrefs: $('a[href]').map((_, e) => $(e).attr('href')).get(),
        imgs: $('img').map((_, e) => `${$(e).attr('src')}|${$(e).attr('alt')}`).get(),
        jsonld: JSON.parse($('script[type="application/ld+json"]').first().text()),
        ids: $('[id]').map((_, e) => e.attribs.id).get(),
        sections: $('main > section').length,
    };
}

describe('CMS rendering of the existing homepage', () => {
    it('reproduces the current page exactly when no content has been edited', () => {
        const original = snapshot(template);
        const rendered = snapshot(renderHome(template, defaultContent()));
        expect(rendered).toEqual(original);
    });

    it('keeps URLs and SEO metadata when content changes', () => {
        const content = mergeContent({ 'home.hero': { eyebrow: 'Changed badge <script>alert(1)</script>' } });
        const html = renderHome(template, content);
        const a = snapshot(template);
        const b = snapshot(html);
        expect(b.hrefs).toEqual(a.hrefs);
        expect(b.canonical).toBe(a.canonical);
        expect(b.ids).toEqual(a.ids);
        expect(html).toContain('Changed badge &lt;script&gt;');
        expect(html).not.toContain('<script>alert(1)</script>');
    });

    it('preview adds noindex and a visible banner; the contact form slot is filled only on request', () => {
        const html = renderHome(template, defaultContent(), { preview: { label: 'Hero' }, contactForm: true });
        expect(html).toContain('noindex');
        expect(html).toContain('cms-preview-bar');
        expect(html).toContain('data-contact-form');
        expect(renderHome(template, defaultContent())).not.toContain('data-contact-form');
    });

    it('every section default passes its own validation (editors can save the current content)', () => {
        for (const s of SECTIONS) expect(() => validateContent(s.fields, s.defaults), s.key).not.toThrow();
    });
});

describe('content sanitisation', () => {
    it('strips scripts, event handlers and javascript: URLs from rich text', () => {
        const out = sanitizeRich('<p onclick="x()">Hi <a href="javascript:alert(1)">x</a><script>alert(1)</script><img src="https://a.example/x.png" onerror="y()"><iframe src="https://evil"></iframe></p>');
        expect(out).not.toMatch(/onclick|onerror|javascript:|<script|<iframe/i);
        expect(out).toContain('<p>Hi');
        expect(out).toContain('loading="lazy"');
    });

    it('limits inline fields to a tiny allowlist and opens external links safely', () => {
        const out = sanitizeInline('<strong>Bold</strong> <img src=x> <a href="https://suskii.com">link</a>');
        expect(out).toContain('<strong>Bold</strong>');
        expect(out).not.toContain('<img');
        expect(out).toContain('rel="noopener"');
    });

    it('rejects unsafe URLs and enforces limits', () => {
        const seo = SECTIONS.find((s) => s.key === 'site.social')!;
        expect(() => validateContent(seo.fields, { ...seo.defaults, facebook: 'javascript:alert(1)' })).toThrow();
        expect(() => validateContent(seo.fields, { ...seo.defaults, facebook: 'http://insecure.example' })).toThrow(/https/);
        expect(() => validateContent(COLLECTION_FIELDS.news, { title: 'x'.repeat(500), summary: 's', body: '<p>b</p>', date: '2026-01-01' })).toThrow(/at most/);
    });

    it('drops unknown fields', () => {
        const out = validateContent(COLLECTION_FIELDS.news, { title: 'T', summary: 'S', body: '<p>B</p>', date: '2026-01-02', evil: 'x' });
        expect(out).not.toHaveProperty('evil');
    });
});

describe('generated pages are valid HTML', () => {
    it('homepage, news and careers pages pass html-validate', async () => {
        const { HtmlValidate } = await import('html-validate');
        const { renderArticle, renderCareersIndex, renderJob, renderNewsIndex } = await import('../server/cms/pages.js');
        const hv = new HtmlValidate(JSON.parse(readFileSync('.htmlvalidate.json', 'utf8')));
        const article = { title: 'Launch', summary: 'Summary', body: '<h2>Heading</h2><p>Text with <a href="https://suskii.com">a link</a>.</p><ul><li>One</li></ul>', date: '2026-02-01', author: 'Team', cover: null };
        const job = { title: 'Engineer', department: 'Tech', location: 'Kigali', employment: 'Full-time', summary: 'Build', body: '<p>Role</p>', applyOpen: true, closingDate: null };
        const pages = {
            home: renderHome(template, defaultContent(), { contactForm: true, newsCount: 1, jobsCount: 1 }),
            newsIndex: renderNewsIndex([{ key: 'launch', data: article }]),
            article: renderArticle('launch', article),
            careers: renderCareersIndex([{ key: 'engineer', data: job }]),
            job: renderJob('engineer', job, { applyEnabled: true }),
            emptyNews: renderNewsIndex([]),
        };
        for (const [name, html] of Object.entries(pages)) {
            const report = await hv.validateString(html);
            const messages = report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message} (line ${m.line})`));
            expect(messages, name).toEqual([]);
        }
    });
});
