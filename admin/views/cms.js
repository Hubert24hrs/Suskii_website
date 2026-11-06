/**
 * Corporate CMS: website sections, news and careers, with the Draft → Pending Review → Approved →
 * Published → Archived workflow, revision history, scheduling and live preview.
 * Forms are generated from the server's content schema, so the editor always matches what the site renders.
 */
import { api, ApiError, append, banner, clear, confirmAction, dateTime, empty, errorState, field, h, icon, modal, pill, skeleton, toast, ago } from '../lib.js';
import { pageHead } from './common.js';
import { pickImage } from './media.js';

const STEPS = [['draft', 'Draft'], ['pending_review', 'Pending review'], ['approved', 'Approved'], ['published', 'Published']];
const COLLECTIONS = [['section', 'Website sections'], ['news', 'News'], ['job', 'Careers']];

let schemaCache = null;

export async function render(root, ctx) {
    const q = ctx.query();
    const collection = ['news', 'job'].includes(q.get('collection')) ? q.get('collection') : 'section';
    root.append(pageHead('Corporate CMS', 'Edit the corporate website. Changes go live only after they are approved and published.',
        ctx.can('cms.publish') ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: rebuild }, icon('refresh', 'icon icon--sm'), 'Republish site') : null,
        h('a', { class: 'btn btn--ghost btn--sm', href: '/', target: '_blank', rel: 'noopener' }, icon('external', 'icon icon--sm'), 'View website')));
    root.append(h('div', { class: 'adm-tabs', role: 'tablist' }, COLLECTIONS.map(([k, t]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(k === collection),
        onclick: () => ctx.setQuery({ collection: k === 'section' ? null : k, entry: null }),
    }, t))));

    const side = h('aside', { class: 'adm-card adm-sidepanel' }, skeleton('adm-skel--row', 6));
    const main = h('div', { class: 'adm-card' }, skeleton('adm-skel--chart'));
    root.append(h('div', { class: 'adm-split' }, side, main));

    try {
        schemaCache ??= await api('/api/cms/schema');
    } catch (e) { clear(main).append(errorState(e)); clear(side); return; }

    const loadList = async (selectId) => {
        let items;
        try { ({ items } = await api(`/api/cms/entries?collection=${collection}`)); } catch (e) { clear(side).append(errorState(e)); return; }
        if (!ctx.isCurrent()) return;
        clear(side);
        if (collection !== 'section' && ctx.can('cms.edit')) {
            side.append(h('button', { class: 'btn btn--dark btn--sm', type: 'button', style: { width: '100%', marginBottom: '10px' }, onclick: () => createDialog(collection, (id) => { ctx.setQuery({ entry: id }); }) },
                icon('plus', 'icon icon--sm'), collection === 'news' ? 'New article' : 'New job opening'));
        }
        if (!items.length) {
            side.append(empty(collection === 'news' ? 'No articles yet' : 'No job openings yet', collection === 'news' ? 'Published articles appear at /news.' : 'Published openings appear at /careers.'));
        }
        const list = h('div', { class: 'adm-entry-list' });
        let lastGroup = null;
        const groupOf = (it) => schemaCache.sections.find((s) => s.key === it.key)?.group;
        const sorted = collection === 'section'
            ? [...items].sort((a, b) => schemaCache.sections.findIndex((s) => s.key === a.key) - schemaCache.sections.findIndex((s) => s.key === b.key))
            : items;
        for (const it of sorted) {
            if (collection === 'section' && groupOf(it) !== lastGroup) { lastGroup = groupOf(it); list.append(h('div', { class: 'adm-nav__group', style: { color: 'var(--muted)', padding: '10px 10px 4px' } }, lastGroup)); }
            list.append(h('button', { type: 'button', 'aria-current': String(it.id === (selectId ?? sorted[0]?.id)), onclick: () => ctx.setQuery({ entry: it.id }) },
                h('span', {}, it.title, h('small', {}, it.hasUnpublishedChanges ? 'Unpublished changes' : it.isLive ? `Live · ${ago(it.publishedAt)}` : 'Not published')),
                pill(it.status)));
        }
        side.append(list);
        return sorted;
    };

    const items = await loadList(q.get('entry'));
    if (!items || !ctx.isCurrent()) return;
    const selected = q.get('entry') ?? items[0]?.id;
    if (!selected) { clear(main).append(empty('Nothing selected', 'Choose an item on the left, or create a new one.', 'cms')); return; }
    await renderEditor(main, ctx, selected, () => loadList(selected));
}

