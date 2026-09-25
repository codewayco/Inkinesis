/** Real-time WebGL rasterization of combined INP meshes and native threshold masks. */
import { evaluateCombined, type CombinedAsset } from './combinedRuntime';
export interface CombinedRendererOptions {
    /** Clear color as RGB in [0,1]; the viewer default is the dark studio background. */
    background?: [number, number, number];
}
export async function createCombinedRenderer(canvas: HTMLCanvasElement, asset: CombinedAsset, options: CombinedRendererOptions = {}) {
    const background = options.background ?? [.125, .13, .145];
    const gl = canvas.getContext('webgl2', { alpha: false, stencil: true, preserveDrawingBuffer: true });
    if (!gl)
        throw new Error('WebGL 2 is required');
    const shader = (kind: number, source: string) => { const s = gl.createShader(kind)!; gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'Shader failed'); return s; };
    const program = gl.createProgram()!;
    const shaders = [shader(gl.VERTEX_SHADER, `#version 300 es
    in vec2 pos; in vec2 uv; uniform vec2 view; out vec2 tex;
    void main(){gl_Position=vec4(pos.x/view.x*2.,-pos.y/view.y*2.,0,1);tex=uv;}`), shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; in vec2 tex; uniform sampler2D image; uniform float opacity; uniform float threshold; out vec4 color;
    void main(){vec4 c=texture(image,tex);if(threshold>=0. && c.a<=threshold)discard;color=c*opacity;}`)];
    shaders.forEach(s => gl.attachShader(program, s));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error('Shader link failed');
    gl.useProgram(program);
    const view = gl.getUniformLocation(program, 'view'), opacity = gl.getUniformLocation(program, 'opacity'), threshold = gl.getUniformLocation(program, 'threshold');
    const textures: WebGLTexture[] = [];
    for (const bytes of asset.textures) {
        // Filter premultiplied texels, matching the CPU renderer. Straight-alpha
        // interpolation leaks hidden RGB into mouth patches and other cutout edges.
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), { premultiplyAlpha: 'premultiply' });
        const texture = gl.createTexture()!;
        textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        bitmap.close();
    }
    const buffers: WebGLBuffer[] = [];
    const meshes = asset.parts.map(n => {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buffer = (target: number, data: Float32Array | Uint32Array) => { const b = gl.createBuffer()!; buffers.push(b); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.DYNAMIC_DRAW); return b; };
        const xy = buffer(gl.ARRAY_BUFFER, new Float32Array(n.mesh!.verts));
        const loc = gl.getAttribLocation(program, 'pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        buffer(gl.ARRAY_BUFFER, new Float32Array(n.mesh!.uvs));
        const uv = gl.getAttribLocation(program, 'uv');
        gl.enableVertexAttribArray(uv);
        gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
        buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(n.mesh!.indices));
        return { vao, xy };
    });
    const byId = new Map(asset.parts.map((n, i) => [n.uuid, i]));
    const order = asset.parts.map((_, i) => i).sort((a, b) => asset.parts[a].zsort - asset.parts[b].zsort);
    return { draw(values: Record<string, number[]>) {
            const bounds = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
            const w = Math.max(1, Math.round(bounds.width * dpr)), h = Math.max(1, Math.round(bounds.height * dpr));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            gl.viewport(0, 0, w, h);
            gl.useProgram(program);
            const scale = Math.min(w / asset.width, h / asset.height) * .96;
            gl.uniform2f(view, w / scale, h / scale);
            gl.clearColor(background[0], background[1], background[2], 1);
            gl.stencilMask(255);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            const posed = evaluateCombined(asset, values);
            for (let i = 0; i < meshes.length; i++) {
                gl.bindBuffer(gl.ARRAY_BUFFER, meshes[i].xy);
                gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(posed[i].xy));
            }
            const draw = (i: number, alpha: number, cutoff = -1) => { gl.bindVertexArray(meshes[i].vao); gl.bindTexture(gl.TEXTURE_2D, textures[asset.parts[i].textures![0]]); gl.uniform1f(opacity, alpha); gl.uniform1f(threshold, cutoff); gl.drawElements(gl.TRIANGLES, asset.parts[i].mesh!.indices.length, gl.UNSIGNED_INT, 0); };
            for (const i of order) {
                const part = posed[i], node = asset.parts[i];
                if (!part.enabled || part.opacity <= 0)
                    continue;
                const mask = node.masks?.[0];
                if (mask) {
                    const source = byId.get(mask.source);
                    if (source === undefined)
                        throw new Error('Missing mask source');
                    gl.enable(gl.STENCIL_TEST);
                    gl.stencilMask(255);
                    gl.clear(gl.STENCIL_BUFFER_BIT);
                    gl.stencilFunc(gl.ALWAYS, 1, 255);
                    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
                    gl.colorMask(false, false, false, false);
                    draw(source, 1, asset.parts[source].mask_threshold ?? .5);
                    gl.colorMask(true, true, true, true);
                    gl.stencilMask(0);
                    gl.stencilFunc(gl.EQUAL, 1, 255);
                    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                }
                else
                    gl.disable(gl.STENCIL_TEST);
                draw(i, Math.max(0, Math.min(1, part.opacity)));
            }
            gl.disable(gl.STENCIL_TEST);
        }, dispose() { textures.forEach(t => gl.deleteTexture(t)); buffers.forEach(b => gl.deleteBuffer(b)); meshes.forEach(m => gl.deleteVertexArray(m.vao)); shaders.forEach(s => gl.deleteShader(s)); gl.deleteProgram(program); } };
}
