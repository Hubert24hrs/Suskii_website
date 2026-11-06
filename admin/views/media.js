/** Media library: upload, describe, reuse and delete website images. Also provides the CMS image picker. */
import { api, banner, clear, confirmAction, dateOnly, empty, errorState, h, icon, modal, pager, skeleton, toast } from '../lib.js';
import { session } from '../lib.js';
import { pageHead } from './common.js';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
const MAX = 4 * 1024 * 1024;
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const canManage = () => !!session()?.permissions.includes('media.manage');

async function upload(file, alt) {
    if (file.size > MAX) throw new Error(`${file.name} is larger than 4 MB.`);
    if (file.type === 'image/svg+xml') throw new Error('SVG files are not accepted because they can contain scripts.');
    return (await api('/api/media', {
        method: 'POST', body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), 'X-Alt-Text': encodeURIComponent(alt ?? '') },
    })).asset;
}

function dropZone(onFiles) {
    const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: () => { onFiles([...input.files]); input.value = ''; } });
    const zone = h('div', { class: 'adm-drop' }, icon('upload'), h('p', {}, 'Drag images here, or ', h('button', { class: 'adm-linkbtn', type: 'button', onclick: () => input.click() }, 'choose files')),
        h('small', {}, 'JPEG, PNG, WebP, GIF or AVIF · up to 4 MB · resized and converted to WebP automatically'), input);
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-over'); onFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); });
    return zone;
}

async function uploadMany(files, after) {
    for (const f of files) {
        try { await upload(f, ''); toast(`Uploaded ${f.name}. Add a description for accessibility.`, 'ok'); } catch (e) { toast(`${f.name}: ${e.message}`, 'error', 7000); }
    }
    after();
}

function card(asset, { onPick, onChanged }) {
    const alt = h('input', { class: 'adm-input', value: asset.alt ?? '', placeholder: 'Image description', maxlength: 300, 'aria-label': `Description for ${asset.filename}`, disabled: !canManage() });
    let saved = asset.alt ?? '';
    alt.addEventListener('change', async () => {
        try { await api(`/api/media/${asset.id}`, { method: 'PATCH', body: { alt: alt.value } }); saved = alt.value; toast('Description saved.', 'ok'); } catch (e) { alt.value = saved; toast(e.message, 'error'); }
    });
    return h('div', { class: 'adm-media' },
        h('img', { src: asset.variants?.[0]?.url ?? asset.url, alt: asset.alt ?? '', loading: 'lazy', width: asset.width ?? null, height: asset.height ?? null }),
        h('div', { class: 'adm-media__body' },
            h('strong', { title: asset.filename }, asset.filename),
            h('span', { class: 'adm-kpi__hint', style: { marginTop: 0 } }, `${asset.width ?? '?'}×${asset.height ?? '?'} · ${kb(asset.size_bytes)} · ${dateOnly(asset.created_at)}`),
            alt,
            !asset.alt ? h('span', { style: { color: '#B54708', fontWeight: 600 } }, 'Missing description') : null,
            h('div', { class: 'adm-actions' },
                onPick ? h('button', { class: 'btn btn--dark btn--sm', type: 'button', onclick: () => onPick({ ...asset, alt: alt.value }) }, 'Use image') : null,
                h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'Copy image address', onclick: () => navigator.clipboard?.writeText(new URL(asset.url, location.origin).href).then(() => toast('Address copied.', 'ok')) }, 'Copy URL'),
                !onPick && canManage() ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Delete ${asset.filename}`, onclick: async () => {
                    if (!(await confirmAction({ title: 'Delete this image?', message: 'Images that are used by website content cannot be deleted until they are replaced there.', confirmLabel: 'Delete', danger: true }))) return;
                    try { await api(`/api/media/${asset.id}`, { method: 'DELETE' }); toast('Image deleted.', 'ok'); onChanged(); } catch (e) { toast(e.message, 'error', 7000); }
                } }, icon('trash', 'icon icon--sm')) : null)));
}

async function grid(host, { page = 1, q = '', onPick } = {}) {
    clear(host).append(h('div', { class: 'adm-media-grid' }, skeleton('adm-skel--chart', 4)));
    let data;
    try { data = await api(`/api/media?page=${page}&q=${encodeURIComponent(q)}`); } catch (e) { clear(host).append(errorState(e)); return; }
    clear(host);
    if (!data.storageConfigured) host.append(banner('warn', 'File storage is not configured on this deployment (BLOB_READ_WRITE_TOKEN). Uploads are disabled until it is set.'));
    if (!data.items.length) { host.append(empty(q ? 'No images match' : 'No images yet', q ? 'Try another search.' : 'Uploaded images appear here and can be used anywhere on the website.', 'media')); return data; }
    host.append(h('div', { class: 'adm-media-grid' }, data.items.map((a) => card(a, { onPick, onChanged: () => grid(host, { page, q, onPick }) }))));
    if (data.total > data.pageSize) host.append(pager({ page, pageSize: data.pageSize, total: data.total, onPage: (p) => grid(host, { page: p, q, onPick }) }));
    return data;
}

function searchBox(onSearch) {
    const s = h('input', { type: 'search', class: 'adm-input', placeholder: 'Search by file name or description', 'aria-label': 'Search images' });
    let t;
    s.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onSearch(s.value.trim()), 250); });
    return s;
}

export async function render(root) {
    root.append(pageHead('Media Library', 'Images used on the corporate website. Every image needs a description for screen readers.'));
    const host = h('div', {});
    let q = '';
    const refresh = () => grid(host, { q });
    root.append(h('div', { class: 'adm-grid' }, canManage() ? dropZone((files) => uploadMany(files, refresh)) : null,
        h('div', { class: 'adm-filters', style: { marginBottom: 0 } }, searchBox((v) => { q = v; refresh(); }))), h('div', { class: 'adm-section-gap' }, host));
    await refresh();
}

/** Opens the library in a dialog and resolves with the chosen asset (or null). */
export function pickImage() {
    return new Promise((resolve) => {
        let done = false;
        const host = h('div', {});
        let q = '';
        const finish = (v) => { if (!done) { done = true; resolve(v); dlg.close(); } };
        const refresh = () => grid(host, { q, onPick: finish });
        const dlg = modal({
            title: 'Choose an image', wide: true,
            body: h('div', { class: 'adm-grid' },
                canManage() ? dropZone((files) => uploadMany(files, refresh)) : null,
                searchBox((v) => { q = v; refresh(); }), host),
            onClose: () => { if (!done) { done = true; resolve(null); } },
        });
        refresh();
    });
}