async function rebuild() {
    const ok = await confirmAction({ title: 'Republish the website?', message: 'This rebuilds the public site from the currently published content. Drafts are not included.', confirmLabel: 'Republish' });
    if (!ok) return;
    try { const res = await api('/api/cms/rebuild', { method: 'POST' }); toast(res.message, res.triggered ? 'ok' : 'info', 7000); } catch (e) { toast(e.message, 'error'); }
}

function slugify(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function createDialog(collection, onCreated) {
    const fields = schemaCache.collections[collection];
    const values = Object.fromEntries(fields.map((f) => [f.key, f.type === 'boolean' ? collection === 'job' && f.key === 'applyOpen' : f.type === 'date' && f.key === 'date' ? new Date().toISOString().slice(0, 10) : f.type === 'image' ? null : '']));
    const slug = h('input', { class: 'adm-input', required: true, maxlength: 80, pattern: '[a-z0-9-]+' });
    let slugTouched = false;
    slug.addEventListener('input', () => { slugTouched = true; });
    const form = buildForm(fields, values, {
        onChange: (key, v) => { if (key === 'title' && !slugTouched) slug.value = slugify(v); },
    });
    const alertHost = h('div', {});
    modal({
        title: collection === 'news' ? 'New article' : 'New job opening', wide: true,
        body: h('div', { class: 'adm-form' }, alertHost, field('URL slug', slug, { help: `Public address: /${collection === 'news' ? 'news' : 'careers'}/<slug>. Lowercase letters, numbers and hyphens.` }), form.el),
        actions: [
            { label: 'Cancel' },
            { label: 'Create draft', kind: 'primary', onClick: async () => {
                clear(alertHost);
                try {
                    const { entry } = await api('/api/cms/entries', { method: 'POST', body: { collection, slug: slug.value.trim(), data: form.value() } });
                    toast('Draft created. It is not public until it is published.', 'ok');
                    onCreated(entry.id);
                } catch (e) { alertHost.append(banner('error', e.message)); form.markError(e.details?.field); return false; }
            } },
        ],
    });
}

async function renderEditor(main, ctx, id, refreshList) {
    clear(main).append(skeleton('adm-skel--chart'));
    let data;
    try { data = await api(`/api/cms/entries/${id}`); } catch (e) { clear(main).append(errorState(e)); return; }
    if (!ctx.isCurrent()) return;
    const { entry, revisions } = data;
    const def = entry.collection === 'section' ? schemaCache.sections.find((s) => s.key === entry.key) : null;
    const fields = def ? def.fields : schemaCache.collections[entry.collection];
    const canEdit = ctx.can('cms.edit') && entry.status !== 'archived';
    const form = buildForm(fields, structuredClone(entry.draft ?? {}), { disabled: !canEdit, onChange: () => markDirty(true) });
    let dirty = false;
    const saveBtn = h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: true }, 'Save draft');
    const dirtyNote = h('span', { class: 'adm-kpi__hint' });
    const markDirty = (v) => { dirty = v; saveBtn.disabled = !v || !canEdit; dirtyNote.textContent = v ? 'Unsaved changes' : ''; };
    const alertHost = h('div', { 'aria-live': 'polite' });

    const publicPath = entry.collection === 'news' ? `/news/${entry.key}` : entry.collection === 'job' ? `/careers/${entry.key}` : '/';
    const reload = async () => { await renderEditor(main, ctx, id, refreshList); await refreshList(); };

    const act = async (action, body, success) => {
        clear(alertHost);
        try {
            const res = await api(`/api/cms/entries/${id}/${action}`, { method: 'POST', body: body ?? {} });
            toast(success, 'ok');
            if (res.rebuild) toast(res.rebuild.message, res.rebuild.triggered ? 'ok' : 'info', 8000);
            await reload();
        } catch (e) { alertHost.append(banner('error', e.message)); }
    };

    saveBtn.addEventListener('click', async () => {
        clear(alertHost);
        saveBtn.disabled = true;
        try {
            await api(`/api/cms/entries/${id}`, { method: 'PUT', body: { data: form.value(), version: entry.version } });
            markDirty(false);
            toast('Draft saved. Submit it for review when it is ready.', 'ok');
            await reload();
        } catch (e) {
            saveBtn.disabled = false;
            alertHost.append(banner('error', e.message));
            form.markError(e.details?.field);
            if (e instanceof ApiError && e.status === 409) alertHost.append(h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: reload }, 'Reload latest version'));
        }
    });

    const s = entry.status;
    const canSelfPublish = ctx.can('cms.review') && ctx.can('cms.publish');
    const hasUnpublished = entry.published === null || JSON.stringify(entry.draft) !== JSON.stringify(entry.published);
    const buttons = [];
    const btn = (text, onClick, kind = 'ghost', title) => h('button', { class: `btn btn--${kind} btn--sm`, type: 'button', title, onclick: async (e) => { if (dirty && !(await confirmAction({ title: 'Unsaved changes', message: 'Save your draft first, or continue without your unsaved edits?', confirmLabel: 'Continue without saving' }))) return; e.target.disabled = true; await onClick(); } }, text);
    if (s === 'draft' && ctx.can('cms.edit') && hasUnpublished) buttons.push(btn('Submit for review', () => act('submit', {}, 'Submitted for review.')));
    if (s === 'pending_review' && ctx.can('cms.review')) {
        buttons.push(btn('Approve', () => act('approve', {}, 'Approved.'), 'dark'));
        buttons.push(btn('Request changes', async () => { const note = await askNote('Request changes', 'Tell the author what to change (optional).'); if (note !== null) await act('reject', { note }, 'Sent back to draft.'); }));
    }
    // Mirrors the server rule: approved content, or content published in one step by someone who may both review and publish.
    const publishable = s !== 'archived' && hasUnpublished && (s === 'approved' || canSelfPublish);
    if (ctx.can('cms.publish') && publishable) {
        buttons.push(btn(s === 'approved' ? 'Publish now' : 'Approve & publish', async () => {
            if (await confirmAction({ title: 'Publish to the live website?', message: `“${entry.title}” will be visible to everyone at ${publicPath}.`, confirmLabel: 'Publish' })) await act('publish', {}, 'Published.');
        }, 'dark', s !== 'approved' ? 'You have review and publish rights, so you can approve and publish in one step.' : undefined));
        if (!entry.publish_at) buttons.push(btn('Schedule…', () => scheduleDialog((publishAt) => act('schedule', { publishAt }, 'Scheduled.'))));
    }
    if (entry.publish_at && ctx.can('cms.publish')) buttons.push(btn('Cancel schedule', () => act('unschedule', {}, 'Schedule cancelled.')));
    if (entry.collection !== 'section' && entry.published && ctx.can('cms.publish') && s !== 'archived') {
        buttons.push(btn('Unpublish', async () => { if (await confirmAction({ title: 'Unpublish?', message: `${publicPath} will stop being available.`, confirmLabel: 'Unpublish', danger: true })) await act('unpublish', {}, 'Unpublished.'); }));
    }
    if (entry.collection !== 'section' && ctx.can('cms.delete')) {
        if (s !== 'archived') buttons.push(btn('Archive', async () => { if (await confirmAction({ title: 'Archive this entry?', message: 'Archived entries are removed from the website but kept with their history.', confirmLabel: 'Archive', danger: true })) await act('archive', {}, 'Archived.'); }));
        else {
            buttons.push(btn('Restore', () => act('restore', {}, 'Restored as a draft.')));
            buttons.push(btn('Delete permanently…', async () => {
                if (!(await confirmAction({ title: 'Delete permanently?', message: 'This removes the entry and its revision history. This cannot be undone.', confirmLabel: 'Delete', danger: true, requireText: entry.key }))) return;
                try { await api(`/api/cms/entries/${id}`, { method: 'DELETE' }); toast('Deleted.', 'ok'); ctx.setQuery({ entry: null }); } catch (e) { alertHost.append(banner('error', e.message)); }
            }, 'danger'));
        }
    }
    if (entry.collection === 'section' && ctx.can('cms.edit')) {
        buttons.push(btn('Reset to original…', async () => {
            if (await confirmAction({ title: 'Reset this section?', message: 'The draft is replaced with the website’s original content for this section. The live site does not change until you publish.', confirmLabel: 'Reset draft' })) await act('reset', {}, 'Draft reset to the original content.');
        }));
    }

    const workflow = h('div', { class: 'adm-workflow', 'aria-label': 'Workflow status' },
        s === 'archived' ? h('span', { class: 'adm-step is-current' }, 'Archived')
            : STEPS.map(([k, t], i) => [i ? h('span', { 'aria-hidden': 'true' }, '→') : null, h('span', { class: `adm-step${k === s ? ' is-current' : ''}`, 'aria-current': k === s ? 'step' : null }, t)]));

    append(clear(main), [
        h('div', { class: 'adm-card__head' },
            h('div', {}, h('h2', {}, entry.title), h('p', {}, def ? def.description : `${publicPath}`)),
            h('div', { class: 'adm-actions' },
                h('a', { class: 'btn btn--ghost btn--sm', href: `/api/cms/preview/${id}`, target: '_blank', rel: 'noopener', title: 'Preview the saved draft' }, icon('eye', 'icon icon--sm'), 'Preview draft'),
                entry.published ? h('a', { class: 'btn btn--ghost btn--sm', href: publicPath, target: '_blank', rel: 'noopener' }, icon('external', 'icon icon--sm'), 'Live page') : null)),
        workflow,
        h('div', { class: 'adm-kpi__hint', style: { margin: '8px 0 14px' } },
            `Version ${entry.version} · Last saved ${dateTime(entry.updated_at)}`,
            entry.published_at ? ` · Published ${dateTime(entry.published_at)}` : ' · Never published',
            entry.publish_at ? h('strong', {}, ` · Scheduled for ${dateTime(entry.publish_at)}`) : null),
        entry.published && hasUnpublished ? banner('info', 'The live site shows the last published version. This draft has changes that are not public yet.') : null,
        !canEdit && entry.status === 'archived' ? banner('warn', 'This entry is archived. Restore it to edit or publish it again.') : null,
        !ctx.can('cms.edit') ? banner('info', 'You can view this content but not edit it.') : null,
        alertHost,
        h('div', { class: 'adm-actions', style: { marginBottom: '16px' } }, buttons),
        form.el,
        h('div', { class: 'adm-actions', style: { position: 'sticky', bottom: 0, background: '#fff', padding: '12px 0', marginTop: '12px', borderTop: '1px solid var(--line)' } }, saveBtn, dirtyNote),
        revisionList(revisions, entry, ctx, () => reload())]);
}

