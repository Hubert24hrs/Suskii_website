/**
 * SUSKII Admin — application shell: routing, layout, session handling and global filters.
 * All authorisation is enforced by the server; the navigation only hides what a role cannot use.
 */
import { api, ApiError, banner, clear, h, icon, setCsrf, setSession, setUnauthorizedHandler, toast, ago, can } from './lib.js';

const NAV = [
    { group: 'Operations' },
    { path: '/admin/overview', label: 'Overview', icon: 'overview', perm: 'overview.read', view: 'overview' },
    { path: '/admin/platforms', label: 'Platform Management', icon: 'platforms', perm: 'overview.read', view: 'platforms' },
    { path: '/admin/transactions', label: 'Transactions', icon: 'transactions', perm: 'finance.read', view: 'records', resource: 'transactions' },
    { path: '/admin/orders', label: 'Orders', icon: 'orders', platformPerm: 'marketplace', view: 'records', resource: 'orders' },
    { path: '/admin/errands', label: 'Errands', icon: 'errands', platformPerm: 'errands', view: 'records', resource: 'requests' },
    { path: '/admin/bookings', label: 'Travel & Bookings', icon: 'bookings', platformPerm: 'travel_tour', view: 'records', resource: 'bookings' },
    { path: '/admin/customers', label: 'Customers', icon: 'customers', anyPlatform: true, view: 'records', resource: 'users' },
    { path: '/admin/providers', label: 'Sellers & Providers', icon: 'providers', anyPlatform: true, view: 'records', resource: 'providers' },
    { group: 'Finance' },
    { path: '/admin/payments', label: 'Payments', icon: 'payments', perm: 'finance.read', view: 'records', resource: 'payments' },
    { path: '/admin/commissions', label: 'Commissions', icon: 'commissions', perm: 'finance.read', view: 'records', resource: 'commissions' },
    { path: '/admin/refunds', label: 'Refunds & Disputes', icon: 'refunds', perm: 'finance.read', view: 'refunds' },
    { path: '/admin/finance', label: 'Financial Reports', icon: 'finance', perm: 'finance.read', view: 'finance' },
    { path: '/admin/analytics', label: 'Analytics', icon: 'analytics', perm: 'analytics.read', view: 'analytics' },
    { group: 'Corporate' },
    { path: '/admin/notifications', label: 'Notifications', icon: 'notifications', perm: 'notifications.read', view: 'notifications' },
    { path: '/admin/cms', label: 'Corporate CMS', icon: 'cms', perm: 'cms.read', view: 'cms' },
    { path: '/admin/media', label: 'Media Library', icon: 'media', perm: 'media.read', view: 'media' },
    { path: '/admin/inquiries', label: 'Contact Inquiries', icon: 'inquiries', perm: 'inquiries.read', view: 'inquiries' },
    { path: '/admin/careers', label: 'Careers & Applications', icon: 'careers', perm: 'careers.read', view: 'careers' },
    { group: 'Administration' },
    { path: '/admin/users', label: 'Administrators', icon: 'users', perm: 'users.read', view: 'users' },
    { path: '/admin/roles', label: 'Roles & Permissions', icon: 'roles', perm: 'users.read', view: 'roles' },
    { path: '/admin/audit-logs', label: 'Audit Logs', icon: 'audit', perm: 'audit.read', view: 'audit' },
    { path: '/admin/integrations', label: 'Integrations', icon: 'integrations', perm: 'integrations.read', view: 'integrations' },
    { path: '/admin/settings', label: 'Settings', icon: 'settings', perm: 'settings.read', view: 'settings' },
];
const HIDDEN_ROUTES = [{ path: '/admin/account', label: 'My account', view: 'account' }];
const AUTH_ROUTES = new Set(['/admin/login', '/admin/reset', '/admin/setup', '/admin/forgot']);

const app = document.getElementById('app');
const state = { me: null, shell: null, content: null, notifTimer: null, current: null };


