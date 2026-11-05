/** A shared rigid prop links the two hands. Other pieces may be held by only
 * one of those hands: all travel with the same paired translation/hand frame.
 * Reject any significant piece with no hand support, and two unrelated props
 * without a shared component. The existing eight-pixel noise rule is unchanged. */
export function sharedPropGroup(pieces:{area:number}[],contacts:{component:number}[][]) {
 if(contacts.length!==2)return {supported:false,shared:[] as number[],unsupported:[] as number[]};
 const sets=contacts.map(c=>new Set(c.map(m=>m.component))),shared=[...sets[0]].filter(id=>sets[1].has(id));
 const unsupported=pieces.map((p,i)=>({area:p.area,id:i+1})).filter(p=>p.area>8&&!sets.some(s=>s.has(p.id))).map(p=>p.id);
 return {supported:shared.length>0&&unsupported.length===0,shared,unsupported};
}
