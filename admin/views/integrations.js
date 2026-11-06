/**
 * Integrations: connect each platform independently. Credentials are write-only — the browser only ever
 * sees whether a value is set and where it comes from. A platform shows "Connected" only after a real
 * health check succeeds against its API.
 */
import { api, ago, append, banner, clear, confirmAction, dateTime, errorState, field, h, icon, label, pill, PLATFORM_LABEL, skeleton, stateBadge, table, toast } from '../lib.js';
import { pageHead } from './common.js';

const PLATFORMS = ['marketplace', 'errands', 'travel_tour'];
const SOURCE = { environment: 'Server environment variable', admin: 'Saved in the admin (encrypted)', none: 'Not set' };

export async function render(root, ctx) {
    root.append(pageHead('Integrations', 'Connect SUSKII Marketplace, Errands and Travel & Tours to the central admin. Each platform keeps its own database.'));
    const body = h('div', {}, skeleton('adm-skel--chart'));
    root.append(body);
    let data;
    try { data = await api('/api/integrations'); } catch (e) { clear(body).append(errorState(e)); return; }
    if (!ctx.isCurrent()) return;
    clear(body);
    const selected = PLATFORMS.includes(ctx.query().get('platform')) ? ctx.query().get('platform') : null;

    // Overview cards
    body.append(h('div', { class: 'adm-grid adm-grid--3' }, data.integrations.map((i) => h('button', {
        type: 'button', class: 'adm-card adm-plat', style: { textAlign: 'left', outline: i.platform === selected ? '2px solid var(--ink)' : null },
        onclick: () => ctx.setQuery({ platform: i.platform }), 'aria-pressed': String(i.platform === selected),
    },
    h('div', { class: 'adm-plat__head' }, h('strong', {}, i.name)), h('div', {}, stateBadge(i.state)),
    h('dl', { class: 'adm-plat__meta' }, h('dt', {}, 'Mode'), h('dd', {}, label(i.mode)), h('dt', {}, 'Status'), h('dd', {}, i.reason),
        h('dt', {}, 'Last sync'), h('dd', {}, i.lastSyncOkAt ? ago(i.lastSyncOkAt) : 'Never'))))));

    if (!selected) {
        body.append(h('div', { class: 'adm-card adm-section-gap' }, h('p', {}, 'Choose a platform above to configure it.'),
            h('p', { class: 'adm-kpi__hint' }, 'The endpoints listed for each platform are proposed contracts. Confirm them with each platform team before switching to live.')));
        return;
    }
    const i = data.integrations.find((x) => x.platform === selected);
    const manage = ctx.can('integrations.manage');
    const panel = h('div', { class: 'adm-section-gap' });
    body.append(panel);
    renderPanel(panel, i, data, ctx, manage);
}

function renderPanel(panel, i, data, ctx, manage) {
    clear(panel);
    const replace = (next) => { const idx = data.integrations.findIndex((x) => x.platform === next.platform); data.integrations[idx] = next; ctx.navigate(location.pathname + location.search, { replace: true }); };
    const tabs = [['status', 'Status'], ['config', 'Configuration'], ['secrets', 'Credentials'], ['webhooks', 'Webhooks'], ['history', 'Sync & event history']];
    const current = tabs.some(([k]) => k === ctx.query().get('tab')) ? ctx.query().get('tab') : 'status';
    panel.append(h('div', { class: 'adm-tabs', role: 'tablist' }, tabs.map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === current), onclick: () => ctx.setQuery({ tab: k === 'status' ? null : k }) }, t))));
    const host = h('div', { class: 'adm-card', role: 'tabpanel' });
    panel.append(host);
    ({ status: statusTab, config: configTab, secrets: secretsTab, webhooks: webhookTab, history: historyTab })[current](host, i, data, ctx, manage, replace);
}

