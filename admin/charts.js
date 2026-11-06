/**
 * Dependency-free SVG charts with hover/focus tooltips and a screen-reader data table.
 */
import { h, num } from './lib.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
};

function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
}

function srTable(caption, headers, rows) {
    return h('table', { class: 'adm-sr' }, h('caption', {}, caption),
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}

function legend(items) {
    return h('div', { class: 'adm-legend' }, items.map((i) => h('span', {}, h('i', { style: { background: i.color } }), i.name)));
}

function shortDay(d) {
    const dt = new Date(`${d}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * series: [{ name, color, values: number[] }], labels: string[] (x categories, usually days)
 */
export function lineChart({ labels, series, format = num, title = 'Chart', height = 240, stacked = false, kind = 'line' }) {
    const W = 720, H = height, pad = { l: 52, r: 12, t: 12, b: 28 };
    const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
    const max = niceMax(stacked || kind === 'bar' ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((x) => x.values)));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = (i) => pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = (v) => pad.t + ih - (v / max) * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title, preserveAspectRatio: 'none' });

    const grid = svgEl('g', { class: 'grid' });
    const axis = svgEl('g', { class: 'axis' });
    for (let t = 0; t <= 4; t++) {
        const v = (max / 4) * t;
        grid.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
        const tx = svgEl('text', { x: pad.l - 8, y: y(v) + 3, 'text-anchor': 'end' });
        tx.textContent = format(v, true);
        axis.append(tx);
    }
    const step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((l, i) => {
        if (i % step && i !== labels.length - 1) return;
        const tx = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' });
        tx.textContent = shortDay(l);
        axis.append(tx);
    });
    svg.append(grid, axis);

    if (kind === 'bar') {
        const bw = Math.max(2, (iw / labels.length) * 0.7);
        labels.forEach((_, i) => {
            let acc = 0;
            for (const s of series) {
                const v = s.values[i] ?? 0;
                if (!v) continue;
                const cx = pad.l + (i + 0.5) * (iw / labels.length);
                svg.append(svgEl('rect', { x: cx - bw / 2, y: y(acc + v), width: bw, height: Math.max(0, y(acc) - y(acc + v)), fill: s.color, rx: 2 }));
                acc += v;
            }
        });
    } else {
        const cum = labels.map(() => 0);
        for (const s of series) {
            const pts = s.values.map((v, i) => {
                const base = stacked ? cum[i] : 0;
                if (stacked) cum[i] += v;
                return [x(i), y(base + v)];
            });
            if (!pts.length) continue;
            const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
            svg.append(svgEl('path', { d: `${d}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`, fill: s.color, opacity: 0.08 }));
            svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
        }
    }

    const wrap = h('div', { class: 'adm-chart', tabindex: 0, 'aria-label': `${title}. Use left and right arrow keys to read values.` });
    const tip = h('div', { class: 'adm-chart__tip', hidden: true });
    const cursor = svgEl('line', { y1: pad.t, y2: pad.t + ih, stroke: '#0A0F24', 'stroke-opacity': 0.25, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    svg.append(cursor);
    let idx = -1;
    const show = (i) => {
        if (i < 0 || i >= labels.length) return;
        idx = i;
        const cx = kind === 'bar' ? pad.l + (i + 0.5) * (iw / labels.length) : x(i);
        cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
        tip.replaceChildren(h('strong', {}, shortDay(labels[i])), ...series.map((s) => h('div', {}, `${s.name}: ${format(s.values[i] ?? 0)}`)));
        tip.hidden = false;
        const rect = svg.getBoundingClientRect();
        tip.style.left = `${(cx / W) * rect.width}px`;
        tip.style.top = `${pad.t / H * rect.height + 8}px`;
    };
    const hide = () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const i = kind === 'bar' ? Math.floor((px - pad.l) / (iw / labels.length)) : Math.round(((px - pad.l) / iw) * (labels.length - 1));
        show(Math.max(0, Math.min(labels.length - 1, i)));
    });
    svg.addEventListener('mouseleave', hide);
    wrap.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { show(Math.min(labels.length - 1, idx + 1)); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { show(Math.max(0, idx - 1)); e.preventDefault(); }
    });
    wrap.addEventListener('blur', hide);
    wrap.append(svg, tip);
    return h('div', {}, wrap, legend(series), srTable(title, ['Date', ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => format(s.values[i] ?? 0))])));
}

/** items: [{ name, color, value }] */
export function donutChart({ items, title = 'Distribution', format = num, centerLabel = 'Total' }) {
    const total = items.reduce((s, i) => s + i.value, 0);
    const R = 70, C = 2 * Math.PI * R;
    const svg = svgEl('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-label': title });
    svg.append(svgEl('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: '#EEF0F5', 'stroke-width': 22 }));
    let offset = 0;
    for (const it of items) {
        if (!it.value || !total) continue;
        const len = (it.value / total) * C;
        const c = svgEl('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: it.color, 'stroke-width': 22, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 90 90)' });
        const t = svgEl('title'); t.textContent = `${it.name}: ${format(it.value)}`; c.append(t);
        svg.append(c);
        offset += len;
    }
    const centre = String(format(total, true));
    const v = svgEl('text', { x: 90, y: 88, 'text-anchor': 'middle', 'font-size': centre.length > 9 ? 14 : centre.length > 6 ? 17 : 22, 'font-weight': 800, fill: '#0A0F24' }); v.textContent = centre;
    const l = svgEl('text', { x: 90, y: 108, 'text-anchor': 'middle', 'font-size': 11, fill: '#5A6382' }); l.textContent = centerLabel;
    svg.append(v, l);
    const list = h('div', { class: 'adm-legend', style: { flexDirection: 'column', gap: '8px' } }, items.map((i) => h('span', {}, h('i', { style: { background: i.color } }),
        `${i.name} — ${format(i.value)}${total ? ` (${((i.value / total) * 100).toFixed(1)}%)` : ''}`)));
    return h('div', { class: 'adm-donut' }, h('div', { class: 'adm-chart' }, svg), list, srTable(title, ['Item', 'Value'], items.map((i) => [i.name, format(i.value)])));
}

/** Horizontal bars: rows [{ name, color, value }] */
export function barList({ rows, format = num, title = 'Comparison' }) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return h('div', { role: 'list', 'aria-label': title, style: { display: 'grid', gap: '10px' } }, rows.map((r) =>
        h('div', { role: 'listitem' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', marginBottom: '4px' } }, h('span', {}, r.name), h('strong', {}, format(r.value))),
            h('div', { style: { height: '10px', background: '#EEF0F5', borderRadius: '999px', overflow: 'hidden' } },
                h('div', { style: { width: `${(r.value / max) * 100}%`, height: '100%', background: r.color, borderRadius: '999px' } })))));
}
