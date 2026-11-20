const {redis,user,token,digest,sessionKey,profileKey} = require('../lib/accounts');
const {scrypt,randomBytes,timingSafeEqual} = require('node:crypto');
const derive = require('node:util').promisify(scrypt);
const admin = 'adekunleadelani170@gmail.com';
const sessionAge = 7 * 86400;
const cookie = (value,age) => '__Host-bumick='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
module.exports = async function(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  try {
    if(req.method==='GET'){
      const account=await user(req);
      if(!account)return res.status(401).end();
      return res.json({account,profile:JSON.parse(await redis('GET',profileKey))});
    }
    if(req.method!=='POST')return res.status(405).end();
    if(!/^application\/json\b/i.test(req.headers['content-type']||''))return res.status(415).end();
    const {action,password,invite,profile}=req.body||{};
    const email=String(req.body?.email||'').trim().toLowerCase();
    if(action==='logout'){
      const key=sessionKey(req);
      if(key)await redis('DEL',key);
      res.setHeader('Set-Cookie',cookie('',0));return res.json({ok:true});
    }
    if(action==='login'||action==='activate'){
      if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254||typeof password!=='string'||password.length<12||password.length>256)return res.status(400).json({error:'Enter your email and a password of 12 to 256 characters.'});
      const rateKey='bumick:attempts:'+digest(email);
      const count=await redis('EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n",1,rateKey);
      if(count>20)return res.status(429).json({error:'Too many attempts. Try again in ten minutes.'});
      const key='bumick:user:'+email;
      if(action==='activate'){
        if(typeof invite!=='string'||!/^[a-f0-9]{64}$/.test(invite))return res.status(403).end();
        const salt=randomBytes(16).toString('hex');
        const hash=(await derive(password,salt,64)).toString('hex');
        const created=await redis('EVAL',"if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('EXISTS',KEYS[2])==1 then return 0 end; redis.call('SET',KEYS[2],ARGV[2]); redis.call('DEL',KEYS[1]); return 1",2,'bumick:invite:'+digest(invite),key,email,JSON.stringify({salt,hash}));
        if(!created)return res.status(403).json({error:'Invitation invalid, expired, or already used.'});
      }else{
        const saved=JSON.parse(await redis('GET',key));
        const actual=await derive(password,saved?.salt||'unused-account',64);
        if(!saved||!timingSafeEqual(actual,Buffer.from(saved.hash,'hex')))return res.status(401).json({error:'Check your email and password.'});
      }
      const account={email,role:email===admin?'admin':'staff'},sid=token();
      await redis('SET','bumick:session:'+digest(sid),JSON.stringify(account),'EX',sessionAge);
      res.setHeader('Set-Cookie',cookie(sid,sessionAge));return res.json({ok:true});
    }
    const account=await user(req);
    if(account?.role!=='admin')return res.status(403).end();
    if(action==='invite'){
      if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254||email===admin)return res.status(400).end();
      if(await redis('EXISTS','bumick:user:'+email))return res.status(409).json({error:'This person already has an account.'});
      const invite=token();await redis('SET','bumick:invite:'+digest(invite),email,'EX',86400);
      return res.json({invite});
    }
    if(action==='profile'){
      if(!profile||typeof profile.name!=='string'||!profile.name.trim()||!['NGN','USD','GBP','EUR','GHS'].includes(profile.currency))return res.status(400).json({error:'Enter a company name and currency.'});
      const clean={};
      for(const field of ['name','currency','phone','email','address','signer','signerPosition','logo','signature']){
        const value=profile[field];if(value==null||value==='')continue;
        const image=field==='logo'||field==='signature';
        if(typeof value!=='string'||value.length>(image?1500000:4000)||(image&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)))return res.status(400).json({error:'Invalid company profile field: '+field});
        clean[field]=value;
      }
      await redis('SET',profileKey,JSON.stringify(clean));return res.json({ok:true});
    }
    return res.status(400).end();
  }catch{return res.status(503).json({error:'Company service unavailable. Please retry.'})}
};