function statusTab(host, i, data, ctx, manage, replace) {
    const out = h('div', {});
    const run = async (btn, path, done) => {
        btn.disabled = true;
        clear(out);
        try { const res = await api(`/api/integrations/${i.platform}/${path}`, { method: 'POST' }); done(res); replace(res.integration); } catch (e) { out.append(banner('error', e.message)); } finally { btn.disabled = false; }
    };
    const testBtn = h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: !manage || i.mode === 'not_configured' }, 'Test connection');
    testBtn.addEventListener('click', () => run(testBtn, 'test', (res) => toast(res.result.ok ? `Connection OK (${res.result.latencyMs} ms)` : `Connection failed: ${res.result.message}`, res.result.ok ? 'ok' : 'error', 7000)));
    const syncBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !ctx.can('integrations.sync') || i.mode !== 'live' }, icon('refresh', 'icon icon--sm'), 'Synchronise now');
    syncBtn.addEventListener('click', () => run(syncBtn, 'sync', (res) => toast(`${label(res.summary.status)}: ${res.summary.message}`, res.summary.status === 'succeeded' ? 'ok' : res.summary.status === 'failed' ? 'error' : 'info', 8000)));
    append(host, [
        h('div', { class: 'adm-card__head' }, h('div', {}, h('h2', {}, i.name), h('p', {}, i.reason)), stateBadge(i.state)),
        i.mode === 'demo' ? h('div', { class: 'adm-banner adm-banner--demo' }, h('span', { class: 'adm-demo-chip' }, 'DEMO MODE'), h('div', {}, 'This platform shows synthetic data so the admin can be evaluated. It is labelled everywhere and never mixed with live figures.')) : null,
        i.mode === 'not_configured' ? banner('info', 'Not configured. Add the API base URL and credentials under Configuration and Credentials, then switch the mode to Live.') : null,
        h('dl', { class: 'adm-kv' },
            h('dt', {}, 'Mode'), h('dd', {}, label(i.mode)),
            h('dt', {}, 'Enabled'), h('dd', {}, i.enabled ? 'Yes' : 'No'),
            h('dt', {}, 'API base URL'), h('dd', {}, i.apiUrl || 'Not set', i.apiUrl ? h('small', { class: 'adm-kpi__hint' }, ` · ${SOURCE[i.apiUrlSource]}`) : null),
            h('dt', {}, 'Authentication'), h('dd', {}, label(i.authType), i.authType === 'api_key_header' ? ` (${i.authHeader})` : ''),
            h('dt', {}, 'API credential'), h('dd', {}, i.credential.set ? `${SOURCE[i.credential.source]} · ${i.credential.hint}` : 'Not set'),
            h('dt', {}, 'Webhook secret'), h('dd', {}, i.webhookSecret.set ? `${SOURCE[i.webhookSecret.source]} · ${i.webhookSecret.hint}` : 'Not set'),
            h('dt', {}, 'Last health check'), h('dd', {}, i.lastHealthAt ? `${dateTime(i.lastHealthAt)} · ${i.lastHealthOk ? 'OK' : 'Failed'}${i.lastHealthMessage ? ` · ${i.lastHealthMessage}` : ''}` : 'Never'),
            h('dt', {}, 'Last sync attempt'), h('dd', {}, dateTime(i.lastSyncAt)),
            h('dt', {}, 'Last successful sync'), h('dd', {}, dateTime(i.lastSyncOkAt)),
            h('dt', {}, 'Sync interval'), h('dd', {}, `${i.syncIntervalMinutes} minutes (runs on the scheduled job)`),
            h('dt', {}, 'Provides'), h('dd', {}, h('div', { class: 'adm-tags' }, i.capabilities.map((c) => h('span', { class: 'adm-tag' }, label(c)))))),
        h('div', { class: 'adm-actions adm-section-gap' }, testBtn, syncBtn, !manage ? h('small', { class: 'adm-kpi__hint' }, 'You can view integrations but not change them.') : null),
        out]);
}

