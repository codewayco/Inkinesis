"""Consistent head/body contact sheets from isolated native runtime poses."""
import json,re,sys
from pathlib import Path
from PIL import Image,ImageDraw
home=Path(sys.argv[1]);protocol=json.loads((home/'protocol.json').read_text());crop=json.loads((home/'crop.json').read_text())
for kind,cols in [('head',7),('body',4)]:
 poses=protocol[kind];sheet=Image.new('RGB',(cols*360,425*((len(poses)+cols-1)//cols)),(220,220,220));draw=ImageDraw.Draw(sheet)
 for i,p in enumerate(poses):
  label=p['label'];name=re.sub(r'\W+','_',label.replace('-','neg').replace('.','p'))+'.png';im=Image.open(home/'frames'/name).convert('RGBA')
  if kind=='head':
   cx,cy,w,h=[crop[k] for k in ['cx','cy','width','height']];im=im.crop((round(cx-w/2),round(cy-h/2),round(cx+w/2),round(cy+h/2)))
  im.thumbnail((360,400));cell=Image.new('RGB',(360,400),(32,33,36));cell.paste(im,((360-im.width)//2,(400-im.height)//2),im)
  x,y=i%cols*360,i//cols*425;sheet.paste(cell,(x,y+25));draw.text((x+5,y+5),label,fill='black')
 sheet.save(home/(kind+'.png'))
