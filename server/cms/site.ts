/**
 * Generates every CMS-driven public page from published content. Used by the production build
 * (written to dist/) and by the local dev server (rendered per request), so both behave the same.
 */
import type { Db } from '../db.js';
import { mergeContent, renderHome } from './render.js';
import { renderArticle, renderCareersIndex, renderJob, renderNewsIndex } from './pages.js';
import { publishedCollection, publishedSiteContent } from './service.js';

export async function renderSitePages(db: Db, homeTemplate: string): Promise<Map<string, string>> {
    const content = mergeContent(await publishedSiteContent(db));
    const news = await publishedCollection(db, 'news');
    const jobs = await publishedCollection(db, 'job');
    const pages = new Map<string, string>();
    pages.set('/', renderHome(homeTemplate, content, { contactForm: true, newsCount: news.length, jobsCount: jobs.length }));
    // News and careers pages link to each other, so both index pages exist (with an empty state) once either has content.
    if (news.length || jobs.length) {
        pages.set('/news/', renderNewsIndex(news));
        pages.set('/careers/', renderCareersIndex(jobs));
    }
    for (const n of news) pages.set(`/news/${n.key}/`, renderArticle(n.key, n.data));
    for (const j of jobs) pages.set(`/careers/${j.key}/`, renderJob(j.key, j.data, { applyEnabled: true }));
    return pages;
}