function configTab(host, i, data, ctx, manage, replace) {
    const contract = data.contracts[i.platform];
    const mode = h('select', { class: 'adm-select', disabled: !manage },
        [['not_configured', 'Not configured'], ['live', 'Live (real platform API)'], ...(data.demoAllowed || i.mode === 'demo' ? [['demo', 'Demo (synthetic data, clearly labelled)']] : [])]
            .map(([v, t]) => h('option', { value: v, selected: v === i.mode }, t)));
    const enabled = h('input', { type: 'checkbox', checked: i.enabled, disabled: !manage });
    const envUrl = i.apiUrlSource === 'environment';
    const apiUrl = h('input', { class: 'adm-input', type: 'url', placeholder: 'https://api.example.com/v1', value: envUrl ? '' : i.apiUrl, disabled: !manage || envUrl });
    const authType = h('select', { class: 'adm-select', disabled: !manage }, [['bearer', 'Bearer token'], ['api_key_header', 'API key header'], ['basic', 'Basic (user:password)'], ['none', 'None']].map(([v, t]) => h('option', { value: v, selected: v === i.authType }, t)));
    const authHeader = h('input', { class: 'adm-input', value: i.authHeader, maxlength: 60, disabled: !manage });
    const timeout = h('input', { class: 'adm-input', type: 'number', min: 2000, max: 30000, step: 500, value: i.timeoutMs, disabled: !manage });
    const interval = h('input', { class: 'adm-input', type: 'number', min: 15, max: 1440, value: i.syncIntervalMinutes, disabled: !manage });
    const eps = Object.fromEntries(Object.entries(contract.endpoints).map(([res, path]) => [res, h('input', { class: 'adm-input', value: i.overrides?.endpoints?.[res] ?? '', placeholder: path, disabled: !manage, 'aria-label': `${label(res)} endpoint` })]));
    const health = h('input', { class: 'adm-input', value: i.overrides?.healthPath ?? '', placeholder: contract.healthPath, disabled: !manage });
    const pagStyle = h('select', { class: 'adm-select', disabled: !manage }, [['', `Default (${contract.pagination.style})`], ['cursor', 'Cursor'], ['page', 'Page number']].map(([v, t]) => h('option', { value: v, selected: (i.overrides?.pagination?.style ?? '') === v }, t)));
    const alertHost = h('div', {});
    const save = h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: !manage }, 'Save configuration');
    save.addEventListener('click', async () => {
        clear(alertHost);
        const endpoints = Object.fromEntries(Object.entries(eps).filter(([, el]) => el.value.trim()).map(([k, el]) => [k, el.value.trim()]));
        const overrides = { ...(Object.keys(endpoints).length ? { endpoints } : {}), ...(health.value.trim() ? { healthPath: health.value.trim() } : {}), ...(pagStyle.value ? { pagination: { style: pagStyle.value } } : {}) };
        if (mode.value === 'demo' && !(await confirmAction({ title: 'Use demo mode?', message: 'Demo mode shows synthetic figures labelled DEMO MODE. They must never be presented as actual company performance.', confirmLabel: 'Use demo mode' }))) return;
        save.disabled = true;
        try {
            const res = await api(`/api/integrations/${i.platform}`, { method: 'PUT', body: {
                mode: mode.value, enabled: enabled.checked, apiUrl: envUrl ? '' : apiUrl.value.trim(), authType: authType.value, authHeader: authHeader.value.trim() || 'X-API-Key',
                timeoutMs: Number(timeout.value), syncIntervalMinutes: Number(interval.value), overrides,
            } });
            toast('Configuration saved. Run “Test connection” to verify it.', 'ok');
            replace(res.integration);
        } catch (e) { alertHost.append(banner('error', e.message)); save.disabled = false; }
    });
    host.append(h('div', { class: 'adm-form' }, alertHost,
        field('Mode', mode, { help: data.demoAllowed ? 'Live connects to the real platform API. Demo is for evaluation only.' : 'Demo mode is disabled on this production deployment.' }),
        h('label', { class: 'adm-check' }, enabled, 'Integration enabled'),
        field('API base URL', apiUrl, { help: envUrl ? `Set by the server environment variable (${i.apiUrl}); change it there.` : 'Must use https://. The server environment variable takes precedence if set.' }),
        h('div', { class: 'adm-grid adm-grid--2' }, field('Authentication', authType), field('API key header name', authHeader, { help: 'Only used with “API key header”.' })),
        h('div', { class: 'adm-grid adm-grid--2' }, field('Request timeout (ms)', timeout), field('Sync interval (minutes)', interval)),
        h('details', {}, h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'Advanced: endpoint paths'),
            h('div', { class: 'adm-form', style: { marginTop: '12px' } },
                banner('info', 'These are the proposed contract paths. Leave a field empty to use the default shown. Paths are relative to the base URL.'),
                field('Health check path', health), field('Pagination', pagStyle),
                h('div', { class: 'adm-grid adm-grid--2' }, Object.entries(eps).map(([res, el]) => field(`${label(res)} endpoint`, el))))),
        h('div', { class: 'adm-actions' }, save)));
}

