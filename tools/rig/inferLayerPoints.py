"""Geometric landmark proposals from prepared source pixels; no image synthesis.

Existing source points are never replaced. Proposals remain unverified and must
pass ownership, motion and export checks before a control can become available.
"""
import json
import sys
import numpy as np
from PIL import Image
from psd_tools import PSDImage
from scipy import ndimage


def propose(analysis, psd_path, width, height):
    psd = PSDImage.open(psd_path)
    if (psd.width, psd.height) != (width, height):
        raise ValueError('Prepared PSD and rig canvas must match')
    scale = max(width, height) / max(analysis['source']['width'], analysis['source']['height'])
    offset = np.array([(width-analysis['source']['width']*scale)/2,
                       (height-analysis['source']['height']*scale)/2])
    known = {k: np.array([v['x'], v['y']])*scale+offset
             for k, v in analysis['points'].items() if v}
    masks, layers = {}, []
    for layer in psd:
        if not layer.is_visible() or layer.is_group():
            continue
        image = layer.topil()
        if image is None:
            continue
        name = layer.name.strip().lower().replace('_', '-')
        layers.append(dict(name=name, x=layer.left, y=layer.top,
                           width=layer.width, height=layer.height))
        alpha = np.asarray(image.convert('RGBA'))[:, :, 3] > 64
        mask = np.zeros((height, width), bool)
        x, y = layer.left, layer.top
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(width, x+alpha.shape[1]), min(height, y+alpha.shape[0])
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] = alpha[y0-y:y1-y, x0-x:x1-x]
        masks[name] = masks.get(name, np.zeros_like(mask)) | mask

    def row_center(mask, fraction):
        ys, xs = np.nonzero(mask)
        low, high = np.quantile(ys, [.01, .99])
        row = low+fraction*(high-low)
        keep = abs(ys-row) <= max(3, .025*(high-low))
        return np.array([np.median(xs[keep]), np.median(ys[keep])]) if keep.sum() >= 4 else None

    alpha_points, provenance, declined = dict(known), {}, []
    for arm, names, joints in [(True, ['arm', 'handwear'], ['shoulder', 'elbow', 'wrist']),
                              (False, ['legwear', 'leg'], ['hip', 'knee', 'ankle'])]:
        for side in ['L', 'R']:
            missing = [j+side for j in joints if j+side not in known]
            if not missing:
                continue
            material = [v for n, v in masks.items() if n in [p+'-'+side.lower() for p in names]]
            shared = not material
            if shared:
                material = [v for n, v in masks.items() if n in names]
            if not material:
                declined.append(('Arm ' if arm else 'Leg ')+side)
                continue
            mask = np.logical_or.reduce(material)
            if shared:
                ys, xs = np.nonzero(mask)
                if not len(xs):
                    continue
                center = int(np.median(xs))
                if side == 'L': mask[:, :center] = False
                else: mask[:, center:] = False
            components, count = ndimage.label(mask)
            if not count:
                continue
            sizes = np.bincount(components.ravel()); sizes[0] = 0
            mask = components == sizes.argmax()
            ys, xs = np.nonzero(mask)
            if len(xs) < 80 or np.ptp(ys) < .08*height:
                declined.append(('Arm ' if arm else 'Leg ')+side)
                continue
            for joint, fraction in zip(joints, [.03, .52, .95]):
                point = row_center(mask, fraction)
                if joint+side in missing and point is not None:
                    alpha_points[joint+side] = point
                    provenance[joint+side] = 'shared-layer-half' if shared else 'sided-layer-alpha'

    # The second source-support fallback is offered only after a limb material
    # layer is unavailable; its geometry is still checked by the rig builder.
    if declined:
        coords = {n: np.column_stack(np.nonzero(v)[::-1]) for n, v in masks.items()}
        for side in ['L', 'R']:
            missing = [j+side for j in ['hip', 'knee', 'ankle'] if j+side not in alpha_points]
            if not missing:
                continue
            foot = coords.get('footwear-'+side.lower())
            if foot is None and 'footwear' in coords:
                foot = coords['footwear']; center = np.median(foot[:, 0])
                foot = foot[foot[:, 0] >= center] if side == 'L' else foot[foot[:, 0] < center]
            ankle = alpha_points.get('ankle'+side)
            if ankle is None and foot is not None and len(foot) >= 60:
                y = np.quantile(foot[:, 1], .1); row = foot[abs(foot[:, 1]-y) < 5]
                if len(row) > 4: ankle = np.array([np.median(row[:, 0]), y])
            material = coords.get('bottomwear', coords.get('topwear'))
            if ankle is None or material is None or len(material) < 80:
                continue
            hip = alpha_points.get('hip'+side)
            if hip is None:
                low, high = np.quantile(material, [.02, .98], axis=0); center = (low[0]+high[0])/2
                if 'shoulderL' in alpha_points and 'shoulderR' in alpha_points:
                    center = (alpha_points['shoulderL'][0]+alpha_points['shoulderR'][0])/2
                y = low[1]+(.1 if 'bottomwear' in coords else .57)*(high[1]-low[1])
                hip = np.array([center+(1 if side == 'L' else -1)*min(.18*(high[0]-low[0]), .06*width), y])
            if ankle[1]-hip[1] < .16*height:
                continue
            knee = alpha_points.get('knee'+side, (hip+ankle)/2)
            for key, point in zip(['hip'+side, 'knee'+side, 'ankle'+side], [hip, knee, ankle]):
                if key in missing:
                    alpha_points[key] = point; provenance[key] = 'garment-foot-bounds'
    encode = lambda points: {k: {'x': float(v[0]), 'y': float(v[1])} for k, v in points.items()}
    return dict(known=encode(known), alpha=encode(alpha_points), provenance=provenance,
                layers=layers, width=width, height=height)


if __name__ == '__main__':
    analysis, psd, width, height = sys.argv[1:]
    print(json.dumps(propose(json.load(open(analysis)), psd, int(width), int(height)), allow_nan=False))
