import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../server/db.js';
import { SYSTEM_ROLES } from '../server/auth/rbac.js';
import { as, createAdmin, createSuperAdmin, freshDb, login, type Session } from './helpers.js';

let db: Db;
let owner: Session, content: Session, marketplace: Session, analyst: Session, finance: Session, corporate: Session, ops: Session;

beforeAll(async () => {
    db = await freshDb();
    await createSuperAdmin(db);
    await createAdmin(db, 'content@suskii.test', ['content_manager']);
    await createAdmin(db, 'market@suskii.test', ['marketplace_manager']);
    await createAdmin(db, 'analyst@suskii.test', ['analyst']);
    await createAdmin(db, 'finance@suskii.test', ['finance_admin']);
    await createAdmin(db, 'corporate@suskii.test', ['corporate_admin']);
    // A custom role with platform access but no finance permission.
    await db.query(`INSERT INTO admin_roles (id, name, description, is_system, is_privileged) VALUES ('custom_ops', 'Ops', '', false, false)`);
    for (const p of ['overview.read', 'platform.marketplace.read', 'notifications.read']) await db.query(`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ('custom_ops', $1)`, [p]);
    await createAdmin(db, 'ops@suskii.test', ['custom_ops']);
    [owner, content, marketplace, analyst, finance, corporate, ops] = await Promise.all(
        ['owner', 'content', 'market', 'analyst', 'finance', 'corporate', 'ops'].map((n) => login(`${n}@suskii.test`)));
    // Demo data so platform scoping is observable.
    for (const p of ['marketplace', 'errands']) await db.query(`UPDATE platform_integrations SET mode = 'demo', status = 'demo' WHERE platform = $1`, [p]);
});

describe('role definitions', () => {
    it('provides the eight required roles', () => {
        expect(Object.keys(SYSTEM_ROLES).sort()).toEqual(['analyst', 'content_manager', 'corporate_admin', 'errands_manager', 'finance_admin', 'marketplace_manager', 'super_admin', 'travel_manager']);
    });

    it('content managers cannot publish or approve', () => {
        expect(SYSTEM_ROLES.content_manager.permissions).not.toContain('cms.publish');
        expect(SYSTEM_ROLES.content_manager.permissions).not.toContain('cms.review');
    });
});

