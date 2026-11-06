/** Organisation and security settings, plus a read-only view of how this deployment is configured. */
import { api, banner, clear, dateTime, errorState, field, h, skeleton, toast } from '../lib.js';
import { pageHead } from './common.js';

export async function render(root, ctx) {
    root.append(pageHead('Settings', 'Organisation details, security policy and deployment status.'));
    const body = h('div', {}, skeleton('adm-skel--chart'));
    root.append(body);
    let data;
    try { data = await api('/api/admin/settings'); } catch (e) { clear(body).append(errorState(e)); return; }
    if (!ctx.isCurrent()) return;
    clear(body);
    const manage = ctx.can('settings.manage');
    const { general, security } = data.settings;

    const org = h('input', { class: 'adm-input', value: general.organisationName, maxlength: 80, disabled: !manage });
    const support = h('input', { class: 'adm-input', type: 'email', value: general.supportEmail, maxlength: 254, disabled: !manage });
    const tz = h('select', { class: 'adm-select', disabled: !manage }, ['UTC', 'Africa/Kigali', 'Africa/Lagos'].map((z) => h('option', { value: z, selected: z === general.reportingTimezone }, z)));
    const save = (key, value, btn) => async () => {
        btn.disabled = true;
        try { await api(`/api/admin/settings/${key}`, { method: 'PUT', body: value() }); toast('Settings saved.', 'ok'); } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = !manage; }
    };
    const saveGeneral = h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: !manage }, 'Save');
    saveGeneral.addEventListener('click', save('general', () => ({ organisationName: org.value, supportEmail: support.value, reportingTimezone: tz.value }), saveGeneral));

    const idle = h('input', { class: 'adm-input', type: 'number', min: 5, max: 480, value: security.idleMinutes, disabled: !manage });
    const mfa = h('input', { type: 'checkbox', checked: security.requireMfaForPrivileged, disabled: !manage });
    const saveSecurity = h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: !manage }, 'Save');
    saveSecurity.addEventListener('click', save('security', () => ({ idleMinutes: Number(idle.value), requireMfaForPrivileged: mfa.checked }), saveSecurity));

    const env = data.environment;
    const yes = (v, okText = 'Configured', noText = 'Not configured') => h('span', { class: `adm-state adm-state--${v ? 'connected' : 'not_configured'}` }, v ? okText : noText);

    body.append(h('div', { class: 'adm-grid adm-grid--2' },
        h('section', { class: 'adm-card' }, h('div', { class: 'adm-card__head' }, h('h2', {}, 'Organisation')),
            h('div', { class: 'adm-form' }, field('Organisation name', org), field('Support email', support),
                field('Reporting time zone', tz, { help: 'Dashboards currently report in UTC; this records the preferred zone for exports and future reports.' }),
                h('div', { class: 'adm-actions' }, saveGeneral))),
        h('section', { class: 'adm-card' }, h('div', { class: 'adm-card__head' }, h('h2', {}, 'Security policy')),
            h('div', { class: 'adm-form' },
                field('Sign out after inactivity (minutes)', idle, { help: 'Sessions also end 12 hours after sign-in regardless of activity.' }),
                h('label', { class: 'adm-check' }, mfa, 'Require two-factor authentication for privileged roles'),
                h('small', { class: 'adm-kpi__hint' }, 'When on, administrators with privileged roles must set up two-factor authentication before they can use the admin.'),
                h('div', { class: 'adm-actions' }, saveSecurity)))));

    body.append(h('section', { class: 'adm-card adm-section-gap' }, h('div', { class: 'adm-card__head' }, h('h2', {}, 'Deployment'), h('p', {}, 'Read-only. These are set as server environment variables (see docs/DEPLOYMENT.md).')),
        h('dl', { class: 'adm-kv' },
            h('dt', {}, 'Environment'), h('dd', {}, env.appEnv),
            h('dt', {}, 'Public site address'), h('dd', {}, env.siteOrigin),
            h('dt', {}, 'Database'), h('dd', {}, yes(env.database)),
            h('dt', {}, 'File storage (media, CVs)'), h('dd', {}, yes(env.storage)),
            h('dt', {}, 'Outgoing email'), h('dd', {}, yes(env.email, 'Configured', 'Not configured — reset and invite links are shown to Super Admins instead')),
            h('dt', {}, 'Website rebuild hook'), h('dd', {}, yes(env.deployHook, 'Configured', 'Not configured — published content goes live on the next deployment')),
            h('dt', {}, 'Last website rebuild'), h('dd', {}, data.lastRebuild ? `${dateTime(data.lastRebuild.at)} · ${data.lastRebuild.reason ?? ''}` : 'Never')),
        !env.storage && env.appEnv === 'production' ? banner('warn', 'Uploads and CV submissions are disabled until BLOB_READ_WRITE_TOKEN is configured.') : null));
}
