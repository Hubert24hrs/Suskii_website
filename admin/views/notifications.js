/** Central notifications: sync failures, new inquiries, applications, content awaiting review. */
import { api, clear, dateTime, empty, errorState, h, skeleton, toast, pill } from '../lib.js';
import { pageHead } from './common.js';

export async function render(root, ctx) {
    const markAll = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Mark all as read');
    root.append(pageHead('Notifications', 'Alerts for your role. Only notifications you are allowed to see are listed.', markAll));
    const body = h('div', {}, skeleton('adm-skel--row', 6));
    root.append(body);
    const load = async () => {
        let data;
        try { data = await api('/api/admin/notifications'); } catch (e) { clear(body).append(errorState(e, load)); return; }
        if (!ctx.isCurrent()) return;
        clear(body);
        markAll.disabled = !data.unread;
        if (!data.items.length) { body.append(h('div', { class: 'adm-card' }, empty('No notifications', 'You are all caught up.', 'notifications'))); return; }
        body.append(h('div', { class: 'adm-card', style: { padding: '8px' } }, data.items.map((n) => h('a', { class: `adm-notif${n.read ? '' : ' is-unread'}`, href: n.link || '/admin/notifications',
            onclick: () => { if (!n.read) api('/api/admin/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {}); } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' } }, h('strong', {}, n.title), pill(n.severity || 'info')),
        n.body ? h('p', { style: { fontSize: '.85rem', margin: '4px 0' } }, n.body) : null,
        h('small', {}, dateTime(n.created_at))))));
    };
    markAll.addEventListener('click', async () => {
        try { await api('/api/admin/notifications/read', { method: 'POST', body: { all: true } }); toast('All notifications marked as read.', 'ok'); load(); } catch (e) { toast(e.message, 'error'); }
    });
    await load();
}
