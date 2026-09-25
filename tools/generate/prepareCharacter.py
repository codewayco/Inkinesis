#!/usr/bin/env python3
"""Repository-owned character preparation.

Geometry comes from the current semantic PSD and anatomical analysis. Edits are
registered to unchanged face pixels and restricted to measured feature supports.
"""
import argparse
import hashlib
import json
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
        choose=(xx-l[0])**2+(yy-l[1])**2 <= (xx-r[0])**2+(yy-r[1])**2
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


def patch(reference, edited, box, name, feather=3, color_match=True):
    x0,y0,x1,y1=box
    ref=reference[y0:y1,x0:x1].astype(np.float32)
    src=edited[y0:y1,x0:x1].astype(np.float32)
    # Match the stable skin collar only, not the newly generated expression.
    ring=np.zeros(src.shape[:2],bool); ring[:3]=True;ring[-3:]=True;ring[:,:3]=True;ring[:,-3:]=True
    bias=np.clip(np.median(ref[ring]-src[ring],axis=0),-24,24) if color_match else np.zeros(3)
    src=np.clip(src+bias,0,255)
    yy,xx=np.mgrid[:y1-y0,:x1-x0]
    distance=np.minimum.reduce([xx+1,yy+1,x1-x0-xx,y1-y0-yy])
    alpha=np.clip(distance/max(1,feather),0,1)
    result=np.zeros((*reference.shape[:2],4),np.uint8)
    result[y0:y1,x0:x1,:3]=np.rint(src).astype(np.uint8)
    result[y0:y1,x0:x1,3]=np.rint(alpha*255).astype(np.uint8)
    return result, {'layer':name,'box':box,'skinBias':bias.tolist()}


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
    capabilities = capabilities if isinstance(capabilities,dict) and capabilities.get('version') == 1 else None
    recovered_feet=recover_visible_feet(layers,reference,mask,points) if not garment_mode else []
    garment_repairs=restore_visible_coat_opening(layers,reference,mask,analysis)
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
                for side,b in layout['eyes'].items():
                    box=expand(b,8,8,size)
                    name='eye_close-'+side
                    layers[name],record=patch(reference,edited,box,name,color_match=improvements)
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
                layers['mouth_open'],record=patch(reference,edited,box,'mouth_open',2,color_match=improvements)
                record.update(measuredCavityPixels=area,threshold=threshold)
                patches.append(record)
                # Preserve the source lip mark on a rectangular support. Triangulating
                # a thin, displaced decomposition line would clip the original pixels
                # when the final builder restores the neutral reference texture.
                layers.pop('mouth',None)
                closed_box=expand(layout['mouth'],10,8,size)
                layers['mouth_close'],closed_record=patch(reference,reference,closed_box,'mouth_close',2)
                patches.append(closed_record)
        except (ValueError,FileNotFoundError) as error:
            if not capabilities:
                raise
            for name in affected:
                layers.pop(name,None)
            layers.update(prior)
            expression_failures.append({'feature':kind,'reason':str(error),'action':'retain source expression; disable control'})
    if capabilities and 'mouth_open' not in layers and layout['mouth']:
        layers.pop('mouth',None)
        layers['mouth_close'],record=patch(reference,reference,expand(layout['mouth'],10,8,size),'mouth_close',2)
        patches.append(record)
    order={'back hair':0,'legwear':10,'footwear':12,'arm':20,'hand':22,'handwear':20,
           'bottomwear':30,'topwear':40,'neck':45,'ears':48,'face':50,'nose':55,
           'eyewhite':60,'irides':65,'eyelash':70,'eyebrow':75,'eye_close':80,
           'mouth_close':82,'mouth_open':83,'front hair':90,'headwear':95}
    def depth(name):
        return order.get(name,order.get(name.rsplit('-',1)[0],46))
    result=PSDImage.new('RGBA',size)
    layer_dir=out/'layers';layer_dir.mkdir(exist_ok=True)
    for name,rgba in sorted(layers.items(),key=lambda p:depth(p[0])):
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
            'improvementsEnabled':improvements,'garmentMode':garment_mode,'garmentRepairs':garment_repairs,'localSeconds':time.monotonic()-started,
            'recoveredFeet':recovered_feet,'faceSupportRepair':face_repair,'expressionFailures':expression_failures,
            'psdRoundtrip':True,'reviewRequired':True,
            'limitations':(['No independent eye layers; preserve source eyes without claiming blink or gaze.'] if not layout['eyes'] else []) + ['Mouth artwork is a measured composite, not separately articulated teeth/tongue.',
                           'Generated anatomy, expressions and extreme poses require visual review.']}
    write_json(out/'preparation.json',report)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage',choices=['neutralize','plan','prepare'])
    p.add_argument('--image',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--psd',type=Path);p.add_argument('--analysis',type=Path);p.add_argument('--edits',type=Path)
    p.add_argument('--no-improvements',action='store_true')
    p.add_argument('--garment-mode',action='store_true',help='Preserve merged clothing; do not split hidden limbs')
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    if a.stage=='neutralize':neutralize(a.image,a.out)
    elif a.stage=='plan':plan_edits(a.image,a.psd,a.out,a.analysis)
    else:prepare(a.image,a.psd,a.analysis,a.edits or a.out,a.out,not a.no_improvements,a.garment_mode)


if __name__=='__main__':main()
