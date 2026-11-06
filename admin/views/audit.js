/** Append-only audit log of sign-ins and every sensitive change. */
import { api, clear, dateTime, downloadCsv, errorState, h, icon, label, modal, pager, pill, skeleton, table } from '../lib.js';
import { pageHead } from './common.js';

export async function render(root, ctx) {
    root.append(pageHead('Audit Logs', 'Who did what, and when. Entries cannot be edited or deleted from the admin.'));
    const body = h('div', {}, skeleton('adm-skel--row', 10));
    root.append(body);
    const q = ctx.query();
    const page = Math.max(1, Number(q.get('page')) || 1);
    const params = new URLSearchParams({ page: String(page) });
    for (const k of ['action', 'actor', 'outcome']) if (q.get(k)) params.set(k, q.get(k));
    let data;
    try { data = await api(`/api/admin/audit-logs?${params}`); } catch (e) { clear(body).append(errorState(e)); return; }
    if (!ctx.isCurrent()) return;
    clear(body);
    const action = h('input', { class: 'adm-input', placeholder: 'Action starts with… (e.g. cms., auth.login)', value: q.get('action') || '', 'aria-label': 'Action' });
    const actor = h('input', { class: 'adm-input', placeholder: 'Administrator email', value: q.get('actor') || '', 'aria-label': 'Administrator email' });
    const outcome = h('select', { class: 'adm-select', 'aria-label': 'Outcome' }, [['', 'Any outcome'], ['success', 'Success'], ['failure', 'Failure']].map(([v, t]) => h('option', { value: v, selected: q.get('outcome') === v }, t)));
    const apply = () => ctx.setQuery({ action: action.value.trim() || null, actor: actor.value.trim() || null, outcome: outcome.value || null, page: null });
    [action, actor].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); }));
    outcome.addEventListener('change', apply);
    const cols = [
        { label: 'Time', render: (r) => dateTime(r.at), csv: (r) => r.at },
        { label: 'Administrator', render: (r) => r.actor_email ?? 'System', csv: (r) => r.actor_email },
        { label: 'Action', key: 'action', mono: true },
        { label: 'Outcome', render: (r) => pill(r.outcome), csv: (r) => r.outcome },
        { label: 'Target', render: (r) => (r.target_type ? `${label(r.target_type)} ${r.target_id ?? ''}` : '—'), csv: (r) => `${r.target_type ?? ''} ${r.target_id ?? ''}`, muted: true },
        { label: 'IP', key: 'ip', mono: true, muted: true },
    ];
    body.append(h('div', { class: 'adm-filters' }, action, actor, outcome, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: apply }, 'Filter'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => downloadCsv(`suskii-audit-page${page}.csv`, [...cols, { label: 'Details', csv: (r) => JSON.stringify(r.metadata ?? {}) }], data.items) }, icon('download', 'icon icon--sm'), 'Export page')));
    body.append(table(cols, data.items, {
        onRowClick: (r) => modal({ title: r.action, body: h('div', {}, h('dl', { class: 'adm-kv' }, h('dt', {}, 'Time'), h('dd', {}, dateTime(r.at)), h('dt', {}, 'Administrator'), h('dd', {}, r.actor_email ?? 'System'),
            h('dt', {}, 'Outcome'), h('dd', {}, r.outcome), h('dt', {}, 'Target'), h('dd', {}, `${r.target_type ?? '—'} ${r.target_id ?? ''}`), h('dt', {}, 'IP address'), h('dd', {}, r.ip ?? '—')),
        h('pre', { class: 'adm-code adm-section-gap' }, JSON.stringify(r.metadata ?? {}, null, 2))) }),
    }));
    if (data.total > data.pageSize) body.append(pager({ page, pageSize: data.pageSize, total: data.total, onPage: (p) => ctx.setQuery({ page: p }) }));
}