function askNote(title, message) {
    return new Promise((resolve) => {
        const ta = h('textarea', { class: 'adm-textarea', maxlength: 300 });
        let done = false;
        modal({ title, body: h('div', { class: 'adm-form' }, h('p', {}, message), field('Note', ta)),
            actions: [{ label: 'Cancel', onClick: () => { done = true; resolve(null); } }, { label: 'Send', kind: 'primary', onClick: () => { done = true; resolve(ta.value.trim()); } }],
            onClose: () => { if (!done) resolve(null); } });
    });
}

function scheduleDialog(onPick) {
    const min = new Date(Date.now() + 5 * 60_000);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const input = h('input', { type: 'datetime-local', class: 'adm-input', min: local(min), value: local(new Date(Date.now() + 3600_000)) });
    modal({ title: 'Schedule publication', body: h('div', { class: 'adm-form' }, field('Publish at (your local time)', input, { help: 'Scheduled content is published by the background job, which runs at least daily (more often if configured). It goes live on the first run after this time.' })),
        actions: [{ label: 'Cancel' }, { label: 'Schedule', kind: 'primary', onClick: async () => { const d = new Date(input.value); if (Number.isNaN(d.getTime())) { toast('Choose a date and time.', 'error'); return false; } await onPick(d.toISOString()); } }] });
}

