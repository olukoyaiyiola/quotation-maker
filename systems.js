'use strict';

function starter(id, name, code, descriptions) {
  return {id, name, code, start: 1, startYear: new Date().getFullYear(),
    items: descriptions.map(description => ({...blankItem(), description}))};
}
const systems = cached.systems?.length ? cached.systems : [
  starter('roofing', 'Roofing System', 'RS', ['Roofing sheets', 'Ridge caps', 'Valley flashing', 'Roofing screws']),
  starter('gutter', 'Rain Water Gutter System', 'RWGS', ['Rain gutters', 'Downpipes', 'Gutter brackets', 'Gutter outlets', 'Stop ends'])
];
const currentSystem = () => systems.find(s => s.id === quote.systemId) || systems[0];
quote.systemId = currentSystem().id;
delete quote.valid;
let records = [];
let selectedRecord;
let templateDraft;
sessionStorage.removeItem('bumick-archive-key');
const currentYear = () => new Date().getFullYear();
const initials = name => (name.match(/[\p{L}\p{N}]+/gu) || []).map(word => word[0]).join('').toUpperCase().slice(0,16);
const reference = (code,year,n) => 'BNL/Q/' + code + '/' + year + '/' + String(n).padStart(3,'0');
function nextNumber(system, year, history) {
  let n = system.startYear === year ? system.start : 1;
  for (const r of history) {
    if (r.year === year && (r.systemId === system.id || r.code === system.code)) n = Math.max(n, r.serial + 1);
  }
  return n;
}
function nextReference() {
  if (quote.recordRef) return quote.recordRef;
  const s = currentSystem(), year = currentYear();
  return reference(s.code, year, nextNumber(s, year, records));
}

