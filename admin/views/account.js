/** The signed-in administrator's own security: password, two-factor authentication and sessions. */
import { api, banner, clear, confirmAction, dateTime, errorState, field, h, modal, session, table, toast } from '../lib.js';
import { pageHead } from './common.js';

export async function render(root, ctx) {
    const me = session();
    const reason = ctx.query().get('mfa');
    root.append(pageHead('My account', `${me.user.name} · ${me.user.email}`));
    if (reason === 'required' || me.mfaEnrollmentRequired) root.append(banner('warn', 'Your role requires two-factor authentication. Set it up below to continue using the admin.'));
    if (reason === 'recommended' && !me.user.mfaEnabled) root.append(banner('info', 'Welcome. As a Super Admin, please turn on two-factor authentication now.'));

    const grid = h('div', { class: 'adm-grid adm-grid--2' });
    root.append(grid);
    grid.append(passwordCard(), mfaCard(me, ctx));
    const sessions = h('section', { class: 'adm-card adm-section-gap' });
    root.append(sessions);
    await sessionsCard(sessions);
}

function passwordCard() {
    const current = h('input', { class: 'adm-input', type: 'password', autocomplete: 'current-password' });
    const next = h('input', { class: 'adm-input', type: 'password', autocomplete: 'new-password', minlength: 12 });
    const again = h('input', { class: 'adm-input', type: 'password', autocomplete: 'new-password' });
    const alertHost = h('div', {});
    const form = h('form', { class: 'adm-form' }, alertHost, field('Current password', current),
        field('New password', next, { help: 'At least 12 characters, using three of: lowercase, uppercase, numbers, symbols. Not your email address.' }),
        field('Confirm new password', again), h('div', { class: 'adm-actions' }, h('button', { class: 'btn btn--dark btn--sm', type: 'submit' }, 'Change password')));
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clear(alertHost);
        if (next.value !== again.value) { alertHost.append(banner('error', 'The new passwords do not match.')); return; }
        try {
            await api('/api/auth/password/change', { method: 'POST', body: { current: current.value, next: next.value } });
            current.value = next.value = again.value = '';
            alertHost.append(banner('ok', 'Password changed. Your other sessions were signed out.'));
        } catch (err) { alertHost.append(banner('error', err.message)); }
    });
    return h('section', { class: 'adm-card' }, h('div', { class: 'adm-card__head' }, h('h2', {}, 'Password')), form);
}