function revisionList(revisions, entry, ctx, reload) {
    return h('details', { class: 'adm-section-gap' }, h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, `Revision history (${revisions.length})`),
        h('ul', { class: 'adm-revisions', style: { marginTop: '10px' } }, revisions.map((r) => h('li', {},
            h('div', {}, h('strong', {}, `v${r.version} · ${r.note || r.status}`), h('div', { class: 'adm-kpi__hint', style: { marginTop: 0 } }, `${dateTime(r.created_at)} · ${r.author_name ?? 'System'}`)),
            h('div', { class: 'adm-actions' }, pill(r.status),
                ctx.can('cms.edit') && entry.status !== 'archived' && r.version !== entry.version ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => {
                    if (!(await confirmAction({ title: `Restore version ${r.version}?`, message: 'Its content becomes a new draft. Nothing changes on the live site until it is published.', confirmLabel: 'Restore as draft' }))) return;
                    try { await api(`/api/cms/entries/${entry.id}/restore-revision`, { method: 'POST', body: { revisionId: r.id } }); toast(`Version ${r.version} restored as a draft.`, 'ok'); reload(); } catch (e) { toast(e.message, 'error'); }
                } }, 'Restore') : null)))));
}

// ─── Schema-driven form builder ───
export function buildForm(fields, values, { disabled = false, onChange = () => {} } = {}) {
    const el = h('div', { class: 'adm-form' });
    const getters = {};
    const wrappers = {};
    for (const f of fields) {
        const { node, get, wrap } = control(f, values[f.key], disabled, (v) => onChange(f.key, v));
        getters[f.key] = get;
        wrappers[f.key] = wrap;
        el.append(node);
    }
    return {
        el,
        value: () => Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()])),
        markError: (path) => {
            el.querySelectorAll('.adm-field--invalid').forEach((x) => x.classList.remove('adm-field--invalid'));
            const top = String(path ?? '').split(/[.[]/)[0];
            const w = wrappers[top];
            if (w) { w.classList.add('adm-field--invalid'); w.scrollIntoView({ block: 'center', behavior: 'smooth' }); w.querySelector('input, textarea, [contenteditable]')?.focus(); }
        },
    };
}