const database = new Promise((resolve,reject) => {
  const open = indexedDB.open('bumick-quotation-history',1);
  open.onupgradeneeded = () => open.result.createObjectStore('records',{keyPath:'ref'});
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
function readAll(db) {
  return new Promise((resolve,reject) => {
    const req = db.transaction('records').objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
// Compare the last version seen by the editor inside the write transaction.
async function writeRecord(record, expectedVersion) {
  const db=await database;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'), store=tx.objectStore('records');
    const get=store.get(record.ref);
    let conflict=false;
    get.onsuccess=()=>{
      const old=get.result;
      if ((old && old.id!==record.id) || (old?.version || null)!==expectedVersion) {
        conflict=true;tx.abort();return;
      }
      store.put(record);
    };
    tx.oncomplete=resolve;
    tx.onabort=()=>reject(conflict?Error('This reference changed. Reopen the quotation from history.'):tx.error);
  });
}
function templateItems(system) {
  return system.items.length ? structuredClone(system.items) : [blankItem()];
}
function startQuotation(system) {
  quote={...newQuote(),systemId:system.id,items:templateItems(system)};
  showEditor();
}
function showEditor() {
  const locked=quote.recordStatus==='issued';
  document.querySelector('.editor').inert=locked;
  byId('save').disabled=locked;
  refreshSystems();
  byId('system').disabled=Boolean(quote.recordRef);
  byId('new-template').disabled=Boolean(quote.recordRef);
  fillInputs('[data-q]','q',quote);renderItems();update();
  if(locked)byId('status').textContent='Exported · '+quote.recordRef;
}
function loadDraft(record) {
  quote={...structuredClone(record.quote),recordRef:record.ref,recordVersion:record.version,recordStatus:record.status};
  showEditor();
}
function validateQuotation(q) {
  function amount(value,minimum,strict=false) {
    return value!=null && String(value).trim()!=='' && Number.isFinite(Number(value)) &&
      (strict ? Number(value)>minimum : Number(value)>=minimum);
  }
  if(!String(q.client || '').trim())throw Error('Enter the client name.');
  if(!q.date)throw Error('Enter the issue date.');
  if(!q.items.length)throw Error('Add at least one item.');
  q.items.forEach((item,i)=>{
    if(!item.description?.trim())throw Error('Enter a description for item '+(i+1)+'.');
    if(!amount(item.qty,0,true))throw Error('Enter a quantity above zero for item '+(i+1)+'.');
    if(!amount(item.rate,0))throw Error('Enter a rate for item '+(i+1)+'.');
  });
  for(const [field,label] of [['labor','workmanship cost'],['transport','transportation cost']]){
    if(!amount(q[field],0))throw Error('Enter the '+label+'. Enter 0 if there is no charge.');
  }
  if(q.tax&&!amount(q.taxRate,0))throw Error('Enter the tax rate or turn tax off.');
  if(q.discount&&!amount(q.discountValue,0))throw Error('Enter the discount value or turn discount off.');
}
async function draftSnapshot() {
  await window.refreshCompany();
  validateQuotation(quote);
  const local=await readAll(await database);
  if(quote.recordRef){
    const old=local.find(r=>r.ref===quote.recordRef);
    if(old?.status!=='draft'||old.version!==quote.recordVersion)throw Error('Reopen the current version from history.');
    return {...old,quote:structuredClone(quote),profile:structuredClone(profile)};
  }
  const system=currentSystem(),year=currentYear();
  let serial=nextNumber(system,year,local);
  {
    const prefix='BNL/Q/'+system.code+'/'+year+'/';
    for(const r of await cloud('GET'))if(r.ref.startsWith(prefix))serial=Math.max(serial,Number(r.ref.slice(prefix.length))+1);
  }
  const ref=reference(system.code,year,serial);
  return {id:crypto.randomUUID(),systemId:system.id,systemName:system.name,code:system.code,year,serial,ref,
    quote:{...structuredClone(quote),number:ref},profile:structuredClone(profile)};
}
async function commitRecord(snapshot,status) {
  const previous=snapshot.version || null;
  const record={...snapshot,status,at:new Date().toISOString(),version:crypto.randomUUID()};
  delete record.quote.recordRef;delete record.quote.recordStatus;delete record.quote.recordVersion;
  record.quote.number=record.ref;
  {
    await cloud('POST',record);
    record.baseVersion=record.version;
  }
  await writeRecord(record,previous);
  records=await readAll(await database);
  return record;
}
byId('new').onclick=()=>{
  if(quote.recordStatus==='issued'||confirm('Start a new quotation with the selected system’s template items?'))startQuotation(currentSystem());
};
function options(select, entries) {
  select.replaceChildren(...entries.map(([name,value]) => new Option(name,value)));
}
function refreshSystems() {
  options(byId('system'),systems.map(s=>[s.name,s.id]));
  byId('system').value=currentSystem().id;
  const list=currentSystem().items;
  options(byId('catalog'),list.length ? list.map((i,n)=>[ [i.description,i.type,i.colour].filter(Boolean).join(' · '), String(n)]) : [['No saved items','']]);
  byId('use-item').disabled=!list.length;
}
byId('system').onchange = e => {
  const system=systems.find(s=>s.id===e.target.value);
  if(!confirm('Replace the item list with the items from '+system.name+'?')){refreshSystems();return}
  quote.systemId=system.id;quote.items=templateItems(system);showEditor();
};
byId('use-item').onclick = () => {
  const item=structuredClone(currentSystem().items[Number(byId('catalog').value)]);
  const empty=quote.items.findIndex(i=>!i.description && !i.rate && !i.type && !i.colour);
  if(empty<0) quote.items.push(item); else quote.items[empty]=item;
  renderItems();update();
};
function templateRows() {
  byId('template-items').innerHTML=templateDraft.items.map((item,i)=>
    '<div class="item catalog-row" data-row="'+i+'"><label>Item name<input required data-field="description" value="'+escape(item.description)+'"></label><label>Qty<input required type="number" min="0.000001" step="any" data-field="qty" value="'+escape(item.qty)+'"></label><label>Rate<input type="number" min="0" step="0.01" data-field="rate" value="'+escape(item.rate)+'"></label><button type="button" data-drop aria-label="Remove saved item">×</button>' + materialFields(item, 'data-field') + '</div>').join('');
}
function editSystem(existing) {
  templateDraft=existing ? structuredClone(currentSystem()) : starter(crypto.randomUUID(),'','',[]);
  byId('system-name').value=templateDraft.name;
  byId('system-code').value=templateDraft.code;
  byId('system-start').value=nextNumber(templateDraft,currentYear(),records);
  templateRows();byId('template').showModal();
}
byId('edit-template').onclick=()=>editSystem(true);
byId('new-template').onclick=()=>editSystem(false);
byId('system-name').oninput=e=>{
  if(!templateDraft.code || byId('system-code').value===initials(templateDraft.name)) byId('system-code').value=initials(e.target.value);
  templateDraft.name=e.target.value;templateDraft.code=byId('system-code').value;
};
byId('system-code').oninput=e=>{templateDraft.code=e.target.value.toUpperCase();e.target.value=templateDraft.code};
byId('template-items').oninput=e=>{
  if(e.target.dataset.field) templateDraft.items[e.target.closest('[data-row]').dataset.row][e.target.dataset.field]=e.target.value;
};
byId('template-items').onclick=e=>{
  if(e.target.hasAttribute('data-drop')){templateDraft.items.splice(e.target.closest('[data-row]').dataset.row,1);templateRows();}
};
byId('catalog-add').onclick=()=>{templateDraft.items.push(blankItem());templateRows();byId('template-items').lastElementChild.querySelector('input').focus()};
byId('template-form').onsubmit=e=>{
  e.preventDefault();
  const s=templateDraft;
  s.name=byId('system-name').value.trim();s.code=byId('system-code').value.trim().toUpperCase();
  if(!s.name || s.items.some(i=>!i.description.trim()))return alert('Enter a name for the system and each saved item.');
  if(systems.some(i=>i.id!==s.id && i.code===s.code))return alert('Choose unique initials for this system.');
  s.start=Number(byId('system-start').value);s.startYear=currentYear();
  const index=systems.findIndex(i=>i.id===s.id);
  if(index<0) systems.push(s);else systems[index]=s;
  if(quote.systemId!==s.id){quote.systemId=s.id;quote.items=templateItems(s)}
  showEditor();byId('template').close();
};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
function showHistory() {
  const filter=byId('filter').value, term=byId('search').value.trim().toUpperCase();
  const matching=records.filter(r=>(!filter || r.systemId===filter) && r.ref.toUpperCase().includes(term))
    .sort((a,b)=>b.at.localeCompare(a.at));
  byId('record-list').replaceChildren(...matching.map(r=>{
    const b=document.createElement('button');b.className='record';b.textContent=r.ref;
    const sub=document.createElement('small');sub.textContent=[r.status==='draft'?'Draft':'Exported',r.systemName,r.quote.client,dateLabel(r.quote.date)].filter(Boolean).join(' · ');
    b.append(sub);b.onclick=()=>{selectedRecord=r;byId('record-heading').textContent=r.status==='draft'?'Saved draft':'Exported quotation';byId('edit-draft').hidden=false;byId('edit-draft').textContent=r.status==='draft'?'Edit draft':'Copy to new quotation';byId('archive-paper').innerHTML=quotationHTML(r.quote,r.profile,r.systemName);byId('archive-view').showModal()};return b;
  }));
  byId('record-info').textContent=matching.length+' matching record'+(matching.length===1?'':'s')+' on this device.';
}
function historyFilters(){
  const known=new Map([...records.map(r=>[r.systemId,r.systemName]),...systems.map(s=>[s.id,s.name])]);
  const selected=byId('filter').value;
  options(byId('filter'),[['All systems',''],...Array.from(known,([id,name])=>[name,id])]);
  byId('filter').value=selected || '';
}
byId('history').onclick=async()=>{
  try{records=await readAll(await database);historyFilters();showHistory();byId('records').showModal();syncArchive();}
  catch{alert('This browser could not open the quotation history.')}
};
byId('search').oninput=byId('filter').onchange=showHistory;

let busy=false;
async function runAction(action) {
  if(busy)return;
  busy=true;
  try {await action()} catch(e){alert(e.message)} finally{busy=false}
}
byId('save').onclick=()=>runAction(async()=>{
  const saved=await commitRecord(await draftSnapshot(),'draft');
  loadDraft(saved);byId('status').textContent='Draft saved · '+saved.ref;
});
byId('edit-draft').onclick=()=>{
  if(!confirm('Open this quotation in the editor? This replaces the current working copy.'))return;
  byId('archive-view').close();byId('records').close();
  if(selectedRecord.status==='draft'){loadDraft(selectedRecord);return}
  quote={...structuredClone(selectedRecord.quote),systemId:selectedRecord.systemId,date:localDate()};
  delete quote.recordRef;delete quote.recordVersion;delete quote.recordStatus;
  showEditor();
};
let exportSource=null, exportFile=null, printImage=null;
const fileUrls=[];
function openExport(record) {
  try{validateQuotation(record?.quote || quote)}
  catch(e){alert(e.message);return}
  exportSource=record;
  byId('formats').hidden=false;byId('file-actions').hidden=true;
  byId('export-info').textContent=record && record.status!=='draft'?'Choose a file format.':'Choose a format to export and lock this quotation.';
  byId('export-dialog').showModal();
}
byId('export').onclick=()=>openExport(quote.recordStatus==='issued'?records.find(r=>r.ref===quote.recordRef):null);
byId('record-export').onclick=()=>openExport(selectedRecord);
document.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>runAction(async()=>{
  if(exportSource)await window.refreshCompany();
  const snapshot=exportSource?.status==='draft' ? {...exportSource,profile:structuredClone(profile)} : exportSource || await draftSnapshot();
  const format=button.dataset.format;
  const canvas=await renderExportPage(snapshot);
  const jpeg=format==='pdf'?await canvasBlob(canvas,'image/jpeg'):null;
  const blob=jpeg?await onePagePdf(jpeg,canvas.width,canvas.height):await canvasBlob(canvas,'image/png');
  canvas.width=canvas.height=1;
  if(!byId('export-dialog').open)return;
  if(!exportSource || snapshot.status==='draft'){
    const saved=await commitRecord(snapshot,'issued');
    if(!exportSource || quote.recordRef===saved.ref)loadDraft(saved);
    if(exportSource){selectedRecord=saved;byId('edit-draft').textContent='Copy to new quotation';byId('record-heading').textContent='Exported quotation';showHistory()}
    exportSource=saved;
  }
  exportFile=new File([blob],snapshot.ref.replaceAll('/','-')+'.'+format,{type:blob.type});
  const download=byId('download-file');
  download.href=URL.createObjectURL(blob);fileUrls.push(download.href);
  download.download=exportFile.name;download.textContent='Download '+format.toUpperCase();
  if(jpeg){printImage=URL.createObjectURL(jpeg);fileUrls.push(printImage)}
  byId('print-file').hidden=!jpeg;
  byId('share-file').hidden=!navigator.canShare?.({files:[exportFile]});
  byId('export-info').textContent='One-page '+format.toUpperCase()+' ready · '+snapshot.ref;
  byId('formats').hidden=true;byId('file-actions').hidden=false;
}));
byId('export-dialog').addEventListener('close',()=>{
  for(const url of fileUrls.splice(0))URL.revokeObjectURL(url);
  exportFile=null;printImage=null;
});
byId('share-file').onclick=async()=>{
  try{await navigator.share({files:[exportFile]})}catch(e){if(e.name!=='AbortError')alert('Use Download to attach the file in your app.')}
};
byId('print-file').onclick=async()=>{
  const paper=byId('paper-print'),img=new Image();img.src=printImage;
  try{await img.decode();paper.replaceChildren(img);paper.classList.add('active');
    window.addEventListener('afterprint',()=>paper.classList.remove('active'),{once:true});window.print()
  }catch(e){alert(e.message)}
};
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'){e.preventDefault();if(!byId('export-dialog').open)openExport(byId('archive-view').open?selectedRecord:quote.recordStatus==='issued'?records.find(r=>r.ref===quote.recordRef):null)}
});

