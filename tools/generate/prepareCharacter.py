#!/usr/bin/env python3
"""Repository-owned character preparation.

Geometry comes from the current semantic PSD and anatomical analysis. Edits are
registered to unchanged face pixels and restricted to measured feature supports.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import time

import cv2
import numpy as np
from PIL import Image, ImageOps
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def foreground(image):
    """Border-connected background only: enclosed white clothing stays foreground."""
    rgba = np.array(image.convert('RGBA'))
    if np.any(rgba[:, :, 3] < 250):
        return rgba[:, :, 3], 'source-alpha'
    rgb = rgba[:, :, :3].astype(np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    color = np.median(border, axis=0)
    method = 'border-connected-color'
    if np.percentile(np.linalg.norm(border - color, axis=1), 80) > 32:
        # A smoothly shaded studio backdrop need not be perfectly flat. Fit its
        # color field only to robust border samples, excluding foreground outliers.
        h,w=rgb.shape[:2]; yy,xx=np.mgrid[:h,:w]; xx=xx/max(1,w-1);yy=yy/max(1,h-1)
        features=[np.ones((h,w)),xx,yy,xx*yy,xx*xx,yy*yy]
        design=np.stack([np.concatenate([f[0],f[-1],f[:,0],f[:,-1]]) for f in features],axis=1)
        selected=np.ones(len(border),bool)
        for _ in range(3):
            coefficients=np.linalg.lstsq(design[selected],border[selected],rcond=None)[0]
            residual=np.linalg.norm(design@coefficients-border,axis=1)
            selected=residual<max(8,float(np.percentile(residual,70))*1.5)
        if selected.mean()<.6 or np.percentile(residual[selected],90)>20:
            raise ValueError('Background is not a simple color field; provide transparency')
        field=sum(f[:,:,None]*coefficients[i] for i,f in enumerate(features))
        distance=np.max(np.abs(rgb-field),axis=2)
        method='border-connected-smooth-field'
    else:
        distance = np.max(np.abs(rgb - color), axis=2)
    candidate = (distance < 28).astype(np.uint8)
    _, labels = cv2.connectedComponents(candidate, connectivity=4)
    ids = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, ids[ids != 0])
    alpha = np.full(distance.shape, 255, np.uint8)
    alpha[background] = np.clip((distance[background] - 5) * 255 / 23, 0, 255).astype(np.uint8)
    if np.mean(alpha > 128) < .01:
        raise ValueError('No usable foreground detected')
    return alpha, method


def neutralize(source, out):
    im = ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
    alpha, method = foreground(im)
    rgba = np.array(im)
    a = alpha[:, :, None].astype(np.float32) / 255
    rgb = np.rint(rgba[:, :, :3] * a + 127 * (1 - a)).astype(np.uint8)
    Image.fromarray(rgb).save(out / 'input.png')
    Image.fromarray(alpha).save(out / 'input-mask.png')
    write_json(out / 'neutralization.json', {'sourceSha256': sha(source), 'method': method,
        'foregroundFraction': float(np.mean(alpha > 128)), 'implementation': 'prepareCharacter.py'})



def _background_run(row, start, stop, minimum=2):
    """True if the alpha row holds a background run of at least `minimum` pixels between start and stop."""
    lo, hi = sorted((int(round(start)), int(round(stop))))
    run = 0
    for v in row[max(0, lo):max(0, hi)]:
        run = run + 1 if v < 32 else 0
        if run >= minimum:
            return True
    return False


def source_check(source, analysis, out):
    """Deterministic pre-decomposition check of the design contract's structural items.

    It measures only what the drawing shows: whether the background is transparent,
    the figure's margin to the image edge, a background gap between each forearm and
    the torso, and a gap between the lower legs. It changes nothing and gates nothing;
    failed items are reported so that the capability report can explain them.
    """
    alpha, method = foreground(ImageOps.exif_transpose(Image.open(source)))
    h, w = alpha.shape
    figure = alpha > 128
    data = json.loads(Path(analysis).read_text()) if analysis and Path(analysis).exists() else {}
    points = {k: (float(p['x']), float(p['y'])) for k, p in (data.get('points') or {}).items() if p}
    checks = []
    if method == 'source-alpha':
        partial = float(np.mean((alpha > 8) & (alpha < 247)) / max(np.mean(figure), 1e-6))
        checks.append({'item': 'C1', 'name': 'transparent background', 'status': 'pass' if partial < .08 else 'fail', 'value': round(partial, 4),
                       'detail': 'Semi-transparent pixels relative to the figure area (soft edges only when low).'})
    else:
        checks.append({'item': 'C1', 'name': 'transparent background', 'status': 'fail', 'value': method,
                       'detail': 'No transparency: the background was removed by colour, so light artwork next to it may be lost or keep a light fringe.'})
    ys, xs = np.nonzero(figure)
    margin = int(min(ys.min(), xs.min(), h - 1 - ys.max(), w - 1 - xs.max())) if len(ys) else 0
    checks.append({'item': 'C2', 'name': 'figure margin', 'status': 'pass' if margin >= max(4, .005 * max(h, w)) else 'fail', 'value': margin,
                   'detail': 'Smallest distance in pixels from the figure to the image edge.'})
    mids = [points[k][0] for k in ('shoulderL', 'shoulderR', 'hipL', 'hipR') if k in points]
    body_x = float(np.mean(mids)) if mids else (float(xs.mean()) if len(xs) else w / 2)
    def along(a, b, n=15):
        return [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in np.linspace(.15, .85, n)]
    for side, label in (('L', 'left'), ('R', 'right')):
        e, wr = points.get('elbow' + side), points.get('wrist' + side)
        if not (e and wr):
            checks.append({'item': 'P2', 'name': f'{label} arm clear of the torso', 'status': 'skipped', 'value': None, 'detail': 'Elbow or wrist not located.'})
            continue
        samples = [q for q in along(e, wr) if 0 <= int(q[1]) < h]
        gaps = [_background_run(alpha[int(y)], x, body_x) for x, y in samples]
        share = float(np.mean(gaps)) if gaps else 0.
        checks.append({'item': 'P2', 'name': f'{label} arm clear of the torso', 'status': 'pass' if share >= .6 else 'fail', 'value': round(share, 3),
                       'detail': 'Share of forearm rows with background between the arm and the body midline.'})
    kl, al, kr, ar = (points.get(k) for k in ('kneeL', 'ankleL', 'kneeR', 'ankleR'))
    if kl and al and kr and ar:
        left, right = along(kl, al), along(kr, ar)
        gaps = [_background_run(alpha[int((a[1] + b[1]) / 2)], a[0], b[0]) for a, b in zip(left, right) if 0 <= int((a[1] + b[1]) / 2) < h]
        share = float(np.mean(gaps)) if gaps else 0.
        checks.append({'item': 'P3', 'name': 'legs apart', 'status': 'pass' if share >= .6 else 'fail', 'value': round(share, 3),
                       'detail': 'Share of lower-leg rows with background between the two legs.'})
    else:
        checks.append({'item': 'P3', 'name': 'legs apart', 'status': 'skipped', 'value': None, 'detail': 'Knees or ankles not located.'})
    write_json(out / 'source-check.json', {'implementation': 'prepareCharacter.py source_check', 'sourceSha256': sha(source),
                                           'alphaMethod': method, 'checks': checks,
                                           'passed': all(c['status'] != 'fail' for c in checks)})


def square(image, size):
    side = max(image.size)
    canvas = Image.new(image.mode, (side, side), 0)
    canvas.paste(image, ((side-image.width)//2, (side-image.height)//2))
    return canvas.resize(size, Image.Resampling.LANCZOS)


def read_layers(path):
    psd = PSDImage.open(path)
    layers = {}
    for layer in psd.descendants():
        if layer.is_group():
            continue
        im = layer.topil()
        if im is None:
            continue
        canvas = Image.new('RGBA', psd.size)
        canvas.paste(im.convert('RGBA'), (layer.left, layer.top))
        if np.asarray(canvas)[:, :, 3].max() > 8:
            if layer.name in layers:
                raise ValueError('Ambiguous duplicate semantic layer: ' + layer.name)
            layers[layer.name] = np.array(canvas)
    return psd.size, layers


def bounds(layers, names):
    selected = [layers[n][:, :, 3] for n in names if n in layers]
    if not selected:
        raise ValueError('Missing semantic features: ' + ', '.join(names))
    y, x = np.where(np.maximum.reduce(selected) > 16)
    if not len(x):
        raise ValueError('Empty feature')
    return [int(x.min()), int(y.min()), int(x.max()+1), int(y.max()+1)]


def expand(box, dx, dy, size):
    x0,y0,x1,y1 = box
    return [max(0, int(x0-dx)), max(0, int(y0-dy)), min(size[0], int(x1+dx)), min(size[1], int(y1+dy))]


def anatomical_points(analysis, size):
    data = json.loads(Path(analysis).read_text())
    w,h = data['source']['width'], data['source']['height']
    scale = size[0] / max(w,h)
    return {k: [(p['x']+(max(w,h)-w)/2)*scale, (p['y']+(max(w,h)-h)/2)*scale]
            for k,p in data['points'].items() if p is not None}


# Layers that must carry each limb joint, by name prefix ('{s}' is the side).
# Shoulders are often under hair or capes: only the silhouette is required.
LIMB_JOINT_LAYERS={'shoulder':None,'elbow':('handwear-{s}','arm-{s}','hand-{s}'),'wrist':('handwear-{s}','arm-{s}','hand-{s}'),
                   'hip':('bottomwear','legwear','topwear'),'knee':('legwear','bottomwear','footwear'),
                   'ankle':('legwear','footwear','bottomwear')}


def _alpha_union(layers, names, threshold=128):
    selected=[layers[n][:,:,3]>threshold for n in names if n in layers]
    return np.logical_or.reduce(selected) if selected else None


def _eye_evidence(layers, side):
    """Eye centre and outer corner measured on the decomposition's eye layers."""
    iris=_alpha_union(layers,['irides-'+side],64)
    white=_alpha_union(layers,['eyewhite-'+side,'irides-'+side,'eyelash-'+side],64)
    if white is None or np.count_nonzero(white)<16:
        return None
    centre=iris if iris is not None and np.count_nonzero(iris)>=8 else white
    ys,xs=np.nonzero(centre);c=np.array([xs.mean(),ys.mean()])
    # The outer corner is where the eye white ends; a lash wing extends past it
    # and higher, so the lash layer is only used without an eye white.
    sclera=_alpha_union(layers,['eyewhite-'+side],64)
    corner=sclera if sclera is not None and np.count_nonzero(sclera)>=16 else white
    ys,xs=np.nonzero(corner)
    # Character left is image right: the outer corner of the left eye is its largest x.
    x=float(xs.max() if side=='l' else xs.min());band=np.abs(xs-x)<=max(1.,.1*(xs.max()-xs.min()))
    return {'centre':c,'outer':np.array([x,float(ys[band].mean())])}