function allowed(item) {
    if (!state.me) return false;
    if (item.perm && !can(item.perm)) return false;
    if (item.platformPerm && !state.me.platforms.includes(item.platformPerm)) return false;
    if (item.anyPlatform && !state.me.platforms.length) return false;
    return true;
}

export function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
    route();
}

/** Reads/writes the shared filter query (?platform=&range=&from=&to=&data=). */
export function query() {
    return new URLSearchParams(location.search);
}
export function setQuery(patch) {
    const q = query();
    for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') q.delete(k);
        else q.set(k, v);
    }
    history.replaceState({}, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
    route();
}

document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="/admin"]');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => route());

setUnauthorizedHandler(() => {
    if (state.me) {
        state.me = null;
        setSession(null);
        toast('Your session has expired. Please sign in again.', 'error');
        navigate(`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
});

async function loadMe() {
    try {
        state.me = await api('/api/auth/me');
        setCsrf(state.me.csrfToken);
        setSession(state.me);
        return 'ok';
    } catch (e) {
        state.me = null;
        setSession(null);
        if (e instanceof ApiError && e.status === 503) return 'unavailable';
        if (e instanceof ApiError && e.status === 401) return 'anonymous';
        return 'error';
    }
}

function notConfigured(message) {
    clear(app).className = 'adm-auth';
    app.append(h('div', { class: 'adm-auth__card' },
        h('div', { class: 'adm-auth__brand' }, h('img', { src: '/assets/brand/suskii-logo-sm.webp', alt: '', width: 99, height: 112 }), h('div', {}, h('strong', {}, 'SUSKII'), h('span', {}, 'Central administration'))),
        h('h1', {}, 'The admin is not set up yet'),
        h('p', { class: 'adm-lead' }, message),
        h('p', {}, 'Connect a PostgreSQL database (DATABASE_URL), redeploy, then create the first administrator. See docs/DEPLOYMENT.md.'),
        h('p', { style: { marginTop: '16px' } }, h('a', { class: 'btn btn--ghost', href: '/', target: '_self' }, 'Back to the website'))));
}

async function route() {
    const path = location.pathname.replace(/\/+$/, '') || '/admin';
    if (AUTH_ROUTES.has(path)) {
        teardownShell();
        const { renderAuth } = await import('./views/auth.js');
        return renderAuth(app, path, { onSignedIn: async (next) => { await loadMe(); navigate(next || '/admin/overview', { replace: true }); } });
    }
    if (!state.me) {
        const s = await loadMe();
        if (s === 'unavailable') return notConfigured('The admin database is not configured on this deployment.');
        if (s !== 'ok') return navigate(`/admin/login${path !== '/admin' ? `?next=${encodeURIComponent(location.pathname + location.search)}` : ''}`, { replace: true });
    }
    if (path === '/admin') return navigate('/admin/overview', { replace: true });
    if (state.me.mfaEnrollmentRequired && path !== '/admin/account') return navigate('/admin/account?mfa=required', { replace: true });

    const item = [...NAV, ...HIDDEN_ROUTES].find((n) => n.path === path);
    ensureShell();
    highlight(path);
    clear(state.content);
    window.scrollTo(0, 0);
    if (!item) {
        state.content.append(h('div', { class: 'adm-card' }, h('h1', {}, 'Page not found'), h('p', {}, 'This admin page does not exist.'), h('a', { class: 'btn btn--ghost', href: '/admin/overview' }, 'Go to Overview')));
        return;
    }
    if (item.view !== 'account' && !allowed(item)) {
        state.content.append(h('div', { class: 'adm-card' }, banner('warn', 'You do not have permission to view this page. Ask a Super Admin if you need access.')));
        return;
    }
    document.title = `${item.label} · SUSKII Admin`;
    const token = (state.current = Symbol(path));
    try {
        const mod = await import(`./views/${item.view}.js`);
        if (state.current !== token) return;
        await mod.render(state.content, { item, me: state.me, can, query, setQuery, navigate, isCurrent: () => state.current === token });
    } catch (e) {
        if (state.current !== token) return;
        console.error(e);
        state.content.append(h('div', { class: 'adm-card' }, banner('error', e?.message ?? 'This page failed to load.')));
    }
}

function teardownShell() {
    state.shell = null;
    state.content = null;
    clearInterval(state.notifTimer);
}

function highlight(path) {
    state.shell.querySelectorAll('.adm-nav a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === path));
    state.shell.querySelectorAll('.adm-nav a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
    state.shell.classList.remove('is-nav-open');
    state.shell.querySelector('.adm-scrim')?.remove();
}

function ensureShell() {
    if (state.shell) return;
    const me = state.me;
    const collapsed = localStorageGet('adm.collapsed') === '1';
    const nav = h('nav', { class: 'adm-nav', 'aria-label': 'Admin' });
    let pendingGroup = null;
    for (const item of NAV) {
        if (item.group) { pendingGroup = item.group; continue; }
        if (!allowed(item)) continue;
        if (pendingGroup) { nav.append(h('div', { class: 'adm-nav__group' }, pendingGroup)); pendingGroup = null; }
        nav.append(h('a', { href: item.path, title: item.label }, icon(item.icon), h('span', {}, item.label)));
    }
    const side = h('aside', { class: 'adm-side', 'aria-label': 'Navigation' },
        h('a', { class: 'adm-side__brand', href: '/admin/overview' }, h('img', { src: '/assets/brand/suskii-logo-sm.webp', alt: '', width: 99, height: 112 }), h('div', {}, h('strong', {}, 'SUSKII'), h('small', {}, 'Central admin'))),
        nav);

    const searchBox = h('input', { type: 'search', placeholder: 'Search content, inquiries, admins, transactions…', 'aria-label': 'Global search', autocomplete: 'off' });
    const results = h('div', { class: 'adm-search-results', hidden: true, role: 'listbox' });
    let searchTimer;
    searchBox.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = searchBox.value.trim();
        if (q.length < 2) { results.hidden = true; return; }
        searchTimer = setTimeout(async () => {
            try {
                const { results: rows } = await api(`/api/admin/search?q=${encodeURIComponent(q)}`);
                clear(results);
                if (!rows.length) results.append(h('div', { style: { padding: '10px', color: 'var(--muted)' } }, 'No matches'));
                for (const r of rows) results.append(h('a', { href: r.link, role: 'option', onclick: () => { results.hidden = true; searchBox.value = ''; } }, h('strong', {}, `${r.type}: ${r.title}`), h('small', {}, r.subtitle)));
                results.hidden = false;
            } catch { results.hidden = true; }
        }, 220);
    });
    searchBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; searchBox.blur(); } });
    document.addEventListener('click', (e) => { if (!e.target.closest?.('.adm-top__search')) results.hidden = true; });

    const notifBtn = h('button', { class: 'adm-iconbtn', type: 'button', 'aria-label': 'Notifications', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, icon('notifications'));
    const notifPop = h('div', { class: 'adm-pop' }, notifBtn);
    const refreshNotifs = async () => {
        if (!me.permissions.includes('notifications.read')) return;
        try {
            const { unread } = await api('/api/admin/notifications');
            notifBtn.querySelector('.adm-badge-dot')?.remove();
            if (unread) notifBtn.append(h('span', { class: 'adm-badge-dot' }, unread > 99 ? '99+' : String(unread)));
            notifBtn.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
        } catch { /* ignore */ }
    };
    notifBtn.addEventListener('click', async () => {
        const open = notifPop.querySelector('.adm-menu');
        if (open) { open.remove(); notifBtn.setAttribute('aria-expanded', 'false'); return; }
        const menu = h('div', { class: 'adm-menu adm-notif-list' }, h('div', { class: 'adm-menu__head' }, h('strong', {}, 'Notifications')));
        notifPop.append(menu);
        notifBtn.setAttribute('aria-expanded', 'true');
        try {
            const { items } = await api('/api/admin/notifications');
            if (!items.length) menu.append(h('p', { style: { padding: '10px', color: 'var(--muted)' } }, 'You are all caught up.'));
            for (const n of items.slice(0, 12)) menu.append(h('a', { class: `adm-notif${n.read ? '' : ' is-unread'}`, href: n.link || '/admin/notifications' }, h('strong', {}, n.title), h('small', {}, `${ago(n.created_at)}${n.body ? ` · ${n.body.slice(0, 80)}` : ''}`)));
            menu.append(h('a', { href: '/admin/notifications', style: { fontWeight: 700 } }, 'View all notifications'));
            if (items.some((n) => !n.read)) await api('/api/admin/notifications/read', { method: 'POST', body: { all: true } }).then(refreshNotifs);
        } catch (e) { menu.append(banner('error', e.message)); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest?.('.adm-pop')) { state.shell?.querySelectorAll('.adm-pop .adm-menu').forEach((m) => m.remove()); } });

    const initials = me.user.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const profileBtn = h('button', { class: 'adm-profile', type: 'button', 'aria-haspopup': 'true' }, h('span', { class: 'adm-avatar', 'aria-hidden': 'true' }, initials), h('span', {}, me.user.name));
    const profilePop = h('div', { class: 'adm-pop' }, profileBtn);
    profileBtn.addEventListener('click', () => {
        const open = profilePop.querySelector('.adm-menu');
        if (open) return open.remove();
        profilePop.append(h('div', { class: 'adm-menu', role: 'menu' },
            h('div', { class: 'adm-menu__head' }, h('strong', {}, me.user.name), h('small', {}, me.user.email), h('small', {}, me.roles.map((r) => r.replace(/_/g, ' ')).join(', ') || 'No role')),
            h('a', { href: '/admin/account', role: 'menuitem' }, 'My account & security'),
            h('a', { href: '/', role: 'menuitem', target: '_blank', rel: 'noopener' }, 'View website'),
            h('button', { type: 'button', role: 'menuitem', onclick: logout }, 'Sign out')));
    });

    const shell = h('div', { class: `adm-shell${collapsed ? ' is-collapsed' : ''}` });
    const menuToggle = h('button', { class: 'adm-iconbtn adm-menu-toggle', type: 'button', 'aria-label': 'Open navigation', onclick: () => {
        shell.classList.add('is-nav-open');
        shell.append(h('div', { class: 'adm-scrim', onclick: () => { shell.classList.remove('is-nav-open'); shell.querySelector('.adm-scrim')?.remove(); } }));
    } }, icon('menu'));
    const collapseToggle = h('button', { class: 'adm-iconbtn adm-collapse-toggle', type: 'button', 'aria-label': 'Collapse navigation', onclick: () => {
        shell.classList.toggle('is-collapsed');
        localStorageSet('adm.collapsed', shell.classList.contains('is-collapsed') ? '1' : '0');
    } }, icon('collapse'));
    const top = h('header', { class: 'adm-top' }, menuToggle, collapseToggle,
        h('div', { class: 'adm-top__search' }, icon('search'), searchBox, results),
        h('div', { class: 'adm-top__spacer' }), notifPop, profilePop);
    const content = h('main', { class: 'adm-content', id: 'adm-main', tabindex: '-1' });
    shell.append(side, h('div', { class: 'adm-main' }, top, content));
    clear(app).className = '';
    app.append(shell);
    state.shell = shell;
    state.content = content;
    refreshNotifs();
    clearInterval(state.notifTimer);
    state.notifTimer = setInterval(refreshNotifs, 60_000);
}

async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
    state.me = null;
    setSession(null);
    teardownShell();
    navigate('/admin/login?signedOut=1', { replace: true });
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

route();
