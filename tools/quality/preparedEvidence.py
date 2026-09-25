"""Neutral layer diagnostics; never changes PSD or layer files."""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'generate'))
from prepareCharacter import read_layers,square
from PIL import Image,ImageDraw
import numpy as np
source,psd,out=map(Path,sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
size,layers=read_layers(psd);reference=square(Image.open(source).convert('RGBA'),size)
# Preserve PSD insertion order; open mouth / closed eyes are alternate expression overlays.
neutral=Image.new('RGBA',size)
for name,rgba in layers.items():
 if name=='mouth_open' or name.startswith('eye_close'):continue
 neutral=Image.alpha_composite(neutral,Image.fromarray(rgba))
reference.thumbnail((1024,1024));reference.save(out/'reference.png')
neutral.thumbnail((1024,1024));neutral.save(out/'neutral.png')
a=np.asarray(neutral.convert('RGB'),dtype=float);b=np.asarray(reference.convert('RGB'),dtype=float);visible=np.asarray(neutral)[:,:,3]>128
residual=np.abs(a-b).mean(axis=2)
metrics={'visiblePixels':int(visible.sum()),'meanVisibleRGBResidual':float(residual[visible].mean()) if visible.any() else None,'automaticThreshold':None,'note':'Diagnostic only: estimated visibility, source background and texture completion affect residual. Threshold uncalibrated; never an automatic rejection.'}
(out/'metrics.json').write_text(json.dumps(metrics,indent=2))
names=[n for n in layers if n in ['neck','face','topwear','headwear','mouth_close','mouth_open','eye_close-l','eye_close-r']]
sheet=Image.new('RGB',(4*280,320*((len(names)+3)//4)),(210,210,210));d=ImageDraw.Draw(sheet)
for i,n in enumerate(names):
 im=Image.fromarray(layers[n]);box=im.getbbox()
 if box:im=im.crop(box)
 im.thumbnail((270,285));x=i%4*280;y=i//4*320;sheet.paste(im,(x,y+25),im);d.text((x+5,y+5),n,fill='black')
sheet.save(out/'parts.png')