def verify_landmarks(layers, mask, points, source_size, size, minimum=.5, garment=False):
    """Check model landmarks against the decomposition and the source silhouette.

    The analysis model sometimes normalizes y by the image width instead of its
    height, for some points of one answer only, which puts faces on collars and
    wrists on belts. Every image has See-through eye and mouth layers, semantic
    body layers and a foreground silhouette, so each point is tested on that
    evidence: face points against the eye and mouth layers and the face layer's
    lower edge, limb joints against their limb or garment layers and the
    silhouette. A point that fails is replaced by the measured feature (face) or
    by the same answer read with the other normalization when that one passes;
    otherwise it is rejected. Model confidences are never raised.

    garment: the limited-motion garment builder gates its face and torso on
    0.8 confidence; with minimum=.8 a lower-confidence chin is verified on the
    face layer's lower edge below the mouth, and a shoulder on the silhouette
    between the chin and two face heights below it, on its own side of the face.

    points: normalized {name: {x,y,confidence}|None}. Returns (points, records).
    """
    w,h=source_size;side_length=max(w,h);scale=size[0]/side_length
    ox,oy=(side_length-w)/2,(side_length-h)/2
    to_canvas=lambda p:np.array([(p['x']*w+ox)*scale,(p['y']*h+oy)*scale])
    to_normal=lambda c:(float(c[0]/scale-ox)/w,float(c[1]/scale-oy)/h)
    swapped=lambda p:{**p,'y':p['y']*w/h}
    out={k:(dict(v) if isinstance(v,dict) else None) for k,v in points.items()};records=[]
    def record(name,status,reason,before=None,after=None):
        records.append({'point':name,'status':status,'reason':reason,
                        'model':None if before is None else {'x':before['x'],'y':before['y']},
                        'result':None if after is None else {'x':after['x'],'y':after['y']}})
    def move(name,canvas,reason):
        before=out[name];x,y=to_normal(canvas)
        out[name]={'x':min(1.,max(0.,x)),'y':min(1.,max(0.,y)),'confidence':before['confidence']}
        record(name,'corrected',reason,before,out[name])
    def usable(name):
        # Points below the capability gate are never used; they are left as answered.
        p=out.get(name)
        return (isinstance(p,dict) and all(np.isfinite([p.get('x',np.nan),p.get('y',np.nan),p.get('confidence',np.nan)]))
                and p['confidence']>=minimum)
    eyes={s:_eye_evidence(layers,s) for s in ['l','r']}
    mouth_alpha=_alpha_union(layers,['mouth'],64)
    mouth=np.array(np.nonzero(mouth_alpha)[::-1]).mean(axis=1) if mouth_alpha is not None and np.count_nonzero(mouth_alpha)>=8 else None
    if not (eyes['l'] and eyes['r']):
        return out,[{'point':'*','status':'unchecked','reason':'The decomposition has no eye layers to verify the face landmarks against'}]
    d=float(np.linalg.norm(eyes['l']['centre']-eyes['r']['centre']))
    tol=max(4.,.35*d)
    face_frame_swapped=False
    def verifiable(name):
        # Below the gate but answered: the decomposition may confirm the point.
        p=out.get(name)
        return (isinstance(p,dict) and all(np.isfinite([p.get('x',np.nan),p.get('y',np.nan),p.get('confidence',np.nan)]))
                and VERIFY_FLOOR<=p['confidence']<minimum)
    def verify(name,canvas,reason):
        before=out[name];x,y=to_normal(canvas)
        out[name]={'x':min(1.,max(0.,x)),'y':min(1.,max(0.,y)),'confidence':before['confidence'],'verified':True}
        record(name,'verified',reason,before,out[name])
    for s,name,key in [('l','eyeL','centre'),('r','eyeR','centre'),('l','eyeLOuter','outer'),('r','eyeROuter','outer')]:
        if verifiable(name):
            verify(name,eyes[s][key],'Low-confidence eye landmark; position measured on the decomposition eye layer')
            continue
        if not usable(name):
            continue
        measured=eyes[s][key]
        if np.linalg.norm(to_canvas(out[name])-measured)<=tol:
            continue
        face_frame_swapped|=bool(np.linalg.norm(to_canvas(swapped(out[name]))-measured)<=tol)
        move(name,measured,'Eye landmark off the decomposition eye layer; measured eye layer position used')
    if mouth is not None and verifiable('mouth') and np.linalg.norm(to_canvas(out['mouth'])-mouth)<=2*tol:
        verify('mouth',mouth,'Low-confidence mouth landmark near the decomposition mouth layer; its measured centre used')
    if mouth is not None and usable('mouth') and np.linalg.norm(to_canvas(out['mouth'])-mouth)>tol:
        face_frame_swapped|=bool(np.linalg.norm(to_canvas(swapped(out['mouth']))-mouth)<=tol)
        move('mouth',mouth,'Mouth landmark off the decomposition mouth layer; measured mouth layer centre used')
    eye_y=float((eyes['l']['centre'][1]+eyes['r']['centre'][1])/2)
    mouth_y=float(mouth[1]) if mouth is not None else (to_canvas(out['mouth'])[1] if usable('mouth') else None)
    if usable('chin') and mouth_y is not None:
        lower=mouth_y+.05*d;upper=mouth_y+max(1.3*(mouth_y-eye_y),.6*d)
        plausible=lambda c:lower<=c[1]<=upper
        chin=to_canvas(out['chin'])
        # The face layer's lowest opaque pixel near the mouth column bounds the jaw.
        face=layers.get('face');bottom=None
        if face is not None and mouth is not None:
            band=face[:,:,3]>128;x0,x1=int(max(0,mouth[0]-.2*d)),int(min(band.shape[1],mouth[0]+.2*d+1))
            rows=np.nonzero(band[:,x0:x1].any(axis=1))[0]
            rows=rows[(rows>=lower)&(rows<=upper)]
            bottom=float(rows.max()) if len(rows) else None
        if not plausible(chin):
            alternative=to_canvas(swapped(out['chin']))
            if plausible(alternative) and (face_frame_swapped or bottom is None or abs(alternative[1]-bottom)<=tol):
                move('chin',alternative,'Chin read with y normalized by the image width, as the other face points of this answer')
            elif bottom is not None:
                move('chin',np.array([mouth[0],bottom]),'Chin outside the face below the mouth; lower edge of the decomposition face layer used')
            else:
                record('chin','rejected','Chin is not below the mouth within a face height',out['chin']);out['chin']=None
    elif garment and verifiable('chin') and mouth is not None:
        lower=mouth[1]+.05*d;upper=mouth[1]+max(1.3*(mouth[1]-eye_y),.6*d)
        face=layers.get('face');chin=to_canvas(out['chin'])
        if face is not None:
            band=face[:,:,3]>128;x0,x1=int(max(0,mouth[0]-.2*d)),int(min(band.shape[1],mouth[0]+.2*d+1))
            rows=np.nonzero(band[:,x0:x1].any(axis=1))[0];rows=rows[(rows>=lower)&(rows<=upper)]
            if len(rows) and abs(chin[1]-rows.max())<=tol and abs(chin[0]-mouth[0])<=tol:
                verify('chin',np.array([mouth[0],float(rows.max())]),'Low-confidence chin at the lower edge of the decomposition face layer below the mouth; that edge used')
    if usable('headTop') and to_canvas(out['headTop'])[1]>=eye_y:
        alternative=to_canvas(swapped(out['headTop']))
        if face_frame_swapped and alternative[1]<eye_y and mask[int(min(mask.shape[0]-1,max(0,alternative[1]))),int(min(mask.shape[1]-1,max(0,alternative[0])))]>128:
            move('headTop',alternative,'Head top read with y normalized by the image width')
        else:
            record('headTop','rejected','Head top is not above the eyes',out['headTop']);out['headTop']=None
    # Limb joints: on their limb or garment layers, and inside the silhouette.
    foreground=mask>128
    distance_cache={}
    cover=np.logical_or.reduce([l[:,:,3]>8 for l in layers.values()])
    def distance_to(names):
        key=names or ('silhouette',)
        if key not in distance_cache:
            support=foreground if names is None else _alpha_union(layers,[n for n in layers if n.startswith(names)])
            if support is None or not support.any():
                support=foreground
            elif names is not None and not names[0].startswith(('handwear','arm','hand')):
                # Garments the decomposition omitted are visible source no layer covers.
                support=support|(foreground&~cover)
            distance_cache[key]=cv2.distanceTransform((~support).astype(np.uint8),cv2.DIST_L2,3)
        return distance_cache[key]
    def off(names,c):
        field=distance_to(names);x,y=int(round(c[0])),int(round(c[1]))
        if not (0<=x<field.shape[1] and 0<=y<field.shape[0]):
            return float('inf')
        return float(field[y,x])
    joint_tol=max(6.,.5*d)
    # A shoulder is attached below the jaw: more than 2.2 eye-to-chin heights
    # below the chin (about a full head) is not a shoulder of this face.
    if usable('chin'):
        chin_y=to_canvas(out['chin'])[1];face_height=max(1.,chin_y-eye_y)
        for side in ['L','R']:
            name='shoulder'+side
            if not usable(name) or (to_canvas(out[name])[1]-chin_y)/face_height<=2.2:
                continue
            alt=to_canvas(swapped(out[name]))
            if -.3<=(alt[1]-chin_y)/face_height<=1.6 and off(None,alt)<=2*joint_tol:
                move(name,alt,'Shoulder more than a head below the chin; the answer read with y normalized by the image width is at the neck line')
            else:
                record(name,'rejected','Shoulder more than a head below the chin',out[name]);out[name]=None
    chin_ok=isinstance(out.get('chin'),dict) and (usable('chin') or out['chin'].get('verified') is True)
    if garment and chin_ok:
        chin_y=to_canvas(out['chin'])[1];face_height=max(1.,chin_y-eye_y);centre_x=float((eyes['l']['centre'][0]+eyes['r']['centre'][0])/2)
        for side in ['L','R']:
            name='shoulder'+side
            if not verifiable(name):
                continue
            here=to_canvas(out[name])
            # Character left is image right.
            own_side=(here[0]-centre_x>=.5*d) if side=='L' else (centre_x-here[0]>=.5*d)
            if own_side and 0<=(here[1]-chin_y)/face_height<=2.2 and off(None,here)<=joint_tol:
                verify(name,here,'Low-confidence shoulder on the source silhouette below the chin, on its own side of the face')
    for side in ['L','R']:
        for joint,families in LIMB_JOINT_LAYERS.items():
            name=joint+side
            if not usable(name):
                continue
            names=None if families is None else tuple(f.format(s=side.lower()) for f in families)
            # A limb layer far from the limb's own shoulder is a mislabeled part
            # (a skirt panel labelled as an arm): only the silhouette is evidence then.
            if names is not None and joint in ('elbow','wrist') and usable('shoulder'+side) and off(names,to_canvas(out['shoulder'+side]))>4*joint_tol:
                names=None
            evidence='silhouette' if names is None else '/'.join(names)
            here,alt=to_canvas(out[name]),to_canvas(swapped(out[name]))
            e0,e1=off(names,here),off(names,alt)
            if e0<=joint_tol:
                continue
            # Only a joint clearly off its evidence is re-read; one just beside
            # its layer (an ankle inside a boot outline) is kept.
            # Ankles were never observed with the width normalization and a
            # re-read would lift them above the knees: they are only checked.
            if e0>2*joint_tol and e1<=joint_tol and joint!='ankle':
                move(name,alt,'Joint off its '+evidence+' evidence; the same answer read with y normalized by the image width lies on it')
            elif e0>3*joint_tol:
                record(name,'rejected','Joint lies %.0f px from its %s evidence'%(e0,evidence),out[name]);out[name]=None
            else:
                record(name,'doubtful','Joint lies %.0f px from its %s evidence; kept'%(e0,evidence),out[name],out[name])
        # A low-confidence elbow or wrist is verified when the whole arm chain
        # from the shoulder lies on the decomposition's arm layer: elbow and wrist
        # on it, and the upper arm (beyond the shoulder, often under a sleeve or
        # cape) and the forearm running along it. Legs under garments are not
        # verified this way: a skirt covers any knee position.
        arm=tuple(f.format(s=side.lower()) for f in LIMB_JOINT_LAYERS['elbow'])
        if usable('shoulder'+side) and any(n.startswith(arm) for n in layers) and off(arm,to_canvas(out['shoulder'+side]))<=4*joint_tol:
            names_=['shoulder'+side,'elbow'+side,'wrist'+side]
            if all(usable(n) or verifiable(n) for n in names_) and any(verifiable(n) for n in names_[1:]):
                q=[to_canvas(out[n]) for n in names_]
                samples=[q[0]+(q[1]-q[0])*t for t in np.linspace(.3,1,8)]+[q[1]+(q[2]-q[1])*t for t in np.linspace(0,1,8)]
                on=[off(arm,c)<=joint_tol for c in samples]
                if off(arm,q[1])<=joint_tol and off(arm,q[2])<=joint_tol and np.mean(on)>=.85:
                    for n in names_[1:]:
                        if verifiable(n):
                            verify(n,to_canvas(out[n]),'Low-confidence joint; the shoulder-elbow-wrist chain lies on the decomposition arm layer')
        # Hip, knee and ankle must descend; a mixed normalization breaks this order.
        chain=[n+side for n in ['hip','knee','ankle']]
        if all(usable(n) for n in chain):
            # Seated poses put knees level with hips: only a clear inversion counts.
            descending=lambda ys:ys[1]>ys[0]-joint_tol and ys[2]>ys[1]-joint_tol
            ys=[to_canvas(out[n])[1] for n in chain]
            if not descending(ys):
                for n in chain[:2]:
                    alt=swapped(out[n]);trial=[to_canvas(alt)[1] if m==n else to_canvas(out[m])[1] for m in chain]
                    if descending(trial) and off(('legwear','bottomwear','topwear','footwear'),to_canvas(alt))<=joint_tol:
                        move(n,to_canvas(alt),'Leg joints out of vertical order; this joint read with y normalized by the image width restores it')
                        break
                else:
                    for n in chain[:2]:
                        record(n,'rejected','Leg joints are not in top-to-bottom order',out[n]);out[n]=None
    return out,records


SHOULDER_ESTIMATE_REASON='Shoulder estimated from the separated arm silhouette'


def estimate_separated_shoulders(layers, mask, reference, points, regions, source_size, size, minimum=.5):
    """Estimate a shoulder pivot the analysis called occluded, from the arm itself.

    Loose sleeves (hoodies, jackets, wide shirts) hide the shoulder seam, so the
    analysis marks the arm root occluded and the whole arm stays fixed although
    the arm hangs free of the torso. Only arms the analysis found visible and
    separate, with an occluded root, are considered, and only when:
    - the source silhouette shows a background gap on the arm's medial side
      along the forearm and along the lower part of the upper arm (up to the
      armpit, where the arm meets the torso);
    - the upper-arm axis, fitted to the separated arm slices, runs up the arm
      layer to its top: the pivot lies half an upper-arm width below that top,
      above the armpit, near the model's own shoulder answer, with an upper arm
      of plausible length against the forearm;
    - the source above the armpit is the arm layer's own artwork (a sleeve cap,
      even when the decomposition gave it to the torso garment), not a cape,
      shawl, mantle or hair the arm layer does not show;
    - the elbow and wrist are usable or verifiable, and the whole
      shoulder-elbow-wrist chain lies on the arm layer.
    The model must have answered the shoulder (confidence >= VERIFY_FLOOR); the
    confidence is kept, never raised. Legs are never estimated.

    Returns (points, records, estimates): estimates is keyed by chain name with
    status 'estimated' or 'declined' and the measured evidence.
    """
    w,h=source_size;side_length=max(w,h);scale=size[0]/side_length
    ox,oy=(side_length-w)/2,(side_length-h)/2
    to_canvas=lambda p:np.array([(p['x']*w+ox)*scale,(p['y']*h+oy)*scale])
    to_normal=lambda c:(float(c[0]/scale-ox)/w,float(c[1]/scale-oy)/h)
    out={k:(dict(v) if isinstance(v,dict) else None) for k,v in points.items()};records=[];estimates={}
    answered=lambda name:(isinstance(out.get(name),dict) and all(np.isfinite([out[name].get('x',np.nan),out[name].get('y',np.nan),out[name].get('confidence',np.nan)]))
                          and VERIFY_FLOOR<=out[name]['confidence']<=1)
    eyes={s:_eye_evidence(layers,s) for s in ['l','r']}
    if not (eyes['l'] and eyes['r']):
        return out,records,estimates
    d=float(np.linalg.norm(eyes['l']['centre']-eyes['r']['centre']));joint_tol=max(6.,.5*d)
    centre_x=float((eyes['l']['centre'][0]+eyes['r']['centre'][0])/2)
    foreground=mask>128;H,W=mask.shape
    def inside(c):
        x,y=int(round(c[0])),int(round(c[1]));return 0<=x<W and 0<=y<H,x,y
    for side in ['L','R']:
        chain='Arm '+side;e=(regions or {}).get(chain) or {}
        if not (e.get('visible') is True and e.get('separate') is True and e.get('rootOccluded') is True):
            continue
        def decline(reason,**evidence):
            estimates[chain]={'status':'declined','reason':reason,**evidence}
        names=['shoulder'+side,'elbow'+side,'wrist'+side]
        if not all(answered(n) for n in names):
            decline('A shoulder, elbow or wrist answer is missing or below the verification floor');continue
        families=tuple(f.format(s=side.lower()) for f in LIMB_JOINT_LAYERS['elbow'])
        arm=_alpha_union(layers,[n for n in layers if n.startswith(families)])
        if arm is None or np.count_nonzero(arm)<64:
            decline('No arm layer');continue
        field=cv2.distanceTransform((~arm).astype(np.uint8),cv2.DIST_L2,3)
        def off(c):
            ok,x,y=inside(c);return float(field[y,x]) if ok else float('inf')
        on_arm=lambda c:(lambda r:r[0] and arm[r[2],r[1]])(inside(c))
        background=lambda c:(lambda r:not r[0] or not foreground[r[2],r[1]])(inside(c))
        s0,el,wr=[to_canvas(out[n]) for n in names]
        forearm=float(np.linalg.norm(wr-el));upper0=float(np.linalg.norm(s0-el))
        if forearm<joint_tol or upper0<joint_tol:
            decline('Joints too close to define the arm');continue
        if off(el)>joint_tol or off(wr)>joint_tol:
            decline('The elbow or wrist is off the arm layer');continue
        torso=np.array([centre_x,s0[1]+upper0])
        gap_min=max(3.,.04*forearm);reach=int(max(4*gap_min,forearm))
        def section(c,direction):
            """Arm span across direction at c and whether background lies beyond its medial and lateral edges."""
            if not on_arm(c):
                return None
            n=np.array([-direction[1],direction[0]])
            if np.dot(n,torso-c)<0:n=-n
            medial=0
            while medial<reach and on_arm(c+n*(medial+1)):medial+=1
            lateral=0
            while lateral<reach and on_arm(c-n*(lateral+1)):lateral+=1
            # Two pixels of slack for anti-aliased layer and silhouette edges.
            clear=lambda start,sign:all(background(c+sign*n*(start+k)) for k in range(3,3+int(np.ceil(gap_min))))
            return {'mid':c+n*(medial-lateral)/2,'width':medial+lateral+1,'gap':clear(medial,1),'outer':clear(lateral,-1)}
        fdir=(wr-el)/forearm
        fore=[section(el+(wr-el)*t,fdir) for t in np.linspace(.15,.85,8)]
        fore_gap=float(np.mean([bool(s and s['gap']) for s in fore]))
        if fore_gap<.75:
            decline('The forearm is not separated from the body by a background gap',forearmGap=fore_gap);continue
        # The gap must reach the elbow: an arm whose forearm only leaves the torso
        # below the elbow is not separated along its length.
        udir=(s0-el)/upper0
        if not any(s and s['gap'] for s in [section(el+udir*upper0*t,udir) for t in (0,.08,.16)]):
            decline('The background gap between arm and torso does not reach the elbow',forearmGap=fore_gap);continue
        # Upper arm: a loose sleeve may touch the torso up to the elbow, where the
        # decomposition's arm layer gives the medial edge. Its lateral edge must be
        # the outer silhouette (nothing beside the arm, such as a cape or wing).
        axis_fit=None
        for _ in range(2):
            ts=np.linspace(.05,.8,16);slices=[section(el+udir*upper0*t,udir) for t in ts]
            valid=[s for s in slices if s]
            outer=float(np.mean([bool(s and s['outer']) for s in slices]))
            if len(valid)<.8*len(slices) or outer<.75:
                axis_fit={'outer':outer,'onArm':len(valid)/len(slices)};break
            mids=np.array([s['mid'] for s in valid]);centre=mids.mean(axis=0)
            direction=np.linalg.svd(mids-centre)[2][0]
            if np.dot(direction,udir)<0:direction=-direction
            axis_fit={'centre':centre,'direction':direction,'width':float(np.median([s['width'] for s in valid])),'slices':len(valid),'outer':outer}
            udir=direction
        if 'direction' not in axis_fit:
            decline('The upper arm is not a separate outer outline on the arm layer',upperArmOuter=axis_fit['outer'],upperArmOnLayer=axis_fit['onArm'],forearmGap=fore_gap);continue
        u=axis_fit['direction']
        if np.degrees(np.arccos(np.clip(np.dot(u,(s0-el)/upper0),-1,1)))>35:
            decline('The fitted upper-arm axis disagrees with the answered shoulder direction');continue
        # Project the elbow on the fitted axis, then walk up the arm layer to its top.
        base=axis_fit['centre']+u*np.dot(el-axis_fit['centre'],u)
        top=base+u*.5*upper0;steps=0
        if not on_arm(top):
            decline('The fitted upper-arm axis leaves the arm layer');continue
        while steps<2*upper0 and on_arm(top+u):top=top+u;steps+=1
        half=axis_fit['width']/2;pivot=top-u*half
        length=float(np.linalg.norm(pivot-el));ratio=length/forearm
        evidence={'upperArmWidth':axis_fit['width'],'axisSlices':axis_fit['slices'],'upperArmOuter':axis_fit['outer'],'forearmGap':fore_gap,
                  'upperToForearm':ratio,'modelDistance':float(np.linalg.norm(pivot-s0))}
        if not .6<=ratio<=1.7:
            decline('The estimated upper arm is implausibly long or short against the forearm',**evidence);continue
        if evidence['modelDistance']>max(2*joint_tol,.5*upper0):
            decline('The estimated pivot is far from the answered shoulder',**evidence);continue
        # The shoulder region (an arm width around the pivot, up to the top) must
        # show the arm layer's own artwork: a sleeve cap may sit under the torso
        # garment in the decomposition, but a cape, shawl or hair over it does not match.
        yy,xx=np.mgrid[:H,:W];rel=np.stack([xx-pivot[0],yy-pivot[1]],axis=-1)
        along=rel@u;across=np.abs(rel@np.array([-u[1],u[0]]))
        cap=arm&foreground&(along>=-2*half)&(along<=half+1)&(across<=half)
        layer_rgb=np.zeros((H,W,3),np.float32);weight=np.zeros((H,W),np.float32)
        for n in layers:
            if n.startswith(families):
                a=layers[n][:,:,3].astype(np.float32)/255;layer_rgb+=layers[n][:,:,:3]*a[:,:,None];weight+=a
        layer_rgb/=np.maximum(weight,1e-6)[:,:,None]
        agree=float(np.mean(np.abs(reference[cap].astype(np.float32)-layer_rgb[cap]).mean(axis=1)<=30)) if cap.any() else 0.
        evidence['shoulderShowsArm']=agree
        if np.count_nonzero(cap)<16 or agree<.6:
            decline('Another garment or hair covers the shoulder; the source there is not the arm layer',**evidence);continue
        # Landmark-check chain rule: the whole shoulder-elbow-wrist chain on the arm layer.
        samples=[pivot+(el-pivot)*t for t in np.linspace(.3,1,8)]+[el+(wr-el)*t for t in np.linspace(0,1,8)]
        chain_on=float(np.mean([off(c)<=joint_tol for c in samples]))
        evidence['chainOnArm']=chain_on
        if chain_on<.85:
            decline('The shoulder-elbow-wrist chain leaves the arm layer',**evidence);continue
        before=out[names[0]];x,y=to_normal(pivot)
        out[names[0]]={'x':min(1.,max(0.,x)),'y':min(1.,max(0.,y)),'confidence':before['confidence'],'verified':True}
        records.append({'point':names[0],'status':'estimated','reason':SHOULDER_ESTIMATE_REASON,
                        'model':{'x':before['x'],'y':before['y']},'result':{'x':out[names[0]]['x'],'y':out[names[0]]['y']}})
        for n in names[1:]:
            if out[n]['confidence']<minimum and not out[n].get('verified'):
                out[n]={**out[n],'verified':True}
                records.append({'point':n,'status':'verified','reason':'Low-confidence joint; the estimated shoulder-elbow-wrist chain lies on the decomposition arm layer',
                                'model':{'x':out[n]['x'],'y':out[n]['y']},'result':{'x':out[n]['x'],'y':out[n]['y']}})
        estimates[chain]={'status':'estimated','reason':SHOULDER_ESTIMATE_REASON,**evidence}
    return out,records,estimates


