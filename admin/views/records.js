/**
 * Read-only record tables mirrored from the platforms (transactions, orders, errands, bookings, people, disputes).
 * Management actions stay disabled until the owning platform exposes an API for them; the central admin never
 * changes platform records (or marks payments successful) on its own.
 */
import { api, clear, dateOnly, dateTime, downloadCsv, errorState, h, icon, label, modal, money, pager, pill, platformChip, PLATFORM_LABEL, skeleton, table, empty, banner } from '../lib.js';
import { CURRENCY_NOTE, demoChip, filterBar, filterQs, pageHead, scopeBanners } from './common.js';

const amount = (r) => (r.amountMinor === null || r.amountMinor === undefined ? '—' : money(r.amountMinor, r.currency));
const id = (r) => h('span', { title: r.sourceId }, r.sourceId);
const plat = (r) => platformChip(r.platform);

const COLS = {
    transactions: [
        { label: 'Reference', render: id, mono: true }, { label: 'Platform', render: plat }, { label: 'Type', render: (r) => label(r.type) },
        { label: 'Status', render: (r) => pill(r.status) }, { label: 'Amount', render: amount, num: true, csv: (r) => r.amountMinor },
        { label: 'Platform fee', render: (r) => money(r.feeMinor, r.currency), num: true, csv: (r) => r.feeMinor }, { label: 'Currency', key: 'currency' },
        { label: 'Method', key: 'method', muted: true }, { label: 'Related', render: (r) => (r.relatedId ? `${label(r.relatedType)} ${r.relatedId}` : '—'), muted: true },
        { label: 'Date', render: (r) => dateTime(r.occurredAt), csv: (r) => r.occurredAt },
    ],
    orders: [
        { label: 'Order', render: id, mono: true }, { label: 'Platform', render: plat }, { label: 'Title', key: 'title' }, { label: 'Status', render: (r) => pill(r.status) },
        { label: 'Amount', render: amount, num: true, csv: (r) => r.amountMinor }, { label: 'Currency', key: 'currency' }, { label: 'Customer', key: 'customerId', mono: true, muted: true },
        { label: 'Seller', key: 'providerId', mono: true, muted: true }, { label: 'Created', render: (r) => dateTime(r.createdAt), csv: (r) => r.createdAt },
    ],
    bookings: [
        { label: 'Booking', render: id, mono: true }, { label: 'Package', key: 'title' }, { label: 'Status', render: (r) => pill(r.status) },
        { label: 'Amount', render: amount, num: true, csv: (r) => r.amountMinor }, { label: 'Currency', key: 'currency' }, { label: 'Travel date', render: (r) => dateOnly(r.travelDate), csv: (r) => r.travelDate },
        { label: 'Customer', key: 'customerId', mono: true, muted: true }, { label: 'Booked', render: (r) => dateTime(r.createdAt), csv: (r) => r.createdAt },
    ],
    users: [
        { label: 'ID', render: id, mono: true }, { label: 'Platform', render: plat }, { label: 'Name', key: 'displayName' }, { label: 'Email', key: 'emailMasked', muted: true },
        { label: 'Country', key: 'country' }, { label: 'Status', render: (r) => (r.status ? pill(r.status) : '—'), csv: (r) => r.status }, { label: 'Verification', render: (r) => (r.verification ? pill(r.verification) : '—'), csv: (r) => r.verification },
        { label: 'Registered', render: (r) => dateOnly(r.registeredAt), csv: (r) => r.registeredAt },
    ],
    disputes: [
        { label: 'Dispute', render: id, mono: true }, { label: 'Platform', render: plat }, { label: 'Status', render: (r) => pill(r.status) }, { label: 'Reason', key: 'reason' },
        { label: 'Amount', render: amount, num: true, csv: (r) => r.amountMinor }, { label: 'Currency', key: 'currency' },
        { label: 'Related', render: (r) => (r.relatedId ? `${label(r.relatedType)} ${r.relatedId}` : '—'), muted: true }, { label: 'Opened', render: (r) => dateTime(r.openedAt), csv: (r) => r.openedAt },
        { label: 'Resolved', render: (r) => dateTime(r.resolvedAt), csv: (r) => r.resolvedAt },
    ],
};
COLS.payments = COLS.transactions.filter((c) => c.label !== 'Type');
COLS.commissions = COLS.payments;
COLS.refunds = COLS.payments.filter((c) => c.label !== 'Platform fee');
COLS.requests = COLS.orders.map((c) => (c.label === 'Order' ? { ...c, label: 'Request' } : c.label === 'Seller' ? { ...c, label: 'Provider' } : c));
COLS.providers = [...COLS.users.slice(0, 2), { label: 'Type', render: (r) => label(r.kind) }, ...COLS.users.slice(2)];