function counter(input, max) {
    if (!max) return null;
    const c = h('small', { style: { justifySelf: 'end' } });
    const upd = () => { c.textContent = `${input.value.length} / ${max}`; c.style.color = input.value.length > max ? '#B42318' : ''; };
    input.addEventListener('input', upd);
    upd();
    return c;
}

function control(f, value, disabled, changed) {
    const help = f.help;
    switch (f.type) {
        case 'text': case 'url': case 'link': case 'email': case 'date': {
            const input = h('input', { class: 'adm-input', type: f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text', value: value ?? '', maxlength: f.max ? f.max + 50 : null, disabled, required: f.required });
            input.addEventListener('input', () => changed(input.value));
            const wrap = field(f.label, input, { help: help ?? (f.type === 'url' ? 'Full https:// address. Leave empty to hide.' : f.type === 'link' ? 'A section link like #contact, a site path like /careers, or a full https:// address.' : null) });
            const c = f.type === 'text' ? counter(input, f.max) : null;
            if (c) wrap.append(c);
            return { node: wrap, wrap, get: () => input.value };
        }
        case 'textarea': {
            const ta = h('textarea', { class: 'adm-textarea', disabled, required: f.required });
            ta.value = value ?? '';
            ta.addEventListener('input', () => changed(ta.value));
            const wrap = field(f.label, ta, { help });
            const c = counter(ta, f.max);
            if (c) wrap.append(c);
            return { node: wrap, wrap, get: () => ta.value };
        }
        case 'inline': {
            const ta = h('textarea', { class: 'adm-textarea', style: { minHeight: '72px' }, disabled });
            ta.value = value ?? '';
            ta.addEventListener('input', () => changed(ta.value));
            const wrap = field(f.label, ta, { help: help ?? 'Plain text. You may use <strong>bold</strong>, <em>italic</em> and <a href="https://…">links</a>; anything else is removed.' });
            return { node: wrap, wrap, get: () => ta.value };
        }
        case 'richtext': return richText(f, value, disabled, changed);
        case 'boolean': {
            const cb = h('input', { type: 'checkbox', disabled, checked: !!value });
            cb.addEventListener('change', () => changed(cb.checked));
            const wrap = h('div', { class: 'adm-field' }, h('label', { class: 'adm-check' }, cb, f.label), help ? h('small', {}, help) : null);
            return { node: wrap, wrap, get: () => cb.checked };
        }
        case 'image': return imageControl(f, value, disabled, changed);
        case 'list': return listControl(f, value, disabled, changed);
        default: {
            const input = h('input', { class: 'adm-input', value: value ?? '', disabled });
            return { node: field(f.label, input), wrap: input, get: () => input.value };
        }
    }
}

function imageControl(f, value, disabled, changed) {
    let current = value && value.url ? { ...value } : null;
    const preview = h('div', { class: 'adm-img-field' });
    const alt = h('input', { class: 'adm-input', placeholder: 'Describe the image for screen readers', value: current?.alt ?? '', disabled, maxlength: 300 });
    alt.addEventListener('input', () => { if (current) current.alt = alt.value; changed(current); });
    const draw = () => {
        clear(preview);
        preview.append(current ? h('img', { src: current.url, alt: '' }) : h('span', { class: 'adm-kpi__hint' }, 'No image'),
            h('div', { class: 'adm-actions' },
                h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled, onclick: async () => {
                    const asset = await pickImage();
                    if (!asset) return;
                    current = { url: asset.url, alt: alt.value || asset.alt || '', assetId: asset.id, width: asset.width, height: asset.height };
                    alt.value = current.alt;
                    draw(); changed(current);
                } }, current ? 'Replace' : 'Choose image'),
                current && !f.required ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled, onclick: () => { current = null; draw(); changed(null); } }, 'Remove') : null));
    };
    draw();
    const wrap = h('div', { class: 'adm-field' }, h('span', { class: 'adm-field__label' }, f.label), preview, h('label', { class: 'adm-kpi__hint' }, 'Alternative text'), alt, f.help ? h('small', {}, f.help) : null);
    return { node: wrap, wrap, get: () => (current ? { ...current, alt: alt.value } : null) };
}