function mfaCard(me, ctx) {
    const card = h('section', { class: 'adm-card' });
    const draw = () => {
        clear(card).append(h('div', { class: 'adm-card__head' }, h('h2', {}, 'Two-factor authentication'),
            h('span', { class: `adm-state adm-state--${me.user.mfaEnabled ? 'connected' : 'not_configured'}` }, me.user.mfaEnabled ? 'On' : 'Off')));
        if (me.user.mfaEnabled) {
            card.append(h('p', {}, 'Signing in requires a code from your authenticator app, or one of your recovery codes.'),
                h('div', { class: 'adm-actions adm-section-gap' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: disable }, 'Turn off two-factor')));
        } else {
            card.append(h('p', {}, 'Protect your account with a 6-digit code from an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.'),
                h('div', { class: 'adm-actions adm-section-gap' }, h('button', { class: 'btn btn--dark btn--sm', type: 'button', onclick: setup }, 'Set up two-factor')));
        }
    };
    const setup = async () => {
        let res;
        try { res = await api('/api/auth/mfa/setup', { method: 'POST' }); } catch (e) { toast(e.message, 'error'); return; }
        const code = h('input', { class: 'adm-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8 });
        const alertHost = h('div', {});
        modal({
            title: 'Set up two-factor authentication',
            body: h('div', { class: 'adm-form' },
                h('p', {}, '1. Scan this QR code with your authenticator app.'),
                h('img', { src: res.qr, alt: 'QR code for your authenticator app', width: 220, height: 220, style: { margin: '0 auto', border: '1px solid var(--line)', borderRadius: '12px' } }),
                h('details', {}, h('summary', {}, 'Can’t scan? Enter this key instead'), h('code', { class: 'adm-code', style: { display: 'block', marginTop: '6px' } }, res.secret)),
                h('p', {}, '2. Enter the 6-digit code it shows.'), alertHost, field('Code', code)),
            actions: [{ label: 'Cancel' }, { label: 'Turn on', kind: 'primary', onClick: async (close) => {
                clear(alertHost);
                try {
                    const out = await api('/api/auth/mfa/enable', { method: 'POST', body: { code: code.value.replace(/\s/g, '') } });
                    me.user.mfaEnabled = true;
                    me.mfaEnrollmentRequired = false;
                    close();
                    showRecovery(out.recoveryCodes);
                    draw();
                    return false;
                } catch (e) { alertHost.append(banner('error', e.message)); return false; }
            } }],
        });
    };
    const disable = async () => {
        const pw = h('input', { class: 'adm-input', type: 'password', autocomplete: 'current-password' });
        const alertHost = h('div', {});
        modal({
            title: 'Turn off two-factor authentication?',
            body: h('div', { class: 'adm-form' }, banner('warn', 'Your account will be protected by your password only. If your role requires two-factor authentication you will be asked to set it up again.'), alertHost, field('Confirm with your password', pw)),
            actions: [{ label: 'Cancel' }, { label: 'Turn off', kind: 'danger', onClick: async () => {
                try { await api('/api/auth/mfa/disable', { method: 'POST', body: { password: pw.value } }); me.user.mfaEnabled = false; toast('Two-factor authentication turned off.', 'ok'); draw(); if (me.privileged) location.reload(); } catch (e) { clear(alertHost).append(banner('error', e.message)); return false; }
            } }],
        });
    };
    draw();
    return card;
}

function showRecovery(codes) {
    const text = codes.join('\n');
    modal({
        title: 'Save your recovery codes',
        body: h('div', { class: 'adm-form' },
            banner('warn', 'Each code lets you sign in once if you lose your phone. They are shown only now — store them in a password manager.'),
            h('pre', { class: 'adm-code', style: { fontSize: '1rem', letterSpacing: '.05em' } }, text),
            h('div', { class: 'adm-actions' },
                h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Copied.', 'ok')) }, 'Copy codes'))),
        actions: [{ label: 'I have saved them', kind: 'primary', onClick: () => { toast('Two-factor authentication is on.', 'ok'); if (location.search.includes('mfa=required')) location.assign('/admin/overview'); } }],
    });
}

async function sessionsCard(card) {
    clear(card).append(h('div', { class: 'adm-card__head' }, h('div', {}, h('h2', {}, 'Active sessions'), h('p', {}, 'Devices currently signed in to your account.'))));
    let data;
    try { data = await api('/api/auth/sessions'); } catch (e) { card.append(errorState(e)); return; }
    card.append(table([
        { label: 'Device', render: (s) => h('span', { title: s.user_agent ?? '' }, describeAgent(s.user_agent), s.current ? h('strong', {}, ' · this device') : null) },
        { label: 'IP address', key: 'ip', mono: true, muted: true },
        { label: 'Signed in', render: (s) => dateTime(s.created_at) },
        { label: 'Last active', render: (s) => dateTime(s.last_seen_at) },
        { label: '', render: (s) => (s.current ? '' : h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async (e) => {
            e.stopPropagation();
            if (!(await confirmAction({ title: 'Sign out this device?', message: 'It will need to sign in again.', confirmLabel: 'Sign out' }))) return;
            try { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }); toast('Session ended.', 'ok'); sessionsCard(card); } catch (err) { toast(err.message, 'error'); }
        } }, 'Sign out')) },
    ], data.sessions));
}

function describeAgent(ua = '') {
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} on ${os}` : browser;
}
