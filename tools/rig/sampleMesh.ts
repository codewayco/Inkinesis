import type { TexturedMesh } from '../../engine/src/render/textured';

/** Where a sample landed. `clamped` means the query fell outside the posed
 *  mesh and was projected onto its nearest triangle rather than extrapolated,
 *  which would send a vertex somewhere the engine never put one. */
export interface Sample { x: number; y: number; clamped: boolean }

/**
 * Sample a mesh at a texture coordinate.
 *
 * The posed meshes are not the quads the export writes: the head deformer
 * replaces a driven layer with a proxy grid of its own, so the two disagree on
 * vertex count and on vertex order. What they DO agree on is the texture: the
 * same pixel is at the same (u, v) in both. So the map between them is a
 * barycentric lookup in UV space, and it is exact wherever the deformation is
 * piecewise linear, which is what a triangle mesh means.
 */
export function sampleAt(mesh: TexturedMesh, u: number, v: number): Sample {
  let best = -Infinity;
  let result: Sample = { x: 0, y: 0, clamped: true };
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t], i1 = mesh.indices[t + 1], i2 = mesh.indices[t + 2];
    const u0 = mesh.uv[i0 * 2], v0 = mesh.uv[i0 * 2 + 1];
    const u1 = mesh.uv[i1 * 2], v1 = mesh.uv[i1 * 2 + 1];
    const u2 = mesh.uv[i2 * 2], v2 = mesh.uv[i2 * 2 + 1];
    const det = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
    if (Math.abs(det) < 1e-12) continue;
    let a = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / det;
    let b = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / det;
    const inside = Math.min(a, b, 1 - a - b);
    if (inside <= best) continue;
    best = inside;
    if (inside < 0) {
      // Outside: clamp onto the simplex instead of extrapolating.
      a = Math.max(0, Math.min(1, a));
      b = Math.max(0, Math.min(1 - a, b));
    }
    const c = 1 - a - b;
    result = {
      x: a * mesh.xy[i0 * 2] + b * mesh.xy[i1 * 2] + c * mesh.xy[i2 * 2],
      y: a * mesh.xy[i0 * 2 + 1] + b * mesh.xy[i1 * 2 + 1] + c * mesh.xy[i2 * 2 + 1],
      clamped: inside < -1e-6,
    };
  }
  return result;
}
