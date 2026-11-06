/**
 * Administrators. There is no public sign-up: new administrators are invited here and set their own
 * password through a one-time link. Only Super Admins can grant privileged roles (enforced by the server).
 */
import { api, ago, banner, clear, confirmAction, dateTime, errorState, field, h, icon, label, modal, pill, skeleton, table, toast, session } from '../lib.js';
import { pageHead } from './common.js';

export async function render(root, ctx) {
    const manage = ctx.can('users.manage');
    const inviteBtn = manage ? h('button', { class: 'btn btn--dark btn--sm', type: 'button' }, icon('plus', 'icon icon--sm'), 'Invite administrator') : null;
    root.append(pageHead('Administrators', 'People who can sign in to the central admin.', inviteBtn));
    const body = h('div', {}, skeleton('adm-skel--row', 6));
    root.append(body);
    let users, roles;
    const load = async () => {
        try { [{ users }, { roles }] = await Promise.all([api('/api/admin/users'), api('/api/admin/roles')]); } catch (e) { clear(body).append(errorState(e, load)); return; }
        if (!ctx.isCurrent()) return;
        clear(body);
        const roleName = Object.fromEntries(roles.map((r) => [r.id, r.name]));
        body.append(table([
            { label: 'Name', render: (u) => h('span', {}, u.name, u.id === session().user.id ? h('small', { class: 'adm-kpi__hint' }, ' (you)') : null) },
            { label: 'Email', key: 'email', muted: true },
            { label: 'Roles', render: (u) => h('div', { class: 'adm-tags' }, u.roles.length ? u.roles.map((r) => h('span', { class: 'adm-tag' }, roleName[r] ?? r)) : h('span', { class: 'adm-kpi__hint' }, 'No role')) },
            { label: 'Status', render: (u) => (u.locked_until && new Date(u.locked_until) > new Date() ? pill('locked') : pill(u.status)) },
            { label: 'Two-factor', render: (u) => (u.mfa_enabled ? pill('active') : h('span', { class: 'adm-kpi__hint' }, 'Off')) },
            { label: 'Last sign-in', render: (u) => (u.last_login_at ? ago(u.last_login_at) : 'Never'), muted: true },
        ], users, { onRowClick: manage ? (u) => edit(u, roles, load) : null }));
        const focus = ctx.query().get('id') && users.find((u) => u.id === ctx.query().get('id'));
        if (focus && manage) edit(focus, roles, load);
    };
    inviteBtn?.addEventListener('click', () => invite(roles, load));
    await load();
}

function roleChecks(roles, selected) {
    const isSuper = session().roles.includes('super_admin');
    const boxes = roles.map((r) => {
        const cb = h('input', { type: 'checkbox', value: r.id, checked: selected.includes(r.id), disabled: r.is_privileged && !isSuper && !selected.includes(r.id) });
        return { cb, node: h('label', { class: 'adm-check', style: { alignItems: 'flex-start' } }, cb, h('span', {}, h('strong', {}, r.name), r.is_privileged ? h('span', { class: 'adm-tag', style: { marginLeft: '6px' } }, 'Privileged') : null,
            h('small', { style: { display: 'block', color: 'var(--muted)', fontWeight: 500 } }, r.description))) };
    });
    return {
        el: h('div', { class: 'adm-grid', style: { gap: '10px' } }, boxes.map((b) => b.node),
            !isSuper ? h('small', { class: 'adm-kpi__hint' }, 'Only a Super Admin can grant privileged roles.') : null),
        value: () => boxes.filter((b) => b.cb.checked).map((b) => b.cb.value),
    };
}

function linkBox(link, text) {
    const input = h('input', { class: 'adm-input', readonly: true, value: link, onfocus: (e) => e.target.select() });
    return h('div', { class: 'adm-form' }, banner('warn', text), input,
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => navigator.clipboard?.writeText(link).then(() => toast('Link copied.', 'ok')) }, 'Copy link'));
}

