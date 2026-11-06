import type { Db } from './db.js';
import type { Ctx } from './http.js';

export interface Actor {
    id: string;
    email: string;
}

export interface AuditEntry {
    action: string;
    outcome?: 'success' | 'failure';
    targetType?: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
}

/** Records a sensitive action. Never store secrets or passwords in metadata. */
export async function audit(db: Db, ctx: Pick<Ctx, 'ip' | 'userAgent'> | null, actor: Actor | null, entry: AuditEntry): Promise<void> {
    await db.query(
        `INSERT INTO audit_logs (actor_id, actor_email, action, outcome, target_type, target_id, ip, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [actor?.id ?? null, actor?.email ?? null, entry.action, entry.outcome ?? 'success', entry.targetType ?? null,
            entry.targetId ?? null, ctx?.ip ?? null, ctx?.userAgent?.slice(0, 300) ?? null, JSON.stringify(redact(entry.metadata ?? {}))],
    );
}

const SECRET_KEYS = /pass(word)?|secret|token|api[_-]?key|credential|authorization|code/i;

export function redact(value: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEYS.test(k)) out[k] = '[redacted]';
        else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
        else out[k] = v;
    }
    return out;
}
