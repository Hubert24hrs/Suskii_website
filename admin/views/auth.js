/** Sign-in, two-factor, password recovery and first-administrator setup screens. */
import { api, ApiError, banner, clear, field, h } from '../lib.js';

function card(...children) {
    return h('div', { class: 'adm-auth__card' },
        h('div', { class: 'adm-auth__brand' },
            h('img', { src: '/assets/brand/suskii-logo-sm.webp', alt: '', width: 99, height: 112 }),
            h('div', {}, h('strong', {}, 'SUSKII'), h('span', {}, 'Central administration'))),
        ...children);
}

function input(attrs) {
    return h('input', { class: 'adm-input', ...attrs });
}

function submitButton(text) {
    return h('button', { class: 'btn btn--dark adm-auth__submit', type: 'submit' }, text);
}

/** Wires a form: disables the button while the handler runs and shows its error in an alert region. */
function wire(form, alertHost, handler) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        clear(alertHost);
        try {
            await handler();
        } catch (err) {
            alertHost.append(banner('error', err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'));
            alertHost.querySelector('[role=alert]')?.focus?.();
        } finally {
            btn.disabled = false;
        }
    });
}

function safeNext(raw) {
    // Only allow redirects back into the admin itself.
    return raw && /^\/admin\/[a-z0-9\-/?=&%._]*$/i.test(raw) && !raw.startsWith('//') ? raw : '/admin/overview';
}

export async function renderAuth(root, path, { onSignedIn }) {
    clear(root).className = 'adm-auth';
    const q = new URLSearchParams(location.search);
    const alertHost = h('div', { class: 'adm-auth__alert', 'aria-live': 'assertive' });

    if (path === '/admin/login') {
        let setup = null;
        try { setup = await api('/api/setup/status'); } catch (e) {
            if (e instanceof ApiError && e.status === 503) {
                root.append(card(h('h1', {}, 'The admin is not set up yet'), banner('warn', e.message), h('p', {}, 'Connect a PostgreSQL database (DATABASE_URL) and redeploy. See docs/DEPLOYMENT.md.')));
                return;
            }
        }
        if (setup?.needsSetup) {
            root.append(card(h('h1', {}, 'Create the first administrator'),
                h('p', { class: 'adm-lead' }, 'No administrator exists yet.'),
                setup.bootstrapEnabled
                    ? h('a', { class: 'btn btn--dark', href: '/admin/setup' }, 'Continue to setup')
                    : h('p', {}, 'Run `npm run admin:create` on a trusted machine with the production DATABASE_URL, or set ADMIN_BOOTSTRAP_TOKEN to enable one-time browser setup.')));
            return;
        }
        const email = input({ type: 'email', name: 'email', autocomplete: 'username', required: true, maxlength: 254, autofocus: true });
        const password = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 256 });
        const form = h('form', { class: 'adm-form', novalidate: false },
            field('Email', email), field('Password', password), submitButton('Sign in'),
            h('a', { class: 'adm-auth__link', href: '/admin/forgot' }, 'Forgot your password?'));
        if (q.get('signedOut')) alertHost.append(banner('ok', 'You have been signed out.'));
        if (q.get('reset')) alertHost.append(banner('ok', 'Your password was changed. Sign in with the new password.'));
        root.append(card(h('h1', {}, 'Sign in'), alertHost, form));
        wire(form, alertHost, async () => {
            const res = await api('/api/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
            password.value = '';
            if (res.mfaRequired) return renderMfa(root, res.challenge, q.get('next'), onSignedIn);
            await onSignedIn(safeNext(q.get('next')));
        });
        return;
    }

    if (path === '/admin/forgot') {
        const email = input({ type: 'email', autocomplete: 'username', required: true, maxlength: 254, autofocus: true });
        const form = h('form', { class: 'adm-form' }, field('Email', email), submitButton('Send reset link'), h('a', { class: 'adm-auth__link', href: '/admin/login' }, 'Back to sign in'));
        root.append(card(h('h1', {}, 'Reset your password'), h('p', { class: 'adm-lead' }, 'We will send a reset link that is valid for 30 minutes.'), alertHost, form));
        wire(form, alertHost, async () => {
            const res = await api('/api/auth/password/forgot', { method: 'POST', body: { email: email.value } });
            clear(alertHost).append(banner('ok', res.message));
        });
        return;
    }

    if (path === '/admin/reset') {
        const token = q.get('token') ?? '';
        const pw = input({ type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 256, autofocus: true });
        const pw2 = input({ type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 256 });
        const form = h('form', { class: 'adm-form' },
            field('New password', pw, { help: 'At least 12 characters, using three of: lowercase, uppercase, numbers, symbols.' }),
            field('Confirm new password', pw2), submitButton('Set password'));
        root.append(card(h('h1', {}, 'Choose a new password'), alertHost, token ? form : banner('error', 'This reset link is incomplete. Request a new one.')));
        // Remove the token from the address bar and history as soon as it has been read.
        history.replaceState({}, '', '/admin/reset');
        wire(form, alertHost, async () => {
            if (pw.value !== pw2.value) throw new ApiError(400, 'mismatch', 'The two passwords do not match.');
            await api('/api/auth/password/reset', { method: 'POST', body: { token, password: pw.value } });
            location.assign('/admin/login?reset=1');
        });
        return;
    }

    if (path === '/admin/setup') {
        const token = input({ type: 'password', autocomplete: 'off', required: true });
        const name = input({ type: 'text', autocomplete: 'name', required: true, maxlength: 120 });
        const email = input({ type: 'email', autocomplete: 'username', required: true, maxlength: 254 });
        const pw = input({ type: 'password', autocomplete: 'new-password', required: true, minlength: 12 });
        const form = h('form', { class: 'adm-form' },
            field('Setup token', token, { help: 'The ADMIN_BOOTSTRAP_TOKEN configured on the server. It only works while no administrator exists.' }),
            field('Your name', name), field('Email', email),
            field('Password', pw, { help: 'At least 12 characters, using three of: lowercase, uppercase, numbers, symbols.' }),
            submitButton('Create Super Admin'));
        root.append(card(h('h1', {}, 'Create the first administrator'), alertHost, form));
        wire(form, alertHost, async () => {
            await api('/api/setup', { method: 'POST', body: { token: token.value, name: name.value, email: email.value, password: pw.value } });
            const res = await api('/api/auth/login', { method: 'POST', body: { email: email.value, password: pw.value } });
            if (res.mfaRequired) return renderMfa(root, res.challenge, null, onSignedIn);
            await onSignedIn('/admin/account?mfa=recommended');
        });
    }
}

