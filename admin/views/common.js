/** Building blocks shared by the operational views: page header, filters, scope warnings, money. */
import { banner, h, money, PLATFORM_LABEL, label, compactMoney, ago } from '../lib.js';

export function pageHead(title, subtitle, ...actions) {
    return h('div', { class: 'adm-head' },
        h('div', {}, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null),
        actions.length ? h('div', { class: 'adm-actions' }, actions) : null);
}

export const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['custom', 'Custom']];

/** Query string carrying only the shared filters (plus extras). */
export function filterQs(query, extra = {}, { defaultRange = '30d' } = {}) {
    const q = new URLSearchParams();
    const src = query();
    q.set('platform', src.get('platform') || 'all');
    const range = src.get('range') || defaultRange;
    if (range) q.set('range', range);
    if (range === 'custom') { q.set('from', src.get('from') || ''); q.set('to', src.get('to') || ''); }
    if (src.get('data')) q.set('data', src.get('data'));
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
    return q.toString();
}

function seg(options, current, onPick, ariaLabel) {
    return h('div', { class: 'adm-seg', role: 'group', 'aria-label': ariaLabel },
        options.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(value === current), onclick: () => onPick(value) }, text)));
}

/**
 * Platform / date-range / data-kind filters. The data-kind switch only appears when a demo source exists,
 * so live and synthetic figures are never shown together.
 */
export function filterBar({ me, query, setQuery, scope, ranges = RANGES, allowAllRange = false, extra = [] }) {
    const q = query();
    const platform = q.get('platform') || 'all';
    const range = q.get('range') || (allowAllRange ? 'all' : '30d');
    const select = h('select', { class: 'adm-select', 'aria-label': 'Platform', onchange: (e) => setQuery({ platform: e.target.value === 'all' ? null : e.target.value }) },
        h('option', { value: 'all' }, me.platforms.length > 1 ? 'All my platforms' : 'All'),
        me.platforms.map((p) => h('option', { value: p, selected: p === platform }, PLATFORM_LABEL[p])));
    const rangeOpts = allowAllRange ? [['all', 'All time'], ...ranges] : ranges;
    const parts = [select, seg(rangeOpts, range, (v) => setQuery({ range: v, ...(v !== 'custom' ? { from: null, to: null } : {}) }), 'Date range')];
    if (range === 'custom') {
        const today = new Date().toISOString().slice(0, 10);
        const from = h('input', { type: 'date', class: 'adm-input', 'aria-label': 'From date', value: q.get('from') || '', max: today });
        const to = h('input', { type: 'date', class: 'adm-input', 'aria-label': 'To date', value: q.get('to') || today, max: today });
        parts.push(from, to, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => setQuery({ from: from.value, to: to.value }) }, 'Apply'));
    }
    if (scope && (scope.availableKinds.length > 1 || scope.kind === 'demo')) {
        parts.push(seg([['live', 'Live data'], ['demo', 'Demo data']], scope.kind, (v) => setQuery({ data: v }), 'Data source'));
    }
    return h('div', { class: 'adm-filters' }, parts, extra);
}

/** Partial-data, failed-sync and DEMO MODE warnings, as returned by the server. */
export function scopeBanners(scope) {
    if (!scope) return null;
    return h('div', {}, scope.warnings.map((w) => w.startsWith('DEMO MODE')
        ? h('div', { class: 'adm-banner adm-banner--demo', role: 'status' }, h('span', { class: 'adm-demo-chip' }, 'DEMO MODE'), h('div', {}, (t => t.charAt(0).toUpperCase() + t.slice(1))(w.replace(/^DEMO MODE:\s*/, ''))))
        : banner('warn', w)));
}

export function demoChip(scope) {
    return scope?.kind === 'demo' ? h('span', { class: 'adm-demo-chip', title: 'Synthetic demo data' }, 'DEMO') : null;
}

/** Per-currency amounts — currencies are listed separately and never added together. */
export function moneyLines(map, { compact = false, emptyText = 'No completed payments' } = {}) {
    const entries = Object.entries(map ?? {}).filter(([, v]) => v !== 0);
    if (!entries.length) return h('div', { class: 'adm-kpi__money' }, h('span', { style: { color: 'var(--muted)', fontWeight: 600, fontSize: '.9rem' } }, emptyText));
    return h('div', { class: 'adm-kpi__money' }, entries.sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => h('span', { title: money(v, c) }, compact ? compactMoney(v, c) : money(v, c))));
}

export function kpi({ label: text, value, money: m, hint, restricted }) {
    return h('div', { class: 'adm-card adm-kpi' },
        h('div', { class: 'adm-kpi__label' }, text),
        restricted ? h('div', { class: 'adm-kpi__value' }, h('small', {}, 'Restricted'))
            : m !== undefined ? moneyLines(m, { compact: true })
                : h('div', { class: 'adm-kpi__value' }, value ?? '—'),
        restricted ? h('div', { class: 'adm-kpi__hint' }, 'Requires finance access') : hint ? h('div', { class: 'adm-kpi__hint' }, hint) : null);
}

export function sourceList(scope) {
    return h('div', { class: 'adm-grid adm-grid--3' }, scope.sources.map((s) => h('div', { class: 'adm-card adm-plat' },
        h('div', { class: 'adm-plat__head' }, h('div', {}, h('strong', {}, s.name), h('small', { style: { color: 'var(--muted)' } }, `Mode: ${label(s.mode)}`))),
        h('div', {}, h('span', { class: `adm-state adm-state--${s.state}` }, ({ not_configured: 'Not Configured', disconnected: 'Disconnected', connecting: 'Connecting', connected: 'Connected', degraded: 'Degraded', sync_failed: 'Synchronization Failed', demo: 'Demo Mode' })[s.state] ?? s.state)),
        h('dl', { class: 'adm-plat__meta' },
            h('dt', {}, 'In these figures'), h('dd', {}, s.included ? 'Yes' : 'No'),
            h('dt', {}, 'Last successful sync'), h('dd', {}, s.lastSyncAt ? ago(s.lastSyncAt) : s.mode === 'demo' ? 'Not applicable (demo)' : 'Never'),
            h('dt', {}, 'Status'), h('dd', {}, s.reason || '—')))));
}

export const CURRENCY_NOTE = 'Amounts are shown in their original currencies and never converted or added across currencies.';
