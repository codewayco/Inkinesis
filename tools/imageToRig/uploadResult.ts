import type {RunReport} from './pipeline';
export interface UploadResultReview {
    technical:'complete';visual:'needs_review';silhouetteIoU?:number;
    source:'original'|'redrawn';limitations:{region:string;reason:string}[];notes:string[];
}
/** Advisory review only: neither a high IoU nor successful export certifies appearance. */
export function uploadResultReview(report:RunReport,source:'original'|'redrawn',iou?:number):UploadResultReview {
    const caps=report.motionCapabilities;
    const regions:Record<string,{mode:string;reasons:string[]}>=caps?{...caps.chains,...caps.headAxes,blink:caps.face.blink,mouth:caps.face.mouth}:{};
    const limitations=Object.entries(regions).filter(([,c])=>c.mode!=='articulated').map(([region,c])=>({region,reason:c.reasons.join(' ')||'Independent movement is unavailable.'}));
    const notes=['The rig was exported and technically validated. Visual appearance still needs your review.'];
    if(Number.isFinite(iou)&&iou!<.95)notes.push('The neutral silhouette differs substantially from the selected source. Inspect missing or extra artwork.');
    if(source==='redrawn')notes.push('The rig uses your accepted redraw. Compare identity, clothing and colors with the original upload.');
    return {technical:'complete',visual:'needs_review',source,silhouetteIoU:Number.isFinite(iou)?iou:undefined,limitations,notes};
}
