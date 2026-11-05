import {it,expect} from 'vitest';
import {alphaInstanceGroups} from '../propInstanceGroups';
import {expectedPropCarriers} from '../expectedPropCarriers';
import type {InpDocument} from '../inp';
function mask(points:[number,number,number][],w=30,h=8){const p=new Uint8ClampedArray(w*h*4);for(const[x,y,a]of points)p[4*(y*w+x)+3]=a;return p;}
it('separates distant objects in the same layer',()=>{const p=mask([[2,3,255],[3,3,255],[24,3,255],[25,3,255]]);expect(alphaInstanceGroups(p,30,8,3).map(g=>g.length).sort()).toEqual([2,2]);});
it('retains thin semitransparent bridges as one object and all visible pixels',()=>{const p=mask([[2,3,255],[3,3,20],[4,3,20],[5,3,255],[6,3,2]]);const g=alphaInstanceGroups(p,30,8,2);expect(g).toHaveLength(1);expect(g[0]).toHaveLength(5);});
it('joins only short gaps and leaves a distant island separate',()=>{const p=mask([[2,3,255],[4,3,255],[20,3,255]]);expect(alphaInstanceGroups(p,30,8,2).map(g=>g.length).sort()).toEqual([1,2]);});
it('flags a grasp even when segmentation omitted every prop layer',()=>{const p={nodes:{children:[]},param:[]} as unknown as InpDocument;const a=expectedPropCarriers(p,{'Arm L':{mode:'held',evidence:['Holding a toy']}},['Holding a toy']);expect(a.reviewRequired).toBe(true);expect(a.warnings.map(w=>w.code)).toContain('source-grasp-without-carrier');});
it('does not equate an arm held away from the body with an object grasp',()=>{const p={nodes:{children:[]},param:[]} as unknown as InpDocument;expect(expectedPropCarriers(p,{},['Arm held away from torso']).reviewRequired).toBe(false);});
