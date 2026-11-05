import {it,expect} from 'vitest';import {preparedTrouserLegs} from '../preparedTrouserLegs';
import {encodePNG} from '../../shared/encodePNG';import type {InpDocument} from '../inp';
const W=200,H=300,marks={hipL:{x:145,y:60},kneeL:{x:145,y:170},ankleL:{x:145,y:275},hipR:{x:55,y:60},kneeR:{x:55,y:170},ankleR:{x:55,y:275}};
const image=(fn:(x:number,y:number)=>boolean)=>{const rgba=new Uint8ClampedArray(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(fn(x,y))rgba.set([150,80,40,255],4*(y*W+x));return Buffer.from(encodePNG(rgba,W,H));};
const document=():InpDocument=>({meta:{canvas:{width:W,height:H}},param:[],nodes:{uuid:0,name:'Root',type:'Node',enabled:true,zsort:0,children:['bottomwear','footwear-l','footwear-r'].map((name,i)=>({uuid:i+1,name,type:'Part',enabled:true,zsort:i,textures:[i],mesh:{verts:[-100,-150,100,-150,-100,150,100,150],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,1,3,2],origin:[0,0]}}))}});
const shoes=[image((x,y)=>x>=128&&x<162&&y>=265),image((x,y)=>x>=38&&x<72&&y>=265)];
it('accepts visible continuous trouser tubes with supplied joints and shoes',()=>{
 const pants=image((x,y)=>y>=45&&y<275&&(y<90?(x>=35&&x<165):((x>=35&&x<75)||(x>=125&&x<165))));
 expect([...preparedTrouserLegs(document(),[pants,...shoes],marks).names]).toEqual(['Leg L','Leg R']);
});
it('does not substitute an intact skirt or disconnected short panels for legs',()=>{
 const skirt=image((x,y)=>x>=25&&x<175&&y>=45&&y<270);expect(preparedTrouserLegs(document(),[skirt,...shoes],marks).names.size).toBe(0);
 const shorts=image((x,y)=>y>=45&&y<140&&(y<90?(x>=35&&x<165):((x>=35&&x<75)||(x>=125&&x<165))));expect(preparedTrouserLegs(document(),[shorts,...shoes],marks).names.size).toBe(0);
});
