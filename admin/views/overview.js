/** Executive overview: KPIs, trends and platform status for the selected platforms, period and data kind. */
import { api, clear, compactMoney, dateTime, downloadCsv, errorState, h, icon, num, PLATFORM_COLOR, PLATFORM_LABEL, skeleton, label } from '../lib.js';
import { barList, donutChart, lineChart } from '../charts.js';
import { CURRENCY_NOTE, demoChip, filterBar, filterQs, kpi, pageHead, scopeBanners, sourceList } from './common.js';

const STATUS_COLOR = { completed: '#067647', pending: '#DC6803', failed: '#B42318', refunded: '#667085', reversed: '#98A2B3', cancelled: '#D0D5DD' };

export async function render(root, ctx) {
    const { me, query, setQuery, isCurrent } = ctx;
    const body = h('div', {});
    const head = pageHead('Overview', 'Company-wide performance across the SUSKII platforms.');
    root.append(head, body);
    body.append(h('div', { class: 'adm-grid adm-grid--kpi' }, skeleton('adm-skel--kpi', 8)), h('div', { class: 'adm-section-gap' }, skeleton('adm-skel--chart')));

    let data;
    try {
        data = await api(`/api/overview?${filterQs(query)}`);
    } catch (e) {
        if (!isCurrent()) return;
        clear(body).append(filterBar({ me, query, setQuery }), errorState(e, () => ctx.navigate(location.pathname + location.search, { replace: true })));
        return;
    }
    if (!isCurrent()) return;
    clear(body);
    const { metrics: m, charts, scope } = data;
    const finance = m.grossTransactionValue !== null;

    head.querySelector('.adm-actions')?.remove();
    head.append(h('div', { class: 'adm-actions' },
        h('span', { class: 'adm-kpi__hint', title: dateTime(data.generatedAt) }, `Updated ${dateTime(data.generatedAt)} · UTC`),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => ctx.navigate(location.pathname + location.search, { replace: true }) }, icon('refresh', 'icon icon--sm'), 'Refresh'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => exportCsv(data) }, icon('download', 'icon icon--sm'), 'Export CSV')));

    body.append(filterBar({ me, query, setQuery, scope }), scopeBanners(scope));

    const noData = !scope.platforms.length;
    const k = (o) => kpi(o);
    body.append(h('div', { class: 'adm-grid adm-grid--kpi' },
        k({ label: h('span', {}, 'Total users ', demoChip(scope)), value: num(m.totalUsers), hint: 'Registered customers on the selected platforms' }),
        k({ label: 'New users', value: num(m.newUsers), hint: 'Registered in this period' }),
        k({ label: 'Total transactions', value: num(m.totalTransactions), hint: 'Payments of any status' }),
        k({ label: 'Completed transactions', value: num(m.completedTransactions) }),
        k({ label: 'Failed transactions', value: num(m.failedTransactions) }),
        k({ label: 'Pending payments', value: num(m.pendingPayments), hint: 'Not counted as revenue' }),
        k({ label: 'Gross transaction value', money: m.grossTransactionValue ?? {}, restricted: !finance, hint: 'Completed payments only' }),
        k({ label: 'Platform revenue', money: m.platformRevenue ?? {}, restricted: !finance, hint: 'Fees on completed payments only' }),
        k({ label: 'Refunds', value: num(m.refunds), hint: finance ? amountHint(m.refundAmount) : null }),
        k({ label: 'Commissions', money: m.commissions ?? {}, restricted: !finance }),
        k({ label: 'Marketplace orders', value: num(m.marketplaceOrders) }),
        k({ label: 'Active errands', value: num(m.activeErrands), hint: `${num(m.errandRequests)} errand requests in period` }),
        k({ label: 'Travel bookings', value: num(m.travelBookings) }),
        k({ label: 'Pending disputes', value: num(m.pendingDisputes) })));

    if (noData) {
        body.append(h('div', { class: 'adm-card adm-section-gap' }, h('h2', { style: { fontSize: '1rem', marginBottom: '6px' } }, 'No platform data yet'),
            h('p', {}, 'Figures appear here once a platform is connected and has completed a successful synchronisation. Nothing is estimated or invented in the meantime.'),
            ctx.can('integrations.read') ? h('p', { style: { marginTop: '10px' } }, h('a', { class: 'btn btn--dark btn--sm', href: '/admin/integrations' }, 'Open Integrations')) : null));
    } else {
        const days = charts.transactionTrend.map((d) => d.day);
        const grid1 = h('div', { class: 'adm-grid adm-grid--2 adm-section-gap' });
        grid1.append(chartCard('Transaction trend', 'Payments per day, by platform', lineChart({
            title: 'Transaction trend', labels: days,
            series: scope.platforms.map((p) => ({ name: PLATFORM_LABEL[p], color: PLATFORM_COLOR[p], values: charts.transactionTrend.map((d) => d[p] ?? 0) })),
        })));
        if (charts.revenueTrend) grid1.append(revenueTrendCard(charts.revenueTrend, days));
        else grid1.append(chartCard('Revenue trend', null, h('p', { class: 'adm-kpi__hint' }, 'Revenue is visible to finance roles only.')));
        body.append(grid1);

        const grid2 = h('div', { class: 'adm-grid adm-grid--3 adm-section-gap' });
        grid2.append(chartCard('Platform comparison', 'Payments in period', barList({
            title: 'Platform comparison',
            rows: charts.platformComparison.map((p) => ({ name: PLATFORM_LABEL[p.platform], color: PLATFORM_COLOR[p.platform], value: p.transactions })),
        })));
        grid2.append(chartCard('Transaction status', 'Share of payments by status', donutChart({
            title: 'Transaction status distribution', centerLabel: 'Payments',
            items: charts.statusDistribution.map((s) => ({ name: label(s.status), color: STATUS_COLOR[s.status], value: s.count })),
        })));
        if (charts.revenueContribution) grid2.append(contributionCard(charts.revenueContribution));
        body.append(grid2);

        const grid3 = h('div', { class: 'adm-grid adm-grid--2 adm-section-gap' });
        grid3.append(chartCard('User growth', 'Cumulative new customers in period', lineChart({
            title: 'User growth', labels: days,
            series: scope.platforms.map((p) => ({ name: PLATFORM_LABEL[p], color: PLATFORM_COLOR[p], values: charts.userGrowth.map((d) => d[`${p}_cumulative`] ?? 0) })),
        })));
        grid3.append(chartCard('Orders, errands and bookings', 'Created per day', lineChart({
            title: 'Orders, errands and bookings', labels: days, kind: 'bar',
            series: [
                { name: 'Marketplace orders', color: PLATFORM_COLOR.marketplace, values: charts.ordersAndBookings.map((d) => d.orders) },
                { name: 'Errand requests', color: PLATFORM_COLOR.errands, values: charts.ordersAndBookings.map((d) => d.errands) },
                { name: 'Travel bookings', color: PLATFORM_COLOR.travel_tour, values: charts.ordersAndBookings.map((d) => d.bookings) },
            ],
        })));
        body.append(grid3);
    }

    body.append(h('div', { class: 'adm-card__head adm-section-gap' }, h('h2', {}, 'Platform status'), h('p', {}, CURRENCY_NOTE)), sourceList(scope));
}

