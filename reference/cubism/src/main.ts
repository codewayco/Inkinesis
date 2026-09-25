import { CubismFramework } from '@cubism/live2dcubismframework';
import { CubismUserModel } from '@cubism/model/cubismusermodel';
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44';
import { CubismShaderManager_WebGL } from '@cubism/rendering/cubismshader_webgl';
import { CubismPose } from '@cubism/effect/cubismpose';
import { resolveFrame, type FrameRequest, type Parameter } from './controls';
import { alignedMatrix, clearColor, resolveAlignment, type Alignment } from './alignment';
import { calibratedValues, resolveCalibration, type Calibration, type HeadAxis } from './calibration';

interface ModelExport {
  FileReferences: { Moc: string; Textures: string[]; Pose?: string };
  Layout?: Record<string, number>;
}

export interface ReferenceHarness {
  parameters(): Parameter[];
  resetTrial(setup?: { alignment?: Alignment; neutralValues?: Record<string, number>;
    calibration?: Calibration }): void;
  frame(request: FrameRequest): { timeSeconds: number };
  frameAngles(request: { frame: number; fps: number; angles: Partial<Record<HeadAxis, number>> }):
    { timeSeconds: number };
  capture(): string;
  diagnostics(): unknown;
}

declare global {
  interface Window { referenceHarness?: ReferenceHarness; referenceError?: string }
}