const STATUSES = {
    transactions: ['completed', 'pending', 'failed', 'refunded', 'reversed', 'cancelled'],
    orders: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'],
    requests: ['open', 'accepted', 'in_progress', 'completed', 'cancelled'],
    bookings: ['pending', 'confirmed', 'completed', 'cancelled'],
    users: ['active', 'suspended', 'inactive'],
    disputes: ['open', 'under_review', 'resolved', 'rejected'],
};
STATUSES.payments = STATUSES.transactions; STATUSES.commissions = STATUSES.transactions; STATUSES.refunds = STATUSES.transactions; STATUSES.providers = STATUSES.users;

/** Operations the brief lists but no platform API currently provides; shown disabled, never simulated. */
const UNSUPPORTED_ACTIONS = {
    transactions: ['Issue refund', 'Reverse transaction'], payments: ['Issue refund', 'Retry payment'], refunds: ['Approve refund', 'Reject refund'],
    commissions: ['Adjust commission'], orders: ['Cancel order', 'Update status'], requests: ['Reassign provider', 'Cancel request'],
    bookings: ['Cancel booking', 'Change travel date'], users: ['Suspend account', 'Verify account'], providers: ['Suspend', 'Approve verification'],
    disputes: ['Resolve dispute', 'Escalate'],
};

const TITLES = {
    transactions: ['Transactions', 'Every payment, refund and commission mirrored from the platforms.'],
    orders: ['Orders', 'Marketplace orders.'],
    requests: ['Errands', 'Errand requests from the Errands platform.'],
    bookings: ['Travel & Bookings', 'Bookings from the Travel & Tour platform.'],
    users: ['Customers', 'Customers registered on each platform. Personal data stays on the platforms; emails are masked.'],
    providers: ['Sellers & Providers', 'Marketplace sellers and Errands service providers.'],
    payments: ['Payments', 'Payment status exactly as reported by each platform.'],
    commissions: ['Commissions', 'Platform commissions earned.'],
};

export async function render(root, ctx) {
    const resource = ctx.item.resource;
    const [title, subtitle] = TITLES[resource] ?? [ctx.item.label, ''];
    root.append(pageHead(title, subtitle));
    const host = h('div', {});
    root.append(host);
    await renderRecords(host, ctx, resource);
}

