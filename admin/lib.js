/**
 * SUSKII Admin — shared helpers.
 * DOM is built with h(); text is always set with textContent, so data from the API is never parsed as HTML.
 */

// ─── DOM ───
export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
}

export function append(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

const ICONS = {
    overview: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
    platforms: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    transactions: 'M7 7h14l-3-3M17 17H3l3 3',
    orders: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
    errands: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z',
    bookings: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
    customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    providers: 'M2 7h20v14H2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
    payments: 'M2 5h20v14H2zM2 10h20',
    commissions: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    refunds: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    finance: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    analytics: 'M3 3v18h18M7 16l4-4 4 4 5-6',
    notifications: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
    cms: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
    media: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
    inquiries: 'M4 4h16v16H4zM22 6l-10 7L2 6',
    careers: 'M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4v13h16zM12 12v.01',
    users: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    roles: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    integrations: 'M9 2v6M15 2v6M5 8h14v4a7 7 0 0 1-14 0zM12 19v3',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    menu: 'M3 6h18M3 12h18M3 18h18',
    collapse: 'M11 17l-5-5 5-5M18 17l-5-5 5-5',
    close: 'M18 6 6 18M6 6l12 12',
    alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    check: 'M20 6 9 17l-5-5',
    external: 'M7 7h10v10M7 17 17 7',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    plus: 'M12 5v14M5 12h14',
    trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    lock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

export function icon(name, cls = 'icon') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of (ICONS[name] ?? ICONS.info).split(/(?=M)/)) {
        const p = document.createElementNS(ns, 'path');
        p.setAttribute('d', d);
        svg.append(p);
    }
    return svg;
}

// ─── API ───
export class ApiError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

let currentSession = null;
/** The signed-in administrator (from /api/auth/me). UI hints only: the server enforces every permission. */
export const setSession = (me) => { currentSession = me; };
export const session = () => currentSession;
export const can = (perm) => !!currentSession?.permissions.includes(perm);

let csrfToken = '';
export const setCsrf = (t) => { csrfToken = t || ''; };
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...headers }, signal };
    if (method !== 'GET' && method !== 'HEAD') opts.headers['X-CSRF-Token'] = csrfToken;
    if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try {
        res = await fetch(path, opts);
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    }
    if (raw) return res;
    const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => ({})) : {};
    if (!res.ok) {
        const err = data.error ?? {};
        if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/mfa')) onUnauthorized();
        throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`, err.details);
    }
    return data;
}

// ─── Toasts, modals, confirm ───
let toastHost;
export function toast(message, kind = 'info', ms = 4200) {
    toastHost ??= document.body.appendChild(h('div', { class: 'adm-toasts', role: 'status', 'aria-live': 'polite' }));
    const t = h('div', { class: `adm-toast adm-toast--${kind}` }, message);
    toastHost.append(t);
    setTimeout(() => t.remove(), ms);
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
    const previous = document.activeElement;
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); previous?.focus?.(); onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: `adm-modal${wide ? ' adm-modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'adm-modal__head' }, h('h2', {}, title), h('button', { class: 'adm-iconbtn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
        body,
        actions.length ? h('div', { class: 'adm-modal__foot' }, actions.map((a) => h('button', {
            class: `btn ${a.kind === 'danger' ? 'btn--danger' : a.kind === 'primary' ? 'btn--dark' : 'btn--ghost'}`, type: 'button',
            onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { if ((await a.onClick?.(close)) !== false && a.close !== false) close(); } finally { btn.disabled = false; } },
        }, a.label))) : null);
    const backdrop = h('div', { class: 'adm-modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, box);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey);
    (box.querySelector('input, textarea, select, button.btn') ?? box).focus?.();
    return { close, box };
}

export function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false, requireText }) {
    return new Promise((resolve) => {
        let done = false;
        const input = requireText ? h('input', { class: 'adm-input', 'aria-label': `Type ${requireText} to confirm`, autocomplete: 'off' }) : null;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        modal({
            title,
            body: h('div', { class: 'adm-form' }, h('p', {}, message), requireText ? h('div', { class: 'adm-field' }, h('label', {}, `Type "${requireText}" to confirm`), input) : null),
            actions: [
                { label: 'Cancel', onClick: () => finish(false) },
                { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => {
                    if (requireText && input.value.trim() !== requireText) { toast(`Type "${requireText}" exactly to confirm.`, 'error'); return false; }
                    finish(true);
                } },
            ],
            onClose: () => finish(false),
        });
    });
}

// ─── Formatting ───
const EXP = { RWF: 0, UGX: 0, XOF: 0, XAF: 0, JPY: 0, KRW: 0 };
export const exponent = (c) => EXP[c] ?? 2;

