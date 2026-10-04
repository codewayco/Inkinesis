import type {UploadAssessment,UploadReview} from '../../tools/imageToRig/uploadReview';

export function installUploadReview(options:{setBusy:(busy:boolean)=>void;state:(text:string)=>void;startJob:(id:string)=>Promise<void>}) {
    const dialog=document.createElement('dialog');dialog.id='uploadReview';dialog.setAttribute('aria-labelledby','uploadReviewTitle');
    dialog.innerHTML=`<h2 id="uploadReviewTitle">Review your image</h2>
      <p>Use a suitable illustration as-is, or request a redraw for rigging. A redraw may change the face, style or details. Review it before building the rig.</p>
      <div class="upload-previews"><figure><img id="uploadOriginal" alt="Original uploaded character"><figcaption>Original</figcaption></figure><figure id="uploadCandidateFigure" hidden><img id="uploadCandidate" alt="Proposed redraw — not yet used for rigging"><figcaption>Proposed redraw</figcaption></figure></div>
      <p id="uploadProgress" role="status" aria-live="polite"></p>
      <fieldset id="uploadChoices"><legend>Choose the image to rig</legend><label><input type="radio" name="uploadChoice" value="original" checked> Use as-is</label><label id="uploadRedrawnChoice" hidden><input type="radio" name="uploadChoice" value="redrawn"> Use this redraw</label></fieldset>
      <ul id="uploadChecks"></ul><p id="uploadRecommendation"></p>
      <p class="hint">Image checks use your configured vision provider. Redraw uses your image provider and adds a paid image-edit request. GPU rigging starts only after you confirm below.</p>
      <div class="row"><button id="uploadRedraw" type="button">Redraw for rigging</button><button id="uploadConfirm" type="button" class="primary">Use original and build rig</button><button id="uploadCancel" type="button">Cancel</button></div>`;
    document.body.append(dialog);
    const element=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>('#'+id)!;
    let review:UploadReview|undefined,working=false,selection:'original'|'redrawn'='original';
    const progress=(s:string)=>{element('uploadProgress').textContent=s;};
    function render() {
        const ready=review?.status==='ready';
        element<HTMLButtonElement>('uploadRedraw').disabled=working||!ready;
        element<HTMLButtonElement>('uploadConfirm').disabled=working||!ready||!(selection==='original'?review?.original:review?.candidate);
        element<HTMLButtonElement>('uploadCancel').disabled=working;
        element<HTMLFieldSetElement>('uploadChoices').disabled=working||!ready;
        element('uploadCandidateFigure').hidden=!review?.candidate;element('uploadRedrawnChoice').hidden=!review?.candidate;
        if(review?.original)element<HTMLImageElement>('uploadOriginal').src=`/api/rig/uploads/${review.id}/original.png?v=${review.original.sha256}`;
        if(review?.candidate)element<HTMLImageElement>('uploadCandidate').src=`/api/rig/uploads/${review.id}/candidate.png?v=${review.candidate.sha256}`;
        const assessment:UploadAssessment|undefined=selection==='original'?review?.original:review?.candidate;
        element('uploadChecks').replaceChildren(...(assessment?.checks??[]).map(c=>{const li=document.createElement('li');li.textContent=`${c.status==='pass'?'✓':c.status==='warning'?'!':'?'} ${c.message}`;return li;}));
        element('uploadRecommendation').textContent=assessment?.recommendRedraw?(selection==='original'?'A redraw is recommended for these source issues. You can still keep the original.':'Some source issues remain in this redraw. Inspect them before accepting, retry, or use the original.'):'Checks are advisory. Inspect the image; they do not guarantee a good rig.';
        element('uploadRedraw').textContent=review?.candidate?'Try another redraw':review?.original?.recommendRedraw?'Redraw for rigging (recommended)':'Redraw for rigging';
        element('uploadConfirm').textContent=selection==='original'?'Use original and build rig':'Accept redraw and build rig';
        for(const radio of dialog.querySelectorAll<HTMLInputElement>('input[name=uploadChoice]'))radio.checked=radio.value===selection;
    }
    async function json(url:string,init?:RequestInit) {
        const r=await fetch(url,init),body=await r.json();if(!r.ok)throw Error(body.error??'Image request failed.');return body;
    }
    async function wait(id:string,chooseCandidate=false) {
        for(;;){
            review=await json('/api/rig/uploads/'+id) as UploadReview;
            if(!['checking','redrawing'].includes(review.status))break;
            progress(review.status==='checking'?'Checking the image before rigging…':'Redrawing and checking the proposed image…');render();
            await new Promise(resolve=>setTimeout(resolve,1000));
        }
        if(chooseCandidate)selection=review.candidate?'redrawn':'original';
        if(review.status==='used'){localStorage.removeItem('inkinesis-upload-review');throw Error('This preview was already used. Select a new image to start another rig.');}
        progress(review.error??'Inspect the image and checks. No rig has been started.');
    }
    async function operation(work:()=>Promise<void>) {
        working=true;render();
        try{await work();}catch(error){const message=error instanceof Error?error.message:String(error);progress(message);options.state(message);if(!dialog.open)options.setBusy(false);}
        finally{working=false;render();}
    }
    const dismiss=()=>{dialog.close();localStorage.removeItem('inkinesis-upload-review');options.setBusy(false);options.state('Image review closed. No new rig was started.');};
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!working)dismiss();});
    element('uploadCancel').onclick=dismiss;
    for(const radio of dialog.querySelectorAll<HTMLInputElement>('input[name=uploadChoice]'))radio.onchange=()=>{selection=radio.value as typeof selection;render();};
    element('uploadRedraw').onclick=()=>{if(!review||working)return;void operation(async()=>{
        await json(`/api/rig/uploads/${review!.id}/redraw`,{method:'POST'});await wait(review!.id,true);
    });};
    element('uploadConfirm').onclick=()=>{if(!review||working)return;void operation(async()=>{
        const selected=selection==='original'?review!.original:review!.candidate;
        const result=await json(`/api/rig/uploads/${review!.id}/confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selection,sha256:selected?.sha256})});
        localStorage.removeItem('inkinesis-upload-review');localStorage.setItem('combined-job',result.id);dialog.close();await options.startJob(result.id);
    });};
    return {
        async open(file:File){
            options.setBusy(true);review=undefined;selection='original';element<HTMLImageElement>('uploadOriginal').removeAttribute('src');dialog.showModal();progress('Uploading image for checks…');
            await operation(async()=>{const result=await json('/api/rig/uploads/',{method:'POST',headers:{'content-type':file.type},body:file});localStorage.setItem('inkinesis-upload-review',result.id);await wait(result.id);});
        },
        async restore(){const id=localStorage.getItem('inkinesis-upload-review');if(!id||localStorage.getItem('combined-job'))return;options.setBusy(true);dialog.showModal();await operation(()=>wait(id));},
    };
}
