import {describe,it,expect} from 'vitest';
import {uploadResultReview} from '../uploadResult';
import {pixelChecks} from '../uploadReview';
import {encodePNG} from '../../shared/encodePNG';
import type {RunReport} from '../pipeline';
describe('Upload quality reporting',()=>{
    it('does not certify visual quality from a high silhouette IoU or change technical status',()=>{
        const report={status:'success',motionCapabilities:{chains:{'Leg L':{mode:'fixed',reasons:['Static clothing overlaps this leg.']}},face:{blink:{mode:'articulated',reasons:[]},mouth:{mode:'fixed',reasons:['Mouth is obscured.']}}}} as unknown as RunReport;
        const review=uploadResultReview(report,'redrawn',.993);
        expect(review).toMatchObject({technical:'complete',visual:'needs_review',limitations:[{region:'Leg L'},{region:'mouth'}]});
        expect(report.status).toBe('success');
        expect(uploadResultReview(report,'original',.47).notes.some(n=>n.includes('silhouette'))).toBe(true);
    });
    it('warns about small opaque inputs without treating white clothing as transparency',()=>{
        const rgba=new Uint8ClampedArray(8*8*4).fill(255),checks=pixelChecks(encodePNG(rgba,8,8));
        expect(checks.find(c=>c.code==='background')?.status).toBe('warning');
        expect(checks.find(c=>c.code==='resolution')?.status).toBe('warning');
    });
});