HIP_ESTIMATE_REASON='Hip estimated from the separated leg layer under the garment hem'


def estimate_covered_hips(layers, mask, reference, points, regions, source_size, size, minimum=.5):
    """Estimate a hip pivot the analysis called occluded, from the leg layer itself.

    Skirts, tunics and shorts hide the hip, so the analysis marks the leg root
    occluded and the whole leg stays fixed although the leg hangs free below
    the hem. See-through paints the whole leg layer, including the thigh under
    the hem. Only legs the analysis found visible and separate, with an occluded
    root, are considered, and only when:
    - the knee and ankle are confidently answered and lie on this leg's layer
      (the leg layer on this side of the two knees);
    - the lower leg is free on both sides: the source silhouette shows a
      background gap on its medial side (the other leg) and its lateral side;
    - the thigh axis, fitted to the leg layer's slices from the knee up, runs up
      the leg layer to its top under a garment: that top is the pivot;
    - the thigh below the hem is the leg layer's own visible artwork down to the
      knee, at least a quarter of the thigh, with nothing beside it (a coat tail,
      a train or a hand along the thigh declines);
    - the pivot is near the model's own hip answer, with a thigh of plausible
      length against the lower leg.
    Long gowns and robes (no thigh or knee visible below the hem) and legs
    that are not separated are declined. The model must have answered the hip
    (confidence >= VERIFY_FLOOR); confidences are kept, never raised. The hem
    stays with the garment: only the pivot is estimated. Whether the static hem
    lets the thigh swing under it is decided later, on the rig, by the garment
    attachment sweep (attachmentMotionGate.ts).

    Returns (points, records, estimates) like estimate_separated_shoulders.
    """
    w,h=source_size;side_length=max(w,h);scale=size[0]/side_length
    ox,oy=(side_length-w)/2,(side_length-h)/2
    to_canvas=lambda p:np.array([(p['x']*w+ox)*scale,(p['y']*h+oy)*scale])
    to_normal=lambda c:(float(c[0]/scale-ox)/w,float(c[1]/scale-oy)/h)
    out={k:(dict(v) if isinstance(v,dict) else None) for k,v in points.items()};records=[];estimates={}
    finite=lambda n:(isinstance(out.get(n),dict) and all(np.isfinite([out[n].get('x',np.nan),out[n].get('y',np.nan),out[n].get('confidence',np.nan)])))
    answered=lambda n:finite(n) and VERIFY_FLOOR<=out[n]['confidence']<=1
    usable=lambda n:finite(n) and minimum<=out[n]['confidence']<=1
    candidates=[s for s in ['L','R'] if (lambda e:e.get('visible') is True and e.get('separate') is True and e.get('rootOccluded') is True)((regions or {}).get('Leg '+s) or {})]
    eyes={s:_eye_evidence(layers,s) for s in ['l','r']}
    if not candidates or not (eyes['l'] and eyes['r']):
        return out,records,estimates
    d=float(np.linalg.norm(eyes['l']['centre']-eyes['r']['centre']));joint_tol=max(6.,.5*d)
    foreground=mask>128;H,W=mask.shape
    legs=[n for n in layers if n.startswith('legwear')];feet=[n for n in layers if n.startswith('footwear')]
    if not legs:
        return out,records,{'Leg '+s:{'status':'declined','reason':'No leg layer'} for s in candidates}
    leg_all=_alpha_union(layers,legs);foot_all=_alpha_union(layers,feet) if feet else np.zeros_like(leg_all)
    # Every other layer can hide a hip: skirts, tunics, aprons, sashes, hands.
    covers=[n for n in layers if not n.startswith(('legwear','footwear')) and not HAIR_LAYER.match(n)]
    cover=_alpha_union(layers,covers) if covers else np.zeros_like(leg_all)
    leg_rgb=np.zeros((H,W,3),np.float32);weight=np.zeros((H,W),np.float32)
    for n in legs+feet:
        a=layers[n][:,:,3].astype(np.float32)/255;leg_rgb+=layers[n][:,:,:3]*a[:,:,None];weight+=a
    leg_rgb/=np.maximum(weight,1e-6)[:,:,None]
    # Source pixels showing the leg layer's own artwork. A layer hides the leg only
    # where the source does not show the leg: See-through also paints the hidden
    # parts of garments drawn behind the legs.
    shows=(leg_all|foot_all)&foreground&(np.abs(reference.astype(np.float32)-leg_rgb).mean(axis=2)<=30)
    cover=cover&~shows
    cols=np.arange(W)[None,:]
    inside=lambda c:(lambda x,y:(0<=x<W and 0<=y<H,x,y))(int(round(c[0])),int(round(c[1])))
    on=lambda m,c:(lambda r:bool(r[0] and m[r[2],r[1]]))(inside(c))
    background=lambda c:(lambda r:not r[0] or not foreground[r[2],r[1]])(inside(c))
    for side in candidates:
        chain='Leg '+side
        def decline(reason,**evidence):
            estimates[chain]={'status':'declined','reason':reason,**evidence}
        names=['hip'+side,'knee'+side,'ankle'+side]
        if not answered(names[0]) or not all(usable(n) for n in names[1:]):
            decline('The hip answer is missing, or the knee or ankle is not confidently located');continue
        h0,kn,an=[to_canvas(out[n]) for n in names]
        shin=float(np.linalg.norm(an-kn));thigh0=float(np.linalg.norm(h0-kn))
        if shin<joint_tol or thigh0<joint_tol:
            decline('Joints too close to define the leg');continue
        other='R' if side=='L' else 'L'
        # Crossed or interleaved legs (a raised leg folded over the standing one) are not separated legs.
        cross=lambda o,p,q:(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0])
        theirs=[to_canvas(out[n+other]) for n in ['hip','knee','ankle'] if answered(n+other)]
        if any(cross(a,b,c)*cross(a,b,e)<0 and cross(c,e,a)*cross(c,e,b)<0 for a,b in [(h0,kn),(kn,an)] for c,e in zip(theirs,theirs[1:])):
            decline('The legs cross; they are not separated');continue
        centre_x=float((kn[0]+to_canvas(out['knee'+other])[0])/2) if usable('knee'+other) else float((eyes['l']['centre'][0]+eyes['r']['centre'][0])/2)
        # Character left is image right: this leg's layer lies on its side of the two knees.
        half=(cols>centre_x) if side=='L' else (cols<centre_x)
        own=leg_all&half
        _,labels=cv2.connectedComponents(own.astype(np.uint8))
        field=cv2.distanceTransform((~own).astype(np.uint8),cv2.DIST_L2,3)
        x,y=int(round(kn[0])),int(round(kn[1]))
        if not (0<=x<W and 0<=y<H) or field[y,x]>joint_tol:
            decline("The knee is off this leg's layer");continue
        if labels[y,x]==0:
            ys,xs=np.nonzero(own);k=int(np.argmin((xs-x)**2+(ys-y)**2));x,y=int(xs[k]),int(ys[k])
        leg=labels==labels[y,x];limb=leg|(foot_all&half)
        gap_min=max(3.,.04*shin);reach=int(max(4*gap_min,shin))
        def section(m,c,direction):
            """Leg span across direction at c and whether background lies beyond its medial and lateral edges."""
            n=np.array([-direction[1],direction[0]])
            if (n[0]>0)!=(side=='L'):n=-n
            if not on(m,c):
                # A joint answered on the outline: the nearest layer pixel across the axis.
                c=next((c+sign*n*k for k in range(1,int(joint_tol)+1) for sign in (1,-1) if on(m,c+sign*n*k)),None)
                if c is None:
                    return None
            lateral=0
            while lateral<reach and on(m,c+n*(lateral+1)):lateral+=1
            medial=0
            while medial<reach and on(m,c-n*(medial+1)):medial+=1
            # Two pixels of slack for anti-aliased layer and silhouette edges.
            clear=lambda start,sign:all(background(c+sign*n*(start+k)) for k in range(3,3+int(np.ceil(gap_min))))
            return {'mid':c+n*(lateral-medial)/2,'width':medial+lateral+1,'medial':clear(medial,-1),'lateral':clear(lateral,1)}
        sdir=(an-kn)/shin
        shin_clear=float(np.mean([bool(s and s['medial'] and s['lateral']) for s in [section(limb,kn+(an-kn)*t,sdir) for t in np.linspace(.15,.85,8)]]))
        if shin_clear<.75:
            decline('The lower leg is not free of the body and the other leg on both sides',shinClear=shin_clear);continue
        # Thigh axis, fitted to the leg layer from the knee up (See-through continues it under the hem).
        udir=(h0-kn)/thigh0;axis=None
        for _ in range(2):
            slices=[section(leg,kn+udir*thigh0*t,udir) for t in np.linspace(.05,.8,16)]
            valid=[s for s in slices if s]
            if len(valid)<.6*len(slices):
                axis={'onLayer':len(valid)/len(slices)};break
            mids=np.array([s['mid'] for s in valid]);centre=mids.mean(axis=0)
            direction=np.linalg.svd(mids-centre)[2][0]
            if np.dot(direction,udir)<0:direction=-direction
            axis={'centre':centre,'direction':direction,'width':float(np.median([s['width'] for s in valid])),'slices':len(valid)}
            udir=direction
        if 'direction' not in axis:
            decline('The thigh does not continue on the leg layer toward the answered hip',thighOnLayer=axis['onLayer'],shinClear=shin_clear);continue
        u=axis['direction']
        if np.degrees(np.arccos(np.clip(np.dot(u,(h0-kn)/thigh0),-1,1)))>35:
            decline('The fitted thigh axis disagrees with the answered hip direction');continue
        # Walk up the axis to the top of the leg layer, or to the crotch where the
        # leg layer joins the other leg (trousers painted with their seat).
        # Toward the body centre: -x for the left leg (image right), +x for the right.
        medial=np.array([-u[1],u[0]])
        if (medial[0]<0)!=(side=='L'):medial=-medial
        # Joined: the leg layer runs from the axis across the midline well into the other leg's half.
        joined=lambda c:all(on(leg_all,c+medial*k) for k in range(0,int((abs(c[0]-centre_x)+.25*axis['width'])/max(abs(medial[0]),.1))+1,2))
        pivot=axis['centre']+u*np.dot(kn-axis['centre'],u);path=[pivot];steps=0
        while steps<2*thigh0 and on(leg,pivot+u):pivot=pivot+u;path.append(pivot);steps+=1
        # A seat joined to the other leg from the top down ends at the crotch.
        # (Knees touching lower down are not contiguous with the top.)
        k=len(path)-1
        while k>0 and joined(path[k]):k-=1
        pivot=path[k] if k<len(path)-1 else pivot
        thigh=float(np.linalg.norm(pivot-kn))
        # From the pivot down the thigh: hidden under a garment (to the hem), then the leg's own visible artwork.
        samples=[pivot+(kn-pivot)*t for t in np.linspace(0,1,41)]
        covered=[on(cover,c) for c in samples];visible=[on(shows,c) for c in samples]
        hem=max([i for i,c in enumerate(covered) if c],default=-1);below=visible[hem+1:]
        evidence={'thighWidth':axis['width'],'axisSlices':axis['slices'],'shinClear':shin_clear,'thighToShin':thigh/shin,
                  'modelDistance':float(np.linalg.norm(pivot-h0)),'hiddenThigh':(hem+1)/len(samples),
                  'visibleBelowHem':float(np.mean(below)) if below else 0.,'kneeVisible':bool(np.mean(visible[-6:])>=.5)}
        if hem<0 or not covered[0]:
            decline('The top of the leg layer is not under a garment; the hip is not hidden there',**evidence);continue
        if not evidence['kneeVisible'] or evidence['visibleBelowHem']<.8 or evidence['hiddenThigh']>.75:
            decline('Too little of the thigh is visible below the hem',**evidence);continue
        evidence['thighLateralClear']=float(np.mean([bool(s and s['lateral']) for s in [section(leg,c,u) for c in samples[hem+1:]]]))
        if evidence['thighLateralClear']<.6:
            decline('Clothing or another part lies beside the visible thigh',**evidence);continue
        if evidence['thighToShin']<.6 and covered[0]:
            # See-through may end the leg layer part-way under the garment: its top is
            # then not the hip. The hip lies further up the same thigh axis, still
            # hidden: the model's hip answer projected onto the fitted axis, accepted
            # only where the garment covers it and the thigh it gives is plausible.
            projected=axis['centre']+u*np.dot(h0-axis['centre'],u)
            extended=float(np.linalg.norm(projected-kn))/shin
            if np.dot(projected-pivot,u)>0 and on(cover,projected) and .6<=extended<=1.7:
                evidence.update(layerTopToShin=evidence['thighToShin'],thighToShin=extended,
                                modelDistance=float(np.linalg.norm(projected-h0)),
                                pivotRule='leg layer ends under the garment; hip taken on the thigh axis at the answered height')
                pivot=projected
        if not .6<=evidence['thighToShin']<=1.7:
            decline('The estimated thigh is implausibly long or short against the lower leg',**evidence);continue
        if evidence['modelDistance']>max(2*joint_tol,.5*thigh0):
            decline('The estimated pivot is far from the answered hip',**evidence);continue
        before=out[names[0]];x,y=to_normal(pivot)
        out[names[0]]={'x':min(1.,max(0.,x)),'y':min(1.,max(0.,y)),'confidence':before['confidence'],'verified':True}
        records.append({'point':names[0],'status':'estimated','reason':HIP_ESTIMATE_REASON,
                        'model':{'x':before['x'],'y':before['y']},'result':{'x':out[names[0]]['x'],'y':out[names[0]]['y']}})
        estimates[chain]={'status':'estimated','reason':HIP_ESTIMATE_REASON,**evidence}
    return out,records,estimates


