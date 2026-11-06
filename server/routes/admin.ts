import { audit } from '../audit.js';
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, type Permission } from '../auth/rbac.js';
import { requireAdmin, revokeAllSessions } from '../auth/session.js';
import { appEnv, deployHookUrl, isDatabaseConfigured, PLATFORM_IDS, siteOrigin } from '../config.js';
import { badRequest, conflict, forbidden, json, notFound, pagination, readJson, type Router } from '../http.js';
import { mailConfigured, sendMail } from '../mail.js';
import { storageConfigured } from '../media/storage.js';
import { resolveAll } from '../integrations/registry.js';
import { hashPassword, passwordProblems, randomToken, sha256 } from '../security.js';
import { bool, email, int, oneOf, optStr, str, uuid } from '../validate.js';

const DEFAULT_SETTINGS = {
    general: { organisationName: 'SUSKII', supportEmail: 'support@suskii.com', reportingTimezone: 'UTC' },
    security: { idleMinutes: 30, requireMfaForPrivileged: false },
};

export function adminRoutes(r: Router): void {
    // ─── Administrators ───
    r.get('/api/admin/users', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'users.read');
        const users = await db.query(
            `SELECT u.id, u.email, u.name, u.status, u.mfa_enabled, u.last_login_at, u.created_at, u.locked_until,
                    coalesce(array_agg(ur.role_id ORDER BY ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS roles
             FROM admin_users u LEFT JOIN admin_user_roles ur ON ur.user_id = u.id GROUP BY u.id ORDER BY u.created_at`);
        return json({ users });
    });

    r.post('/api/admin/users', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'users.manage');
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const userEmail = email(body.email);
        const name = str(body.name, 'name', { max: 120 });
        const roles = Array.isArray(body.roles) ? body.roles.map((x) => String(x)) : [];
        await assertGrantable(db, admin, roles);
        if (await db.one(`SELECT 1 FROM admin_users WHERE lower(email) = $1`, [userEmail])) throw conflict('An administrator with this email already exists.');
        // The new administrator sets their own password through a one-time link; no password is ever shared.
        const placeholder = await hashPassword(randomToken(32));
        const user = await db.tx(async (t) => {
            const u = await t.one<{ id: string; email: string }>(`INSERT INTO admin_users (email, name, password_hash, created_by) VALUES ($1, $2, $3, $4) RETURNING id, email`, [userEmail, name, placeholder, admin.user.id]);
            for (const role of roles) await t.query(`INSERT INTO admin_user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $3)`, [u!.id, role, admin.user.id]);
            return u!;
        });
        const link = await issueResetLink(db, user.id, admin.user.id, 72 * 60);
        const delivered = await sendMail({ to: user.email, subject: 'You have been invited to the SUSKII admin', text: `${admin.user.name} invited you to the SUSKII admin.\n\nSet your password within 72 hours:\n${link}` });
        await audit(db, ctx, admin.user, { action: 'admin.user.create', targetType: 'admin_user', targetId: user.id, metadata: { email: user.email, roles } });
        return json({ ok: true, id: user.id, inviteLink: delivered && mailConfigured() ? null : link, emailed: delivered && mailConfigured() });
    });

    r.patch('/api/admin/users/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'users.manage');
        const id = uuid(ctx.params.id);
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const target = await db.one<{ id: string; email: string }>(`SELECT id, email FROM admin_users WHERE id = $1`, [id]);
        if (!target) throw notFound('Administrator not found');
        const changes: Record<string, unknown> = {};
        await db.tx(async (t) => {
            if (body.name !== undefined) { const name = str(body.name, 'name', { max: 120 }); await t.query(`UPDATE admin_users SET name = $2, updated_at = now() WHERE id = $1`, [id, name]); changes.name = name; }
            if (body.status !== undefined) {
                const status = oneOf(body.status, 'status', ['active', 'disabled'] as const);
                if (id === admin.user.id && status === 'disabled') throw badRequest('You cannot disable your own account.');
                if (status === 'disabled') await assertNotLastSuperAdmin(t, id);
                await t.query(`UPDATE admin_users SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
                if (status === 'disabled') await revokeAllSessions(t, id);
                changes.status = status;
            }
            if (body.roles !== undefined) {
                if (!Array.isArray(body.roles)) throw badRequest('roles must be a list');
                const roles = body.roles.map((x) => String(x));
                await assertGrantable(t, admin, roles);
                if (!roles.includes('super_admin')) await assertNotLastSuperAdmin(t, id);
                if (id === admin.user.id && !roles.includes('super_admin') && admin.roles.includes('super_admin')) throw badRequest('You cannot remove your own Super Admin role.');
                await t.query(`DELETE FROM admin_user_roles WHERE user_id = $1`, [id]);
                for (const role of roles) await t.query(`INSERT INTO admin_user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $3)`, [id, role, admin.user.id]);
                changes.roles = roles;
            }
            if (body.unlock === true) { await t.query(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [id]); changes.unlocked = true; }
        });
        await audit(db, ctx, admin.user, { action: 'admin.user.update', targetType: 'admin_user', targetId: id, metadata: { email: target.email, ...changes } });
        return json({ ok: true });
    });

    r.post('/api/admin/users/:id/reset-link', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'users.manage');
        const id = uuid(ctx.params.id);
        const target = await db.one<{ id: string; email: string }>(`SELECT id, email FROM admin_users WHERE id = $1 AND status = 'active'`, [id]);
        if (!target) throw notFound('Active administrator not found');
        const link = await issueResetLink(db, id, admin.user.id, 60);
        await audit(db, ctx, admin.user, { action: 'admin.user.reset_link', targetType: 'admin_user', targetId: id, metadata: { email: target.email } });
        return json({ ok: true, link, expiresInMinutes: 60 });
    });

    r.post('/api/admin/users/:id/revoke-sessions', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'users.manage');
        const id = uuid(ctx.params.id);
        await revokeAllSessions(db, id, id === admin.user.id ? admin.sessionId : undefined);
        await audit(db, ctx, admin.user, { action: 'admin.user.revoke_sessions', targetType: 'admin_user', targetId: id });
        return json({ ok: true });
    });

    // ─── Roles & permissions ───
    r.get('/api/admin/roles', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'users.read');
        const roles = await db.query(
            `SELECT r.id, r.name, r.description, r.is_system, r.is_privileged,
                    coalesce(array_agg(rp.permission_id ORDER BY rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permissions,
                    (SELECT count(*)::int FROM admin_user_roles ur WHERE ur.role_id = r.id) AS members
             FROM admin_roles r LEFT JOIN admin_role_permissions rp ON rp.role_id = r.id GROUP BY r.id
             ORDER BY r.is_system DESC, array_position(ARRAY[${Object.keys(SYSTEM_ROLES).map((k) => `'${k}'`).join(',')}]::text[], r.id), r.name`);
        const permissions = Object.entries(PERMISSIONS).map(([id, [category, description]]) => ({ id, category, description }));
        return json({ roles, permissions });
    });

    r.post('/api/admin/roles', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'roles.manage');
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const name = str(body.name, 'name', { max: 60 });
        const id = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)}`;
        const perms = permissionList(body.permissions);
        if (await db.one(`SELECT 1 FROM admin_roles WHERE id = $1`, [id])) throw conflict('A role with this name already exists.');
        const privileged = perms.some((p) => ['users.manage', 'roles.manage', 'integrations.manage', 'settings.manage', 'cms.publish'].includes(p));
        await db.tx(async (t) => {
            await t.query(`INSERT INTO admin_roles (id, name, description, is_system, is_privileged) VALUES ($1, $2, $3, false, $4)`, [id, name, optStr(body.description, 'description', { max: 300 }) ?? '', privileged]);
            for (const p of perms) await t.query(`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ($1, $2)`, [id, p]);
        });
        await audit(db, ctx, admin.user, { action: 'admin.role.create', targetType: 'admin_role', targetId: id, metadata: { permissions: perms } });
        return json({ ok: true, id });
    });

    r.put('/api/admin/roles/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'roles.manage');
        const id = str(ctx.params.id, 'id', { max: 60 });
        const role = await db.one<{ is_system: boolean }>(`SELECT is_system FROM admin_roles WHERE id = $1`, [id]);
        if (!role) throw notFound('Role not found');
        if (role.is_system) throw badRequest('Built-in roles cannot be edited. Create a custom role instead.');
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const perms = permissionList(body.permissions);
        await db.tx(async (t) => {
            await t.query(`DELETE FROM admin_role_permissions WHERE role_id = $1`, [id]);
            for (const p of perms) await t.query(`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ($1, $2)`, [id, p]);
        });
        await audit(db, ctx, admin.user, { action: 'admin.role.update', targetType: 'admin_role', targetId: id, metadata: { permissions: perms } });
        return json({ ok: true });
    });

    r.delete('/api/admin/roles/:id', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'roles.manage');
        const id = str(ctx.params.id, 'id', { max: 60 });
        const role = await db.one<{ is_system: boolean; members: number }>(`SELECT is_system, (SELECT count(*)::int FROM admin_user_roles WHERE role_id = $1) AS members FROM admin_roles WHERE id = $1`, [id]);
        if (!role) throw notFound('Role not found');
        if (role.is_system) throw badRequest('Built-in roles cannot be deleted.');
        if (role.members > 0) throw badRequest('Remove this role from all administrators before deleting it.');
        await db.query(`DELETE FROM admin_roles WHERE id = $1 AND is_system = false`, [id]);
        await audit(db, ctx, admin.user, { action: 'admin.role.delete', targetType: 'admin_role', targetId: id });
        return json({ ok: true });
    });

    // ─── Audit logs ───
    r.get('/api/admin/audit-logs', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'audit.read');
        const { pageSize, offset, page } = pagination(ctx.url, { pageSize: 50 });
        const where: string[] = ['true'];
        const params: unknown[] = [];
        const add = (cond: string, v: unknown) => { params.push(v); where.push(cond.replace('?', `$${params.length}`)); };
        const action = ctx.url.searchParams.get('action');
        const actor = ctx.url.searchParams.get('actor');
        const outcome = ctx.url.searchParams.get('outcome');
        if (action) add(`action ILIKE ?`, `${action.replace(/[%_]/g, '')}%`);
        if (actor) add(`actor_email ILIKE ?`, `%${actor.replace(/[%_]/g, '')}%`);
        if (outcome === 'success' || outcome === 'failure') add(`outcome = ?`, outcome);
        const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE ${where.join(' AND ')}`, params))?.n ?? 0;
        const rows = await db.query(`SELECT id, at, actor_email, action, outcome, target_type, target_id, ip, metadata FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ${pageSize} OFFSET ${offset}`, params);
        return json({ items: rows, total, page, pageSize });
    });

    // ─── Notifications ───
    r.get('/api/admin/notifications', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'notifications.read');
        const rows = await db.query<any>(
            `SELECT n.*, (nr.user_id IS NOT NULL) AS read FROM central_notifications n
             LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = $1
             WHERE n.permission IS NULL OR n.permission = ANY($2) ORDER BY n.created_at DESC LIMIT 100`,
            [admin.user.id, [...admin.permissions]]);
        return json({ items: rows, unread: rows.filter((x) => !x.read).length });
    });

    r.post('/api/admin/notifications/read', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'notifications.read');
        const body = await readJson<{ ids?: unknown; all?: unknown }>(ctx.req);
        if (body.all === true) {
            await db.query(`INSERT INTO notification_reads (notification_id, user_id) SELECT id, $1 FROM central_notifications WHERE permission IS NULL OR permission = ANY($2) ON CONFLICT DO NOTHING`, [admin.user.id, [...admin.permissions]]);
        } else if (Array.isArray(body.ids)) {
            for (const id of body.ids.slice(0, 200)) await db.query(`INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [uuid(id), admin.user.id]);
        }
        return json({ ok: true });
    });

    // ─── Settings ───
    r.get('/api/admin/settings', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'settings.read');
        const rows = await db.query<{ key: string; value: unknown; updated_at: Date }>(`SELECT key, value, updated_at FROM site_settings`);
        const stored = Object.fromEntries(rows.map((x) => [x.key, x.value]));
        return json({
            settings: { general: { ...DEFAULT_SETTINGS.general, ...(stored.general as object) }, security: { ...DEFAULT_SETTINGS.security, ...(stored.security as object) } },
            lastRebuild: stored['cms.lastRebuild'] ?? null,
            environment: {
                appEnv: appEnv(), siteOrigin: siteOrigin(), database: isDatabaseConfigured(), storage: storageConfigured(), email: mailConfigured(),
                deployHook: deployHookUrl() !== '',
            },
        });
    });

    r.put('/api/admin/settings/:key', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx, 'settings.manage');
        const key = oneOf(ctx.params.key, 'key', ['general', 'security'] as const);
        const body = await readJson<Record<string, unknown>>(ctx.req);
        const value = key === 'general'
            ? { organisationName: str(body.organisationName, 'organisationName', { max: 80 }), supportEmail: email(body.supportEmail, 'supportEmail'), reportingTimezone: oneOf(body.reportingTimezone, 'reportingTimezone', ['UTC', 'Africa/Lagos', 'Africa/Kigali'] as const) }
            : { idleMinutes: int(body.idleMinutes, 'idleMinutes', { min: 5, max: 480 }), requireMfaForPrivileged: bool(body.requireMfaForPrivileged, 'requireMfaForPrivileged') };
        await db.query(`INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [key, JSON.stringify(value), admin.user.id]);
        await audit(db, ctx, admin.user, { action: `settings.update.${key}`, targetType: 'settings', targetId: key, metadata: value });
        return json({ ok: true });
    });

    // ─── Global search (only across what the user may see) ───
    r.get('/api/admin/search', async (ctx) => {
        const { db, admin } = await requireAdmin(ctx);
        const q = (ctx.url.searchParams.get('q') ?? '').trim().slice(0, 80);
        if (q.length < 2) return json({ results: [] });
        const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        const results: { type: string; title: string; subtitle: string; link: string }[] = [];
        if (admin.permissions.has('cms.read')) {
            for (const e of await db.query<any>(`SELECT id, collection, key, title, status FROM cms_entries WHERE deleted_at IS NULL AND (title ILIKE $1 OR key ILIKE $1 OR draft::text ILIKE $1) LIMIT 8`, [like])) {
                results.push({ type: 'Content', title: e.title, subtitle: `${e.collection === 'section' ? 'Website section' : e.collection === 'news' ? 'News' : 'Job'} · ${e.status.replace('_', ' ')}`, link: `/admin/cms?entry=${e.id}` });
            }
        }
        if (admin.permissions.has('inquiries.read')) {
            for (const i of await db.query<any>(`SELECT id, name, email, topic, status FROM contact_inquiries WHERE name ILIKE $1 OR email ILIKE $1 OR message ILIKE $1 ORDER BY created_at DESC LIMIT 6`, [like])) {
                results.push({ type: 'Inquiry', title: i.name, subtitle: `${i.email} · ${i.topic} · ${i.status}`, link: `/admin/inquiries?id=${i.id}` });
            }
        }
        if (admin.permissions.has('careers.read')) {
            for (const a of await db.query<any>(`SELECT id, name, job_slug, status FROM job_applications WHERE name ILIKE $1 OR email ILIKE $1 ORDER BY created_at DESC LIMIT 6`, [like])) {
                results.push({ type: 'Application', title: a.name, subtitle: `${a.job_slug} · ${a.status}`, link: `/admin/careers?id=${a.id}` });
            }
        }
        if (admin.permissions.has('users.read')) {
            for (const u of await db.query<any>(`SELECT id, name, email FROM admin_users WHERE name ILIKE $1 OR email ILIKE $1 LIMIT 5`, [like])) {
                results.push({ type: 'Administrator', title: u.name, subtitle: u.email, link: `/admin/users?id=${u.id}` });
            }
        }
        if (admin.platforms.length && admin.permissions.has('finance.read')) {
            for (const t of await db.query<any>(`SELECT platform, type, source_id, status FROM transaction_references WHERE platform = ANY($1) AND source_id ILIKE $2 LIMIT 6`, [admin.platforms, like])) {
                results.push({ type: 'Transaction', title: t.source_id, subtitle: `${t.platform} · ${t.type} · ${t.status}`, link: `/admin/transactions?q=${encodeURIComponent(t.source_id)}` });
            }
        }
        return json({ results });
    });

    // ─── Detailed health (admins only; no secrets) ───
    r.get('/api/admin/health', async (ctx) => {
        const { db } = await requireAdmin(ctx, 'integrations.read');
        const started = Date.now();
        await db.query('SELECT 1');
        const integrations = (await resolveAll(db)).map((x) => ({ platform: x.platform, mode: x.mode, state: x.state }));
        const jobs = await db.one<{ queued: number; failed: number }>(`SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM background_jobs`);
        return json({ ok: true, databaseLatencyMs: Date.now() - started, database: db.kind, integrations, jobs, platforms: PLATFORM_IDS });
    });
}

function permissionList(v: unknown): Permission[] {
    if (!Array.isArray(v)) throw badRequest('permissions must be a list');
    const perms = [...new Set(v.map(String))];
    for (const p of perms) if (!ALL_PERMISSIONS.includes(p as Permission)) throw badRequest(`Unknown permission: ${p}`);
    return perms as Permission[];
}

async function assertGrantable(db: import('../db.js').Db, admin: import('../auth/session.js').AdminContext, roles: string[]): Promise<void> {
    if (!roles.length) return;
    const rows = await db.query<{ id: string; is_privileged: boolean }>(`SELECT id, is_privileged FROM admin_roles WHERE id = ANY($1)`, [roles]);
    if (rows.length !== new Set(roles).size) throw badRequest('One or more roles do not exist.');
    // Only Super Admins may grant privileged roles.
    if (rows.some((r) => r.is_privileged) && !admin.roles.includes('super_admin')) throw forbidden('Only a Super Admin can grant privileged roles.');
}

async function assertNotLastSuperAdmin(db: import('../db.js').Db, userId: string): Promise<void> {
    const row = await db.one<{ n: number; is_super: boolean }>(
        `SELECT (SELECT count(*)::int FROM admin_user_roles ur JOIN admin_users u ON u.id = ur.user_id WHERE ur.role_id = 'super_admin' AND u.status = 'active') AS n,
                EXISTS (SELECT 1 FROM admin_user_roles WHERE user_id = $1 AND role_id = 'super_admin') AS is_super`, [userId]);
    if (row?.is_super && row.n <= 1) throw badRequest('This is the last active Super Admin. Grant Super Admin to someone else first.');
}

async function issueResetLink(db: import('../db.js').Db, userId: string, createdBy: string, minutes: number): Promise<string> {
    const token = randomToken(32);
    await db.query(`INSERT INTO admin_password_resets (token_hash, user_id, expires_at, created_by) VALUES ($1, $2, now() + make_interval(mins => $3::int), $4)`, [sha256(token), userId, minutes, createdBy]);
    return `${siteOrigin()}/admin/reset?token=${token}`;
}

export { passwordProblems };