async function cloud(method,body) {
  const res=await fetch('/api/archive',{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(res.status===401)location.reload();
  if(!res.ok)throw Object.assign(Error((await res.json().catch(()=>({}))).error || ({401:'Check the archive access key.',409:'A different quotation already uses this reference in the cloud.',503:'Configure the private archive on Vercel first.'})[res.status] || 'Cloud archive unavailable.'),{status:res.status});
  return res.json();
}
let syncing=false;
async function syncArchive() {
  if(syncing)return;
  syncing=true;
  try{
    const db=await database, manifest=await cloud('GET'), local=await readAll(db);
    const remote=new Map(manifest.map(x=>[x.ref,x]));
    const localRefs=new Map(local.map(x=>[x.ref,x]));
    for(const r of local){
      const other=remote.get(r.ref);
      if(other && other.id!==r.id)throw Error('Reference conflict for '+r.ref+'. Both copies were preserved.');
      if(!other || (r.version && r.version!==r.baseVersion)){
        await cloud('POST',r);
        if(r.version)await writeRecord({...r,baseVersion:r.version},r.version);
      }
    }
    for(const item of manifest){
      const old=localRefs.get(item.ref);
      if(old && (!old.version || old.version!==old.baseVersion || old.version===item.version))continue;
      const r=await cloud('POST',{lookup:item.ref});
      await writeRecord({...r,baseVersion:r.version},old?.version || null);
    }
    records=await readAll(db);historyFilters();showHistory();renderPreview();
    byId('cloud-message').textContent='Cloud archive is up to date.';
  }catch(e){byId('cloud-message').textContent=e.message;byId('status').textContent='Cloud sync pending · see history';}
  finally{syncing=false}
}
window.addEventListener('online',syncArchive);
fillInputs('[data-q]','q',quote);fillInputs('[data-p]','p',profile);
if(!cached.quote)quote.items=templateItems(currentSystem());
showEditor();
database.then(readAll).then(items=>{records=items;renderPreview();syncArchive()}).catch(()=>{byId('status').textContent='History storage unavailable'});