function listControl(f, value, disabled, changed) {
    const items = Array.isArray(value) ? value.map((x) => ({ ...x })) : [];
    const host = h('div', { class: 'adm-list-editor' });
    const rows = [];
    const wrap = h('div', { class: 'adm-field' }, h('span', { class: 'adm-field__label' }, f.label), host);
    const addBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled, onclick: () => { items.push(Object.fromEntries(f.item.map((x) => [x.key, x.type === 'boolean' ? false : x.type === 'image' ? null : '']))); draw(); changed(); } }, icon('plus', 'icon icon--sm'), 'Add item');
    wrap.append(addBtn);
    const sync = () => rows.forEach((r, i) => { items[i] = r.value(); });
    const draw = () => {
        clear(host);
        rows.length = 0;
        items.forEach((it, i) => {
            const sub = buildForm(f.item, it, { disabled, onChange: () => changed() });
            rows.push(sub);
            const move = (d) => { sync(); const [x] = items.splice(i, 1); items.splice(i + d, 0, x); draw(); changed(); };
            host.append(h('div', { class: 'adm-list-item' },
                h('div', { class: 'adm-list-item__bar' }, h('span', {}, `Item ${i + 1}`), h('div', { class: 'adm-actions' },
                    h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: disabled || i === 0, 'aria-label': `Move item ${i + 1} up`, onclick: () => move(-1) }, '↑'),
                    h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: disabled || i === items.length - 1, 'aria-label': `Move item ${i + 1} down`, onclick: () => move(1) }, '↓'),
                    h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled, 'aria-label': `Remove item ${i + 1}`, onclick: () => { sync(); items.splice(i, 1); draw(); changed(); } }, icon('trash', 'icon icon--sm')))),
                sub.el));
        });
        addBtn.disabled = disabled || (f.maxItems && items.length >= f.maxItems);
    };
    draw();
    return { node: wrap, wrap, get: () => { sync(); return items.map((x) => ({ ...x })); } };
}

