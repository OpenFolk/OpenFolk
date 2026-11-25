/* OpenFolk web app: small line charts as inline SVG for the metrics of a mission (no library, no animation). */

const NS = 'http://www.w3.org/2000/svg';

/** Short number for an axis or a tile: 1234567 → 1.2M, 0.123 → 0.12. */
export function shortNumber(v) {
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
    return v.toFixed(3).replace(/\.?0+$/, '') || '0';
}

function el(name, attrs = {}) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
}

/**
 * A line chart of [label, value] points with the first and last label under it and min/max at the side; a zero line
 * when the values cross zero (profit, drawdown). Hovering is not needed: the last value stands at the end.
 * @param {[string, number][]} points
 * @param {{ unit?: string, label?: string }} [o]
 */
export function lineChart(points, o = {}) {
    const w = 320, h = 120, left = 4, right = 44, top = 8, bottom = 18;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': o.label || '' });
    if (!points.length) return svg;
    const values = points.map((p) => p[1]);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const x = (i) => left + (points.length === 1 ? (w - left - right) / 2 : (i / (points.length - 1)) * (w - left - right));
    const y = (v) => top + (1 - (v - min) / (max - min)) * (h - top - bottom);
    svg.append(el('line', { x1: left, x2: w - right, y1: y(max), y2: y(max), class: 'grid' }), el('line', { x1: left, x2: w - right, y1: y(min), y2: y(min), class: 'grid' }));
    if (min < 0 && max > 0) svg.append(el('line', { x1: left, x2: w - right, y1: y(0), y2: y(0), class: 'zero' }));
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    const area = `${d} L${x(points.length - 1).toFixed(1)},${(h - bottom).toFixed(1)} L${x(0).toFixed(1)},${(h - bottom).toFixed(1)} Z`;
    svg.append(el('path', { d: area, class: 'area' }), el('path', { d, class: 'line' }));
    const last = points[points.length - 1];
    svg.append(el('circle', { cx: x(points.length - 1), cy: y(last[1]), r: 2.5, class: 'dot' }));
    const text = (s, attrs) => { const n = el('text', attrs); n.textContent = s; svg.append(n); };
    text(shortNumber(max), { x: w - right + 4, y: y(max) + 4 });
    text(shortNumber(min), { x: w - right + 4, y: y(min) + 4 });
    text(String(points[0][0]).slice(0, 10), { x: left, y: h - 4 });
    text(String(last[0]).slice(0, 10), { x: w - right, y: h - 4, 'text-anchor': 'end' });
    return svg;
}