function invite(roles, refresh) {
    const name = h('input', { class: 'adm-input', maxlength: 120, autocomplete: 'off' });
    const email = h('input', { class: 'adm-input', type: 'email', maxlength: 254, autocomplete: 'off' });
    const rc = roleChecks(roles, []);
    const alertHost = h('div', {});
    modal({
        title: 'Invite administrator', wide: true,
        body: h('div', { class: 'adm-form' }, alertHost, field('Full name', name), field('Work email', email), h('div', { class: 'adm-field' }, h('span', { class: 'adm-field__label' }, 'Roles'), rc.el)),
        actions: [{ label: 'Cancel' }, { label: 'Send invitation', kind: 'primary', onClick: async (close) => {
            clear(alertHost);
            try {
                const res = await api('/api/admin/users', { method: 'POST', body: { name: name.value, email: email.value, roles: rc.value() } });
                refresh();
                if (res.inviteLink) {
                    close();
                    modal({ title: 'Share the invitation link', body: linkBox(res.inviteLink, 'Email delivery is not configured, so send this one-time link to the new administrator through a secure channel. It expires in 72 hours and can be used once.') });
                    return false;
                }
                toast('Invitation sent by email.', 'ok');
            } catch (e) { alertHost.append(banner('error', e.message)); return false; }
        } }],
    });
}

function edit(u, roles, refresh) {
    const me = session();
    const self = u.id === me.user.id;
    const rc = roleChecks(roles, u.roles);
    const name = h('input', { class: 'adm-input', value: u.name, maxlength: 120 });
    const alertHost = h('div', {});
    const locked = u.locked_until && new Date(u.locked_until) > new Date();
    const doAction = async (fn, success) => { clear(alertHost); try { await fn(); toast(success, 'ok'); refresh(); return true; } catch (e) { alertHost.append(banner('error', e.message)); return false; } };
    const { close } = modal({
        title: u.name, wide: true,
        body: h('div', { class: 'adm-form' }, alertHost,
            h('dl', { class: 'adm-kv' }, h('dt', {}, 'Email'), h('dd', {}, u.email), h('dt', {}, 'Created'), h('dd', {}, dateTime(u.created_at)),
                h('dt', {}, 'Last sign-in'), h('dd', {}, dateTime(u.last_login_at)), h('dt', {}, 'Two-factor'), h('dd', {}, u.mfa_enabled ? 'On' : 'Off'),
                h('dt', {}, 'Status'), h('dd', {}, locked ? `Locked until ${dateTime(u.locked_until)}` : label(u.status))),
            field('Name', name),
            h('div', { class: 'adm-field' }, h('span', { class: 'adm-field__label' }, 'Roles'), rc.el),
            h('div', { class: 'adm-actions' },
                locked ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => doAction(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { unlock: true } }), 'Account unlocked.') }, 'Unlock') : null,
                u.status === 'active' ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => {
                    try { const res = await api(`/api/admin/users/${u.id}/reset-link`, { method: 'POST' }); modal({ title: 'Password reset link', body: linkBox(res.link, `Send this one-time link to ${u.name} through a secure channel. It expires in ${res.expiresInMinutes} minutes.`) }); } catch (e) { alertHost.append(banner('error', e.message)); }
                } }, 'Create password reset link') : null,
                h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => {
                    if (await confirmAction({ title: 'Sign out everywhere?', message: `All of ${self ? 'your other' : `${u.name}’s`} sessions will end immediately.`, confirmLabel: 'Sign out sessions' })) doAction(() => api(`/api/admin/users/${u.id}/revoke-sessions`, { method: 'POST' }), 'Sessions revoked.');
                } }, 'Revoke sessions'),
                !self ? h('button', { class: `btn btn--${u.status === 'active' ? 'danger' : 'ghost'} btn--sm`, type: 'button', onclick: async () => {
                    const disabling = u.status === 'active';
                    if (!(await confirmAction({ title: disabling ? `Disable ${u.name}?` : `Re-enable ${u.name}?`, message: disabling ? 'They are signed out immediately and cannot sign in until re-enabled.' : 'They will be able to sign in again.', confirmLabel: disabling ? 'Disable' : 'Enable', danger: disabling }))) return;
                    if (await doAction(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: disabling ? 'disabled' : 'active' } }), disabling ? 'Administrator disabled.' : 'Administrator enabled.')) close();
                } }, u.status === 'active' ? 'Disable account' : 'Enable account') : null)),
        actions: [{ label: 'Cancel' }, { label: 'Save changes', kind: 'primary', onClick: async () => {
            const body = {};
            if (name.value.trim() !== u.name) body.name = name.value;
            const next = rc.value();
            if (next.slice().sort().join() !== u.roles.slice().sort().join()) body.roles = next;
            if (!Object.keys(body).length) return;
            return (await doAction(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body }), 'Administrator updated.')) ? undefined : false;
        } }],
    });
}
