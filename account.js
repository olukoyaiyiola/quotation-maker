'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const params=new URLSearchParams(location.hash.slice(1));
  const setup=params.has('admin-setup');
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  let invite=params.get('invite');
  if(setup){
    invite=sessionStorage.getItem('bumick-setup-token')||hex(crypto.getRandomValues(new Uint8Array(32)));
    sessionStorage.setItem('bumick-setup-token',invite);
    const note=document.createElement('label'),code=document.createElement('input');
    note.textContent='Administrator setup ID. Send this ID to the project owner for approval.';
    code.readOnly=true;code.onclick=()=>code.select();note.append(code);el('signin').prepend(note);
    crypto.subtle.digest('SHA-256',new TextEncoder().encode(invite)).then(value=>{code.value=hex(new Uint8Array(value))});
  }
  if(invite){
    if(!setup)history.replaceState(null,'',location.pathname);
    el('auth-title').textContent='Activate your invitation and choose a password (at least 12 characters).';
    el('auth-submit').textContent='Activate account';
    el('account-email').value=setup?'adekunleadelani170@gmail.com':params.get('email')||'';
    el('account-password').autocomplete='new-password';
  }
  async function request(body){
    const res=await fetch('/api/account',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Object.assign(Error(data.error||'Please sign in or try again.'),{status:res.status});
    return data;
  }
  el('signin').onsubmit=async e=>{
    e.preventDefault();el('auth-submit').disabled=true;
    try{
      await request({action:invite?'activate':'login',email:el('account-email').value,password:el('account-password').value,invite});
      sessionStorage.removeItem('bumick-setup-token');
      location.replace(location.pathname);
    }catch(err){el('auth-message').textContent=err.message;el('auth-submit').disabled=false}
  };
  async function start(){
    const session=await request();
    window.companySession=session;
    for(const src of ['app.js','systems.js','image-export.js']){
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.onload=resolve;script.onerror=reject;script.src=src;document.body.append(script)});
    }
    const admin=session.account.role==='admin';
    const apply=remote=>{
      if(!remote)return;
      for(const key of Object.keys(profile))delete profile[key];
      Object.assign(profile,remote);fillInputs('[data-p]','p',profile);renderPreview();
    };
    async function refresh(){
      const latest=await request();
      if(!el('profile').open)apply(latest.profile);
    }
    window.refreshCompany=refresh;
    el('signout').onclick=async()=>{try{await request({action:'logout'});location.reload()}catch(err){alert(err.message)}};
    for(const input of document.querySelectorAll('[data-p],[data-image],[data-clear]'))input.disabled=!admin;
    el('team').hidden=!admin;
    el('team').onclick=()=>{el('invite-result').hidden=true;el('invites').showModal()};
    el('invite-form').onsubmit=async e=>{
      e.preventDefault();
      try{
        const email=el('invite-email').value.trim(),result=await request({action:'invite',email});
        const url=new URL(location.pathname,location.origin);url.hash=new URLSearchParams({invite:result.invite,email});
        el('invite-link').value=url.href;el('invite-result').hidden=false;el('invite-link').select();el('invite-status').textContent='';
      }catch(err){el('invite-result').hidden=true;el('invite-status').textContent=err.message}
    };
    const onError=err=>{if(err.status===401)location.reload();else el('status').textContent=err.message};
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(onError)});
    window.addEventListener('focus',()=>refresh().catch(onError));
    el('profile-status').textContent=admin?'Save to update the company profile on all devices.':'Your administrator manages this profile.';
    if(admin){
      el('done').textContent='Save company profile';
      el('done').onclick=async()=>{
        try{await request({action:'profile',profile});persist();el('profile').close();el('status').textContent='Company profile synced.'}
        catch(err){el('profile-status').textContent=err.message}
      };
      el('profile').addEventListener('close',()=>refresh().catch(onError));
    }
    document.body.classList.remove('locked');
    if(admin&&!session.profile)el('profile').showModal();
  }
  if(!invite)start().catch(err=>{if(err.status!==401)el('auth-message').textContent=err.message||'Unable to load the app.'});
})();
