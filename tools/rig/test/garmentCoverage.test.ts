import { describe, expect, it } from 'vitest';
import { missingBodyRegions } from '../garmentCoverage';
import { carryPoses, type PoseDump } from '../carryPsd2Live';
import { writeInp, readInp, inpParts } from '../inp';
import { readCombined, evaluateCombined } from '../../../player/src/combinedRuntime';
import { encodePNG } from '../../shared/encodePNG';

describe('source-visible omissions',()=>{
    it('retains a missing body component, excluding the head, covered artwork and tiny alpha holes',()=>{
        const source={width:64,height:64,rgba:new Uint8ClampedArray(64*64*4)},coverage=new Uint8ClampedArray(source.rgba.length);
        const block=(x:number,y:number,w:number,h:number,covered=false)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*64+xx)*4+3;source.rgba[i]=255;if(covered)coverage[i]=255;}};
        block(0,0,20,20);block(0,30,20,20);block(30,30,20,20,true);block(60,60,2,2);
        const result=missingBodyRegions(source,coverage,25);
        expect(result.components).toEqual([400]);
        expect(result.selected.reduce((a,b)=>a+b,0)).toBe(400);
        expect(result.selected[30*64]).toBe(1);expect(result.selected[0]).toBe(0);expect(result.selected[30*64+30]).toBe(0);
    });
    it('does not turn enclosed background or neutral shadows into recovered anatomy',()=>{
        const source={width:64,height:64,rgba:new Uint8ClampedArray(64*64*4)},coverage=new Uint8ClampedArray(source.rgba.length);
        for(let y=10;y<40;y++)for(let x=10;x<40;x++)source.rgba.set([210,210,210,255],(y*64+x)*4);
        const cautious=missingBodyRegions(source,coverage,0,256,[255,255,255]);
        expect(cautious.components).toEqual([]);expect(cautious.ambiguousComponents).toEqual([900]);
        // Genuine source alpha can describe neutral-colored artwork without this ambiguity.
        expect(missingBodyRegions(source,coverage,0).components).toEqual([900]);
    });
});

describe('native split hair transfer',()=>{
    it('keeps both drawable identities and transfers their distinct source roll motion',()=>{
        const mesh={verts:[-5,-5,5,-5,-5,5],uvs:[0,0,1,0,0,1],indices:[0,1,2],origin:[0,0]};
        const input=writeInp({meta:{canvas:{width:20,height:20},combined:{version:2}},nodes:{uuid:0,name:'root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'face_skin',type:'Part',enabled:true,zsort:0,mesh,textures:[0]}]},param:[]},[encodePNG(new Uint8ClampedArray(16).fill(255),2,2)]);
        const layers=['face','back hair#0:l','back hair#0:r','earwear#9:l'];
        const dump:PoseDump={canvas:{width:20,height:20},coordinateSystem:'canvas-y-down',drawables:layers.map((layer,i)=>({id:String(i),layer,rest:[5,5,15,5,5,15],uvs:mesh.uvs,indices:mesh.indices,textureFile:'atlas.png'})),parameters:[]};
        dump.parameters=[{id:'ParamAngleZ',name:'roll',min:-30,max:30,default:0,keypoints:[-30,0,30].map(value=>({value,positions:dump.drawables.map((d,i)=>({id:d.id,xy:d.rest!.map((v,k)=>v+(k%2?0:value/30*(i+1)))}))}))}];
        const result=carryPoses(input,dump,new Map([['atlas.png',encodePNG(new Uint8ClampedArray(16).fill(255),2,2)]]),{splitFaceLayers:true,sourceOrder:true});
        expect(inpParts(readInp(result.file).puppet).map(n=>n.name)).toEqual(layers);
        const asset=readCombined(result.file),rest=evaluateCombined(asset),roll=evaluateCombined(asset,{ParamAngleZ:[30]});
        for(let i=0;i<layers.length;i++)expect(roll[i].xy[0]-rest[i].xy[0]).toBeCloseTo(i+1,7);
    });
});