function richText(f, value, disabled, changed) {
    const editor = h('div', { class: 'adm-textarea adm-richedit', contenteditable: disabled ? 'false' : 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': f.label });
    editor.innerHTML = sanitizeForEditor(value ?? '');
    const source = h('textarea', { class: 'adm-textarea adm-rich', hidden: true, 'aria-label': `${f.label} (HTML)` });
    let mode = 'visual';
    const exec = (cmd, arg) => { editor.focus(); document.execCommand(cmd, false, arg); changed(); };
    const tool = (text, title, fn) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title, 'aria-label': title, disabled, onmousedown: (e) => e.preventDefault(), onclick: fn }, text);
    const toolbar = h('div', { class: 'adm-actions', role: 'toolbar', 'aria-label': 'Formatting' },
        tool('B', 'Bold', () => exec('bold')), tool('I', 'Italic', () => exec('italic')),
        tool('H2', 'Heading', () => exec('formatBlock', 'h2')), tool('H3', 'Subheading', () => exec('formatBlock', 'h3')), tool('¶', 'Paragraph', () => exec('formatBlock', 'p')),
        tool('• List', 'Bulleted list', () => exec('insertUnorderedList')), tool('1. List', 'Numbered list', () => exec('insertOrderedList')),
        tool('“ ”', 'Quote', () => exec('formatBlock', 'blockquote')),
        tool('Link', 'Insert link', () => { const url = prompt('Link address (https://… or /path)'); if (url && /^(https:\/\/|\/|mailto:)/.test(url)) exec('createLink', url); }),
        tool('Image', 'Insert image', async () => { const a = await pickImage(); if (a) exec('insertHTML', `<img src="${encodeURI(a.url)}" alt="${(a.alt || '').replace(/"/g, '&quot;')}">`); }),
        tool('Clear', 'Remove formatting', () => exec('removeFormat')),
        tool('HTML', 'Edit HTML source', () => {
            if (mode === 'visual') { source.value = editor.innerHTML; editor.hidden = true; source.hidden = false; mode = 'html'; }
            else { editor.innerHTML = sanitizeForEditor(source.value); source.hidden = true; editor.hidden = false; mode = 'visual'; changed(); }
        }));
    editor.addEventListener('input', () => changed());
    source.addEventListener('input', () => changed());
    editor.addEventListener('paste', (e) => {
        // Paste as plain text so foreign styling never reaches the page; the server sanitises again regardless.
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    const wrap = h('div', { class: 'adm-field' }, h('span', { class: 'adm-field__label' }, f.label), toolbar, editor, source,
        h('small', {}, 'Headings, lists, links, quotes, images and tables are kept. Scripts, styles and other markup are removed when saved.'));
    return { node: wrap, wrap, get: () => (mode === 'html' ? source.value : editor.innerHTML) };
}

/** Editor-only safety net: parse into an inert document and drop executable markup before showing it. */
function sanitizeForEditor(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((n) => {
        for (const a of [...n.attributes]) {
            if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
        }
    });
    return doc.body.innerHTML;
}
