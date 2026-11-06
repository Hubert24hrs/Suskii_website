import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string, exts = ['.js', '.html', '.css', '.json']): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p, exts) : exts.some((e) => p.endsWith(e)) ? [p] : [];
    });
}

const SECRET_PATTERNS = [
    // Variable names may appear in help text; values must never appear.
    /(CENTRAL_ADMIN_SECRET|DATABASE_URL|BLOB_READ_WRITE_TOKEN|RESEND_API_KEY|CRON_SECRET|_API_KEY|WEBHOOK_[A-Z]+_SECRET)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{8,}/,
    /process\.env/,
    /postgres(ql)?:\/\//i,
    /\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

describe('browser bundles', () => {
    const browserFiles = [...files('admin'), ...files('js'), ...files('css'), ...['index.html', '404.html', 'privacy.html', 'terms.html', 'referral.html'].filter(existsSync)];

    it('contain no secrets, environment access or connection strings', () => {
        expect(browserFiles.length).toBeGreaterThan(5);
        for (const f of browserFiles) {
            const text = readFileSync(f, 'utf8');
            for (const re of SECRET_PATTERNS) expect(re.test(text), `${f} matches ${re}`).toBe(false);
        }
    });

    it('the build only publishes public files (never server code, migrations or scripts)', () => {
        const src = readFileSync('scripts/build-site.ts', 'utf8');
        const dirs = src.match(/PUBLIC_DIRS\s*=\s*\[([^\]]*)\]/)![1];
        for (const forbidden of ['server', 'db', 'scripts', 'tests', 'api', 'node_modules', '.data']) expect(dirs).not.toMatch(new RegExp(`['"]${forbidden.replace('.', '\\.')}['"]`));
    });

    it('the admin is never indexed and cannot be framed', () => {
        const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
        const admin = cfg.headers.find((h: any) => h.source.startsWith('/admin'));
        const get = (k: string) => admin.headers.find((x: any) => x.key === k)?.value;
        expect(get('X-Robots-Tag')).toMatch(/noindex/);
        expect(get('X-Frame-Options')).toBe('DENY');
        expect(get('Content-Security-Policy')).toMatch(/frame-ancestors 'none'/);
        expect(get('Cache-Control')).toBe('no-store');
        expect(readFileSync('robots.txt', 'utf8')).toMatch(/Disallow:\s*\/admin/);
    });
});

describe('serverless runtime compatibility', () => {
    it('the API loads without require() of ES modules (as on Vercel)', async () => {
        const { execFileSync } = await import('node:child_process');
        const code = `const { handle } = await import('./server/app.ts');
const r = await handle(new Request('http://x/api/health'));
const c = await import('./server/cms/content.ts');
console.log(r.status, c.sanitizeRich('<p>ok<script>x</script></p>'));`;
        const out = execFileSync(process.execPath, ['--no-experimental-require-module', '--import', 'tsx', '--input-type=module', '-e', code], {
            env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8', timeout: 60_000,
        });
        expect(out.trim()).toBe('200 <p>ok</p>');
    }, 90_000);
});
