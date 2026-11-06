/** Contact inquiries submitted through the website's contact form. */
import { api, banner, clear, dateTime, empty, errorState, field, h, label, modal, pager, pill, skeleton, table, toast } from '../lib.js';
import { pageHead } from './common.js';

const STATUSES = ['new', 'in_progress', 'resolved', 'spam'];

export async function render(root, ctx) {
    root.append(pageHead('Contact Inquiries', 'Messages sent through the website contact form.'));
    const body = h('div', {}, skeleton('adm-skel--row', 8));
    root.append(body);
    await load(body, ctx);
}

async function load(body, ctx) {
    const q = ctx.query();
    const status = STATUSES.includes(q.get('status')) ? q.get('status') : '';
    const page = Math.max(1, Number(q.get('page')) || 1);
    let data;
    try { data = await api(`/api/inquiries?page=${page}${status ? `&status=${status}` : ''}`); } catch (e) { clear(body).append(errorState(e, () => load(body, ctx))); return; }
    if (!ctx.isCurrent()) return;
    clear(body);
    const counts = Object.fromEntries(data.counts.map((c) => [c.status, c.n]));
    body.append(h('div', { class: 'adm-tabs', role: 'tablist' },
        [['', 'All'], ...STATUSES.map((s) => [s, label(s)])].map(([s, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(s === status),
            onclick: () => ctx.setQuery({ status: s || null, page: null }) }, t, s && counts[s] ? ` (${counts[s]})` : ''))));
    body.append(table([
        { label: 'Received', render: (r) => dateTime(r.created_at) },
        { label: 'Name', key: 'name' },
        { label: 'Email', key: 'email', muted: true },
        { label: 'Topic', render: (r) => label(r.topic) },
        { label: 'Message', render: (r) => (r.message.length > 90 ? `${r.message.slice(0, 90)}…` : r.message) },
        { label: 'Status', render: (r) => pill(r.status) },
        { label: 'Assigned', render: (r) => r.assigned_name ?? '—', muted: true },
    ], data.items, { onRowClick: (r) => open(r, ctx, () => load(body, ctx)), emptyState: empty('No inquiries', status ? 'Nothing with this status.' : 'Messages from the website contact form will appear here.', 'inquiries') }));
    if (data.total > data.pageSize) body.append(pager({ page, pageSize: data.pageSize, total: data.total, onPage: (p) => ctx.setQuery({ page: p }) }));
    const focus = q.get('id') && data.items.find((x) => x.id === q.get('id'));
    if (focus) open(focus, ctx, () => load(body, ctx));
}

function open(r, ctx, refresh) {
    const manage = ctx.can('inquiries.manage');
    const status = h('select', { class: 'adm-select', disabled: !manage }, STATUSES.map((s) => h('option', { value: s, selected: s === r.status }, label(s))));
    const notes = h('textarea', { class: 'adm-textarea', disabled: !manage, maxlength: 4000, placeholder: 'Internal notes (not sent to the customer)' });
    notes.value = r.notes ?? '';
    const assign = h('input', { type: 'checkbox', checked: !!r.assigned_to, disabled: !manage });
    modal({
        title: `Inquiry from ${r.name}`, wide: true,
        body: h('div', { class: 'adm-form' },
            h('dl', { class: 'adm-kv' },
                h('dt', {}, 'Received'), h('dd', {}, dateTime(r.created_at)),
                h('dt', {}, 'Email'), h('dd', {}, h('a', { href: `mailto:${r.email}` }, r.email)),
                h('dt', {}, 'Phone'), h('dd', {}, r.phone || '—'),
                h('dt', {}, 'Topic'), h('dd', {}, label(r.topic)),
                h('dt', {}, 'Assigned to'), h('dd', {}, r.assigned_name ?? 'Nobody')),
            h('div', { class: 'adm-code', style: { whiteSpace: 'pre-wrap', wordBreak: 'normal' } }, r.message),
            !manage ? banner('info', 'You can read inquiries but not change them.') : null,
            field('Status', status), field('Notes', notes),
            h('label', { class: 'adm-check' }, assign, 'Assigned to me')),
        actions: manage ? [
            { label: 'Close' },
            { label: 'Reply by email', onClick: () => { location.href = `mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent('Re: your message to SUSKII')}`; return false; } },
            { label: 'Save', kind: 'primary', onClick: async () => {
                try {
                    await api(`/api/inquiries/${r.id}`, { method: 'PATCH', body: { status: status.value, notes: notes.value, assignToMe: assign.checked } });
                    toast('Inquiry updated.', 'ok');
                    refresh();
                } catch (e) { toast(e.message, 'error'); return false; }
            } },
        ] : [{ label: 'Close' }],
    });
}
