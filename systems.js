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
let archiveKey = sessionStorage.getItem('bumick-archive-key') || '';
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
// Allocate and save in one transaction so two tabs cannot issue the same reference.
async function saveRecord() {
  const db = await database, system = currentSystem(), year = currentYear();
  const snapshot = {id:crypto.randomUUID(),systemId:system.id,systemName:system.name,code:system.code,year,
    at:new Date().toISOString(),quote:structuredClone(quote),profile:structuredClone(profile)};
  if (archiveKey) {
    // Competing devices may calculate the same next number. Only the first
    // write can claim it. Re-read the archive before repeating a claim.
    let candidate = nextNumber(system, year, await readAll(db));
    const prefix = 'BNL/Q/' + system.code + '/' + year + '/';
    for (;;) {
      const manifest = await cloud('GET');
      for (const item of manifest) {
        if (item.ref.startsWith(prefix)) candidate = Math.max(candidate, Number(item.ref.slice(prefix.length)) + 1);
      }
      snapshot.serial = candidate;
      snapshot.ref = reference(system.code, year, candidate);
      snapshot.quote.number = snapshot.ref;
      try { await cloud('POST',snapshot); break; }
      catch (error) { if (error.status !== 409) throw error; candidate++; }
    }
    await new Promise((resolve,reject) => {
      const tx = db.transaction('records','readwrite');
      tx.objectStore('records').put(snapshot);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    return snapshot;
  }
  return new Promise((resolve,reject) => {
    const tx = db.transaction('records','readwrite'), store = tx.objectStore('records');
    const all = store.getAll();
    all.onsuccess = () => {
      snapshot.serial = nextNumber(system,year,all.result);
      snapshot.ref = reference(system.code,year,snapshot.serial);
      snapshot.quote.number = snapshot.ref;
      store.add(snapshot);
    };
    tx.oncomplete = () => resolve(snapshot);
    tx.onabort = () => reject(tx.error || Error('History could not be saved.'));
  });
}
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
  quote.systemId=e.target.value;
  refreshSystems(); update();
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
  quote.systemId=s.id;refreshSystems();update();byId('template').close();
};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
function showHistory() {
  const filter=byId('filter').value, term=byId('search').value.trim().toUpperCase();
  const matching=records.filter(r=>(!filter || r.systemId===filter) && r.ref.toUpperCase().includes(term))
    .sort((a,b)=>b.at.localeCompare(a.at));
  byId('record-list').replaceChildren(...matching.map(r=>{
    const b=document.createElement('button');b.className='record';b.textContent=r.ref;
    const sub=document.createElement('small');sub.textContent=[r.systemName,r.quote.client,dateLabel(r.quote.date)].filter(Boolean).join(' · ');
    b.append(sub);b.onclick=()=>{selectedRecord=r;byId('archive-paper').innerHTML=quotationHTML(r.quote,r.profile,r.systemName);byId('archive-view').showModal()};return b;
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
  try{records=await readAll(await database);historyFilters();showHistory();byId('records').showModal();if(archiveKey)syncArchive();}
  catch{alert('This browser could not open the quotation history.')}
};
byId('search').oninput=byId('filter').onchange=showHistory;

async function printRecord(r) {
  const paper=byId('paper-print');paper.innerHTML=quotationHTML(r.quote,r.profile,r.systemName);
  await Promise.all(Array.from(paper.querySelectorAll('img'), img => img.decode()));
  paper.classList.add('active');document.title=r.ref.replaceAll('/','-');
  const cleanup=()=>{paper.classList.remove('active');document.title='Bumick Quotation'};
  window.addEventListener('afterprint',cleanup,{once:true});window.print();
}
let issuing=false;
async function issue(mode) {
  if(issuing)return;
  if(!quote.items.some(i=>i.description.trim() && Number(i.qty)>0))return alert('Add an item with a name and quantity before issuing this quotation.');
  issuing=true;
  try{
    const r=await saveRecord();records=await readAll(await database);renderPreview();
    byId('status').textContent='Recorded '+r.ref;
    if(archiveKey)syncArchive();
    if(mode==='print')await printRecord(r);else await showImages(r);
  }catch(error){alert('Could not complete the export. Check Record history before retrying. '+error.message)}
  finally{issuing=false}
}
byId('print').onclick=()=>issue('print');byId('png').onclick=()=>issue('image');
byId('reprint').onclick=()=>printRecord(selectedRecord).catch(e=>alert(e.message));
byId('reimage').onclick=()=>showImages(selectedRecord).catch(e=>alert(e.message));
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'){e.preventDefault();if(byId('archive-view').open)byId('reprint').click();else issue('print')}});

async function cloud(method,body) {
  const res=await fetch('/api/archive',{method,headers:{Authorization:'Bearer '+archiveKey,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(!res.ok)throw Object.assign(Error(({401:'Check the archive access key.',409:'A different quotation already uses this reference in the cloud.',503:'Configure the private archive on Vercel first.'})[res.status] || 'Cloud archive unavailable.'),{status:res.status});
  return res.json();
}
let syncing=false;
async function syncArchive() {
  if(syncing || !archiveKey)return;
  syncing=true;
  try{
    const db=await database, manifest=await cloud('GET'), local=await readAll(db);
    const remote=new Map(manifest.map(x=>[x.ref,x.id])), localRefs=new Map(local.map(x=>[x.ref,x.id]));
    for(const r of local){
      if(remote.has(r.ref)&&remote.get(r.ref)!==r.id)throw Error('Reference conflict for '+r.ref+'. Both copies were preserved.');
      if(!remote.has(r.ref))await cloud('POST',r);
    }
    for(const item of manifest){
      if(localRefs.has(item.ref))continue;
      const r=await cloud('POST',{lookup:item.ref});
      await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').add(r);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
    }
    records=await readAll(db);historyFilters();showHistory();renderPreview();
    byId('cloud-message').textContent='Cloud archive is up to date.';
  }catch(e){byId('cloud-message').textContent=e.message;byId('status').textContent='Cloud sync pending · see history';}
  finally{syncing=false}
}
byId('connect').onclick=()=>{archiveKey=byId('archive-key').value.trim();if(!archiveKey)return;sessionStorage.setItem('bumick-archive-key',archiveKey);byId('archive-key').value='';syncArchive()};
byId('disconnect').onclick=()=>{archiveKey='';sessionStorage.removeItem('bumick-archive-key');byId('cloud-message').textContent='Disconnected.'};
window.addEventListener('online',syncArchive);
fillInputs('[data-q]','q',quote);fillInputs('[data-p]','p',profile);
refreshSystems();renderItems();update();
database.then(readAll).then(items=>{records=items;renderPreview();if(archiveKey)syncArchive()}).catch(()=>{byId('status').textContent='History storage unavailable'});