export function money(minor, currency) {
    if (minor === null || minor === undefined || !currency) return '—';
    const major = minor / 10 ** exponent(currency);
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: exponent(currency), minimumFractionDigits: 0 }).format(major);
    } catch {
        return `${currency} ${major.toLocaleString('en-GB')}`;
    }
}

export function compactMoney(minor, currency) {
    const major = minor / 10 ** exponent(currency);
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(major);
    } catch {
        return `${currency} ${major.toLocaleString('en-GB')}`;
    }
}

export const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-GB'));
export const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

export function dateTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function ago(v) {
    if (!v) return 'never';
    const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
}

export const label = (s) => String(s ?? '').replace(/_/g, ' ');
export const pill = (status) => h('span', { class: `adm-pill adm-pill--${String(status ?? '').toLowerCase()}` }, label(status) || '—');

export const PLATFORM_LABEL = { marketplace: 'Marketplace', errands: 'Errands', travel_tour: 'Travel & Tours' };
export const PLATFORM_COLOR = { marketplace: '#E8461E', errands: '#0E9F8E', travel_tour: '#4F46E5' };
export const STATE_LABEL = {
    not_configured: 'Not Configured', disconnected: 'Disconnected', connecting: 'Connecting', connected: 'Connected',
    degraded: 'Degraded', sync_failed: 'Synchronization Failed', demo: 'Demo Mode',
};
export const stateBadge = (state) => h('span', { class: `adm-state adm-state--${state}` }, STATE_LABEL[state] ?? label(state));

export function platformChip(p) {
    const tile = { marketplace: 'market', errands: 'errands', travel_tour: 'travel' }[p] ?? 'market';
    return h('span', { class: 'adm-tags' }, h('span', { class: 'adm-tag', style: { borderColor: PLATFORM_COLOR[p], color: PLATFORM_COLOR[p] }, 'data-tile': tile }, PLATFORM_LABEL[p] ?? p));
}

// ─── Small UI pieces ───
export function banner(kind, text) {
    return h('div', { class: `adm-banner adm-banner--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert'), h('div', {}, text));
}

export function empty(title, text, iconName = 'inbox') {
    return h('div', { class: 'adm-empty' }, icon(iconName), h('strong', {}, title), text ? h('p', {}, text) : null);
}

export function errorState(err, retry) {
    return h('div', { class: 'adm-card' }, banner('error', err?.message ?? 'Something went wrong.'), retry ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: retry }, icon('refresh', 'icon icon--sm'), 'Try again') : null);
}

export const skeleton = (cls, n = 1) => Array.from({ length: n }, () => h('div', { class: `adm-skel ${cls}`, 'aria-hidden': 'true' }));

export function field(labelText, control, { help, error, id } = {}) {
    const fid = id ?? `f-${Math.random().toString(36).slice(2, 9)}`;
    if (control instanceof HTMLElement && !control.id) control.id = fid;
    return h('div', { class: `adm-field${error ? ' adm-field--invalid' : ''}` },
        h('label', { for: control.id || fid }, labelText), control,
        help ? h('small', {}, help) : null, error ? h('span', { class: 'adm-error' }, error) : null);
}

export function table(columns, rows, { onRowClick, emptyState } = {}) {
    if (!rows.length) return emptyState ?? empty('Nothing to show', 'Try changing the filters.');
    return h('div', { class: 'adm-table-wrap' },
        h('table', { class: 'adm-table' },
            h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '', scope: 'col' }, c.label)))),
            h('tbody', {}, rows.map((r) => h('tr', { class: onRowClick ? 'is-clickable' : '', tabindex: onRowClick ? 0 : null,
                onclick: onRowClick ? () => onRowClick(r) : null, onkeydown: onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : null },
            columns.map((c) => {
                const v = c.render ? c.render(r) : r[c.key];
                return h('td', { class: [c.num ? 'num' : '', c.mono ? 'mono' : '', c.muted ? 'muted' : ''].join(' ') }, v ?? '—');
            }))))));
}

export function pager({ page, pageSize, total, onPage }) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return h('div', { class: 'adm-pager' },
        h('span', {}, total ? `${num((page - 1) * pageSize + 1)}–${num(Math.min(total, page * pageSize))} of ${num(total)}` : '0 results'),
        h('div', { class: 'adm-actions' },
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: page <= 1, onclick: () => onPage(page - 1) }, 'Previous'),
            h('span', {}, `Page ${page} of ${pages}`),
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: page >= pages, onclick: () => onPage(page + 1) }, 'Next')));
}

export function downloadCsv(filename, columns, rows) {
    const escCell = (v) => {
        let s = String(v ?? '');
        if (/^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [columns.map((c) => escCell(c.label)).join(','), ...rows.map((r) => columns.map((c) => escCell(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
