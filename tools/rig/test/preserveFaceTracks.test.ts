import {it,expect} from 'vitest';import {preserveFaceTracks} from '../preserveFaceTracks';import {inpParts,type InpDocument} from '../inp';import {evaluateCombined,type CombinedAsset} from '../../../player/src/combinedRuntime';
const ref=():InpDocument=>({meta:{canvas:{width:20,height:20}},nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:[{uuid:1,name:'mouth_close',type:'Part',enabled:true,zsort:1,textures:[0],mesh:{verts:[0,0,10,0,0,10],uvs:[0,0,1,0,0,1],indices:[0,1,2],origin:[0,0]}}]},param:[{uuid:2,name:'ParamMouthForm',is_vec2:false,min:[-1,0],max:[1,0],defaults:[0,0],axis_points:[[0,.5,1],[0]],merge_mode:'Passthrough',bindings:[{node:1,param_name:'deform',interpolate_mode:'Linear',isSet:[[true],[true],[true]],values:[[[[1,0],[0,1],[0,0]]],[[[0,0],[0,0],[0,0]]],[[[-1,0],[0,-1],[0,0]]]]}]}]});
it('restores the reference face interpolation at keys and intermediate values',()=>{
 const a=ref(),b=structuredClone(a);b.param[0].axis_points=[[0,.3,1],[0]];b.param[0].bindings[0].values=[[[[9,9],[8,8],[7,7]]],[[[4,4],[3,3],[2,2]]],[[[1,1],[1,1],[1,1]]]];
 expect(preserveFaceTracks(b,[Buffer.from('same')],a,[Buffer.from('same')]).changedBindings).toBeGreaterThan(0);
 const asset=(puppet:InpDocument):CombinedAsset=>({puppet,parts:inpParts(puppet),width:20,height:20,textures:[]});
 for(const x of [-1,-.83,-.25,0,.16,.73,1])expect(evaluateCombined(asset(b),{ParamMouthForm:[x,0]})).toEqual(evaluateCombined(asset(a),{ParamMouthForm:[x,0]}));
});
it('refuses a reference from a different texture or mesh',()=>{
 const a=ref(),b=ref();expect(()=>preserveFaceTracks(b,[Buffer.from('new')],a,[Buffer.from('old')])).toThrow('artwork');b.nodes.children![0].mesh!.verts[0]=1;expect(()=>preserveFaceTracks(b,[Buffer.from('same')],a,[Buffer.from('same')])).toThrow('artwork');
});
