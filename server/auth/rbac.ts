/**
 * Role-based access control. Every API route declares the permission it needs and the server
 * checks it on every request; the browser only uses these to hide controls.
 */
import type { PlatformId } from '../config.js';
import type { Db } from '../db.js';

export const PERMISSIONS = {
    'overview.read': ['Dashboard', 'View the operational overview'],
    'platform.marketplace.read': ['Platforms', 'View SUSKII Marketplace records'],
    'platform.errands.read': ['Platforms', 'View SUSKII Errands records'],
    'platform.travel_tour.read': ['Platforms', 'View SUSKII Travel & Tours records'],
    'finance.read': ['Finance', 'View transactions, payments, commissions, refunds and financial reports'],
    'analytics.read': ['Analytics', 'View analytics and reports'],
    'cms.read': ['CMS', 'View website content'],
    'cms.edit': ['CMS', 'Create and edit drafts, submit them for review'],
    'cms.review': ['CMS', 'Approve or reject content submitted for review'],
    'cms.publish': ['CMS', 'Publish, unpublish and schedule website content'],
    'cms.delete': ['CMS', 'Archive and delete website content'],
    'media.read': ['Media', 'View the media library'],
    'media.manage': ['Media', 'Upload, edit and delete media'],
    'inquiries.read': ['Inquiries', 'Read contact inquiries'],
    'inquiries.manage': ['Inquiries', 'Update and assign contact inquiries'],
    'careers.read': ['Careers', 'Read job applications'],
    'careers.manage': ['Careers', 'Update job applications'],
    'users.read': ['Administration', 'View administrators'],
    'users.manage': ['Administration', 'Create, disable and reset administrators'],
    'roles.manage': ['Administration', 'Grant roles and edit role permissions'],
    'audit.read': ['Administration', 'View audit logs'],
    'integrations.read': ['Integrations', 'View integration status, logs and webhook history'],
    'integrations.manage': ['Integrations', 'Configure platform connections and credentials'],
    'integrations.sync': ['Integrations', 'Run manual synchronisation'],
    'settings.read': ['Settings', 'View settings'],
    'settings.manage': ['Settings', 'Change settings'],
    'notifications.read': ['Notifications', 'Receive notifications'],
} as const satisfies Record<string, readonly [string, string]>;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PLATFORM_PERMISSION: Record<PlatformId, Permission> = {
    marketplace: 'platform.marketplace.read',
    errands: 'platform.errands.read',
    travel_tour: 'platform.travel_tour.read',
};

interface RoleDef {
    name: string;
    description: string;
    privileged: boolean;
    permissions: Permission[];
}

const base: Permission[] = ['notifications.read'];

export const SYSTEM_ROLES: Record<string, RoleDef> = {
    super_admin: {
        name: 'Super Admin',
        description: 'All authorized corporate and platform operations.',
        privileged: true,
        permissions: ALL_PERMISSIONS,
    },
    corporate_admin: {
        name: 'Corporate Admin',
        description: 'Corporate website, CMS, announcements and permitted reports.',
        privileged: true,
        permissions: [...base, 'overview.read', 'analytics.read', 'cms.read', 'cms.edit', 'cms.review', 'cms.publish', 'cms.delete',
            'media.read', 'media.manage', 'inquiries.read', 'inquiries.manage', 'careers.read', 'careers.manage', 'settings.read', 'users.read'],
    },
    finance_admin: {
        name: 'Finance Admin',
        description: 'Transactions, payments, commissions, refunds and financial reports.',
        privileged: true,
        permissions: [...base, 'overview.read', 'finance.read', 'analytics.read',
            'platform.marketplace.read', 'platform.errands.read', 'platform.travel_tour.read', 'integrations.read'],
    },
    marketplace_manager: {
        name: 'Marketplace Manager',
        description: 'Marketplace records and authorized Marketplace operations.',
        privileged: false,
        permissions: [...base, 'overview.read', 'platform.marketplace.read', 'finance.read', 'analytics.read'],
    },
    errands_manager: {
        name: 'Errands Manager',
        description: 'Errands records and authorized Errands operations.',
        privileged: false,
        permissions: [...base, 'overview.read', 'platform.errands.read', 'finance.read', 'analytics.read'],
    },
    travel_manager: {
        name: 'Travel Manager',
        description: 'Travel & Tour records and authorized Travel operations.',
        privileged: false,
        permissions: [...base, 'overview.read', 'platform.travel_tour.read', 'finance.read', 'analytics.read'],
    },
    content_manager: {
        name: 'Content Manager',
        description: 'Corporate CMS and media management (drafts are submitted for review).',
        privileged: false,
        permissions: [...base, 'cms.read', 'cms.edit', 'media.read', 'media.manage'],
    },
    analyst: {
        name: 'Analyst',
        description: 'Read-only authorized reports and analytics.',
        privileged: false,
        permissions: [...base, 'overview.read', 'analytics.read', 'finance.read',
            'platform.marketplace.read', 'platform.errands.read', 'platform.travel_tour.read'],
    },
};

/** Idempotent: adds missing permissions and system roles, refreshes their grants. Never deletes custom roles. */
export async function syncRbac(db: Db): Promise<void> {
    for (const [id, [category, description]] of Object.entries(PERMISSIONS)) {
        await db.query(
            `INSERT INTO admin_permissions (id, category, description) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, description = EXCLUDED.description`,
            [id, category, description],
        );
    }
    for (const [id, role] of Object.entries(SYSTEM_ROLES)) {
        await db.query(
            `INSERT INTO admin_roles (id, name, description, is_system, is_privileged) VALUES ($1, $2, $3, true, $4)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
                 is_system = true, is_privileged = EXCLUDED.is_privileged`,
            [id, role.name, role.description, role.privileged],
        );
        await db.query(`DELETE FROM admin_role_permissions WHERE role_id = $1`, [id]);
        for (const p of role.permissions) {
            await db.query(`INSERT INTO admin_role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, p]);
        }
    }
}

export async function permissionsForUser(db: Db, userId: string): Promise<Set<Permission>> {
    const rows = await db.query<{ permission_id: Permission }>(
        `SELECT DISTINCT rp.permission_id FROM admin_user_roles ur
         JOIN admin_role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1`,
        [userId],
    );
    return new Set(rows.map((r) => r.permission_id));
}

export function readablePlatforms(perms: Set<Permission>): PlatformId[] {
    return (Object.keys(PLATFORM_PERMISSION) as PlatformId[]).filter((p) => perms.has(PLATFORM_PERMISSION[p]));
}
