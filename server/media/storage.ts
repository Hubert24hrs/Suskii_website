/**
 * File storage: Vercel Blob in production (BLOB_READ_WRITE_TOKEN), the local filesystem in development.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { blobToken, isProduction } from '../config.js';
import { unavailable } from '../http.js';

export interface StoredObject { key: string; url: string }

export interface Storage {
    readonly kind: 'blob' | 'local';
    put(key: string, body: Uint8Array, contentType: string, opts?: { private?: boolean }): Promise<StoredObject>;
    get(obj: StoredObject): Promise<Uint8Array>;
    remove(obj: StoredObject): Promise<void>;
}

const LOCAL_ROOT = join(process.cwd(), '.data');

class LocalStorage implements Storage {
    readonly kind = 'local' as const;
    private path(key: string, priv: boolean): string {
        const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
        return join(LOCAL_ROOT, priv ? 'private' : 'uploads', safe);
    }
    async put(key: string, body: Uint8Array, _type: string, opts: { private?: boolean } = {}): Promise<StoredObject> {
        const file = this.path(key, !!opts.private);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, body);
        return { key: (opts.private ? 'private:' : '') + key, url: opts.private ? '' : `/uploads/${key}` };
    }
    async get(obj: StoredObject): Promise<Uint8Array> {
        const priv = obj.key.startsWith('private:');
        return new Uint8Array(await readFile(this.path(obj.key.replace(/^private:/, ''), priv)));
    }
    async remove(obj: StoredObject): Promise<void> {
        const priv = obj.key.startsWith('private:');
        await rm(this.path(obj.key.replace(/^private:/, ''), priv), { force: true });
    }
}

class BlobStorage implements Storage {
    readonly kind = 'blob' as const;
    constructor(private token: string) {}
    async put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
        const { put } = await import('@vercel/blob');
        const res = await put(key, Buffer.from(body), { access: 'public', contentType, token: this.token, addRandomSuffix: true });
        return { key: res.pathname, url: res.url };
    }
    async get(obj: StoredObject): Promise<Uint8Array> {
        const res = await fetch(obj.url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    }
    async remove(obj: StoredObject): Promise<void> {
        const { del } = await import('@vercel/blob');
        await del(obj.url, { token: this.token });
    }
}

let cached: Storage | undefined;
export function storage(): Storage {
    if (cached) return cached;
    const token = blobToken();
    if (token) cached = new BlobStorage(token);
    else if (!isProduction()) cached = new LocalStorage();
    else throw unavailable('File storage is not configured. Connect Vercel Blob (BLOB_READ_WRITE_TOKEN) to upload media.');
    return cached;
}

export function storageConfigured(): boolean {
    return blobToken() !== '' || !isProduction();
}