def check_landmarks(source, psd, analysis, out, garment=False):
    """Stage entry: write the verified landmark set for the pipeline to adopt.

    garment: the limited-motion garment builder, which gates on 0.8 confidence
    and estimates no limb roots."""
    size,layers=read_layers(psd)
    data=json.loads(Path(analysis).read_text());assessment=data['assessment']
    model=assessment.get('modelPoints') or assessment['points']
    mask=np.array(square(Image.fromarray(foreground(Image.open(source))[0]),size))
    source_size=(data['source']['width'],data['source']['height'])
    points,records=verify_landmarks(layers,mask,model,source_size,size,minimum=.8 if garment else .5,garment=garment)
    reference=np.array(square(Image.open(source).convert('RGB'),size))
    estimates={}
    if not garment:
        points,estimated,estimates=estimate_separated_shoulders(layers,mask,reference,points,assessment.get('regions') or {},source_size,size)
        records+=estimated
        points,estimated,hips=estimate_covered_hips(layers,mask,reference,points,assessment.get('regions') or {},source_size,size)
        records+=estimated;estimates={**estimates,**hips}
    write_json(out/'landmark-check.json',{'schema':1,'sourceSha256':sha(source),'psdSha256':sha(psd),
        'modelPoints':model,'points':points,'records':records,'rootEstimates':estimates,
        'changed':sum(r['status'] in ('corrected','rejected','estimated') for r in records),
        'method':'Model landmarks tested against See-through eye, mouth, face and limb layers and the source silhouette'})


def recover_face_support(layers, reference, mask, points):
    """Repair missing face support from visible source pixels, not generated anatomy.

    Only a materially incomplete face is repaired. A landmark-bounded hull connects
    the existing face and facial feature supports; it stops at the measured chin.
    Expression supports are inpainted underneath their independent feature layers
    so blink and mouth motion cannot expose a duplicate neutral expression.
    """
    required = ['eyeL', 'eyeR', 'mouth', 'chin']
    if not all(n in points for n in required):
        return {'status': 'not-repaired', 'reason': 'Insufficient visible facial landmarks'}
    h,w = mask.shape
    eyes = np.array([points['eyeL'],points['eyeR']], np.float32)
    mouth,chin = np.array(points['mouth']),np.array(points['chin'])
    eye_distance = float(np.linalg.norm(eyes[0]-eyes[1]))
    if eye_distance < 8 or not (eyes[:,1].mean() < mouth[1] < chin[1]):
        return {'status': 'not-repaired', 'reason': 'Facial landmarks do not support an upright face envelope'}
    # Check the cheeks/central face, including support behind independent eyes.
    probe = np.zeros((h,w),np.uint8)
    corners = np.array([eyes[0],eyes[1],mouth+[eye_distance*.35,0],
                        mouth-[eye_distance*.35,0]],np.float32)
    cv2.fillConvexPoly(probe,cv2.convexHull(corners).astype(np.int32),255)
    probe = (probe>0)&(mask>128)
    face = layers.get('face', np.zeros((h,w,4),np.uint8))
    coverage = float(np.mean(face[:,:,3][probe]>128)) if probe.any() else 1.
    if coverage >= .85:
        return {'status':'unchanged','supportCoverage':coverage}
    support = np.zeros((h,w),np.uint8)
    feature_names = [n for n in layers if n.startswith(('eyewhite-','irides-','eyelash-','eyebrow-','ears-')) or n in ['face','nose','mouth','mouth_close']]
    for name in feature_names:
        support = np.maximum(support,layers[name][:,:,3])
    # Bound the repair to the head: a corrupt layer must not pull the hull to the torso.
    yy,xx=np.mgrid[:h,:w]
    cx=float(eyes[:,0].mean())
    # An estimated chin may end above visible facial hair. Require matching
    # source pixels in a nearby existing head layer before extending support;
    # never extend to arbitrary long hair or carry a beard on the neck texture.
    jaw_hint=np.zeros((h,w),bool)
    if 'back hair' in layers:
        back=layers['back hair']
        error=np.mean(np.abs(back[:,:,:3].astype(float)-reference),axis=2)
        jaw_hint=(back[:,:,3]>128)&(mask>128)&(error<30)&(np.abs(xx-cx)<eye_distance*.75)&(yy>=mouth[1])&(yy<=chin[1]+eye_distance*.6)
    lower_boundary=max(float(chin[1]),float(yy[jaw_hint].max()) if jaw_hint.any() else float(chin[1]))
    head=(np.abs(xx-cx)<eye_distance*1.25)&(yy>=eyes[:,1].mean()-eye_distance*1.5)&(yy<=lower_boundary)
    support = ((support>16)|jaw_hint)&head&(mask>16)
    y,x=np.where(support)
    vertices=np.vstack([np.column_stack([x,y]),eyes,mouth,chin]).astype(np.int32)
    hull=np.zeros((h,w),np.uint8)
    cv2.fillConvexPoly(hull,cv2.convexHull(vertices),255)
    hull=np.minimum(hull,mask);hull[~head]=0
    # Never take over artwork another layer already explains: the collar, the
    # clasp or the neck below a jaw stay with their own parts.
    for name,layer in layers.items():
        if name=='neck' or not HEAD_LAYER.match(name):
            explained=(layer[:,:,3]>128)&(color_distance(layer[:,:,:3],reference)<30)&(face[:,:,3]<128)
            hull[explained]=0
    if np.count_nonzero(hull)<32:
        return {'status':'not-repaired','reason':'No bounded source-supported face region'}
    # Remove neutral expression pixels only from the new underlay. Existing face
    # pixels and all feature textures/geometry remain independently owned.
    expression=np.zeros((h,w),np.uint8)
    for name in feature_names:
        if name not in ['face','ears-l','ears-r']:
            expression=np.maximum(expression,layers[name][:,:,3])
    radius=max(2,round(eye_distance*.04))
    expression=cv2.dilate((expression>8).astype(np.uint8)*255,np.ones((radius*2+1,radius*2+1),np.uint8))
    clean=cv2.inpaint(reference,expression,radius,cv2.INPAINT_NS)
    repaired=face.copy()
    added=(hull>0)&(face[:,:,3]<250)
    repaired[added,:3]=clean[added]
    repaired[:,:,3]=np.maximum(face[:,:,3],hull)
    layers['face']=repaired
    neck_restored=0
    if 'neck' in layers:
        # Preserve visible source neck shading without copying the neutral face
        # into the neck or changing any neck mesh, alpha, or motion ownership.
        visible=(layers['neck'][:,:,3]>128)&(mask>128)&(yy>lower_boundary)
        for name in ['face','front hair','ears-l','ears-r']:
            if name in layers:
                visible &= layers[name][:,:,3]<8
        layers['neck'][visible,:3]=reference[visible]
        neck_restored=int(visible.sum())
    return {'status':'repaired','supportCoverageBefore':coverage,
            'supportCoverageAfter':float(np.mean(repaired[:,:,3][probe]>128)),
            'addedPixels':int(added.sum()),'neckSourcePixels':neck_restored,'method':'Source-supported facial hull with expression-free underlay',
            'chinLandmark':float(chin[1]),'sourceSupportedLowerBoundary':lower_boundary,'generatedAnatomy':False}


def feature_layout(layers, size):
    face = bounds(layers, ['face'])
    eye = {s: bounds(layers, [f'eyewhite-{s}', f'irides-{s}', f'eyelash-{s}']) for s in ['l','r']
           if any(f'{name}-{s}' in layers for name in ['eyewhite','irides','eyelash'])}
    mouth = bounds(layers, ['mouth', 'mouth_close']) if any(n in layers for n in ['mouth','mouth_close']) else None
    return {'face': face, 'eyes': eye, 'mouth': mouth}


def plan_edits(source, psd, out, analysis=None):
    size,layers = read_layers(psd)
    ref = square(Image.open(source).convert('RGB'), size)
    if analysis:
        source_mask=np.array(square(Image.fromarray(foreground(Image.open(source))[0]),size))
        recover_face_support(layers,np.array(ref),source_mask,anatomical_points(analysis,size))
    layout = feature_layout(layers, size)
    face = layout['face']; width,height = face[2]-face[0],face[3]-face[1]
    side = int(max(width,height)*1.6)
    cx,cy = (face[0]+face[2])/2,(face[1]+face[3])/2
    crop = [int(cx-side/2),int(cy-side/2),int(cx-side/2)+side,int(cy-side/2)+side]
    ref.crop(crop).resize((1024,1024), Image.Resampling.LANCZOS).save(out/'edit-source.png')
    capabilities = json.loads(Path(analysis).read_text()).get('capabilities') if analysis else None
    capabilities = capabilities if isinstance(capabilities,dict) and capabilities.get('version') == 1 else None
    allowed = lambda name: not capabilities or capabilities['face'][name]['mode'] != 'fixed'
    kinds = (['eyes'] if layout['eyes'] and allowed('blink') else []) + (['mouth'] if layout['mouth'] and allowed('mouth') else [])
    for kind in kinds:
        mask = np.full((size[1],size[0],4),255,np.uint8)
        boxes = list(layout['eyes'].values()) if kind=='eyes' else [layout['mouth']]
        for box in boxes:
            b = expand(box,(box[2]-box[0])*.35,max(8,(box[3]-box[1])*.55),size)
            mask[b[1]:b[3],b[0]:b[2],3] = 0
        Image.fromarray(mask).crop(crop).resize((1024,1024)).save(out/f'edit-mask-{kind}.png')
    write_json(out/'edit-plan.json', {'schema':1, 'canvas':size, 'cropCanvas':crop,
        'layout':layout, 'expressionKinds':kinds, 'allowPartial':bool(capabilities), 'sourceSha256':sha(source), 'psdSha256':sha(psd),
        'regionSource':'semantic alpha bounds, no additional vision call'})


def retain_components(alpha, minimum=12):
    count,labels,stats,_ = cv2.connectedComponentsWithStats((alpha>8).astype(np.uint8))
    if count <= 1:
        return alpha
    keep = np.where(stats[:,cv2.CC_STAT_AREA] >= minimum)[0]
    return np.where(np.isin(labels, keep[keep!=0]), alpha, 0).astype(np.uint8)


def split_limbs(layers, points, partial=False):
    """Assign components by anatomical chains, never use a fixed canvas midline."""
    report=[]
    for base,joint in [('legwear','knee'),('footwear','ankle'),('handwear','elbow')]:
        if base not in layers:
            continue
        rgba=layers[base]; h,w=rgba.shape[:2]
        if joint+'L' not in points or joint+'R' not in points:
            if partial:
                report.append({'layer':base,'operation':'retained unsplit: anatomical ownership is uncertain'})
                continue
            raise ValueError('Missing landmarks for '+base)
        layers.pop(base)
        yy,xx=np.mgrid[:h,:w]
        l,r=points[joint+'L'],points[joint+'R']
        chain={'knee':['hip','knee','ankle'],'ankle':['knee','ankle'],'elbow':['shoulder','elbow','wrist']}[joint]
        def segment_distance(side):
            # Distance to the limb's own joint polyline, not to one joint: a
            # straight bisector between two knees cuts through a wide stance.
            names=[n+side for n in chain if n+side in points]
            if len(names)<2:
                q=points[joint+side];return (xx-q[0])**2+(yy-q[1])**2
            best=np.full((h,w),np.inf,np.float32)
            for a_,b_ in zip(names,names[1:]):
                a,b=np.array(points[a_],np.float32),np.array(points[b_],np.float32);d=b-a;length=float(d@d)
                t=np.clip(((xx-a[0])*d[0]+(yy-a[1])*d[1])/max(length,1e-6),0,1)
                best=np.minimum(best,(xx-a[0]-t*d[0])**2+(yy-a[1]-t*d[1])**2)
            return best
        def polyline(side):
            return [np.array(points[n+side],np.float32) for n in chain if n+side in points]
        def crossing(a,b):
            # Two limbs whose joint polylines cross (crossed legs, a hand over the
            # other arm) cannot be split by distance to them: the boundary becomes
            # an X that cuts both limbs into pieces meeting at a point.
            cross=lambda o,p,q:(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0])
            for p1,p2 in zip(a,a[1:]):
                for q1,q2 in zip(b,b[1:]):
                    if cross(p1,p2,q1)*cross(p1,p2,q2)<0 and cross(q1,q2,p1)*cross(q1,q2,p2)<0:
                        return True
            return False
        if crossing(polyline('L'),polyline('R')):
            choose=(xx-l[0])**2+(yy-l[1])**2<=(xx-r[0])**2+(yy-r[1])**2
        else:
            choose=segment_distance('L')<=segment_distance('R')
        for side,mask in [('l',choose),('r',~choose)]:
            part=rgba.copy(); part[:,:,3]=np.where(mask,rgba[:,:,3],0)
            layers[base+'-'+side]=part
        report.append({'layer':base,'operation':'nearest anatomical landmark partition'})
    # Keep whole arm artwork: our limb deformer does not need an artificial cuff cut.
    for side in ['l','r']:
        name='handwear-'+side
        if name in layers and 'arm-'+side not in layers:
            layers['arm-'+side]=layers.pop(name)
    return report


