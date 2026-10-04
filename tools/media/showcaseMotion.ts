import type { InpDocument } from '../rig/inp';
import type { MotionCapabilities, ChainName } from '../imageToRig/capabilities';

/** See docs/media/motion.gif and its recorded timing/angle specification. */
export const motionLimits = { yaw: 20, pitch: 0, roll: 10, shoulder: 16, elbow: 30, hip: 18, knee: 45, mouth: .65 };
export const motionTiming = { period: 4, arms: [0,1.2], rightLeg: [1,1.8], leftLeg: [1.8,2.6], head: [2.4,4], settle: [3.6,4] };
export const reviewTimes = [0,.6,1.4,2.2,2.75,3.2,3.6];
export interface Recipe { family:'gif-motion'; arms:string[]; legs:string[] }
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
/** Open then close inside the reference GIF's phase, without a hold or added delay. */
const excursion=(t:number,start:number,end:number)=>{
    if(t<=start||t>=end)return 0;
    const half=(end-start)/2;
    return t<start+half?smooth((t-start)/half):1-smooth((t-start-half)/half);
};
/** Key times follow the GIF's face sequence, including its final small return. */
const headKeys:[[number,number],...Array<[number,number]>]=[[2.4,0],[2.75,1],[3,0],[3.2,-1],[3.5,0],[3.6,.5],[4,0]];
function headAmount(t:number){
    if(t<=headKeys[0][0])return 0;
    for(let i=1;i<headKeys.length;i++)if(t<=headKeys[i][0]){
        const [a,x]=headKeys[i-1],[b,y]=headKeys[i];return x+(y-x)*smooth((t-a)/(b-a));
    }
    return 0;
}
export function recipeFor(puppet:InpDocument):Recipe {
    const caps=puppet.meta.motionCapabilities as MotionCapabilities|undefined;
    const has=(name:string)=>puppet.param.some(p=>p.name===name&&p.bindings.length)&&caps?.chains[name as ChainName]?.mode!=='fixed';
    return {family:'gif-motion',arms:['Arm L','Arm R'].filter(has),legs:['Leg L','Leg R'].filter(has)};
}
/** Repeated four-second GIF sequence. No extra amplitude scale or per-avatar delay. */
export function showcaseValues(puppet:InpDocument,recipe:Recipe,seconds:number):Record<string,number[]> {
    const values:Record<string,number[]>={},caps=puppet.meta.motionCapabilities as MotionCapabilities|undefined;
    if(seconds<0)return values;
    const t=seconds%motionTiming.period;
    if(t===0)return values;
    const put=(name:string,offset:number[])=>{
        const p=puppet.param.find(p=>p.name===name&&p.bindings.length);if(!p||caps?.chains[name as ChainName]?.mode==='fixed')return;
        values[name]=p.defaults.map((rest,i)=>Math.max(p.min[i],Math.min(p.max[i],rest+(offset[i]??0))));
    };
    const arms=excursion(t,...motionTiming.arms as [number,number]);
    for(const name of recipe.arms){const sign=name.endsWith('L')?-1:1;put(name,[sign*motionLimits.shoulder*arms,sign*motionLimits.elbow*arms]);}
    for(const name of recipe.legs){
        const left=name.endsWith('L'),amount=excursion(t,...(left?motionTiming.leftLeg:motionTiming.rightLeg) as [number,number]);
        // Right knee flexion is mirrored inside the rig; hip direction must mirror too.
        put(name,[(left?-1:1)*motionLimits.hip*amount,motionLimits.knee*amount]);
    }
    const h=headAmount(t),allowed=(axis:'yaw'|'pitch'|'roll')=>(caps?.headAxes?.[axis]?.mode??caps?.face.head.mode)!=='fixed';
    put('Head Angles',[allowed('yaw')?motionLimits.yaw*h:0,0]);
    put('ParamAngleZ',[allowed('roll')?motionLimits.roll*h:0]);
    if(caps?.face.blink.mode!=='fixed'){
        const blink=smooth((t-2.86)/.12)*(1-smooth((t-3.06)/.14));
        put('ParamEyeLOpen',[-blink]);put('ParamEyeROpen',[-blink]);
    }
    if(caps?.face.mouth.mode!=='fixed')put('ParamMouthOpenY',[motionLimits.mouth*excursion(t,2.4,4)]);
    return values;
}

/** Video presentation order only: the catalog and neutral gallery keep their order. */
export function showcaseOrder<T extends {id:string;recipe:Recipe}>(entries:T[]):T[]{
    const opening=['04-purple-couture','03-solstice-mosaic','06-saffron-orbit','05-ultramarine-tempo','09-desert-ranger'];
    const score=(e:T)=>opening.includes(e.id)?100-opening.indexOf(e.id):['01-tidal-glass','02-ember-waltz'].includes(e.id)?-1:e.recipe.arms.length+e.recipe.legs.length;
    return [...entries].sort((a,b)=>score(b)-score(a));
}
