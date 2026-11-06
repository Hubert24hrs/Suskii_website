/** Job applications received through the careers pages. Job openings themselves are edited in the CMS. */
import { api, clear, dateTime, empty, errorState, field, h, icon, label, modal, pager, pill, skeleton, table, toast, banner } from '../lib.js';
import { pageHead } from './common.js';

const STATUSES = ['new', 'reviewing', 'shortlisted', 'rejected', 'hired'];

export async function render(root, ctx) {
    root.append(pageHead('Careers & Applications', 'Applications submitted for job openings published on the website.',
        ctx.can('cms.read') ? h('a', { class: 'btn btn--ghost btn--sm', href: '/admin/cms?collection=job' }, 'Manage job openings') : null));
    const body = h('div', {}, skeleton('adm-skel--row', 8));
    root.append(body);
    await load(body, ctx);
}

async function load(body, ctx) {
    const q = ctx.query();
    const status = STATUSES.includes(q.get('status')) ? q.get('status') : '';
    const page = Math.max(1, Number(q.get('page')) || 1);
    let data;
    try { data = await api(`/api/applications?page=${page}${status ? `&status=${status}` : ''}`); } catch (e) { clear(body).append(errorState(e, () => load(body, ctx))); return; }
    if (!ctx.isCurrent()) return;
    clear(body);
    body.append(h('div', { class: 'adm-tabs', role: 'tablist' }, [['', 'All'], ...STATUSES.map((s) => [s, label(s)])].map(([s, t]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(s === status), onclick: () => ctx.setQuery({ status: s || null, page: null }) }, t))));
    body.append(banner('info', 'Applications contain personal data. Download CVs only when needed; every download is recorded in the audit log.'));
    body.append(table([
        { label: 'Received', render: (r) => dateTime(r.created_at) },
        { label: 'Applicant', key: 'name' },
        { label: 'Email', key: 'email', muted: true },
        { label: 'Position', render: (r) => r.job_title ?? r.job_slug },
        { label: 'CV', render: (r) => (r.has_resume ? 'Attached' : '—') },
        { label: 'Status', render: (r) => pill(r.status) },
    ], data.items, { onRowClick: (r) => open(r, ctx, () => load(body, ctx)), emptyState: empty('No applications', 'Applications appear here when a published job opening accepts applications.', 'careers') }));
    if (data.total > data.pageSize) body.append(pager({ page, pageSize: data.pageSize, total: data.total, onPage: (p) => ctx.setQuery({ page: p }) }));
    const focus = q.get('id') && data.items.find((x) => x.id === q.get('id'));
    if (focus) open(focus, ctx, () => load(body, ctx));
}

function open(r, ctx, refresh) {
    const manage = ctx.can('careers.manage');
    const status = h('select', { class: 'adm-select', disabled: !manage }, STATUSES.map((s) => h('option', { value: s, selected: s === r.status }, label(s))));
    const notes = h('textarea', { class: 'adm-textarea', disabled: !manage, maxlength: 4000, placeholder: 'Internal notes' });
    notes.value = r.notes ?? '';
    const safeProfile = r.profile_url && /^https:\/\//i.test(r.profile_url) ? r.profile_url : null;
    modal({
        title: `${r.name} — ${r.job_title ?? r.job_slug}`, wide: true,
        body: h('div', { class: 'adm-form' },
            h('dl', { class: 'adm-kv' },
                h('dt', {}, 'Received'), h('dd', {}, dateTime(r.created_at)),
                h('dt', {}, 'Email'), h('dd', {}, h('a', { href: `mailto:${r.email}` }, r.email)),
                h('dt', {}, 'Phone'), h('dd', {}, r.phone || '—'),
                h('dt', {}, 'Profile'), h('dd', {}, safeProfile ? h('a', { href: safeProfile, target: '_blank', rel: 'noopener noreferrer' }, safeProfile) : '—'),
                h('dt', {}, 'CV'), h('dd', {}, r.has_resume ? h('a', { class: 'btn btn--ghost btn--sm', href: `/api/applications/${r.id}/resume` }, icon('download', 'icon icon--sm'), 'Download PDF') : 'Not provided')),
            r.cover_letter ? h('div', {}, h('div', { class: 'adm-kpi__label', style: { marginBottom: '6px' } }, 'Cover letter'), h('div', { class: 'adm-code', style: { whiteSpace: 'pre-wrap', wordBreak: 'normal' } }, r.cover_letter)) : null,
            field('Status', status), field('Notes', notes)),
        actions: manage ? [{ label: 'Close' }, { label: 'Save', kind: 'primary', onClick: async () => {
            try { await api(`/api/applications/${r.id}`, { method: 'PATCH', body: { status: status.value, notes: notes.value } }); toast('Application updated.', 'ok'); refresh(); } catch (e) { toast(e.message, 'error'); return false; }
        } }] : [{ label: 'Close' }],
    });
}