export async function renderRecords(host, ctx, resource) {
    const { me, query, setQuery, isCurrent } = ctx;
    const q = query();
    const page = Math.max(1, Number(q.get('page')) || 1);
    clear(host).append(skeleton('adm-skel--row', 8));
    const qs = filterQs(query, { page, status: q.get('status'), currency: q.get('currency'), q: q.get('q') }, { defaultRange: 'all' });
    let data;
    try {
        data = await api(`/api/records/${resource}?${qs}`);
    } catch (e) {
        if (!isCurrent()) return;
        clear(host).append(errorState(e, () => renderRecords(host, ctx, resource)));
        return;
    }
    if (!isCurrent()) return;
    clear(host);

    const search = h('input', { type: 'search', class: 'adm-input', placeholder: 'Search reference or name', value: q.get('q') || '', 'aria-label': 'Search records' });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') setQuery({ q: search.value.trim() || null, page: null }); });
    const statusSel = h('select', { class: 'adm-select', 'aria-label': 'Status', onchange: (e) => setQuery({ status: e.target.value || null, page: null }) },
        h('option', { value: '' }, 'Any status'), (STATUSES[resource] ?? []).map((s) => h('option', { value: s, selected: q.get('status') === s }, label(s))));
    const extra = [statusSel, search];
    if (COLS[resource]?.some((c) => c.label === 'Currency')) {
        const cur = h('input', { class: 'adm-input', style: { minWidth: '90px', width: '90px' }, placeholder: 'Currency', maxlength: 3, value: q.get('currency') || '', 'aria-label': 'Currency code' });
        cur.addEventListener('keydown', (e) => { if (e.key === 'Enter') setQuery({ currency: cur.value.trim().toUpperCase() || null, page: null }); });
        extra.push(cur);
    }
    host.append(filterBar({ me, query, setQuery, scope: data.scope, allowAllRange: true, extra }), scopeBanners(data.scope));

    if (data.unsupported?.length) {
        host.append(banner('info', `${data.unsupported.map((p) => PLATFORM_LABEL[p]).join(', ')} ${data.unsupported.length > 1 ? 'do' : 'does'} not provide ${label(resource)} data, so ${data.unsupported.length > 1 ? 'they are' : 'it is'} not included here.`));
    }
    const cols = COLS[resource] ?? COLS.transactions;
    const toolbar = h('div', { class: 'adm-card__head' },
        h('div', { class: 'adm-actions' }, demoChip(data.scope), h('span', { class: 'adm-kpi__hint' }, ['transactions', 'payments', 'commissions', 'refunds'].includes(resource) ? CURRENCY_NOTE : 'Read-only mirror of platform records.')),
        h('div', { class: 'adm-actions' },
            (UNSUPPORTED_ACTIONS[resource] ?? []).map((a) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true, title: 'Not available: the platform API does not provide this operation yet.' }, a)),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !data.items.length, onclick: () => downloadCsv(`suskii-${data.scope.kind === 'demo' ? 'DEMO-' : ''}${resource}-page${page}.csv`, cols.map((c) => ({ ...c, csv: c.csv ?? ((r) => (c.key ? r[c.key] : r.sourceId)) })), data.items) }, icon('download', 'icon icon--sm'), 'Export CSV')));
    host.append(toolbar);

    const noSources = !data.scope.platforms.length;
    host.append(table(cols, data.items, {
        onRowClick: (r) => detail(r, resource),
        emptyState: noSources
            ? empty('No connected platform data', 'Records appear here after a platform is connected and synchronised in Integrations.', 'integrations')
            : empty('No records match', 'Try a different period, status or search.'),
    }));
    if (data.total > data.pageSize) host.append(pager({ page, pageSize: data.pageSize, total: data.total, onPage: (p) => setQuery({ page: p }) }));
}

function detail(r, resource) {
    const rows = Object.entries(r).filter(([k]) => k !== 'attributes');
    const kv = h('dl', { class: 'adm-kv' }, rows.map(([k, v]) => [h('dt', {}, label(k.replace(/([A-Z])/g, ' $1').toLowerCase())), h('dd', {}, formatValue(k, v, r))]));
    const attrs = r.attributes && Object.keys(r.attributes).length ? h('div', { class: 'adm-section-gap' }, h('h3', { style: { fontSize: '.9rem', marginBottom: '6px' } }, 'Original platform fields'), h('pre', { class: 'adm-code' }, JSON.stringify(r.attributes, null, 2))) : null;
    modal({
        title: `${label(resource)} ${r.sourceId}`, wide: true,
        body: h('div', {}, r.isDemo ? h('div', { class: 'adm-banner adm-banner--demo' }, h('span', { class: 'adm-demo-chip' }, 'DEMO MODE'), h('div', {}, 'Synthetic record — not a real customer or transaction.')) : null,
            kv, attrs,
            h('div', { class: 'adm-section-gap adm-actions' }, (UNSUPPORTED_ACTIONS[resource] ?? []).map((a) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true, title: 'Not available: the platform API does not provide this operation yet.' }, a)),
                h('small', { class: 'adm-kpi__hint' }, 'Changes are made on the owning platform. The central admin does not modify platform records.'))),
    });
}

function formatValue(k, v, r) {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'platform') return PLATFORM_LABEL[v] ?? v;
    if (/Minor$/.test(k)) return `${money(v, r.currency)} (${v} minor units)`;
    if (/At$|Date$/.test(k)) return dateTime(v);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
}
