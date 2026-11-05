import { openSync, writeSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Serialize plain JSON data without constructing one V8-sized string. */
export function writeJson(path: string, value: unknown) {
  const fd = openSync(path, 'w'), digest = createHash('sha256');
  let pending = '', bytes = 0;
  const flush = () => {
    if (!pending) return;
    const buffer = Buffer.from(pending, 'utf8');
    for (let offset = 0; offset < buffer.length;) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    digest.update(buffer); bytes += buffer.length; pending = '';
  };
  const emit = (s: string) => { pending += s; if (pending.length >= 65536) flush(); };
  const ancestors = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v !== 'object') { emit(JSON.stringify(v) ?? 'null'); return; }
    if (ancestors.has(v)) throw new TypeError('Circular JSON data');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
      throw new TypeError('Expected plain JSON object');
    ancestors.add(v);
    if (Array.isArray(v)) {
      emit('[');
      // Numeric coordinate fields dominate the bridge. Bound each temporary string.
      for (let start = 0; start < v.length; start += 4096) {
        const chunk = v.slice(start, start + 4096);
        if (chunk.every(x => x === null || typeof x !== 'object')) {
          if (start) emit(','); emit(JSON.stringify(chunk).slice(1, -1));
        } else for (let j = 0; j < chunk.length; j++) { if (start + j) emit(','); visit(chunk[j]); }
      }
      emit(']');
    } else {
      emit('{'); let first = true;
      for (const key of Object.keys(v)) {
        const child = (v as Record<string, unknown>)[key];
        if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
        if (!first) emit(','); first = false;
        emit(JSON.stringify(key)); emit(':'); visit(child);
      }
      emit('}');
    }
    ancestors.delete(v);
  };
  try { visit(value); flush(); } finally { closeSync(fd); }
  return { sha256: digest.digest('hex'), bytes };
}