function renderMfa(root, challenge, next, onSignedIn) {
    clear(root);
    const alertHost = h('div', { class: 'adm-auth__alert', 'aria-live': 'assertive' });
    let useRecovery = false;
    const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: 8, required: true, autofocus: true });
    const codeField = field('Authentication code', code, { help: 'The 6-digit code from your authenticator app.' });
    const toggle = h('button', { class: 'adm-auth__link adm-linkbtn', type: 'button' }, 'Use a recovery code instead');
    toggle.addEventListener('click', () => {
        useRecovery = !useRecovery;
        code.value = '';
        code.setAttribute('inputmode', useRecovery ? 'text' : 'numeric');
        code.setAttribute('maxlength', useRecovery ? '20' : '8');
        if (useRecovery) code.removeAttribute('pattern'); else code.setAttribute('pattern', '[0-9 ]*');
        codeField.querySelector('label').textContent = useRecovery ? 'Recovery code' : 'Authentication code';
        codeField.querySelector('small').textContent = useRecovery ? 'One of the recovery codes you saved when you turned on two-factor authentication. Each code works once.' : 'The 6-digit code from your authenticator app.';
        toggle.textContent = useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead';
        code.focus();
    });
    const form = h('form', { class: 'adm-form' }, codeField, submitButton('Verify'), toggle, h('a', { class: 'adm-auth__link', href: '/admin/login' }, 'Start again'));
    root.append(card(h('h1', {}, 'Two-factor authentication'), alertHost, form));
    code.focus();
    wire(form, alertHost, async () => {
        const body = useRecovery ? { challenge, recoveryCode: code.value } : { challenge, code: code.value.replace(/\s/g, '') };
        await api('/api/auth/mfa', { method: 'POST', body });
        await onSignedIn(safeNext(next));
    });
}
