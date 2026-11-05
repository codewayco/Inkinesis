import {describe,it,expect} from 'vitest';import {affineKeyIndices} from '../live2d/linearKeys';
describe('affine export key compression',()=>{
 it('removes only redundant keys across every binding',()=>{expect(affineKeyIndices([0,.5,1],[[[[0,0]],[[2,3]],[[4,6]]],[0,.5,1]])).toEqual([0,2]);expect(affineKeyIndices([0,.5,1],[[[[0,0]],[[2,3]],[[4,6]]],[0,.8,1]])).toEqual([0,1,2]);});
 it('uses nonuniform key distances and preserves curved motion',()=>{expect(affineKeyIndices([0,.1,.6,1],[[0,1,6,10]])).toEqual([0,3]);expect(affineKeyIndices([0,.1,.6,1],[[0,.01,.36,1]])).toEqual([0,1,2,3]);});
});
