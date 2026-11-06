/** Refunds and disputes, as two tabs over the read-only record tables. */
import { h } from '../lib.js';
import { pageHead } from './common.js';
import { renderRecords } from './records.js';

export async function render(root, ctx) {
    const tab = ctx.query().get('tab') === 'disputes' ? 'disputes' : 'refunds';
    root.append(pageHead('Refunds & Disputes', 'Refunds and open disputes as reported by each platform. Decisions are made on the owning platform.'));
    root.append(h('div', { class: 'adm-tabs', role: 'tablist' },
        [['refunds', 'Refunds'], ['disputes', 'Disputes']].map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab),
            onclick: () => ctx.setQuery({ tab: k === 'refunds' ? null : k, page: null, status: null }) }, t))));
    const host = h('div', { role: 'tabpanel' });
    root.append(host);
    await renderRecords(host, ctx, tab);
}
