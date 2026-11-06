/** Roles and the permission matrix. Built-in roles are fixed; custom roles can be created by Super Admins. */
import { api, banner, clear, confirmAction, errorState, field, h, icon, modal, skeleton, toast } from '../lib.js';
import { pageHead } from './common.js';

export async function render(root, ctx) {
    const manage = ctx.can('roles.manage');
    const addBtn = manage ? h('button', { class: 'btn btn--dark btn--sm', type: 'button' }, icon('plus', 'icon icon--sm'), 'New custom role') : null;
    root.append(pageHead('Roles & Permissions', 'What each role can see and do. Permissions are enforced by the server on every request.', addBtn));
    const body = h('div', {}, skeleton('adm-skel--chart'));
    root.append(body);
    let data;
    const load = async () => {
        try { data = await api('/api/admin/roles'); } catch (e) { clear(body).append(errorState(e, load)); return; }
        if (!ctx.isCurrent()) return;
        clear(body);
        const { roles, permissions } = data;
        const cats = [...new Set(permissions.map((p) => p.category))];
        const matrix = h('table', { class: 'adm-table adm-matrix' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Permission'), roles.map((r) => h('th', { scope: 'col', class: 'center', title: r.description }, r.name, h('div', { style: { fontWeight: 500, textTransform: 'none', letterSpacing: 0 } }, `${r.members} member${r.members === 1 ? '' : 's'}`))))),
            h('tbody', {}, cats.flatMap((c) => [
                h('tr', {}, h('th', { scope: 'rowgroup', colspan: roles.length + 1, style: { background: '#F4F5FA', position: 'static' } }, c)),
                ...permissions.filter((p) => p.category === c).map((p) => h('tr', {},
                    h('td', {}, h('strong', { style: { fontSize: '.82rem' } }, p.description), h('div', { class: 'adm-kpi__hint', style: { marginTop: 0 } }, p.id)),
                    roles.map((r) => h('td', { class: 'center', 'aria-label': `${r.name}: ${r.permissions.includes(p.id) ? 'allowed' : 'not allowed'}` }, r.permissions.includes(p.id) ? icon('check', 'icon icon--sm') : h('span', { 'aria-hidden': 'true', style: { color: 'var(--line-strong)' } }, '—'))))),
            ])));
        body.append(h('div', { class: 'adm-table-wrap' }, matrix));
        const custom = roles.filter((r) => !r.is_system);
        if (manage && custom.length) {
            body.append(h('section', { class: 'adm-card adm-section-gap' }, h('div', { class: 'adm-card__head' }, h('h2', {}, 'Custom roles')),
                h('div', { class: 'adm-grid', style: { gap: '8px' } }, custom.map((r) => h('div', { class: 'adm-actions', style: { justifyContent: 'space-between' } },
                    h('span', {}, h('strong', {}, r.name), ` · ${r.permissions.length} permissions · ${r.members} members`),
                    h('div', { class: 'adm-actions' },
                        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => editor(r, permissions, load) }, 'Edit'),
                        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => {
                            if (!(await confirmAction({ title: `Delete ${r.name}?`, message: 'Roles with members cannot be deleted.', confirmLabel: 'Delete', danger: true }))) return;
                            try { await api(`/api/admin/roles/${r.id}`, { method: 'DELETE' }); toast('Role deleted.', 'ok'); load(); } catch (e) { toast(e.message, 'error'); }
                        } }, icon('trash', 'icon icon--sm'))))))));
        }
    };
    addBtn?.addEventListener('click', () => editor(null, data.permissions, load));
    await load();
}

function editor(role, permissions, refresh) {
    const name = h('input', { class: 'adm-input', maxlength: 60, value: role?.name ?? '', disabled: !!role });
    const desc = h('input', { class: 'adm-input', maxlength: 300, value: role?.description ?? '', disabled: !!role });
    const boxes = permissions.map((p) => ({ p, cb: h('input', { type: 'checkbox', value: p.id, checked: role?.permissions.includes(p.id) }) }));
    const alertHost = h('div', {});
    modal({
        title: role ? `Edit ${role.name}` : 'New custom role', wide: true,
        body: h('div', { class: 'adm-form' }, alertHost, field('Name', name), field('Description', desc),
            banner('info', 'Roles that can manage administrators, roles, integrations, settings or publish content are privileged; only Super Admins can grant them.'),
            h('div', { class: 'adm-grid adm-grid--2', style: { gap: '8px' } }, boxes.map(({ p, cb }) => h('label', { class: 'adm-check' }, cb, h('span', {}, p.description, h('small', { style: { display: 'block', color: 'var(--muted)' } }, `${p.category} · ${p.id}`)))))),
        actions: [{ label: 'Cancel' }, { label: role ? 'Save' : 'Create role', kind: 'primary', onClick: async () => {
            const perms = boxes.filter((b) => b.cb.checked).map((b) => b.p.id);
            try {
                if (role) await api(`/api/admin/roles/${role.id}`, { method: 'PUT', body: { permissions: perms } });
                else await api('/api/admin/roles', { method: 'POST', body: { name: name.value, description: desc.value, permissions: perms } });
                toast(role ? 'Role updated.' : 'Role created.', 'ok');
                refresh();
            } catch (e) { clear(alertHost).append(banner('error', e.message)); return false; }
        } }],
    });
}
