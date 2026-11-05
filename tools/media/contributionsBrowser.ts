/** README figures for the three method contributions, rendered from delivered rigs.
 * Every panel is actual renderer output; colors, outlines and wireframes are overlays. */
import { readCombined, evaluateCombined, type CombinedAsset } from '../../player/src/combinedRuntime';
import { createCombinedRenderer } from '../../player/src/combinedRenderer';

type RGB = [number, number, number];
type Owner = 'left' | 'right' | 'seat' | 'torso';
interface Box { x: number; y: number; w: number; h: number }

const BG = '#0b0d11', PANEL = '#13161c', LINE = '#262a33', INK = '#f2efe8', MUTED = '#9b9a95', FAINT = '#6d6c68';
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const OWNER_COLORS: Record<Owner, RGB> = { left: [25, 179, 163], right: [240, 163, 60], seat: [154, 107, 255], torso: [125, 138, 156] };
const CARRIED: RGB = [66, 214, 160], LEFT_BEHIND: RGB = [255, 86, 102], MESH: RGB = [92, 196, 255];
// Posed limbs and held objects can leave the rig's own canvas, so renders keep a margin around it.
const RENDER = 2100, MARGIN = 1.6, PANEL_BG: RGB = [19, 22, 28];
const canvas = document.querySelector<HTMLCanvasElement>('#composition')!, ctx = canvas.getContext('2d')!;
const css = ([r, g, b]: RGB, a = 1) => `rgba(${r},${g},${b},${a})`;
const garment = (name: string) => /^(topwear|bottomwear|legwear|footwear|handwear)/.test(name);
const isObject = (name: string) => /^(objects|prop)(?:#|__|-|$)/.test(name);

async function load(id: string) {
    // Figure characters may be shipped examples or local evaluated rigs in other-avatars/.
    for (const root of ['example-avatars', 'other-avatars']) {
        const response = await fetch(`/${root}/${id}/character.inp`);
        if (response.ok && !response.headers.get('content-type')?.includes('html')) return readCombined(new Uint8Array(await response.arrayBuffer()));
    }
    throw Error(`Install ${id} before rendering`);
}
/** Limb parameters whose deformation carries this part. */
function owner(asset: CombinedAsset, uuid: number): Owner {
    const limbs = asset.puppet.param.filter(p => /^(Arm|Leg) [LR]$/.test(p.name) && p.bindings.some(b => b.node === uuid && b.param_name === 'deform')).map(p => p.name);
    const left = limbs.some(n => n.endsWith('L')), right = limbs.some(n => n.endsWith('R'));
    return left && right ? 'seat' : left ? 'left' : right ? 'right' : 'torso';
}
async function recolor(bytes: Uint8Array, shade: (r: number, g: number, b: number) => RGB) {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d')!;
    g.drawImage(bitmap, 0, 0); bitmap.close();
    const image = g.getImageData(0, 0, c.width, c.height), d = image.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { const [r, gg, b] = shade(d[i], d[i + 1], d[i + 2]); d[i] = r; d[i + 1] = gg; d[i + 2] = b; }
    g.putImageData(image, 0, 0);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}
const luminance = (r: number, g: number, b: number) => (.3 * r + .59 * g + .11 * b) / 255;
const tint = (color: RGB) => (r: number, g: number, b: number): RGB => { const k = .5 + .62 * luminance(r, g, b); return color.map(v => Math.min(255, v * k)) as RGB; };
const ghost = (r: number, g: number, b: number): RGB => { const v = 38 + 58 * luminance(r, g, b); return [v, v + 4, v + 11]; };

/** Same rig with parts re-textured by owning limb; non-garment parts become a dim silhouette. */
async function ownerAsset(asset: CombinedAsset): Promise<CombinedAsset> {
    const textures = [...asset.textures], cache = new Map<string, number>();
    const variant = async (index: number, key: string, shade: (r: number, g: number, b: number) => RGB) => {
        const k = `${index}:${key}`;
        if (!cache.has(k)) { textures.push(await recolor(asset.textures[index], shade)); cache.set(k, textures.length - 1); }
        return cache.get(k)!;
    };
    const parts = [];
    for (const part of asset.parts) {
        const o = owner(asset, part.uuid), key = garment(part.name) ? o : 'ghost';
        parts.push({ ...part, textures: [await variant(part.textures![0], key, key === 'ghost' ? ghost : tint(OWNER_COLORS[o]))] });
    }
    return { ...asset, parts, textures };
}
/** Ablation: the held objects lose their wrist carriers and stay where they were drawn. */
function withoutCarriers(asset: CombinedAsset): CombinedAsset {
    const objects = new Set(asset.parts.filter(p => isObject(p.name)).map(p => p.uuid));
    return { ...asset, puppet: { ...asset.puppet, param: asset.puppet.param.map(p => ({ ...p, bindings: p.bindings.filter(b => !objects.has(b.node)) })) } };
}
const objectsOnly = (asset: CombinedAsset): CombinedAsset => ({ ...asset, parts: asset.parts.map(p => ({ ...p, enabled: p.enabled && isObject(p.name) })) });

async function render(asset: CombinedAsset, values: Record<string, number[]>, background = PANEL_BG) {
    const c = document.createElement('canvas'); c.style.width = c.style.height = RENDER + 'px';
    document.querySelector('#renders')!.append(c);
    const renderer = await createCombinedRenderer(c, { ...asset, width: asset.width * MARGIN, height: asset.height * MARGIN }, { background: background.map(v => v / 255) as RGB });
    renderer.draw(values);
    const out = document.createElement('canvas'); out.width = c.width; out.height = c.height; out.getContext('2d')!.drawImage(c, 0, 0);
    renderer.dispose(); c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); c.remove();
    return out;
}
/** Character bounds: pixels that differ from the panel background, padded. */
function bounds(images: HTMLCanvasElement[], pad = .05): Box {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const image of images) {
        const d = image.getContext('2d')!.getImageData(0, 0, image.width, image.height).data;
        for (let y = 0; y < image.height; y += 2) for (let x = 0; x < image.width; x += 2) {
            const i = 4 * (y * image.width + x);
            if (Math.abs(d[i] - PANEL_BG[0]) + Math.abs(d[i + 1] - PANEL_BG[1]) + Math.abs(d[i + 2] - PANEL_BG[2]) > 18) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
    }
    const w = x1 - x0, h = y1 - y0, p = Math.max(w, h) * pad;
    return { x: x0 - p, y: y0 - p, w: w + 2 * p, h: h + 2 * p };
}
/** Screen transform used by the WebGL renderer for a square render target. */
const project = (asset: CombinedAsset) => { const s = Math.min(RENDER / asset.width, RENDER / asset.height) / MARGIN * .96; return (x: number, y: number) => [RENDER / 2 + x * s, RENDER / 2 + y * s]; };

