const {user,profileKey} = require('../lib/accounts');
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const {UPSTASH_REDIS_REST_URL:url,UPSTASH_REDIS_REST_TOKEN:token}=process.env;
  if(!url || !token)return res.status(503).json({error:'Archive not configured'});
  async function redis(command){
    const result=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command)});
    const data=await result.json();if(!result.ok || data.error)throw Error('Storage failed');return data.result;
  }
  try{
    const account=await user(req);
    if(!account)return res.status(401).end();
    if(req.method==='POST' && !/^application\/json\b/i.test(req.headers['content-type']||''))return res.status(415).end();
    const index='bumick:archive:index';
    if(req.method==='GET'){
      const [pairs,versions]=await redis(['EVAL',"return {redis.call('HGETALL',KEYS[1]),redis.call('HGETALL',KEYS[2])}",2,index,index+':versions']);
      const revisions=new Map();for(let i=0;i<versions.length;i+=2)revisions.set(versions[i],versions[i+1]);
      const list=[];for(let i=0;i<pairs.length;i+=2)list.push({ref:pairs[i],id:pairs[i+1],version:revisions.get(pairs[i])});
      return res.json(list);
    }
    if(req.method!=='POST')return res.status(405).end();
    const record=req.body || {},ref=record.lookup || record.ref;
    if(typeof ref!=='string' || !/^BNL\/Q\/[A-Z0-9]{1,16}\/\d{4}\/\d{3,}$/.test(ref))return res.status(400).end();
    const path='bumick:archive:record:'+ref;
    if(record.lookup){const value=await redis(['GET',path]);return value?res.json(JSON.parse(value)):res.status(404).end()}
    if(typeof record.id!=='string' || !Array.isArray(record.quote?.items) || !record.profile || record.quote.number!==ref)return res.status(400).end();
    const official=JSON.parse(await redis(['GET',profileKey]));
    if(!official)return res.status(409).json({error:'Ask the administrator to save the company profile first.'});
    if(account.role!=='admin' && Object.keys({...official,...record.profile}).some(k=>official[k]!==record.profile[k]))return res.status(409).json({error:'The company profile has changed. Refresh before saving.'});
    const script = `
      local existing = redis.call('GET', KEYS[2])
      if existing then
        local old = cjson.decode(existing)
        if old.id ~= ARGV[2] then return 0 end
        if (old.version or '') == ARGV[4] then return 1 end
        if old.status ~= 'draft' or old.version ~= ARGV[5] then return 0 end
      end
      redis.call('SET', KEYS[2], ARGV[3])
      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      redis.call('HSET', KEYS[3], ARGV[1], ARGV[4])
      return 1
    `;
    const ok=await redis(['EVAL',script,3,index,path,index+':versions',ref,record.id,JSON.stringify(record),record.version || '',record.baseVersion || '']);
    return ok?res.json({saved:true}):res.status(409).end();
  }catch{return res.status(502).json({error:'Archive service unavailable'})}
};
