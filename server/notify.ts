import type { Db } from './db.js';
import type { Permission } from './auth/rbac.js';

export interface NotificationInput {
    type: string;
    severity?: 'info' | 'success' | 'warning' | 'error';
    title: string;
    body?: string;
    link?: string;
    /** Only administrators holding this permission see the notification. */
    permission?: Permission;
    platform?: string;
}

export async function notify(db: Db, n: NotificationInput): Promise<void> {
    await db.query(
        `INSERT INTO central_notifications (type, severity, title, body, link, permission, platform) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [n.type, n.severity ?? 'info', n.title.slice(0, 200), (n.body ?? '').slice(0, 1000), n.link ?? null, n.permission ?? null, n.platform ?? null],
    );
}