function text(s: string, x: number, y: number, size: number, color = INK, weight = 400, align: CanvasTextAlign = 'left', spacing = 0) {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing + 'px';
    ctx.fillText(s, x, y);
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
}
function roundRect(x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
/** Panel with the character crop fitted inside, a caption above and an optional overlay painter. */
function panel(image: HTMLCanvasElement, box: Box, x: number, y: number, w: number, h: number, caption: string, sub = '', accent = MUTED) {
    roundRect(x, y, w, h, 22, PANEL, LINE);
    const top = 78, s = Math.min((w - 40) / box.w, (h - top - 24) / box.h), dw = box.w * s, dh = box.h * s;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 22); ctx.clip();
    ctx.drawImage(image, box.x, box.y, box.w, box.h, x + (w - dw) / 2, y + top + (h - top - 24 - dh) / 2, dw, dh);
    ctx.restore();
    text(caption, x + 28, y + 46, 27, INK, 600);
    if (sub) text(sub, x + w - 28, y + 46, 22, accent, 500, 'right');
    return { s, ox: x + (w - dw) / 2 - box.x * s, oy: y + top + (h - top - 24 - dh) / 2 - box.y * s };
}
function header(eyebrow: string, color: RGB, title: string, lead: string) {
    ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `700 22px ${FONT}`; const w = ctx.measureText(eyebrow.toUpperCase()).width + 3 * eyebrow.length + 40;
    roundRect(64, 52, w, 42, 21, css(color, .14), css(color, .55));
    text(eyebrow.toUpperCase(), 64 + 20, 81, 22, css(color), 700, 'left', 3);
    text(title, 64, 162, 58, INK, 700);
    text(lead, 64, 210, 26, MUTED, 400);
}
function chip(color: RGB, label: string, x: number, y: number) {
    roundRect(x, y - 22, 30, 30, 8, css(color));
    text(label, x + 44, y, 24, INK, 500);
    ctx.font = `500 24px ${FONT}`; return x + 44 + ctx.measureText(label).width + 48;
}
function stat(value: string, unit: string, label: string, x: number, y: number, color: RGB) {
    text(value, x, y, 72, css(color), 700);
    ctx.font = `700 72px ${FONT}`; const w = ctx.measureText(value).width;
    if (unit) text(unit, x + w + 8, y, 30, MUTED, 600);
    text(label, x, y + 44, 23, MUTED, 400);
}
/** Glow around the alpha of an object-only render, drawn through a panel transform. */
function glow(mask: HTMLCanvasElement, box: Box, t: { s: number; ox: number; oy: number }, color: RGB) {
    const m = document.createElement('canvas'); m.width = mask.width; m.height = mask.height;
    const g = m.getContext('2d')!, src = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height), out = g.createImageData(mask.width, mask.height);
    for (let i = 0; i < src.data.length; i += 4) {
        const differs = Math.abs(src.data[i] - PANEL_BG[0]) + Math.abs(src.data[i + 1] - PANEL_BG[1]) + Math.abs(src.data[i + 2] - PANEL_BG[2]) > 18;
        if (differs) { out.data[i] = color[0]; out.data[i + 1] = color[1]; out.data[i + 2] = color[2]; out.data[i + 3] = 255; }
    }
    g.putImageData(out, 0, 0);
    // The object's own pixels, so the halo sits behind it instead of tinting it.
    const o = document.createElement('canvas'); o.width = mask.width; o.height = mask.height;
    const pixels = new ImageData(new Uint8ClampedArray(src.data), mask.width, mask.height);
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = out.data[i + 3];
    o.getContext('2d')!.putImageData(pixels, 0, 0);
    const place = (image: HTMLCanvasElement) => ctx.drawImage(image, box.x, box.y, box.w, box.h, t.ox + box.x * t.s, t.oy + box.y * t.s, box.w * t.s, box.h * t.s);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [blur, alpha] of [[40, .6], [16, .85]] as const) { ctx.filter = `blur(${blur * t.s}px)`; ctx.globalAlpha = alpha; place(m); }
    ctx.restore(); place(o);
}

