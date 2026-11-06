/** Financial reports: per-currency and per-platform figures built only from completed payments. */
import { api, clear, compactMoney, downloadCsv, errorState, h, icon, money, num, PLATFORM_COLOR, PLATFORM_LABEL, skeleton, table } from '../lib.js';
import { lineChart } from '../charts.js';
import { CURRENCY_NOTE, demoChip, filterBar, filterQs, pageHead, scopeBanners } from './common.js';

export async function render(root, ctx) {
    const { me, query, setQuery, isCurrent } = ctx;
    root.append(pageHead('Financial Reports', 'Gross transaction value, platform revenue, refunds and commissions by currency and platform.'));
    const body = h('div', {}, skeleton('adm-skel--chart'));
    root.append(body);
    let data;
    try { data = await api(`/api/overview?${filterQs(query)}`); } catch (e) {
        if (!isCurrent()) return;
        clear(body).append(errorState(e));
        return;
    }
    if (!isCurrent()) return;
    clear(body);
    const { metrics: m, charts, scope, currencies } = data;
    body.append(filterBar({ me, query, setQuery, scope }), scopeBanners(scope));
    body.append(h('div', { class: 'adm-banner adm-banner--info' }, icon('info'), h('div', {},
        'Revenue counts platform fees on completed payments only. Pending, failed, refunded and reversed payments are excluded. ', CURRENCY_NOTE)));

    const allCurrencies = [...new Set([...currencies, ...Object.keys(m.refundAmount ?? {}), ...Object.keys(m.commissions ?? {}), ...Object.keys(m.pendingPaymentsAmount ?? {})])].sort();
    const byCurrency = allCurrencies.map((c) => ({
        currency: c,
        gtv: m.grossTransactionValue?.[c] ?? 0, revenue: m.platformRevenue?.[c] ?? 0, refunds: m.refundAmount?.[c] ?? 0,
        commissions: m.commissions?.[c] ?? 0, pending: m.pendingPaymentsAmount?.[c] ?? 0,
    }));
    const mcol = (labelText, key) => ({ label: labelText, num: true, render: (r) => money(r[key], r.currency), csv: (r) => r[key] });
    const currencyCols = [{ label: 'Currency', key: 'currency' }, mcol('Gross transaction value', 'gtv'), mcol('Platform revenue', 'revenue'), mcol('Refunded', 'refunds'), mcol('Commissions', 'commissions'), mcol('Pending (not revenue)', 'pending')];

    body.append(h('section', { class: 'adm-card' },
        h('div', { class: 'adm-card__head' }, h('div', {}, h('h2', {}, 'By currency ', demoChip(scope)), h('p', {}, `${data.range.preset === 'custom' ? 'Custom period' : `Period: ${data.range.preset}`} · UTC`)),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !byCurrency.length, onclick: () => downloadCsv(`suskii-${scope.kind === 'demo' ? 'DEMO-' : ''}finance-by-currency.csv`, currencyCols, byCurrency) }, icon('download', 'icon icon--sm'), 'Export CSV')),
        table(currencyCols, byCurrency)));

    const platRows = charts.platformComparison.flatMap((p) => {
        const cs = [...new Set([...Object.keys(p.gtv), ...Object.keys(p.revenue)])].sort();
        return cs.length ? cs.map((c) => ({ platform: p.platform, currency: c, transactions: p.transactions, completed: p.completed, gtv: p.gtv[c] ?? 0, revenue: p.revenue[c] ?? 0 }))
            : [{ platform: p.platform, currency: '', transactions: p.transactions, completed: p.completed, gtv: null, revenue: null }];
    });
    const platCols = [
        { label: 'Platform', render: (r) => PLATFORM_LABEL[r.platform], csv: (r) => r.platform }, { label: 'Currency', key: 'currency' },
        { label: 'Payments', num: true, render: (r) => num(r.transactions), csv: (r) => r.transactions }, { label: 'Completed', num: true, render: (r) => num(r.completed), csv: (r) => r.completed },
        mcol('Gross transaction value', 'gtv'), mcol('Platform revenue', 'revenue'),
    ];
    body.append(h('section', { class: 'adm-card adm-section-gap' },
        h('div', { class: 'adm-card__head' }, h('h2', {}, 'By platform'),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !platRows.length, onclick: () => downloadCsv(`suskii-${scope.kind === 'demo' ? 'DEMO-' : ''}finance-by-platform.csv`, platCols, platRows) }, icon('download', 'icon icon--sm'), 'Export CSV')),
        table(platCols, platRows)));

    if (charts.revenueTrend && Object.keys(charts.revenueTrend).length) {
        const grid = h('div', { class: 'adm-grid adm-grid--2 adm-section-gap' });
        for (const [c, series] of Object.entries(charts.revenueTrend)) {
            grid.append(h('section', { class: 'adm-card' }, h('div', { class: 'adm-card__head' }, h('h2', {}, `Daily revenue (${c})`)),
                lineChart({ title: `Daily revenue in ${c}`, labels: series.map((d) => d.day), format: (v) => compactMoney(v, c), series: [{ name: c, color: PLATFORM_COLOR.travel_tour, values: series.map((d) => d.value) }] })));
        }
        body.append(grid);
    }
    body.append(h('section', { class: 'adm-card adm-section-gap' }, h('h2', { style: { fontSize: '1rem', marginBottom: '6px' } }, 'Settlement, payouts and reconciliation'),
        h('p', { class: 'adm-kpi__hint' }, 'Payout and settlement reports need each platform’s payout API, which has not been provided yet. Until then these reports are unavailable rather than estimated.'),
        h('div', { class: 'adm-actions', style: { marginTop: '10px' } },
            ['Payout report', 'Settlement reconciliation', 'Tax summary'].map((t) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true, title: 'Requires platform payout APIs' }, t)))));
}