async function checkedFetch(url: string | URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Reference input failed: ${response.status}`);
  return response;
}

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#reference')!;
  const requestedSize = new URLSearchParams(location.search).get('size');
  if (requestedSize !== null) {
    const size = Number(requestedSize);
    if (!Number.isSafeInteger(size) || size < 64 || size > 4096) throw new Error('Invalid capture size');
    canvas.width = canvas.height = size;
  }
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true,
    preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error('WebGL unavailable');
  if (!CubismFramework.startUp()) throw new Error('Cubism Core startup failed');
  CubismFramework.initialize();
  const manifest = await (await checkedFetch('/model-manifest')).json() as { url: string };
  const modelUrl = new URL(manifest.url, location.href);
  const description = await (await checkedFetch(modelUrl)).json() as ModelExport;
  const moc = await (await checkedFetch(new URL(description.FileReferences.Moc, modelUrl))).arrayBuffer();
  const poseData = description.FileReferences.Pose
    ? await (await checkedFetch(new URL(description.FileReferences.Pose, modelUrl))).arrayBuffer()
    : undefined;
  const textures: WebGLTexture[] = [];
  for (const file of description.FileReferences.Textures) {
    const bitmap = await createImageBitmap(await (await checkedFetch(new URL(file, modelUrl))).blob(),
      { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
    const texture = gl.createTexture();
    if (!texture) throw new Error('Texture allocation failed');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.push(texture);
    bitmap.close();
  }

  let userModel: CubismUserModel | undefined;
  let parameters: Parameter[] = [];
  let alignment = resolveAlignment();
  let neutralValues: Record<string, number> = {};
  let calibration: Calibration | undefined;
  let lastAngles: Partial<Record<HeadAxis, number>> | undefined;
  let lastFrame: FrameRequest | undefined;
  let mvp: Float32Array = new Float32Array();
  const resetTrial: ReferenceHarness['resetTrial'] = (setup = {}) => {
    // Validate before releasing the current trial, so invalid inputs are atomic.
    const nextAlignment = resolveAlignment(setup.alignment);
    const nextNeutral = { ...setup.neutralValues };
    if (userModel) resolveFrame(parameters, { frame: 0, fps: 60, values: nextNeutral });
    const nextCalibration = setup.calibration
      ? resolveCalibration(parameters, nextNeutral, setup.calibration) : undefined;
    userModel?.release();
    userModel = new CubismUserModel();
    userModel.loadModel(moc.slice(0), true);
    const model = userModel.getModel();
    // Initialize exported alternate-part groups once using SDK defaults. Freeze
    // those opacities; no elapsed-time pose controller runs during a trial.
    if (poseData) {
      const pose = CubismPose.create(poseData, poseData.byteLength);
      pose.reset(model);
      pose.copyPartOpacities(model);
      CubismPose.delete(pose);
    }
    parameters = Array.from({ length: model.getParameterCount() }, (_, i) => ({
      id: model.getParameterId(i).getString(),
      minimum: model.getParameterMinimumValue(i),
      maximum: model.getParameterMaximumValue(i),
      defaultValue: model.getParameterDefaultValue(i),
    }));
    // Validate the actual inventory before any ID could reach the SDK setter.
    resolveFrame(parameters, { frame: 0, fps: 60, values: {} });
    resolveFrame(parameters, { frame: 0, fps: 60, values: nextNeutral });
    alignment = nextAlignment;
    neutralValues = nextNeutral;
    calibration = nextCalibration;
    lastFrame = undefined;
    lastAngles = undefined;
    if (description.Layout) userModel.getModelMatrix().setupFromLayout(new Map(Object.entries(description.Layout)));
    userModel.createRenderer(canvas.width, canvas.height);
    const renderer = userModel.getRenderer();
    renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);
    textures.forEach((texture, i) => renderer.bindTexture(i, texture));
    // No motion, expression, blink, breath or physics controllers loaded.
    // A fresh Core model resets part opacities and drawable state between trials.
  };

  const harness: ReferenceHarness = {
    parameters: () => parameters.map(p => ({ ...p })),
    resetTrial,
    frameAngles(request) {
      const result = harness.frame({ frame: request.frame, fps: request.fps,
        values: calibratedValues(parameters, neutralValues, calibration, request.angles) });
      lastAngles = { ...request.angles };
      return result;
    },
    frame(request) {
      if (!userModel) throw new Error('No active trial');
      const frame = resolveFrame(parameters, { ...request,
        values: { ...neutralValues, ...request.values } });
      const model = userModel.getModel();
      frame.values.forEach((value, i) => model.setParameterValueByIndex(i, value));
      // The static reference has no elapsed-time effects; time labels come solely
      // from the explicit frame clock. Dynamics require a separate declared mode.
      model.update();
      const projection = new CubismMatrix44();
      mvp = alignedMatrix(userModel.getModelMatrix().getArray(), canvas.width, canvas.height, alignment);
      projection.setMatrix(mvp);
      const renderer = userModel.getRenderer();
      renderer.setMvpMatrix(projection);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...clearColor(alignment));
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.setRenderState(null, [0, 0, canvas.width, canvas.height]);
      renderer.drawModel();
      gl.finish();
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Reference WebGL error');
      lastFrame = { ...request, values: Object.fromEntries(parameters.map((p, i) => [p.id, frame.values[i]])) };
      lastAngles = undefined;
      return { timeSeconds: frame.timeSeconds };
    },
    capture() {
      if (!lastFrame) throw new Error('Render a frame after resetting the trial before capture');
      return canvas.toDataURL('image/png');
    },
    diagnostics() {
      const model = userModel!.getModel();
      return {
        viewport: { width: canvas.width, height: canvas.height },
        alignment: resolveAlignment(alignment), neutralValues: { ...neutralValues },
        calibration: calibration ? structuredClone(calibration) : null,
        requestedAngles: lastAngles ? { ...lastAngles } : null,
        exportedLayout: { ...description.Layout },
        modelMatrix: Array.from(userModel!.getModelMatrix().getArray()),
        mvp: lastFrame ? Array.from(mvp) : null,
        frame: lastFrame ? { ...lastFrame, values: { ...lastFrame.values } } : null,
        parameters: parameters.map((p, i) => ({ ...p, value: model.getParameterValueByIndex(i) })),
        parts: Array.from({ length: model.getPartCount() }, (_, i) => ({
          id: model.getPartId(i).getString(), opacity: model.getPartOpacityByIndex(i),
          parent: model.getPartParentPartIndices()[i],
        })),
        drawables: Array.from({ length: model.getDrawableCount() }, (_, i) => ({
          id: model.getDrawableId(i).getString(), opacity: model.getDrawableOpacity(i),
          visible: model.getDrawableDynamicFlagIsVisible(i),
          parent: model.getDrawableParentPartIndex(i),
          masks: Array.from(model.getDrawableMasks()[i]),
          invertedMask: model.getDrawableInvertedMaskBit(i),
        })),
      };
    },
  };
  resetTrial();
  // R5 loads shader source asynchronously. No render counts until it is ready.
  userModel!.getRenderer().loadShaders('/sdk-shaders/');
  const shader = CubismShaderManager_WebGL.getInstance().getShader(gl);
  const deadline = performance.now() + 20_000;
  while (!shader._isShaderLoaded) {
    if (performance.now() > deadline) throw new Error('Cubism shaders did not become ready');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // Some allocated slots are unused by this SDK; inspect compiled slots only.
  const programs = shader._shaderSets.map(set => set.shaderProgram).filter(p => p !== undefined);
  if (!programs.length || programs.some(program => !program ||
      !gl.getProgramParameter(program, gl.LINK_STATUS))) {
    throw new Error('Cubism shader compilation failed');
  }
  harness.frame({ frame: 0, fps: 60, values: {} });
  window.referenceHarness = harness;
  document.querySelector('#status')!.textContent =
    'Reference harness ready. Raw controls only; physical-angle calibration and neutral alignment pending.';
}

start().catch(error => {
  window.referenceError = String(error);
  document.querySelector('#status')!.textContent = String(error);
});