def recover_visible_feet(layers, reference, mask, points):
    """Recover omitted distal source pixels only when no footwear layer exists.

    Ankles bound the search; the source silhouette supplies all artwork. The
    ordinary anatomical partition and leg rig then own the recovered pixels.
    """
    if any(n == 'footwear' or n.startswith('footwear-') for n in layers):
        return []
    if not all(n+s in points for n in ['ankle', 'knee'] for s in ['L', 'R']):
        return []
    h,w=mask.shape; yy,xx=np.mgrid[:h,:w]; selected=np.zeros((h,w),bool)
    for side in ['L','R']:
        ankle=np.array(points['ankle'+side]); knee=np.array(points['knee'+side])
        length=float(np.linalg.norm(ankle-knee))
        if length < 8:
            continue
        selected |= ((yy>=ankle[1]-.15*length)&(yy<=ankle[1]+.8*length)
                     &(np.abs(xx-ankle[0])<.8*length)&(mask>8))
    if np.count_nonzero(selected)<32:
        return []
    rgba=np.dstack([reference,np.where(selected,mask,0).astype(np.uint8)])
    layers['footwear']=rgba
    return [{'operation':'recover missing distal foot artwork from visible source silhouette',
             'pixels':int(np.count_nonzero(selected)), 'generatedPixels':False,
             'ownership':'Existing ankle partition and whole-leg deformation'}]


def map_edit(path, plan, canvas):
    im=Image.open(path).convert('RGB')
    x0,y0,x1,y1=plan['cropCanvas']
    result=canvas.copy()
    result.paste(im.resize((x1-x0,y1-y0),Image.Resampling.LANCZOS),(x0,y0))
    return np.array(result)


def register_edit(reference, edited, boxes, face):
    """Fit translation on unchanged face pixels; reject unsupported large shifts."""
    x0,y0,x1,y1=face
    fixed=cv2.cvtColor(reference[y0:y1,x0:x1],cv2.COLOR_RGB2GRAY).astype(np.float32)/255
    moved=cv2.cvtColor(edited[y0:y1,x0:x1],cv2.COLOR_RGB2GRAY).astype(np.float32)/255
    mask=np.full(fixed.shape,255,np.uint8)
    for a,b,c,d in boxes:
        mask[max(0,b-y0):min(y1-y0,d-y0),max(0,a-x0):min(x1-x0,c-x0)]=0
    warp=np.eye(2,3,dtype=np.float32)
    score=None
    try:
        score,warp=cv2.findTransformECC(fixed,moved,warp,cv2.MOTION_TRANSLATION,
            (cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,40,1e-5),mask,3)
        if np.linalg.norm(warp[:,2]) > min(x1-x0,y1-y0)*.08:
            raise ValueError('Expression edit moved the face too far')
        aligned=cv2.warpAffine(edited,warp,(edited.shape[1],edited.shape[0]),
                              flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
    except cv2.error:
        aligned=edited
        warp=np.eye(2,3,dtype=np.float32)
    return aligned, {'ecc':score,'translation':warp[:,2].tolist()}


def color_distance(a, b):
    """Largest per-channel difference, robust to hue shifts that a mean would dilute."""
    return np.max(np.abs(a.astype(np.float32)-np.asarray(b,np.float32)),axis=-1)


def skin_model(reference, layers, mask, region):
    """Median skin color and a tolerance, from face pixels no feature, hair or headwear covers."""
    face=layers.get('face')
    if face is None:
        return None
    # Only layers drawn over the face hide it; back hair lies behind it.
    cover=np.zeros(mask.shape,bool)
    for name,layer in layers.items():
        if name!='face' and HEAD_LAYER.match(name) and depth(name)>depth('face'):
            cover|=layer[:,:,3]>32
    skin=(face[:,:,3]>128)&~cover&(mask>128)&region
    if np.count_nonzero(skin)<40:
        skin=(face[:,:,3]>128)&~cover&(mask>128)
    if np.count_nonzero(skin)<40:
        # Glasses, a hood or hair can lie over the whole face layer. The face
        # pixels that already reproduce the source outside the facial features
        # are its visible skin then.
        features=np.zeros(mask.shape,bool)
        for name,layer in layers.items():
            if name.startswith(FEATURE_PREFIXES):
                features|=layer[:,:,3]>32
        agree=(face[:,:,3]>128)&~features&(mask>128)&(color_distance(face[:,:,:3],reference)<20)
        skin=agree&region if np.count_nonzero(agree&region)>=40 else agree
    if np.count_nonzero(skin)<40:
        return None
    values=reference[skin].astype(np.float32);median=np.median(values,axis=0)
    spread=np.median(color_distance(values,median))
    # Line art and deep shadow are not skin; keep the tolerance within a band.
    return {'median':median,'tolerance':float(np.clip(3*spread,18,45)),'pixels':int(np.count_nonzero(skin))}


def feathered(region, sigma=.9):
    alpha=cv2.GaussianBlur(region.astype(np.float32),(0,0),sigma) if sigma>0 else region.astype(np.float32)
    return np.clip(np.maximum(alpha,region*.999),0,1)


def shaped_patch(reference, edited, region, support, name, sigma=.9, color_match=True):
    """An expression patch with the shape of the changed feature, never a box.

    Alpha follows region, feathered, and is cut to support (the face and its
    features inside the source silhouette), so no background or neighbouring
    artwork is ever copied. Skin bias is matched on a ring just outside the region.
    """
    region=region&support
    if not region.any():
        raise ValueError('Empty expression region for '+name)
    ring=(cv2.dilate(region.astype(np.uint8),np.ones((5,5),np.uint8))>0)&~region&support
    bias=np.zeros(3,np.float32)
    if color_match and np.count_nonzero(ring)>=12:
        bias=np.clip(np.median(reference[ring].astype(np.float32)-edited[ring].astype(np.float32),axis=0),-24,24)
    alpha=feathered(region,sigma)*support
    result=np.zeros((*reference.shape[:2],4),np.uint8)
    result[:,:,:3]=np.clip(edited.astype(np.float32)+bias,0,255).astype(np.uint8)
    result[:,:,3]=np.rint(alpha*255).astype(np.uint8)
    ys,xs=np.nonzero(result[:,:,3])
    box=[int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1]
    return result,{'layer':name,'box':box,'skinBias':bias.tolist(),'pixels':int(np.count_nonzero(result[:,:,3]>128)),'shape':'feature region, feathered, clipped to face support'}


def face_support(layers, mask):
    """Where the face and its features lie inside the source silhouette."""
    support=np.zeros(mask.shape,bool)
    for name in layers:
        if name=='face' or name.startswith(('mouth','nose','eyewhite','irides','eyelash','eyebrow')):
            support|=layers[name][:,:,3]>64
    return support&(mask>128)


def mouth_close_region(layers, reference, mask, skin, facial_hair):
    """The source lips: the decomposition mouth plus connected lip marks.

    Surrounding skin, the jaw contour and facial hair are not part of it, so
    they stay on the face when the closed mouth fades out.
    """
    core=_alpha_union(layers,['mouth','mouth_close'],32)
    if core is None or not core.any():
        return None
    ys,xs=np.nonzero(core);width=max(4,xs.max()-xs.min())
    radius=1 if facial_hair or skin is None else max(2,int(round(.06*width)))
    near=cv2.dilate(core.astype(np.uint8),np.ones((2*radius+1,2*radius+1),np.uint8))>0
    region=core.copy()
    if skin is not None and not facial_hair:
        marks=near&(color_distance(reference,skin['median'])>skin['tolerance'])
        count,labels=cv2.connectedComponents((marks|core).astype(np.uint8))
        touching=np.unique(labels[core]);region|=np.isin(labels,touching[touching>0])&marks
    region=cv2.dilate(region.astype(np.uint8),np.ones((3,3),np.uint8))>0
    hair_colored=None
    if facial_hair and skin is not None:
        # Facial hair the decomposition put into the mouth layer has the colors
        # of the moustache or beard just outside it, not of the lips: it stays
        # on the face, which shows the source there once the lip shape is cut.
        window=cv2.dilate(core.astype(np.uint8),np.ones((2*width+1,2*width+1),np.uint8))>0
        outside=window&~(cv2.dilate(core.astype(np.uint8),np.ones((7,7),np.uint8))>0)&face_support(layers,mask)
        hair=outside&(color_distance(reference,skin['median'])>skin['tolerance'])
        if np.count_nonzero(hair)>=30:
            samples=reference[hair].astype(np.float32)
            k=min(4,len(samples))
            _,_,palette=cv2.kmeans(samples,k,None,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_MAX_ITER,20,1.),2,cv2.KMEANS_PP_CENTERS)
            nearest=np.min(np.stack([color_distance(reference,c) for c in palette]),axis=0)
            hair_colored=window&face_support(layers,mask)&(nearest<25)&(color_distance(reference,skin['median'])>skin['tolerance'])
            # Only hair that continues the moustache or beard outside the lips is
            # facial hair. Dark stubble can have the color of the lip line, and a
            # lip line inside the mouth must still close and open with the mouth.
            count,labels=cv2.connectedComponents(hair_colored.astype(np.uint8))
            outer=np.unique(labels[hair]);hair_colored&=np.isin(labels,outer[outer>0])
            region&=~(core&hair_colored)
    if facial_hair and 'face' in layers:
        # A moustache the decomposition put into the mouth layer is usually also
        # completed on the face beneath it. Where the face already reproduces the
        # source, the pixel is facial hair, not lips: it stays on the face so it
        # is kept while the mouth opens. The decomposition often draws the lips on
        # the face too: with a measured hair color only hair-colored pixels count.
        face=layers['face']
        duplicate=(face[:,:,3]>128)&(color_distance(face[:,:,:3],reference)<28)
        if hair_colored is not None:
            duplicate&=hair_colored
        duplicate=cv2.morphologyEx(duplicate.astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))>0
        region&=~duplicate
    return region&face_support(layers,mask)


def front_facial_hair(reference, cavity, search, support, skin, face_width, features=None):
    """Facial hair that hangs in front of the opening: a moustache above it.

    Source pixels the skin model does not explain (sparse strands are merged),
    at least a fortieth of the face width thick, that form a piece reaching
    clearly above the edited opening. Over the opening only its part down to the
    opening's upper third counts; beside it the piece is kept whole (a curl
    hanging past the mouth corner). A lip line or smile crease, thin or reaching
    into the opening, still opens with the mouth. The piece is filled, so no skin or
    cavity speck shows between its strands; the hole the opening lies in (a beard
    enclosing the mouth) stays open. A moustache wider than the mouth
    search window is followed up to a third of the face width beyond it.
    """
    if skin is None or not cavity.any():
        return np.zeros(cavity.shape,bool)
    x0,y0,x1,y1=search
    window=np.zeros(cavity.shape,bool);window[y0:y1,x0:x1]=True
    ex,ey=int(round(face_width*.35)),int(round(face_width*.2))
    reach=np.zeros(cavity.shape,bool);reach[max(0,y0-ey):y1+ey,max(0,x0-ex):x1+ex]=True
    hair=reach&support&(color_distance(reference,skin['median'])>skin['tolerance'])
    if features is not None:
        hair&=~features
    hair=cv2.morphologyEx(hair.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))>0
    k=max(3,int(round(face_width/40)))|1
    thick=cv2.morphologyEx(hair.astype(np.uint8),cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k)))>0
    hair=thick|(cv2.dilate(thick.astype(np.uint8),np.ones((3,3),np.uint8))>0)&hair
    cy,_=np.nonzero(cavity);top,ch=cy.min(),cy.max()-cy.min()+1
    count,labels,stats,_=cv2.connectedComponentsWithStats(hair.astype(np.uint8))
    near=set(np.unique(labels[window]).tolist())
    front=np.isin(labels,[i for i in range(1,count) if i in near and stats[i,cv2.CC_STAT_AREA]>=20
                          and stats[i,cv2.CC_STAT_TOP]<top-max(2,.2*ch)])
    rows=np.arange(cavity.shape[0])[:,None]
    over=cv2.dilate(cavity.astype(np.uint8),np.ones((5,5),np.uint8))>0
    front&=~(over&(rows>=top+max(1,.35*ch)))
    filled=front.astype(np.uint8).copy();flood=np.zeros((filled.shape[0]+2,filled.shape[1]+2),np.uint8)
    cv2.floodFill(filled,flood,(0,0),2)
    # Gaps between strands are filled; the hole the opening itself lies in (a beard
    # around the mouth encloses it) is the mouth, not a gap.
    holes=filled==0
    count,labels=cv2.connectedComponents(holes.astype(np.uint8))
    mouth=np.unique(labels[holes&cavity])
    holes&=~np.isin(labels,mouth[mouth>0])
    return (front|holes)&reach


