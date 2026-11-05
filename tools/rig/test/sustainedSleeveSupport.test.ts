import {it,expect} from 'vitest';
import {clothingAttachments} from '../clothingAttachments';
import {encodePNG} from '../../shared/encodePNG';
import {inpParts,type InpDocument} from '../inp';
function fixture(narrowStrap=false){
 const w=240,h=300,rgba=new Uint8ClampedArray(w*h*4);
 for(let y=30;y<160;y++)for(let x=80;x<210;x++)if(x>=120||(y>=50&&y<135&&x>= (narrowStrap?98:92)&&x<=110))rgba.set([160,80,20,255],(y*w+x)*4);
 const chain={root:{x:100,y:50},joint:{x:100,y:150},tip:{x:100,y:250},rootBlend:60,jointBlend:45};
 const puppet:InpDocument={meta:{canvas:{width:w,height:h},combined:{chains:[{name:'Arm R',chain,distalSign:1}]}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'topwear',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts:[-120,-150,120,-150,-120,150,120,150],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}}]},param:[{uuid:10,name:'Arm R',is_vec2:true,min:[-30,-60],max:[30,60],defaults:[0,0],merge_mode:'Passthrough',axis_points:[[0,.5,1],[0,.5,1]],bindings:[]}]};
 return {puppet,textures:[Buffer.from(encodePNG(rgba,w,h))]};
}
it('recovers a narrow long sleeve while retaining the separate torso unbound',()=>{
 const legacy=fixture();clothingAttachments(legacy.puppet,legacy.textures,{});expect(legacy.puppet.param[0].bindings).toHaveLength(0);
 const f=fixture();clothingAttachments(f.puppet,f.textures,{}, {sustainedSleeveSupport:true});const parts=inpParts(f.puppet),sleeve=parts.find(n=>n.name==='topwear__Arm_R')!,torso=parts.find(n=>n.name==='topwear__torso')!;
 expect(sleeve).toBeDefined();expect(torso).toBeDefined();expect(f.puppet.param[0].bindings.some(b=>b.node===sleeve.uuid)).toBe(true);expect(f.puppet.param[0].bindings.some(b=>b.node===torso.uuid)).toBe(false);
});
it('does not mistake a long thin strap for a sleeve',()=>{const f=fixture(true);clothingAttachments(f.puppet,f.textures,{}, {sustainedSleeveSupport:true});expect(f.puppet.param[0].bindings).toHaveLength(0);expect(inpParts(f.puppet)[0].name).toBe('topwear');});