describe('server-side enforcement', () => {
    it('content managers cannot see operational or financial data', async () => {
        expect((await as(content)('GET', '/api/overview')).status).toBe(403);
        expect((await as(content)('GET', '/api/records/payments')).status).toBe(403);
        expect((await as(content)('GET', '/api/admin/users')).status).toBe(403);
        expect((await as(content)('GET', '/api/integrations')).status).toBe(403);
        expect((await as(content)('GET', '/api/cms/entries')).status).toBe(200);
    });

    it('platform managers only see their own platform', async () => {
        expect((await as(marketplace)('GET', '/api/overview?platform=errands')).status).toBe(403);
        const all = await as(marketplace)('GET', '/api/overview?range=30d');
        expect(all.status).toBe(200);
        expect(all.body.scope.sources.map((s: any) => s.platform)).toEqual(['marketplace']);
        const recs = await as(marketplace)('GET', '/api/records/orders');
        expect(recs.body.items.every((r: any) => r.platform === 'marketplace')).toBe(true);
        expect((await as(marketplace)('GET', '/api/records/requests?platform=errands')).status).toBe(403);
    });

    it('financial figures are withheld without finance.read', async () => {
        const res = await as(ops)('GET', '/api/overview?range=30d');
        expect(res.status).toBe(200);
        expect(res.body.metrics.grossTransactionValue).toBeNull();
        expect(res.body.metrics.platformRevenue).toBeNull();
        expect(res.body.charts.revenueTrend).toBeNull();
        expect(res.body.metrics.marketplaceOrders).toBeGreaterThan(0);
        expect((await as(ops)('GET', '/api/records/payments')).status).toBe(403);
        const fin = await as(finance)('GET', '/api/overview?range=30d');
        expect(fin.body.metrics.grossTransactionValue).not.toBeNull();
    });

    it('analysts cannot change anything', async () => {
        expect((await as(analyst)('PUT', '/api/admin/settings/general', { organisationName: 'X', supportEmail: 'a@b.co', reportingTimezone: 'UTC' })).status).toBe(403);
        expect((await as(analyst)('POST', '/api/admin/users', { email: 'x@suskii.test', name: 'X', roles: [] })).status).toBe(403);
        expect((await as(analyst)('PUT', '/api/integrations/marketplace', { mode: 'live', enabled: true, authType: 'none' })).status).toBe(403);
    });

    it('only Super Admins can grant privileged roles', async () => {
        await db.query(`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ('corporate_admin', 'users.manage') ON CONFLICT DO NOTHING`);
        const corp = await login('corporate@suskii.test');
        const denied = await as(corp)('POST', '/api/admin/users', { email: 'escalate@suskii.test', name: 'E', roles: ['super_admin'] });
        expect(denied.status).toBe(403);
        const allowedNonPrivileged = await as(corp)('POST', '/api/admin/users', { email: 'helper@suskii.test', name: 'H', roles: ['content_manager'] });
        expect(allowedNonPrivileged.status).toBe(200);
        await db.query(`DELETE FROM admin_role_permissions WHERE role_id = 'corporate_admin' AND permission_id = 'users.manage'`);
        const ok = await as(owner)('POST', '/api/admin/users', { email: 'second-owner@suskii.test', name: 'S', roles: ['super_admin'] });
        expect(ok.status).toBe(200);
        expect(ok.body.inviteLink).toMatch(/\/admin\/reset\?token=/);
    });

    it('protects the last Super Admin and the current user', async () => {
        const id = await createAdmin(db, 'solo@suskii.test', ['super_admin']);
        const others = await db.query<{ id: string }>(`SELECT user_id AS id FROM admin_user_roles WHERE role_id = 'super_admin' AND user_id <> $1`, [id]);
        // Temporarily make "solo" the only active Super Admin.
        await db.query(`UPDATE admin_users SET status = 'disabled' WHERE id = ANY($1)`, [others.map((o) => o.id)]);
        try {
            const me = await login('solo@suskii.test');
            expect((await as(me)('PATCH', `/api/admin/users/${id}`, { status: 'disabled' })).status).toBe(400);
            expect((await as(me)('PATCH', `/api/admin/users/${id}`, { roles: ['analyst'] })).status).toBe(400);
        } finally {
            await db.query(`UPDATE admin_users SET status = 'active' WHERE id = ANY($1)`, [others.map((o) => o.id)]);
        }
    });

    it('built-in roles cannot be edited or deleted; custom roles can', async () => {
        expect((await as(owner)('PUT', '/api/admin/roles/super_admin', { permissions: [] })).status).toBe(400);
        expect((await as(owner)('DELETE', '/api/admin/roles/analyst')).status).toBe(400);
        const created = await as(owner)('POST', '/api/admin/roles', { name: 'Support desk', permissions: ['inquiries.read', 'inquiries.manage'] });
        expect(created.status).toBe(200);
        expect((await as(owner)('PUT', `/api/admin/roles/${created.body.id}`, { permissions: ['inquiries.read'] })).status).toBe(200);
        expect((await as(owner)('PUT', `/api/admin/roles/${created.body.id}`, { permissions: ['not.a.permission'] })).status).toBe(400);
        expect((await as(owner)('DELETE', `/api/admin/roles/${created.body.id}`)).status).toBe(200);
    });

    it('audits sensitive administrator changes', async () => {
        const rows = await db.query<{ action: string }>(`SELECT action FROM audit_logs WHERE action LIKE 'admin.%'`);
        const actions = rows.map((r) => r.action);
        expect(actions).toContain('admin.user.create');
        expect(actions).toContain('admin.role.create');
        expect(actions).toContain('admin.role.delete');
    });
});