const api = {
    /** Pose sheet for choosing figure poses. */
    async poses(id: string, list: Record<string, number[]>[]) {
        const asset = await load(id), images = await Promise.all(list.map(v => render(asset, v))), box = bounds(images);
        canvas.width = 420 * list.length; canvas.height = 640; ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height);
        images.forEach((image, i) => { panel(image, box, i * 420 + 10, 10, 400, 620, String(i), JSON.stringify(list[i]).slice(0, 40)); });
        return canvas.toDataURL('image/png').split(',')[1];
    },
    /** Ownership colors at rest for choosing the figure cast. */
    async ownerSheet(ids: string[]) {
        const images = [];
        for (const id of ids) images.push(await render(await ownerAsset(await load(id)), {}));
        canvas.width = 420 * ids.length; canvas.height = 640; ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height);
        images.forEach((image, i) => panel(image, bounds([image]), i * 420 + 10, 10, 400, 620, ids[i].slice(0, 22)));
        return canvas.toDataURL('image/png').split(',')[1];
    },
    /** Garment ownership: artwork, ownership x-ray at rest, x-ray and artwork in a pose. */
    async ownership(rows: { id: string; label: string; pose: Record<string, number[]> }[]) {
        canvas.width = 2400; canvas.height = 300 + rows.length * 780 + 150;
        header('Garment ownership', OWNER_COLORS.seat, 'Every garment pixel knows which limb carries it',
            'Sleeves follow the arms, trouser tubes follow the legs, the seat blends both, and everything else stays with the torso.');
        for (const [r, row] of rows.entries()) {
            const asset = await load(row.id), owners = await ownerAsset(asset);
            const images = [await render(asset, {}), await render(owners, {}), await render(owners, row.pose), await render(asset, row.pose)];
            const box = bounds(images), y = 260 + r * 780, w = (2400 - 128 - 3 * 28) / 4;
            const titles = ['Artwork', 'Ownership at rest', 'Ownership in motion', 'Delivered rig in motion'];
            images.forEach((image, i) => panel(image, box, 64 + i * (w + 28), y, w, 750, titles[i], i === 0 ? row.label : ''));
        }
        const y = canvas.height - 92; let x = 64;
        x = chip(OWNER_COLORS.left, 'Left limb', x, y); x = chip(OWNER_COLORS.right, 'Right limb', x, y);
        x = chip(OWNER_COLORS.seat, 'Seat: blends both legs', x, y); chip(OWNER_COLORS.torso, 'Torso: stays in place', x, y);
        text('Torso drift  11.77%  →  0.28%', 2400 - 64, y - 4, 34, INK, 700, 'right');
        text('nearest-bone assignment vs. Inkinesis, 64 characters', 2400 - 64, y + 34, 22, MUTED, 400, 'right');
        return canvas.toDataURL('image/webp', .93).split(',')[1];
    },
    /** Held-object carriers: rest, Inkinesis in a raised pose, and the same pose with carriers removed. */
    async carriers(id: string, label: string, pose: Record<string, number[]>) {
        canvas.width = 2400; canvas.height = 1110;
        header('Held-object carriers', CARRIED, 'Objects stay in the hand',
            'Each object touching a hand rides a rigid carrier that follows that wrist; without carriers the arms leave the objects behind.');
        const asset = await load(id), off = withoutCarriers(asset);
        const images = [await render(asset, {}), await render(asset, pose), await render(off, pose)];
        const masks = [await render(objectsOnly(asset), {}), await render(objectsOnly(asset), pose), await render(objectsOnly(off), pose)];
        const box = bounds(images, .04), w = (2400 - 128 - 2 * 28 - 520) / 3, h = 790;
        const captions: [string, string, RGB][] = [['Artwork', label, [155, 154, 149]], ['Inkinesis', 'objects follow', CARRIED], ['Carriers off', 'objects left behind', LEFT_BEHIND]];
        images.forEach((image, i) => {
            const t = panel(image, box, 64 + i * (w + 28), 260, w, h, captions[i][0], captions[i][1], css(captions[i][2]));
            if (i) glow(masks[i], box, t, captions[i][2]);
        });
        const x = 2400 - 64 - 492; roundRect(x, 260, 492, h, 22, PANEL, LINE);
        text('New hand–object', x + 40, 340, 30, INK, 600); text('contact loss', x + 40, 378, 30, INK, 600);
        text('35 characters · 64 multi-joint poses', x + 40, 418, 21, MUTED);
        const bar = (value: number, name: string, y: number, color: RGB) => {
            text(name, x + 40, y, 25, INK, 500); text(value.toFixed(2) + '%', x + 452, y, 25, css(color), 700, 'right');
            roundRect(x + 40, y + 18, 412, 22, 11, '#1d2129'); roundRect(x + 40, y + 18, Math.max(22, 412 * value / 100), 22, 11, css(color));
        };
        bar(2.86, 'Inkinesis', 500, CARRIED); bar(95.71, 'Carriers removed', 600, LEFT_BEHIND);
        stat('33×', '', 'less contact loss than the same rig', x + 40, 770, CARRIED); text('without wrist carriers', x + 40, 842, 23, MUTED);
        text('Same arm pose in both panels;', x + 40, 990, 21, FAINT); text('only the carriers are removed.', x + 40, 1020, 21, FAINT);
        return canvas.toDataURL('image/webp', .93).split(',')[1];
    },
    /** Verified export: rendered rig with a scan line revealing its posed triangle mesh. */
    async export(id: string, label: string, pose: Record<string, number[]>) {
        canvas.width = 2400; canvas.height = 1290;
        header('Verified Live2D export', MESH, 'The exported model moves exactly like the preview',
            'Every rig is written as Inochi2D and as a Live2D MOC3, then checked vertex by vertex under the official Cubism Core.');
        const asset = await load(id), art = await render(asset, pose), box = bounds([art], .06);
        const mesh = document.createElement('canvas'); mesh.width = mesh.height = RENDER; const m = mesh.getContext('2d')!;
        m.fillStyle = css(PANEL_BG); m.fillRect(0, 0, RENDER, RENDER); m.globalAlpha = .16; m.drawImage(art, 0, 0); m.globalAlpha = 1;
        const at = project(asset), posed = evaluateCombined(asset, pose);
        m.strokeStyle = css(MESH, .55); m.lineWidth = .55; m.beginPath();
        posed.forEach((p, i) => {
            if (!p.enabled || p.opacity <= .01) return;
            const idx = asset.parts[i].mesh!.indices;
            for (let k = 0; k < idx.length; k += 3) {
                const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map(v => at(p.xy[2 * v], p.xy[2 * v + 1]));
                m.moveTo(a[0], a[1]); m.lineTo(b[0], b[1]); m.lineTo(c[0], c[1]); m.closePath();
            }
        });
        m.stroke();
        const w = 1300, x = 64, y = 260, h = 960, t = panel(art, box, x, y, w, h, 'Rendered rig  ·  posed triangle mesh', label);
        const split = x + w * .5;
        ctx.save(); ctx.beginPath(); ctx.rect(split, y + 70, x + w - split, h - 70); ctx.clip();
        ctx.drawImage(mesh, box.x, box.y, box.w, box.h, t.ox + box.x * t.s, t.oy + box.y * t.s, box.w * t.s, box.h * t.s); ctx.restore();
        const gradient = ctx.createLinearGradient(split - 40, 0, split + 40, 0);
        gradient.addColorStop(0, css(MESH, 0)); gradient.addColorStop(.5, css(MESH, .5)); gradient.addColorStop(1, css(MESH, 0));
        ctx.fillStyle = gradient; ctx.fillRect(split - 40, y + 70, 80, h - 94); ctx.fillStyle = css(MESH); ctx.fillRect(split - 1.5, y + 70, 3, h - 94);
        text('rendered', split - 24, y + h - 36, 22, MUTED, 500, 'right'); text('posed triangles', split + 24, y + h - 36, 22, css(MESH), 500);
        const sx = x + w + 28, sw = 2400 - 64 - sx; roundRect(sx, y, sw, h, 22, PANEL, LINE);
        stat('94/94', '', 'Live2D exports load and match the source rig', sx + 56, y + 150, MESH);
        stat('0.005', 'px', 'vertex tolerance at every protocol pose', sx + 56, y + 360, MESH);
        stat('0.18', '×10⁻³ px', 'worst measured deviation', sx + 56, y + 570, MESH);
        stat('164', 'poses', 'per rig, including multi-joint combinations', sx + 56, y + 780, MESH);
        text('Checks cover vertex coordinates and opacity under the official Cubism Core;', sx + 56, y + h - 60, 20, FAINT);
        text('Live2D packages target Cubism 5.0 or newer.', sx + 56, y + h - 32, 20, FAINT);
        return canvas.toDataURL('image/webp', .93).split(',')[1];
    },
};
declare global { interface Window { contributions: typeof api } }
window.contributions = api;