function amountHint(map) {
    const parts = Object.entries(map ?? {}).filter(([, v]) => v).map(([c, v]) => compactMoney(v, c));
    return parts.length ? `Refunded: ${parts.join(' · ')}` : 'No completed refunds';
}

function chartCard(title, subtitle, content) {
    return h('section', { class: 'adm-card' }, h('div', { class: 'adm-card__head' }, h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null)), content);
}

function currencyPicker(currencies, onPick) {
    if (currencies.length < 2) return null;
    return h('select', { class: 'adm-select', 'aria-label': 'Currency', onchange: (e) => onPick(e.target.value) }, currencies.map((c) => h('option', { value: c }, c)));
}

function revenueTrendCard(trend, days) {
    const currencies = Object.keys(trend);
    const host = h('div', {});
    const draw = (c) => {
        clear(host);
        if (!c) { host.append(h('p', { class: 'adm-kpi__hint' }, 'No completed payments in this period.')); return; }
        host.append(lineChart({ title: `Platform revenue (${c})`, labels: days, format: (v, short) => (short ? compactMoney(v, c) : compactMoney(v, c)), series: [{ name: `Revenue (${c})`, color: '#4F46E5', values: trend[c].map((d) => d.value) }] }));
    };
    draw(currencies[0]);
    const card = chartCard('Revenue trend', 'Fees on completed payments, per currency', host);
    const picker = currencyPicker(currencies, draw);
    if (picker) card.querySelector('.adm-card__head').append(picker);
    return card;
}

function contributionCard(contrib) {
    const currencies = Object.keys(contrib);
    const host = h('div', {});
    const draw = (c) => {
        clear(host);
        if (!c) { host.append(h('p', { class: 'adm-kpi__hint' }, 'No revenue in this period.')); return; }
        host.append(donutChart({ title: `Revenue contribution (${c})`, centerLabel: c, format: (v) => compactMoney(v, c),
            items: contrib[c].map((x) => ({ name: PLATFORM_LABEL[x.platform], color: PLATFORM_COLOR[x.platform], value: x.value })) }));
    };
    draw(currencies[0]);
    const card = chartCard('Revenue contribution', 'By platform, per currency', host);
    const picker = currencyPicker(currencies, draw);
    if (picker) card.querySelector('.adm-card__head').append(picker);
    return card;
}

function exportCsv(data) {
    const m = data.metrics;
    const rows = [];
    const push = (metric, value, currency = '') => rows.push({ metric, value, currency });
    for (const key of ['totalUsers', 'newUsers', 'totalTransactions', 'completedTransactions', 'failedTransactions', 'pendingPayments', 'refunds', 'marketplaceOrders', 'activeErrands', 'errandRequests', 'travelBookings', 'pendingDisputes']) push(key, m[key]);
    for (const key of ['grossTransactionValue', 'platformRevenue', 'refundAmount', 'commissions', 'pendingPaymentsAmount']) {
        if (m[key]) for (const [c, v] of Object.entries(m[key])) push(`${key} (minor units)`, v, c);
    }
    const kind = data.scope.kind === 'demo' ? 'DEMO-' : '';
    downloadCsv(`suskii-${kind}overview-${data.range.preset}-${new Date().toISOString().slice(0, 10)}.csv`,
        [{ label: 'Metric', key: 'metric' }, { label: 'Value', key: 'value' }, { label: 'Currency', key: 'currency' }, { label: 'Data', csv: () => data.scope.kind }], rows);
}