function secretsTab(host, i, data, ctx, manage, replace) {
    const cred = h('input', { class: 'adm-input', type: 'password', autocomplete: 'new-password', placeholder: i.credential.set ? 'Enter a new value to replace the current one' : 'Paste the API token or key', disabled: !manage || i.credential.source === 'environment' });
    const hook = h('input', { class: 'adm-input', type: 'password', autocomplete: 'new-password', placeholder: 'At least 24 characters', disabled: !manage || i.webhookSecret.source === 'environment' });
    const alertHost = h('div', {});
    const send = async (body, msg) => {
        clear(alertHost);
        try { const res = await api(`/api/integrations/${i.platform}/secrets`, { method: 'PUT', body }); cred.value = ''; hook.value = ''; toast(msg, 'ok'); replace(res.integration); } catch (e) { alertHost.append(banner('error', e.message)); }
    };
    const generate = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !manage || i.webhookSecret.source === 'environment', onclick: () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        hook.type = 'text';
        hook.value = `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
        toast('Secret generated. Save it, then share it with the platform team through a secure channel. It will not be shown again.', 'info', 9000);
    } }, 'Generate secret');
    host.append(h('div', { class: 'adm-form' },
        banner('info', 'Secrets are encrypted on the server and never sent back to the browser. For production, prefer server environment variables (see docs/INTEGRATIONS.md); they take precedence over values saved here.'),
        alertHost,
        h('h3', { style: { fontSize: '1rem' } }, 'API credential'),
        h('p', { class: 'adm-kpi__hint' }, `Current: ${i.credential.set ? `${SOURCE[i.credential.source]} (${i.credential.hint})` : 'not set'}. For Basic auth use “username:password”.`),
        field('New credential', cred),
        h('div', { class: 'adm-actions' },
            h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: !manage || i.credential.source === 'environment', onclick: () => { if (!cred.value) return toast('Enter a value first.', 'error'); send({ credential: cred.value }, 'Credential saved.'); } }, 'Save credential'),
            i.credential.source === 'admin' ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !manage, onclick: async () => { if (await confirmAction({ title: 'Remove the saved credential?', message: 'Live synchronisation stops until a new credential is set.', confirmLabel: 'Remove', danger: true })) send({ clear: 'credential' }, 'Credential removed.'); } }, 'Remove') : null),
        h('h3', { style: { fontSize: '1rem', marginTop: '8px' } }, 'Webhook signing secret'),
        h('p', { class: 'adm-kpi__hint' }, `Current: ${i.webhookSecret.set ? `${SOURCE[i.webhookSecret.source]} (${i.webhookSecret.hint})` : 'not set — webhooks from this platform are rejected'}.`),
        field('New webhook secret', hook),
        h('div', { class: 'adm-actions' }, generate,
            h('button', { class: 'btn btn--dark btn--sm', type: 'button', disabled: !manage || i.webhookSecret.source === 'environment', onclick: () => { if (!hook.value) return toast('Enter or generate a secret first.', 'error'); send({ webhookSecret: hook.value }, 'Webhook secret saved.'); } }, 'Save webhook secret'),
            i.webhookSecret.source === 'admin' ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: !manage, onclick: async () => { if (await confirmAction({ title: 'Remove the webhook secret?', message: 'Incoming webhooks from this platform will be rejected.', confirmLabel: 'Remove', danger: true })) send({ clear: 'webhookSecret' }, 'Webhook secret removed.'); } }, 'Remove') : null)));
}

function webhookTab(host, i, data) {
    const url = data.webhook.urlTemplate.replace('{platform}', i.platform);
    const supported = data.webhook.events.filter((e) => {
        const res = { user: 'users', order: 'orders', request: 'requests', booking: 'bookings', payment: 'payments', refund: 'refunds', dispute: 'disputes', commission: 'commissions' }[e.split('.')[0]];
        return i.capabilities.includes(res);
    });
    host.append(h('div', { class: 'adm-form' },
        h('p', {}, `Give the ${PLATFORM_LABEL[i.platform]} team these details so their platform can push changes in real time. Until webhooks are live, data arrives through scheduled synchronisation.`),
        field('Endpoint', h('input', { class: 'adm-input', readonly: true, value: url, onfocus: (e) => e.target.select() })),
        h('pre', { class: 'adm-code' }, `POST ${url}
Content-Type: application/json
X-Suskii-Timestamp: <unix seconds>
X-Suskii-Signature: v1=<hex HMAC-SHA256(webhook_secret, "<timestamp>.<raw body>")>

{ "id": "evt_123", "type": "payment.completed", "created_at": "2026-01-01T12:00:00Z", "data": { ...record... } }`),
        h('ul', { style: { paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '.875rem' } },
            h('li', {}, `Requests older or newer than ${data.webhook.toleranceSeconds / 60} minutes are rejected (replay protection).`),
            h('li', {}, 'Each event id is processed once; repeats are acknowledged with 200 but ignored.'),
            h('li', {}, 'Several signatures may be sent comma-separated during secret rotation.'),
            h('li', {}, 'Responses: 202 accepted · 200 duplicate (ignored) · 400 malformed or unknown event · 401 bad signature or timestamp · 409 platform not in live mode · 413 body over 512 KB · 422 event not applicable to this platform · 503 secret not configured.')),
        h('div', {}, h('div', { class: 'adm-kpi__label', style: { marginBottom: '6px' } }, 'Events accepted from this platform'), h('div', { class: 'adm-tags' }, supported.map((e) => h('span', { class: 'adm-tag', style: { fontFamily: 'ui-monospace, monospace' } }, e))))));
}

async function historyTab(host, i) {
    host.append(skeleton('adm-skel--row', 6));
    let hist;
    try { hist = await api(`/api/integrations/${i.platform}/history`); } catch (e) { clear(host).append(errorState(e)); return; }
    clear(host);
    const section = (title, cols, rows) => h('div', { class: 'adm-section-gap' }, h('h3', { style: { fontSize: '.95rem', marginBottom: '8px' } }, title), table(cols, rows));
    host.append(
        section('Synchronisation jobs', [
            { label: 'Started', render: (r) => dateTime(r.started_at) }, { label: 'Resource', render: (r) => label(r.resource) }, { label: 'Trigger', key: 'trigger' },
            { label: 'Status', render: (r) => pill(r.status) }, { label: 'Fetched', key: 'records_fetched', num: true }, { label: 'Stored', key: 'records_upserted', num: true },
            { label: 'Error', render: (r) => r.error ?? '—', muted: true }], hist.jobs),
        section('Webhook deliveries', [
            { label: 'Received', render: (r) => dateTime(r.received_at) }, { label: 'Event', key: 'event_type', mono: true }, { label: 'Event id', key: 'event_id', mono: true, muted: true },
            { label: 'Signature', render: (r) => (r.signature_valid ? 'Valid' : 'Invalid') }, { label: 'Outcome', render: (r) => pill(r.outcome) }, { label: 'HTTP', key: 'http_status', num: true },
            { label: 'Reason', render: (r) => r.reason ?? '—', muted: true }], hist.deliveries),
        section('Processed events', [
            { label: 'Received', render: (r) => dateTime(r.received_at) }, { label: 'Event', key: 'event_type', mono: true }, { label: 'Status', render: (r) => pill(r.status) },
            { label: 'Attempts', key: 'attempts', num: true }, { label: 'Processed', render: (r) => dateTime(r.processed_at) }, { label: 'Error', render: (r) => r.error ?? '—', muted: true }], hist.events),
        h('details', { class: 'adm-section-gap' }, h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, `Log (${hist.logs.length})`),
            h('pre', { class: 'adm-code', style: { maxHeight: '320px', overflow: 'auto' } }, hist.logs.map((l) => `${dateTime(l.at)}  ${l.level.toUpperCase().padEnd(5)}  ${l.message}`).join('\n') || 'No log entries.')));
}