def mouth_open_region(reference, edited, cavity, search, support, skin, facial_hair, closed, features=None, front=None):
    """Pixels the open-mouth edit really changed, connected to its cavity."""
    x0,y0,x1,y1=search
    window=np.zeros(support.shape,bool);window[y0:y1,x0:x1]=True
    changed=cv2.medianBlur((color_distance(edited,reference)>24).astype(np.uint8),3)>0
    grown=(changed|cavity)&window
    count,labels=cv2.connectedComponents(grown.astype(np.uint8))
    keep=np.unique(labels[cavity&grown]);region=np.isin(labels,keep[keep>0])
    # Fill holes (teeth inside the cavity) and cover the closed lips it replaces.
    filled=region.astype(np.uint8).copy();h,w=filled.shape;flood=np.zeros((h+2,w+2),np.uint8)
    cv2.floodFill(filled,flood,(0,0),2);region|=filled==0
    if closed is not None:
        region|=closed&window
    region=(cv2.dilate(region.astype(np.uint8),np.ones((5,5),np.uint8))>0)&window
    # The edit may repaint the whole face (eyes, nose, skin). The patch stays
    # around the mouth: within a third of the mouth width of the cavity and the
    # lips, and never on the eyes, brows or nose.
    mouth=cavity|(closed if closed is not None else False)
    ys,xs=np.nonzero(mouth);reach=max(4,int(round(.3*(xs.max()-xs.min()+1))))
    region&=cv2.dilate(mouth.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*reach+1,2*reach+1)))>0
    if facial_hair:
        # With facial hair the patch covers only the opening and the lips around
        # it, about as thick as the closed lips: the beard and moustache beyond
        # them stay as the source draws them, even where the edit restyled them.
        lips=closed if closed is not None and closed.any() else cavity
        ly,_=np.nonzero(lips);band=max(4,int(round(.6*(ly.max()-ly.min()+1)))+2)
        region&=cv2.dilate(mouth.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*band+1,2*band+1)))>0
    if features is not None:
        region&=~features
    hair=None
    if facial_hair and skin is None:
        # Without a skin model the facial hair cannot be told from skin: every
        # source pixel outside the opening and the lips it replaces stays as is.
        keep=cavity|(closed if closed is not None else False)
        region&=cv2.dilate(keep.astype(np.uint8),np.ones((3,3),np.uint8))>0
        hair=window&support&~region
    if facial_hair and skin is not None:
        # Facial hair lies in front of the mouth: source hair pixels stay visible
        # on the face layer instead of being replaced by the generated mouth.
        hair=window&support&(color_distance(reference,skin['median'])>skin['tolerance'])
        if closed is not None:
            hair&=~closed
        hair&=~(cv2.dilate(cavity.astype(np.uint8),np.ones((3,3),np.uint8))>0)
        # A moustache above the opening hangs in front of it, also over the
        # opening's top: it stays whole on the face and the mouth opens below it.
        front=np.zeros(hair.shape,bool) if front is None else front
        hair|=front
        # Where the edit shaved facial hair off (the source is clearly farther
        # from the skin than the edit, which shows skin), the source stays: an
        # open mouth never shows clean-shaven skin.
        to_skin=color_distance(edited,skin['median'])
        shaven=window&support&(to_skin<=skin['tolerance'])&(color_distance(reference,skin['median'])-to_skin>.5*skin['tolerance'])
        if closed is not None:
            shaven&=~closed
        hair|=shaven&~(cv2.dilate(cavity.astype(np.uint8),np.ones((3,3),np.uint8))>0)
        # The patch moves while the mouth opens: any of its pixels inside the
        # moustache (skin between strands, the dark outline) slides over the
        # static hair. The hair is closed over its highlights and grown by its
        # outline, and only patch artwork still connected to the cavity is kept,
        # so no skin fragment is left between or above the strands.
        zone=cv2.morphologyEx(hair.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        zone=(cv2.dilate(zone,np.ones((5,5),np.uint8))>0)&~(cv2.dilate((cavity&~front).astype(np.uint8),np.ones((3,3),np.uint8))>0)
        zone|=front
        hair=zone&window
        region&=~hair
        count,labels=cv2.connectedComponents(region.astype(np.uint8))
        keep=np.unique(labels[cavity&region]);region&=np.isin(labels,keep[keep>0])
        # Hair the source shows where the edit draws the opening (a tuft under
        # the lower lip that the opened lip and tongue now cover) would show
        # through holes in the open mouth: holes the patch encloses around the
        # opening belong to it.
        cy,cx=np.nonzero(cavity);ch=cy.max()-cy.min()+1
        around=np.zeros(region.shape,bool);around[max(0,cy.min()-ch//4):cy.max()+ch//4+1,cx.min():cx.max()+1]=True
        filled=region.astype(np.uint8).copy();flood=np.zeros((filled.shape[0]+2,filled.shape[1]+2),np.uint8)
        cv2.floodFill(filled,flood,(0,0),2)
        holes=(filled==0)
        count,labels=cv2.connectedComponents(holes.astype(np.uint8))
        inner=np.unique(labels[holes&around]);holes&=np.isin(labels,inner[inner>0])
        holes&=~front
        region|=holes;hair&=~holes
    return region&(support|cavity),hair


def keep_lip_color(reference, edited, cavity, region, closed, skin):
    """Give the opened lips the hue of the source lips when the edit changed it.

    Image edits often repaint colored lips (lipstick) in a natural tone. The lips
    of the open mouth lie in a band around its cavity; pixels there that have the
    edit's lip color take the source lips' chromaticity, keeping their own
    lightness and shading, the more the closer they are to that color, so teeth,
    the cavity and the skin around stay as edited. Returns the edit and a record
    (None when nothing was changed).
    """
    if skin is None or closed is None or not closed.any() or not cavity.any():
        return edited,None
    ref=reference.astype(np.float32);rgb=edited.astype(np.float32)
    chroma=lambda v:v/np.maximum(v.sum(axis=-1,keepdims=True),1.)
    lit=lambda v:(v.mean(axis=-1)>50)&(v.mean(axis=-1)<210)
    source_lips=closed&lit(ref)&(color_distance(ref,skin['median'])>skin['tolerance'])
    if np.count_nonzero(source_lips)<20:
        return edited,None
    source=np.median(ref[source_lips],axis=0)
    if float(color_distance(source,skin['median']))<=1.5*skin['tolerance']:
        return edited,None   # natural lips: nothing to keep
    # The opened lips are about as thick as the closed ones, each side of the cavity.
    ys,_=np.nonzero(closed);k=max(3,int(round(.6*(ys.max()-ys.min()+1))))
    band=(cv2.dilate(cavity.astype(np.uint8),np.ones((2*k+1,2*k+1),np.uint8))>0)&~cavity&region
    lips=band&(color_distance(rgb,skin['median'])>skin['tolerance'])&lit(rgb)&(rgb.min(axis=2)<200)
    if np.count_nonzero(lips)<20:
        return edited,None
    painted=np.median(rgb[lips],axis=0)
    target=np.median(chroma(ref[source_lips]),axis=0);current=np.median(chroma(rgb[lips]),axis=0)
    if float(np.abs(target-current).max())<=.04:
        return edited,None
    reach=max(30.,.6*float(color_distance(painted,skin['median'])))
    weight=np.clip(1-color_distance(rgb,painted)/reach,0,1)*band
    moved=rgb.sum(axis=2,keepdims=True)*(chroma(rgb)+weight[:,:,None]*(target-current))
    out=edited.copy();out[band]=np.clip(moved[band],0,255).astype(np.uint8)
    return out,{'sourceLips':source.tolist(),'editedLips':painted.tolist(),'chromaShift':(target-current).round(3).tolist(),'pixels':int(np.count_nonzero(weight>.5))}


def eye_close_region(layers, reference, edited, side, support, skin=None):
    """Closed-eye patch shape: the eye and its changed surround, never the brow."""
    eye=_alpha_union(layers,['eyewhite-'+side,'irides-'+side,'eyelash-'+side],32)
    if eye is None or not eye.any():
        return None
    ys,_=np.nonzero(eye);height=max(3,ys.max()-ys.min())
    radius=max(3,int(round(.3*height)))
    near=cv2.dilate(eye.astype(np.uint8),np.ones((2*radius+1,2*radius+1),np.uint8))>0
    changed=cv2.medianBlur((color_distance(edited,reference)>20).astype(np.uint8),3)>0
    # The open eye squashes towards the lid line while it closes; its soft edge
    # and lower rim must stay under the patch, so the patch covers the eye's
    # whole footprint grown by two pixels.
    faint=_alpha_union(layers,['eyewhite-'+side,'irides-'+side,'eyelash-'+side],4)
    footprint=cv2.dilate((eye|faint).astype(np.uint8),np.ones((5,5),np.uint8))>0
    # Strands the edit painted where the source shows skin are not part of the
    # closed lid: changed pixels far from both the skin and the eye's own
    # colors are left out.
    surround=near&changed
    if skin is not None:
        eye_colors=reference[eye].astype(np.float32)
        lid=color_distance(edited,skin['median'])<=1.5*skin['tolerance']
        dark=np.mean(edited.astype(np.float32),axis=2)<np.percentile(np.mean(eye_colors,axis=1),50)+10
        surround&=lid|dark
    region=(footprint|surround)
    region=cv2.morphologyEx(region.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))>0
    brow=_alpha_union(layers,['eyebrow-'+side],24)
    if brow is not None:
        region&=~(cv2.dilate(brow.astype(np.uint8),np.ones((3,3),np.uint8))>0)
    return region&(support|footprint)


def restore_visible_coat_opening(layers, reference, mask, analysis):
    """Clip hallucinated coat lining only where visible trouser evidence agrees with the source.

    No hidden surface is generated. Competing semantic colors must support the
    decision; correct skirts and dresses already agree with the source.
    """
    assessment=json.loads(Path(analysis).read_text()).get('assessment',{})
    garments=assessment.get('garments',[])
    confirmed_coat=any(r.get('kind')=='coat' and r.get('confidence',0)>=.8 for r in garments)
    # The shared pipeline has a longGarment flag rather than the old route's
    # garment list. Leave ordinary short clothing and explicitly identified
    # skirts alone. Source agreement still decides every removed pixel.
    if not confirmed_coat and (not assessment.get('longGarment') or garments):
        return []
    repairs=[]
    for upper_name in ['topwear','bottomwear']:
        if upper_name not in layers or 'legwear' not in layers:
            continue
        upper,lower=layers[upper_name],layers['legwear']
        upper_error=np.mean(np.abs(upper[:,:,:3].astype(float)-reference),axis=2)
        lower_error=np.mean(np.abs(lower[:,:,:3].astype(float)-reference),axis=2)
        overlap=(upper[:,:,3]>128)&(lower[:,:,3]>128)&(mask>128)
        seed=overlap&(lower_error+12<upper_error)&(lower_error<35)
        candidate=overlap&(lower_error+3<upper_error)&(lower_error<55)
        candidate=cv2.morphologyEx(candidate.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        count,labels,stats,_=cv2.connectedComponentsWithStats(candidate)
        selected=np.zeros(mask.shape,np.uint8)
        for i in range(1,count):
            region=labels==i
            if stats[i,cv2.CC_STAT_AREA]>=64 and np.count_nonzero(seed&region)>=16:
                selected[region]=255
        # Fill only tiny gaps in the supported region, then soften its boundary.
        selected=cv2.morphologyEx(selected,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
        soft=cv2.GaussianBlur(selected,(5,5),.8).astype(float)/255
        soft*=overlap
        upper[:,:,3]=np.rint(upper[:,:,3]*(1-soft)).astype(np.uint8)
        repairs.append({'layer':upper_name,'referenceVisibleLayer':'legwear',
            'removedOpaquePixels':int(np.count_nonzero(soft>.5)),
            'method':'Source-color-supported coat opening; no inferred joints or generated pixels'})
    return repairs


ORDER={'prop':-5,'back hair':0,'wings':1,'legwear':10,'footwear':12,'arm':20,'hand':22,'handwear':20,
       'bottomwear':30,'topwear':40,'neck':45,'ears':48,'earwear':49,'face':50,'nose':55,
       'eyewhite':60,'irides':65,'eyelash':70,'eye_close':72,'eyebrow':75,
       'mouth_close':82,'mouth_open':83,'eyewear':85,'front hair':90,'headwear':95}
HAIR_LAYER=re.compile(r'^(front hair|back hair|side hair|hair)(#.*)?$')
# Lowest model confidence a landmark may have to be accepted on decomposition evidence.
VERIFY_FLOOR=.3
FEATURE_PREFIXES=('eyewhite','irides','eyelash','eyebrow','eye_close','nose','mouth')


def depth(name):
    return ORDER.get(name,ORDER.get(name.rsplit('-',1)[0],46))


HEAD_LAYER=re.compile(r'^(front hair|back hair|side hair|hair|headwear|eyewear|earwear(?:-[lr])?|face|neck|nose|ears?(?:-[lr])?|eyebrow-[lr]|irides-[lr]|eyewhite-[lr]|eyelash-[lr]|eye_close-[lr]|mouth(?:_open|_close)?|lip_upper|lip_lower|tooth-[tb]|tongue)$')


HIDDEN_AT_REST=('eye_close-l','eye_close-r','mouth_open')

LIMB_PREFIXES=('arm','hand','footwear')

def local_mean(rgb, support, size=9):
    """Mean color of the supported pixels in a size x size window."""
    weight=cv2.boxFilter(support.astype(np.float32),-1,(size,size),normalize=False)
    total=cv2.boxFilter(rgb*support[:,:,None],-1,(size,size),normalize=False)
    return total/np.maximum(weight,1e-6)[:,:,None],weight

def recover_uncovered_source(layers, reference, mask, points=None):
    """Give visible source regions that no semantic layer covers to their neighbour.

    Decomposition can omit whole garments, e.g. wide trousers, which then vanish
    from the rig. Only source pixels are used. A region joins the adjacent layer
    whose artwork continues across the shared boundary without a color edge.
    Arm, hand and shoe layers only absorb regions small relative to themselves,
    so a trouser leg under a resting hand is not carried by the arm; a region
    rejected that way which reaches an ankle becomes leg clothing. Props and regions without
    such a neighbour (furniture, ground shadows) are left unchanged.
    """
    h,w=mask.shape
    owners=sorted((n for n in layers if n!='objects' and not n.startswith(FEATURE_PREFIXES)),key=depth)
    if not owners:
        return []
    cover=np.maximum.reduce([layer[:,:,3] for layer in layers.values()])
    # One omitted part is one region with one owner, even where a layer's faint
    # edge (a crop line, a soft hair tip) crosses it: split there, its two halves
    # would go to different layers and crack apart along that line in motion.
    count,labels,stats,_=cv2.connectedComponentsWithStats(((mask>128)&(cover<128)).astype(np.uint8))
    open_=cover<8
    for i in range(1,count):
        x,y,bw,bh=stats[i,:4]
        stats[i,cv2.CC_STAT_AREA]=int(np.count_nonzero((labels[y:y+bh,x:x+bw]==i)&open_[y:y+bh,x:x+bw]))
    minimum=max(64,int(1.5e-4*h*w))
    rgb=reference.astype(np.float32)
    areas={n:max(1,int(np.count_nonzero(l[:,:,3]>128))) for n,l in layers.items()}
    # The head turns about the neck: a head layer may only take a region that
    # lies within the head (down to half a face below the chin). A raised arm or a sleeve the decomposition
    # omitted must never move with the head.
    in_head=np.ones((h,w),bool)
    face=layers.get('face')
    if face is not None and (face[:,:,3]>128).any():
        fy,fx=np.nonzero(face[:,:,3]>128);fw=fx.max()-fx.min()+1;fh=fy.max()-fy.min()+1
        chin=points['chin'][1] if points and 'chin' in points else fy.max()
        yy_,xx_=np.mgrid[:h,:w]
        # The zone follows the head's own silhouette above the chin (hair,
        # headwear, ears) and reaches two face widths beyond the face: a feather
        # or horn sweeping out of a headdress stays with the head, however narrow
        # the face is, while a raised arm still reaches far below the chin.
        head=np.zeros((h,w),bool)
        for name,layer in layers.items():
            if HEAD_LAYER.match(name) and name!='neck' and not name.startswith(FEATURE_PREFIXES):
                head|=layer[:,:,3]>128
        hx=np.nonzero((head&(yy_<=chin)).any(axis=0))[0]
        left,right=fx.min()-2*fw,fx.max()+2*fw
        if len(hx):
            left,right=min(left,hx.min()-.25*fw),max(right,hx.max()+.25*fw)
        in_head=(xx_>=left)&(xx_<=right)&(yy_<=chin+.5*fh)
    head_ok=lambda name,x0,y0,x1,y1,region:not HEAD_LAYER.match(name) or float(np.mean(in_head[y0:y1,x0:x1][region]))>=.7
    # A part lying mostly above the chin (an ear the decomposition omitted)
    # belongs to the head, not to the neck.
    chin_y=points['chin'][1] if points and 'chin' in points else (np.nonzero((face[:,:,3]>128).any(axis=1))[0].max() if face is not None and (face[:,:,3]>128).any() else None)
    neck_ok=lambda name,y0,region:name!='neck' or chin_y is None or float(np.mean((np.nonzero(region)[0]+y0)>chin_y))>=.5
    repairs=[]
    for i in range(1,count):
        if stats[i,cv2.CC_STAT_AREA]<4:
            continue
        x,y,bw,bh=stats[i,:4];pad=16
        x0,y0,x1,y1=max(0,x-pad),max(0,y-pad),min(w,x+bw+pad),min(h,y+bh+pad)
        part=labels[y0:y1,x0:x1]==i;region=part&open_[y0:y1,x0:x1]
        ring=(cv2.dilate(part.astype(np.uint8),np.ones((7,7),np.uint8))>0)&~part&(mask[y0:y1,x0:x1]>128)
        # The visible owner of each boundary pixel is the topmost covering layer.
        visible=np.full(region.shape,-1)
        for k,name in enumerate(owners):
            visible[layers[name][y0:y1,x0:x1,3]>128]=k
        inner,_=local_mean(rgb[y0:y1,x0:x1],region.astype(np.float32))
        scores=[]
        for k,name in enumerate(owners):
            contact=ring&(visible==k)
            if np.count_nonzero(contact)<24:
                continue
            outer,_=local_mean(rgb[y0:y1,x0:x1],(visible==k).astype(np.float32))
            continuous=contact&(np.mean(np.abs(outer-inner),axis=2)<20)
            scores.append((int(np.count_nonzero(continuous)),int(np.count_nonzero(contact)),name))
        area=int(np.count_nonzero(region))
        # A neighbour absorbs only what it can plausibly carry: limbs a small
        # part of themselves; other layers can continue a garment the
        # decomposition cut short, but not grow many times their own size.
        valid=[c for c in scores if c[0]>=24 and c[0]>=.3*c[1] and area>=minimum
               and area<=(.25 if c[2].startswith(LIMB_PREFIXES) else 8)*areas[c[2]] and head_ok(c[2],x0,y0,x1,y1,region)]
        rule='boundary continuity'
        ankles=[np.array(points[k]) for k in ['ankleL','ankleR'] if points and k in points]
        yy,xx=np.nonzero(region)
        reach=.03*np.hypot(h,w)
        if valid:
            score,contact,name=max(valid)
            if not neck_ok(name,y0,region) and 'face' in layers:
                # The neck does not turn with the head: skin above the chin (an
                # omitted ear) continues the face instead.
                name='face';rule='boundary continuity, above the chin: head skin'
        elif area>=minimum and ankles and min(np.min(np.hypot(xx+x0-a[0],yy+y0-a[1])) for a in ankles)<=reach:
            name='legwear';score,contact=0,0;rule='ankle-bearing region without a valid neighbour'
            layers.setdefault(name,np.zeros((h,w,4),np.uint8))
        elif area<48:
            # Slivers along the silhouette are the source's anti-aliased edge
            # blended with the backdrop; copying them adds a light fringe.
            continue
        else:
            # A visible part the decomposition omitted (ear, antenna, horn tip,
            # feather, tail, stool, prop). It is kept, owned by the part it is
            # attached to: the head when it touches mostly head layers, a limb
            # when it is small against it, the props layer, or otherwise a
            # static part drawn behind its neighbours.
            contacts={}
            for k,candidate in enumerate(owners):
                n_contact=int(np.count_nonzero(ring&(visible==k)))
                if n_contact:
                    contacts[candidate]=n_contact
            if 'objects' in layers:
                n_contact=int(np.count_nonzero(ring&(layers['objects'][y0:y1,x0:x1,3]>128)))
                if n_contact:
                    contacts['objects']=n_contact
            total=sum(contacts.values())
            head={n:c for n,c in contacts.items() if HEAD_LAYER.match(n) and n!='neck' and not n.startswith(FEATURE_PREFIXES)}
            if not head_ok('face',x0,y0,x1,y1,region):
                head={}
            # Among the head layers it touches, the part continues the one whose
            # artwork at the contact has its color: an ear continues the face, a
            # curl the hair. A touching head layer of the same color claims it
            # even when the body surrounds it more.
            inner_color=np.median(rgb[y0:y1,x0:x1][region],axis=0)
            def continuity(n):
                k=owners.index(n);contact=ring&(visible==k)
                return float(color_distance(np.median(rgb[y0:y1,x0:x1][contact],axis=0),inner_color))
            similar={n:continuity(n) for n,c in head.items() if c>=12}
            limbs={n:c for n,c in contacts.items() if n.startswith(LIMB_PREFIXES+('legwear',)) and area<=.25*areas[n] and c>=.3*total}
            if head and (sum(head.values())>=max(12,.5*total) or (similar and min(similar.values())<30)):
                name=min(similar,key=similar.get) if similar else max(head,key=head.get);rule='omitted part attached to the head'
            elif limbs:
                name=max(limbs,key=limbs.get);rule='omitted part carried by the limb it touches'
            else:
                best=max(contacts,key=contacts.get) if contacts else None
                if best=='objects':
                    name='objects';rule='omitted part of a prop'
                else:
                    name='prop';rule='omitted part kept as a static part behind its neighbours'
                    layers.setdefault(name,np.zeros((h,w,4),np.uint8));areas.setdefault(name,1)
            score,contact=0,int(total)
        # Include the soft silhouette edge that belongs to the same region.
        fill=(cv2.dilate(region.astype(np.uint8),np.ones((5,5),np.uint8))>0)&((cover[y0:y1,x0:x1]<8)|part)&(mask[y0:y1,x0:x1]>8)
        owner=layers[name][y0:y1,x0:x1]
        owner[fill,:3]=reference[y0:y1,x0:x1][fill]
        owner[fill,3]=np.maximum(owner[fill,3],mask[y0:y1,x0:x1][fill])
        repairs.append({'layer':name,'addedPixels':int(np.count_nonzero(fill)),'bbox':[int(x0),int(y0),int(x1),int(y1)],
            'continuousBoundaryPixels':score,'contactPixels':contact,'rule':rule,'generatedPixels':False,
            'method':'Uncovered source region joined to the layer that continues across its boundary'})
    return repairs

def motion_group(name):
    """The rig part that moves a layer: the head, one limb, props or the body."""
    if HEAD_LAYER.match(name):
        return 'head'
    limb=re.match(r'^(arm|hand|handwear|legwear|footwear)(?:-([lr]))?$',name)
    if limb:
        return ('arm' if limb.group(1) in ('arm','hand','handwear') else 'leg')+'-'+(limb.group(2) or 'both')
    return 'objects' if name=='objects' else 'body'

def source_draw_order(layers, reference, mask):
    """Semantic draw order, corrected where the source shows the opposite occlusion.

    Only layers the rig moves independently (head, each limb, props, body) are
    reordered: hiding either one's pixels would open holes once they move apart,
    while the lower layer keeps its completed hidden texture. A lower layer is
    raised directly above an upper one when, in their visible overlap, the source
    clearly shows it in front on at least twice as many pixels as the reverse.
    No pixel is changed.
    """
    order=sorted(layers,key=depth)
    visible=[n for n in order if n not in HIDDEN_AT_REST]
    ref=reference.astype(np.float32);boxes={}
    for name in visible:
        ys,xs=np.nonzero(layers[name][:,:,3]>128)
        if len(xs):
            boxes[name]=(int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1)
    evidence=[]
    for i,lower in enumerate(visible):
        for j,upper in enumerate(visible[i+1:],i+1):
            if lower not in boxes or upper not in boxes or motion_group(lower)==motion_group(upper):
                continue
            # The face and neck continue as hidden completion under collars and
            # hair; their overlaps say nothing about which part is in front.
            if lower in ('face','neck') or upper in ('face','neck'):
                continue
            a,b=boxes[lower],boxes[upper]
            x0,y0,x1,y1=max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])
            if x0>=x1 or y0>=y1:
                continue
            bottom,top=layers[lower][y0:y1,x0:x1],layers[upper][y0:y1,x0:x1]
            both=(bottom[:,:,3]>128)&(top[:,:,3]>128)&(mask[y0:y1,x0:x1]>128)
            # Pixels covered by a third layer above both say nothing about this pair.
            for other in visible[j+1:]:
                both&=layers[other][y0:y1,x0:x1,3]<128
            if np.count_nonzero(both)<64:
                continue
            source=ref[y0:y1,x0:x1]
            bottom_error=np.mean(np.abs(bottom[:,:,:3]-source),axis=2);top_error=np.mean(np.abs(top[:,:,:3]-source),axis=2)
            lower_front=int(np.count_nonzero(both&(bottom_error+12<top_error)&(bottom_error<35)))
            upper_front=int(np.count_nonzero(both&(top_error+12<bottom_error)&(top_error<35)))
            # Clear evidence in either direction is a constraint: the semantic
            # order it confirms must survive other raises, too.
            # Raising against the semantic order needs evidence on a visible share
            # of the smaller layer, not a few boundary pixels.
            smaller=min(np.count_nonzero(layers[lower][:,:,3]>128),np.count_nonzero(layers[upper][:,:,3]>128))
            # An arm is never raised above the body or a prop as a whole: its
            # hidden upper part (the completion under a sleeve or an obi) would
            # then be drawn over them when it moves. Arm artwork the source shows
            # in front of them becomes a front hand layer instead (split_front_limb).
            arm_over_body=motion_group(lower).startswith('arm-') and motion_group(upper) in ('body','objects')
            if lower_front>=max(64,.02*smaller) and lower_front>=2*upper_front and not arm_over_body:
                evidence.append((lower_front-upper_front,lower,upper,lower_front,upper_front))
            elif upper_front>=64 and upper_front>=2*lower_front:
                evidence.append((upper_front-lower_front,upper,lower,upper_front,lower_front))
    # Accept the strongest constraints that do not contradict stronger ones, then
    # order the layers topologically, as close to the semantic order as possible.
    above={n:set() for n in order}
    def reaches(start,goal):
        stack,seen=[start],set()
        while stack:
            n=stack.pop()
            if n==goal:
                return True
            if n not in seen:
                seen.add(n);stack.extend(above[n])
        return False
    accepted=[]
    for item in sorted(evidence,reverse=True):
        _,front,back,_,_=item
        if not reaches(back,front):
            above[front].add(back);accepted.append(item)
    rank={n:i for i,n in enumerate(order)};placed=[];remaining=set(order)
    while remaining:
        ready=[n for n in remaining if not (above[n]&remaining)]
        n=min(ready,key=rank.get);placed.append(n);remaining.remove(n)
    records=[{'raised':front,'above':back,'sourceFrontPixels':f,'reversePixels':r}
             for _,front,back,f,r in accepted if rank[front]<rank[back]]
    return placed,records

def remove_new_hair_specks(before, after, source_support):
    """Discard tiny islands created by clipping a previously connected hair part.

    Disconnected wisps already present in the decomposition keep their pixels.
    A newly separated fragment below two percent of its original connected
    component is eligible only when the lower composite explains the source
    better on most of its pixels. Real strands emerging from behind an occluder
    therefore remain when their own artwork agrees with the source.
    """
    _,old,old_stats,_=cv2.connectedComponentsWithStats((before>8).astype(np.uint8))
    count,new,stats,_=cv2.connectedComponentsWithStats((after>8).astype(np.uint8))
    parent={}
    for i in range(1,count):
        ids=old[new==i];ids=ids[ids>0]
        if len(ids):
            parent[i]=int(np.bincount(ids).argmax())
    result=after.copy()
    for i,p in parent.items():
        siblings=[j for j,q in parent.items() if q==p]
        if len(siblings)<2 or stats[i,cv2.CC_STAT_AREA]>=.02*old_stats[p,cv2.CC_STAT_AREA]:
            continue
        if i==max(siblings,key=lambda j:stats[j,cv2.CC_STAT_AREA]):
            continue
        if np.mean(source_support[new==i])<=.5:
            continue
        region=cv2.dilate((new==i).astype(np.uint8),np.ones((3,3),np.uint8))>0
        result[region&((new==i)|(after<=8))]=0
    return result

def reveal_source_occlusion(layers, reference, mask, order):
    """Clip drawn pixels that the source image shows are hidden behind lower layers.

    Within one moving part the semantic order can still put a layer above artwork
    that the source shows in front, e.g. hood pixels behind the face or an
    invented tail over a skirt. Layers are visited from the bottom of order, each
    against the composite of the layers below it after their own repair, so a
    wrong face under a wrong hood cannot shield either one. A pixel is removed
    only when that composite explains the source and the layer contradicts it,
    so artwork that really covers another layer stays in front. The face layer is
    the head's skin base and is never clipped; its tone is corrected beforehand.
    Layers hidden at rest and facial feature layers belong to the expression
    pipeline and are not clipped.
    """
    names=[n for n in order if n not in HIDDEN_AT_REST]
    h,w=mask.shape;ref=reference.astype(np.float32)
    skin=skin_model(reference,layers,mask,np.ones(mask.shape,bool))
    face=layers.get('face')
    skin_evidence=(color_distance(reference,skin['median'])<skin['tolerance']) if skin is not None else np.zeros(mask.shape,bool)
    # Each layer is judged only against lower layers of its own moving part: a
    # layer cut where another part shows would open a hole once that part moves.
    composites={}
    records=[]
    for name in names:
        # Props are not bound to any limb: they stay with the body.
        group=motion_group(name).replace('objects','body')
        if group not in composites:
            composites[group]=(np.zeros((h,w,3),np.float32),np.zeros((h,w),np.float32))
        below_color,below_alpha=composites[group]
        layer=layers[name]
        ys,xs=np.nonzero(layer[:,:,3]>8)
        if len(xs) and name!='face' and not name.startswith(FEATURE_PREFIXES):
            x0,y0,x1,y1=int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1
            part=layer[y0:y1,x0:x1];a=part[:,:,3].astype(np.float32)/255
            coverage=below_alpha[y0:y1,x0:x1]
            hidden=below_color[y0:y1,x0:x1]/np.maximum(coverage,1e-6)[:,:,None]
            drawn=part[:,:,:3]*a[:,:,None]+hidden*(1-a[:,:,None])
            source=ref[y0:y1,x0:x1]
            # Local means: fine hair or fabric texture must not decide single pixels.
            drawn_error=cv2.blur(np.mean(np.abs(drawn-source),axis=2),(9,9));hidden_error=cv2.blur(np.mean(np.abs(hidden-source),axis=2),(9,9))
            overlap=(part[:,:,3]>8)&(coverage>.9)&(mask[y0:y1,x0:x1]>128)
            if HAIR_LAYER.match(name) and face is not None and names.index('face')<names.index(name):
                # A face completion can contain a copy of a real hair lock.
                # Its matching color is not evidence that the lock is hidden:
                # require visible skin evidence before cutting hair over a face.
                overlap&=(face[y0:y1,x0:x1,3]<=128)|skin_evidence[y0:y1,x0:x1]
            seed=overlap&(hidden_error+12<drawn_error)&(hidden_error<35)
            candidate=overlap&(hidden_error+3<drawn_error)&(hidden_error<55)
            candidate=cv2.morphologyEx(candidate.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
            count,labels,stats,_=cv2.connectedComponentsWithStats(candidate)
            selected=np.zeros(overlap.shape,np.uint8)
            own=part[:,:,3]>128
            for i in range(1,count):
                region=labels==i
                if stats[i,cv2.CC_STAT_AREA]>=64 and np.count_nonzero(seed&region)>=16:
                    # A region the layer's own artwork surrounds is not occlusion
                    # but its own surface painted differently: cutting it would
                    # open a hole that shows once the two layers move apart. It is
                    # kept and takes the source colors at rest instead.
                    ring=(cv2.dilate(region.astype(np.uint8),np.ones((7,7),np.uint8))>0)&~region
                    if ring.any() and np.mean(own[ring])>=.9 and float(color_distance(
                            np.median(source[region],axis=0),np.median(part[:,:,:3][ring].astype(np.float32),axis=0)))<35:
                        continue
                    selected[region]=255
            if selected.any():
                alpha_before=part[:,:,3].copy()
                selected=cv2.morphologyEx(selected,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
                soft=cv2.GaussianBlur(selected,(5,5),.8).astype(float)/255
                soft*=overlap
                part[:,:,3]=np.rint(part[:,:,3]*(1-soft)).astype(np.uint8)
                # The soft cut leaves a faint outline of the removed area; away
                # from the layer's remaining solid artwork it is residue (ring
                # outlines of removed headwear over a face) and is cleared.
                solid=((part[:,:,3]>200)&(soft<.02)).astype(np.uint8)
                far=cv2.distanceTransform(1-solid,cv2.DIST_L2,3)>3 if solid.any() else np.ones(soft.shape,bool)
                part[:,:,3]=np.where((soft>.02)&far,0,part[:,:,3]).astype(np.uint8)
                if HAIR_LAYER.match(name):
                    # Use unblurred evidence here: a tiny real strand can lose
                    # its own color in the neighborhood means used for regions.
                    lower_error=np.mean(np.abs(hidden-source),axis=2)
                    own_error=np.mean(np.abs(part[:,:,:3].astype(np.float32)-source),axis=2)
                    support=(coverage>.9)&(lower_error<35)&(lower_error+12<own_error)
                    part[:,:,3]=remove_new_hair_specks(alpha_before,part[:,:,3],support)
                records.append({'layer':name,'removedOpaquePixels':int(np.count_nonzero(soft>.5)),
                    'method':'Source-color-supported occlusion by repaired lower layers; no generated pixels'})
        a=layer[:,:,3].astype(np.float32)/255
        composites[group]=(layer[:,:,:3]*a[:,:,None]+below_color*(1-a[:,:,None]),a+below_alpha*(1-a))
    return records


REST_EDGE=3
REST_COLOR_DIFFERENCE=24


def restore_rest_color(layers, reference, mask, order):
    """At rest the rig shows the source drawing.

    Where the topmost layer at a pixel is opaque, its colour is what the rest pose
    shows; if it clearly differs from the source (See-through redrew it: a lost
    beard, tattoo or print), the source colour is written into that layer. Under a
    partly transparent topmost layer, the opaque layer just below is solved so that
    the blend shows the source. Deeper layers never change, and the band within
    REST_EDGE pixels of the silhouette is left alone (blended edge pixels would
    add a fringe). Layers hidden at rest are skipped. Alpha never changes.
    """
    h, w = mask.shape
    inside = cv2.distanceTransform((mask > 128).astype(np.uint8), cv2.DIST_L2, 3) > REST_EDGE
    covered = np.zeros((h, w), bool)
    changed = {}
    for name in reversed([n for n in order if n not in HIDDEN_AT_REST]):
        layer = layers[name]
        alpha = layer[:, :, 3]
        top = ~covered & (alpha > 8)
        target = top & (alpha > 200) & inside
        diff = np.max(np.abs(layer[:, :, :3].astype(np.int16) - reference.astype(np.int16)), axis=2)
        fix = target & (diff > REST_COLOR_DIFFERENCE)
        if fix.any():
            layer[:, :, :3][fix] = reference[fix]
            changed[name] = int(fix.sum())
        covered |= alpha > 8
    # Under a partly transparent layer (the soft edge of a brow, a nose line, a hair
    # tip) the rest pose shows a blend with the opaque layer below it. That layer's
    # colour is solved so the blend shows the source: a See-through face drawn
    # lighter than the drawing would otherwise outline every feature with a halo.
    names = [n for n in order if n not in HIDDEN_AT_REST]
    alphas = {n: layers[n][:, :, 3].astype(np.float32) / 255 for n in names}
    top_idx = np.full((h, w), -1, np.int32); below_idx = np.full((h, w), -1, np.int32)
    for k, name in enumerate(names):  # bottom to top: the last writer is the topmost
        covering = alphas[name] > 8 / 255
        below_idx = np.where(covering, top_idx, below_idx); top_idx = np.where(covering, k, top_idx)
    top_idx[mask <= 128] = -1
    blended = 0
    for k, name in enumerate(names):
        at = (top_idx == k) & (alphas[name] <= 200 / 255) & inside
        if not at.any():
            continue
        a = alphas[name][at][:, None]
        for j, lower in enumerate(names):
            sel = below_idx[at] == j
            if not sel.any() or j == k:
                continue
            ys, xs = np.nonzero(at); ys, xs = ys[sel], xs[sel]
            below = layers[lower]
            ok = below[ys, xs, 3] > 200
            ys, xs = ys[ok], xs[ok]
            if not len(ys):
                continue
            aa = alphas[name][ys, xs][:, None]
            solved = (reference[ys, xs].astype(np.float32) - layers[name][ys, xs, :3].astype(np.float32) * aa) / np.maximum(1 - aa, .15)
            current = below[ys, xs, :3].astype(np.float32)
            fix = np.max(np.abs(solved - current), axis=1) > REST_COLOR_DIFFERENCE
            below[ys[fix], xs[fix], :3] = np.clip(np.rint(solved[fix]), 0, 255).astype(np.uint8)
            blended += int(fix.sum())
    return {'changedPixels': changed, 'blendSolvedPixels': blended, 'edgeBand': REST_EDGE, 'colorDifference': REST_COLOR_DIFFERENCE,
            'method': 'Source colour written into the topmost opaque layer at rest, and under partly transparent layers solved so the blend shows the source; silhouette band unchanged'}


def prepare(source, psd, analysis, edits, out, improvements=True, garment_mode=False):
    started=time.monotonic(); size,layers=read_layers(psd)
    reference=np.array(square(Image.open(source).convert('RGB'),size))
    mask=np.array(square(Image.open(out/'input-mask.png').convert('L'),size))
    points=anatomical_points(analysis,size)
    face_repair=recover_face_support(layers,reference,mask,points)
    layout=feature_layout(layers,size)
    if garment_mode:
        Image.fromarray(np.dstack([reference,mask])).save(out/'source-preservation.png')
    changes=[]
    distant=cv2.dilate(mask,np.ones((31,31),np.uint8))<8
    # Remove detached specks, but retain tiny intentional features (nose, lashes).
    for name,layer in layers.items():
        before=int(np.count_nonzero(layer[:,:,3]))
        layer[:,:,3]=retain_components(layer[:,:,3],3 if any(s in name for s in ['nose','eye','mouth']) else 12)
        # Broad outside-mask removal would erase occluded anatomy. Only very large
        # layers dominated by distant background are clipped.
        area=layer[:,:,3]>8
        if area.mean()>.35 and np.mean(distant[area])>.55:
            layer[:,:,3]=np.where(distant,0,layer[:,:,3])
        changes.append({'layer':name,'removedPixels':before-int(np.count_nonzero(layer[:,:,3]))})
    points=anatomical_points(analysis,size)
    capabilities=json.loads(Path(analysis).read_text()).get('capabilities')
    facial_hair=bool(json.loads(Path(analysis).read_text()).get('assessment',{}).get('facialHair'))
    capabilities = capabilities if isinstance(capabilities,dict) and capabilities.get('version') == 1 else None
    recovered_feet=recover_visible_feet(layers,reference,mask,points) if not garment_mode else []
    garment_repairs=restore_visible_coat_opening(layers,reference,mask,analysis)
    uncovered_source=recover_uncovered_source(layers,reference,mask,points)
    splits=([{'operation':'preserve merged garment and occluded limb layers; no guessed anatomical split'}]
            if garment_mode else split_limbs(layers,points,partial=bool(capabilities)))
    plan=json.loads((edits/'edit-plan.json').read_text())
    if plan['sourceSha256'] != sha(source) or plan['psdSha256'] != sha(psd):
        raise ValueError('Edit plan does not belong to these inputs')
    registrations=[];patches=[]
    expression_failures=[]
    for kind in plan['expressionKinds']:
        affected=['mouth','mouth_open','mouth_close'] if kind=='mouth' else ['eye_close-l','eye_close-r']
        prior={name:layers[name].copy() for name in affected if name in layers}
        try:
            if (edits/f'expression_{kind}.failure.json').exists():
                raise ValueError('Expression provider failed; see expression failure record')
            edited=map_edit(edits/f'expression_{kind}.png',plan,Image.fromarray(reference))
            boxes=list(layout['eyes'].values()) if kind=='eyes' else [layout['mouth']]
            excluded=[expand(b,12,18,size) for b in boxes]
            if improvements:
                edited,registration=register_edit(reference,edited,excluded,layout['face'])
                registrations.append({'kind':kind,**registration})
            if kind=='eyes':
                support=face_support(layers,mask)
                mouth_area=mouth_close_region(layers,reference,mask,None,True)
                for side,b in layout['eyes'].items():
                    name='eye_close-'+side
                    eye_ring=np.zeros(mask.shape,bool);eb=expand(b,(b[2]-b[0])*.6,(b[3]-b[1])*1.2,size);eye_ring[eb[1]:eb[3],eb[0]:eb[2]]=True
                    eye_area=_alpha_union(layers,[f'eyewhite-{side}',f'irides-{side}',f'eyelash-{side}',f'eyebrow-{side}'],16)
                    region=eye_close_region(layers,reference,edited,side,support,skin_model(reference,layers,mask,eye_ring&~(cv2.dilate(eye_area.astype(np.uint8),np.ones((5,5),np.uint8))>0)))
                    if region is None:
                        raise ValueError('No eye layer to shape the closed eye')
                    if mouth_area is not None:
                        # Eye and mouth patches never overlap.
                        region&=~(cv2.dilate(mouth_area.astype(np.uint8),np.ones((5,5),np.uint8))>0)
                    layers[name],record=shaped_patch(reference,edited,region,support|region,name,color_match=improvements)
                    patches.append(record)
            else:
                b=layout['mouth']; fw=layout['face'][2]-layout['face'][0]
                search=expand(b,max(10,fw*.12),max(16,fw*.17),size)
                x0,y0,x1,y1=search
                roi=edited[y0:y1,x0:x1]
                gray=cv2.cvtColor(roi,cv2.COLOR_RGB2GRAY)
                threshold=float(np.clip(np.percentile(gray,15)*.8,45,160))
                count,labels,stats,centers=cv2.connectedComponentsWithStats((gray<threshold).astype(np.uint8))
                target=np.array([(b[0]+b[2])/2-x0,(b[1]+b[3])/2-y0])
                ids=[i for i in range(1,count) if stats[i,cv2.CC_STAT_AREA]>=5]
                if not ids:
                    raise ValueError('No measurable mouth in expression edit')
                selected=min(ids,key=lambda i: np.linalg.norm(centers[i]-target)/max(1,stats[i,cv2.CC_STAT_AREA]**.25))
                x,y,w,h,area=map(int,stats[selected])
                if h<3 or w<5:
                    raise ValueError('Expression did not produce an open mouth')
                box=expand([x+x0,y+y0,x+x0+w,y+y0+h],3,3,size)
                cavity=np.zeros(mask.shape,bool);cavity[y0:y1,x0:x1]=labels==selected
                support=face_support(layers,mask)
                ring=np.zeros(mask.shape,bool);ring[search[1]:search[3],search[0]:search[2]]=True
                lips=_alpha_union(layers,['mouth'],32)
                lips=np.zeros(mask.shape,bool) if lips is None else lips
                skin=skin_model(reference,layers,mask,ring&~(cv2.dilate(lips.astype(np.uint8),np.ones((7,7),np.uint8))>0))
                closed=mouth_close_region(layers,reference,mask,skin,facial_hair)
                # Source pixels in the opening that neither the face nor the mouth
                # layer explains lie in front of the mouth (e.g. a mustache).
                opening=np.zeros(mask.shape,bool);opening[box[1]:box[3],box[0]:box[2]]=True;opening&=mask>128
                explained=np.zeros(mask.shape,bool)
                for name in ['face','mouth']:
                    if name in prior or name in layers:
                        source_layer=(prior.get(name) if name in prior else layers[name])
                        explained|=(source_layer[:,:,3]>128)&(np.mean(np.abs(source_layer[:,:,:3].astype(float)-reference),axis=2)<40)
                unexplained=float(np.mean(~explained[opening])) if opening.any() else 0.
                upper=_alpha_union(layers,[n for n in layers if n.startswith(('eyewhite','irides','eyelash','eyebrow','nose'))],32)
                upper=None if upper is None else (cv2.dilate(upper.astype(np.uint8),np.ones((5,5),np.uint8))>0)&~cavity
                front=front_facial_hair(reference,cavity,search,support,skin,fw,upper) if facial_hair else None
                if front is not None and closed is not None:
                    # A moustache the decomposition drew into the mouth layer is
                    # not lips: it stays on the face in every mouth state.
                    closed&=~front
                region,hair=mouth_open_region(reference,edited,cavity,search,support,skin,facial_hair,closed,upper,front)
                if facial_hair:
                    # Facial hair stays in front of the opening; the mouth opens
                    # only if a real opening remains visible below or around it.
                    shown=cavity&region;sy,sx=np.nonzero(shown)
                    if (np.count_nonzero(shown)<max(12,.3*np.count_nonzero(cavity))
                            or sy.max()-sy.min()+1<3 or sx.max()-sx.min()+1<5):
                        raise ValueError('Facial hair covers the edited opening; no open mouth remains visible below it')
                edited,lip_color=keep_lip_color(reference,edited,cavity,region,closed,skin)
                layers['mouth_open'],record=shaped_patch(reference,edited,region,support|cavity,'mouth_open',color_match=improvements)
                record.update(measuredCavityPixels=area,threshold=threshold,unexplainedOpeningSource=unexplained,lipColor=lip_color,frontFacialHairPixels=int(np.count_nonzero(front)) if front is not None else 0,
                              facialHairKeptPixels=int(np.count_nonzero(hair)) if hair is not None else 0,
                              skin=None if skin is None else {'median':skin['median'].tolist(),'tolerance':skin['tolerance']})
                patches.append(record)
                # The closed mouth keeps the exact source lips on their own shape:
                # skin, jaw contour and facial hair around them stay on the face.
                layers.pop('mouth',None)
                if closed is None or not closed.any():
                    raise ValueError('No source lips to keep as the closed mouth')
                layers['mouth_close'],closed_record=shaped_patch(reference,reference,closed,support,'mouth_close',color_match=False)
                patches.append(closed_record)
        except (ValueError,FileNotFoundError) as error:
            if not capabilities:
                raise
            for name in affected:
                layers.pop(name,None)
            layers.update(prior)
            expression_failures.append({'feature':kind,'reason':str(error),'action':'retain source expression; disable control'})
    if capabilities and 'mouth_open' not in layers and layout['mouth']:
        closed=mouth_close_region(layers,reference,mask,None,facial_hair)
        layers.pop('mouth',None)
        if closed is not None and closed.any():
            layers['mouth_close'],record=shaped_patch(reference,reference,closed,face_support(layers,mask)|closed,'mouth_close',color_match=False)
            patches.append(record)
    order,reordered=source_draw_order(layers,reference,mask)
    source_occlusion=reveal_source_occlusion(layers,reference,mask,order)
    rest_color=restore_rest_color(layers,reference,mask,order)
    result=PSDImage.new('RGBA',size)
    layer_dir=out/'layers';layer_dir.mkdir(exist_ok=True)
    for name in order:
        rgba=layers[name]
        im=Image.fromarray(rgba);bbox=im.getbbox()
        if not bbox:
            continue
        im.save(layer_dir/(name+'.png'))
        PixelLayer.frompil(im.crop(bbox),result,name=name,left=bbox[0],top=bbox[1])
    target=out/'character.psd';result.save(target)
    # Verify pixels and placement through a real PSD serialization round trip.
    _,readback=read_layers(target)
    if set(readback) != set(n for n,p in layers.items() if p[:,:,3].max()>8):
        raise ValueError('PSD layer inventory changed')
    for name,rgba in readback.items():
        expected=layers[name]
        if not np.array_equal(rgba[:,:,3],expected[:,:,3]) or not np.array_equal(rgba[:,:,:3][rgba[:,:,3]>0],expected[:,:,:3][rgba[:,:,3]>0]):
            raise ValueError('PSD round trip changed pixels: '+name)
    report={'implementation':'repository-owned semantic preparation v1','sourceSha256':sha(source),
            'decompositionSha256':sha(psd),'outputSha256':sha(target),'layerCount':len(readback),
            'cleanup':changes,'splits':splits,'registration':registrations,'patches':patches,
            'improvementsEnabled':improvements,'garmentMode':garment_mode,'garmentRepairs':garment_repairs,'uncoveredSource':uncovered_source,'sourceDrawOrder':reordered,'sourceOcclusion':source_occlusion,'restColor':rest_color,'localSeconds':time.monotonic()-started,
            'recoveredFeet':recovered_feet,'faceSupportRepair':face_repair,'expressionFailures':expression_failures,
            'psdRoundtrip':True,'reviewRequired':True,
            'limitations':(['No independent eye layers; preserve source eyes without claiming blink or gaze.'] if not layout['eyes'] else []) + ['Mouth artwork is a measured composite, not separately articulated teeth/tongue.',
                           'Generated anatomy, expressions and extreme poses require visual review.']}
    write_json(out/'preparation.json',report)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage',choices=['neutralize','check','landmarks','plan','prepare'])
    p.add_argument('--image',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--psd',type=Path);p.add_argument('--analysis',type=Path);p.add_argument('--edits',type=Path)
    p.add_argument('--no-improvements',action='store_true')
    p.add_argument('--garment-mode',action='store_true',help='Preserve merged clothing; do not split hidden limbs')
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    if a.stage=='neutralize':neutralize(a.image,a.out)
    elif a.stage=='check':source_check(a.image,a.analysis,a.out)
    elif a.stage=='landmarks':check_landmarks(a.image,a.psd,a.analysis,a.out,a.garment_mode)
    elif a.stage=='plan':plan_edits(a.image,a.psd,a.out,a.analysis)
    else:prepare(a.image,a.psd,a.analysis,a.edits or a.out,a.out,not a.no_improvements,a.garment_mode)


if __name__=='__main__':main()
