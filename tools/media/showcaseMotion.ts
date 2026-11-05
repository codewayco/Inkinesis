import type { InpDocument } from '../rig/inp';
import type { MotionCapabilities, ChainName } from '../imageToRig/capabilities';

/** See docs/media/motion.gif and its recorded timing/angle specification. */
export const motionLimits = { yaw: 20, pitch: 0, roll: 10, shoulder: 16, elbow: 30, hip: 18, knee: 45, mouth: .65 };
export const motionTiming = { period: 4, arms: [0,1.2], rightLeg: [1,1.8], leftLeg: [1.8,2.6], head: [2.4,4], settle: [3.6,4] };
/** Showcase rigs render at SUPERSAMPLE times their cell size and are downscaled with high-quality smoothing; frames are written at OUTPUT_SCALE times the 1600×1000 layout. */
export const SUPERSAMPLE = 3, OUTPUT_SCALE = 1.5;
export const reviewTimes = [0,.6,1.4,2.2,2.75,3.2,3.6];
export interface Recipe { family:'gif-motion'; arms:string[]; legs:string[]; armScale:number }
/** Showcase rigs whose held object would leave the cell or lose contact with the hand at the
 * full arm targets; their shoulder and elbow targets are halved. Every other rig uses the GIF targets. */
export const showcaseArmScale:Record<string,number>={
    '58-amber-pangolin-ceramist':.5,'77-turquoise-raven-calligrapher':.5,'84-starberry-spacefarer':.5,
};
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
export function recipeFor(puppet:InpDocument,id?:string):Recipe {
    const caps=puppet.meta.motionCapabilities as MotionCapabilities|undefined;
    const has=(name:string)=>puppet.param.some(p=>p.name===name&&p.bindings.length)&&caps?.chains[name as ChainName]?.mode!=='fixed';
    return {family:'gif-motion',arms:['Arm L','Arm R'].filter(has),legs:['Leg L','Leg R'].filter(has),armScale:(id&&showcaseArmScale[id])||1};
}
/** Repeated four-second GIF sequence. No per-avatar delay; only the arm scale above changes amplitude. */
export function showcaseValues(puppet:InpDocument,recipe:Recipe,seconds:number):Record<string,number[]> {
    const values:Record<string,number[]>={},caps=puppet.meta.motionCapabilities as MotionCapabilities|undefined;
    if(seconds<0)return values;
    const t=seconds%motionTiming.period;
    if(t===0)return values;
    const put=(name:string,offset:number[])=>{
        const p=puppet.param.find(p=>p.name===name&&p.bindings.length);if(!p||caps?.chains[name as ChainName]?.mode==='fixed')return;
        values[name]=p.defaults.map((rest,i)=>Math.max(p.min[i],Math.min(p.max[i],rest+(offset[i]??0))));
    };
    const arms=excursion(t,...motionTiming.arms as [number,number])*recipe.armScale;
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

/** Video cast and order. Characters holding objects alternate with empty-handed anime
 * characters until the latter run out, then the remaining holders follow. Rigs that tear,
 * drop a held object or leave a hole at any arm or leg amplitude are left out. The catalog
 * and the neutral gallery keep their own order. */
export const showcaseCast=[
    '01-vermilion-shrine-bells','10-sakura-comet-idol','02-neon-penlight-cheer','11-azure-prism-dancer',
    '03-cedar-ridge-ranger','26-apricot-sunrise-runner','04-midnight-brass-busker','12-lilac-moon-ribbon',
    '43-aurora-axolotl-beaconer','32-skyline-blue-vocalist','06-ember-forge-smith','15-amber-daybreak-hero',
    '31-vermilion-crane-host','07-foxfire-festival-sweet','08-asphalt-comet-skater','09-strawberry-cream-patissier',
    '13-emerald-star-wand','14-ruby-rose-duelist','16-violet-pulse-singer','17-teal-breeze-prince',
    '18-twinlens-shutter-girl','47-cobalt-otter-cartographer','48-raspberry-clockwork-gnome','52-copper-ibis-restaurateur',
    '53-coral-reef-siren','56-jade-dragon-parade','57-peach-kite-painter','58-amber-pangolin-ceramist',
    '59-obsidian-bat-cabaret','62-rose-ibex-fan-diplomat','63-citrus-seahorse-luthier','64-saffron-spider-confectioner',
    '65-brass-heron-banner-engineer','76-midnight-tape-archivist','77-turquoise-raven-calligrapher','78-lilac-hotel-bellkeeper',
    '83-rose-quartz-cello','84-starberry-spacefarer','85-verdigris-bull-vaultkeeper','88-glacier-bison-procession',
];
export function showcaseOrder<T extends {id:string}>(entries:T[]):T[]{
    return showcaseCast.map(id=>{const entry=entries.find(e=>e.id===id);if(!entry)throw Error('Missing showcase avatar '+id);return entry;});
}
