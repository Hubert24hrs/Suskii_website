/** Platform management: connection state, what each platform's API supports, and where to act. */
import { api, ago, clear, errorState, h, label, PLATFORM_COLOR, skeleton, stateBadge } from '../lib.js';
import { pageHead } from './common.js';

const LINKS = {
    marketplace: [['Orders', '/admin/orders'], ['Sellers', '/admin/providers?platform=marketplace'], ['Payments', '/admin/payments?platform=marketplace']],
    errands: [['Errand requests', '/admin/errands'], ['Providers', '/admin/providers?platform=errands'], ['Payments', '/admin/payments?platform=errands']],
    travel_tour: [['Bookings', '/admin/bookings'], ['Customers', '/admin/customers?platform=travel_tour'], ['Payments', '/admin/payments?platform=travel_tour']],
};
const MANAGEMENT = {
    marketplace: ['Approve seller', 'Suspend listing', 'Moderate reviews'],
    errands: ['Approve provider', 'Reassign errand', 'Set service areas'],
    travel_tour: ['Publish package', 'Manage availability', 'Cancel booking'],
};

export async function render(root, ctx) {
    root.append(pageHead('Platform Management', 'Each SUSKII platform keeps its own database and operations. This page shows how each is connected to the central admin.'));
    const body = h('div', {}, skeleton('adm-skel--chart'));
    root.append(body);
    let overview, integrations = null;
    try {
        [overview, integrations] = await Promise.all([
            api('/api/overview?range=30d'),
            ctx.can('integrations.read') ? api('/api/integrations') : Promise.resolve(null),
        ]);
    } catch (e) {
        if (!ctx.isCurrent()) return;
        clear(body).append(errorState(e));
        return;
    }
    if (!ctx.isCurrent()) return;
    clear(body);
    const byPlatform = Object.fromEntries((integrations?.integrations ?? []).map((i) => [i.platform, i]));
    const grid = h('div', { class: 'adm-grid adm-grid--3' });
    for (const s of overview.scope.sources) {
        const i = byPlatform[s.platform];
        const caps = overview.capabilities?.[s.platform] ?? [];
        const canLink = (href) => {
            const path = href.split('?')[0];
            return !['/admin/payments'].includes(path) || ctx.can('finance.read');
        };
        grid.append(h('section', { class: 'adm-card adm-plat', style: { borderTop: `4px solid ${PLATFORM_COLOR[s.platform]}` } },
            h('div', { class: 'adm-plat__head' }, h('div', {}, h('strong', {}, s.name), h('small', { style: { color: 'var(--muted)' } }, `Mode: ${label(s.mode)}`))),
            h('div', {}, stateBadge(s.state)),
            h('dl', { class: 'adm-plat__meta' },
                h('dt', {}, 'Status'), h('dd', {}, s.reason || '—'),
                h('dt', {}, 'Last health check'), h('dd', {}, i?.lastHealthAt ? `${ago(i.lastHealthAt)} · ${i.lastHealthOk ? 'OK' : 'Failed'}` : '—'),
                h('dt', {}, 'Last successful sync'), h('dd', {}, s.lastSyncAt ? ago(s.lastSyncAt) : 'Never'),
                i ? [h('dt', {}, 'API base URL'), h('dd', {}, i.apiUrl || 'Not set')] : null),
            h('div', {}, h('div', { class: 'adm-kpi__label', style: { marginBottom: '6px' } }, 'Data this platform provides'),
                h('div', { class: 'adm-tags' }, caps.map((c) => h('span', { class: 'adm-tag' }, label(c))))),
            h('div', { class: 'adm-actions' }, LINKS[s.platform].filter(([, href]) => canLink(href)).map(([t, href]) => h('a', { class: 'btn btn--ghost btn--sm', href }, t)),
                ctx.can('integrations.read') ? h('a', { class: 'btn btn--dark btn--sm', href: `/admin/integrations?platform=${s.platform}` }, 'Integration settings') : null),
            h('div', {}, h('div', { class: 'adm-kpi__label', style: { marginBottom: '6px' } }, 'Management actions'),
                h('div', { class: 'adm-actions' }, MANAGEMENT[s.platform].map((t) => h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: true, title: 'Not available: this platform has not exposed a management API for this yet.' }, t))),
                h('small', { class: 'adm-kpi__hint' }, 'Disabled until the platform provides an API for it. Use the platform’s own admin in the meantime.'))));
    }
    body.append(grid);
}
