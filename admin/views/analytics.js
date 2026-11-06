/** Operational analytics: growth, activity and conversion trends across platforms. */
import { api, clear, errorState, h, label, num, pct, PLATFORM_COLOR, PLATFORM_LABEL, skeleton, table } from '../lib.js';
import { barList, donutChart, lineChart } from '../charts.js';
import { demoChip, filterBar, filterQs, kpi, pageHead, scopeBanners } from './common.js';

export async function render(root, ctx) {
    const { me, query, setQuery, isCurrent } = ctx;
    root.append(pageHead('Analytics', 'Growth and activity trends. All figures come from synchronised platform data.'));
    const body = h('div', {}, skeleton('adm-skel--chart', 2));
    root.append(body);
    let data;
    try { data = await api(`/api/overview?${filterQs(query)}`); } catch (e) {
        if (!isCurrent()) return;
        clear(body).append(errorState(e));
        return;
    }
    if (!isCurrent()) return;
    clear(body);
    const { metrics: m, charts, scope } = data;
    body.append(filterBar({ me, query, setQuery, scope }), scopeBanners(scope));
    if (!scope.platforms.length) {
        body.append(h('div', { class: 'adm-card' }, h('p', {}, 'Analytics become available once at least one platform is connected and synchronised.')));
        return;
    }
    const days = charts.transactionTrend.map((d) => d.day);
    body.append(h('div', { class: 'adm-grid adm-grid--kpi' },
        kpi({ label: h('span', {}, 'Payment success rate ', demoChip(scope)), value: pct(m.completedTransactions, m.totalTransactions), hint: `${num(m.completedTransactions)} of ${num(m.totalTransactions)} payments completed` }),
        kpi({ label: 'Payment failure rate', value: pct(m.failedTransactions, m.totalTransactions) }),
        kpi({ label: 'New users', value: num(m.newUsers), hint: `${num(m.totalUsers)} customers in total` }),
        kpi({ label: 'Refund rate', value: pct(m.refunds, m.completedTransactions), hint: 'Refunds per completed payment' }),
        kpi({ label: 'Active errands', value: num(m.activeErrands) }),
        kpi({ label: 'Travel bookings', value: num(m.travelBookings) })));

    const g = h('div', { class: 'adm-grid adm-grid--2 adm-section-gap' });
    g.append(card('New users per day', lineChart({ title: 'New users per day', labels: days, kind: 'bar',
        series: scope.platforms.map((p) => ({ name: PLATFORM_LABEL[p], color: PLATFORM_COLOR[p], values: charts.userGrowth.map((d) => d[p] ?? 0) })) })));
    g.append(card('Payments per day', lineChart({ title: 'Payments per day', labels: days, stacked: true,
        series: scope.platforms.map((p) => ({ name: PLATFORM_LABEL[p], color: PLATFORM_COLOR[p], values: charts.transactionTrend.map((d) => d[p] ?? 0) })) })));
    g.append(card('Activity mix', donutChart({ title: 'Activity mix', centerLabel: 'Created',
        items: [
            { name: 'Marketplace orders', color: PLATFORM_COLOR.marketplace, value: m.marketplaceOrders },
            { name: 'Errand requests', color: PLATFORM_COLOR.errands, value: m.errandRequests },
            { name: 'Travel bookings', color: PLATFORM_COLOR.travel_tour, value: m.travelBookings },
        ] })));
    g.append(card('Completed payments by platform', barList({ title: 'Completed payments by platform',
        rows: charts.platformComparison.map((p) => ({ name: PLATFORM_LABEL[p.platform], color: PLATFORM_COLOR[p.platform], value: p.completed })) })));
    body.append(g);

    body.append(h('section', { class: 'adm-card adm-section-gap' }, h('div', { class: 'adm-card__head' }, h('h2', {}, 'Payment status breakdown')),
        table([{ label: 'Status', render: (r) => label(r.status) }, { label: 'Payments', num: true, render: (r) => num(r.count) }, { label: 'Share', num: true, render: (r) => pct(r.count, m.totalTransactions) }], charts.statusDistribution)));
}

function card(title, content) {
    return h('section', { class: 'adm-card' }, h('div', { class: 'adm-card__head' }, h('h2', {}, title)), content);
}
