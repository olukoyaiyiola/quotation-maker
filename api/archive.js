// Vercel environment variables: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
// BUMICK_ARCHIVE_KEY. Keep all three server-side. One archive per installation.
const { timingSafeEqual, createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest();
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const {UPSTASH_REDIS_REST_URL:url,UPSTASH_REDIS_REST_TOKEN:token,BUMICK_ARCHIVE_KEY:key}=process.env;
  if(!url || !token || !key)return res.status(503).json({error:'Archive not configured'});
  if(!timingSafeEqual(hash(req.headers.authorization || ''),hash('Bearer '+key)))return res.status(401).end();
  async function redis(command){
    const result=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command)});
    const data=await result.json();if(!result.ok || data.error)throw Error('Storage failed');return data.result;
  }
  try{
    const index='bumick:archive:index';
    if(req.method==='GET'){
      const pairs=await redis(['HGETALL',index]);
      const list=[];for(let i=0;i<pairs.length;i+=2)list.push({ref:pairs[i],id:pairs[i+1]});
      return res.json(list);
    }
    if(req.method!=='POST')return res.status(405).end();
    const record=req.body || {},ref=record.lookup || record.ref;
    if(typeof ref!=='string' || !/^BNL\/Q\/[A-Z0-9]{1,16}\/\d{4}\/\d{3,}$/.test(ref))return res.status(400).end();
    const path='bumick:archive:record:'+ref;
    if(record.lookup){const value=await redis(['GET',path]);return value?res.json(JSON.parse(value)):res.status(404).end()}
    if(typeof record.id!=='string' || !Array.isArray(record.quote?.items) || !record.profile || record.quote.number!==ref)return res.status(400).end();
    const script="local id=redis.call('HGET',KEYS[1],ARGV[1]); if id then if id==ARGV[2] then return 1 else return 0 end end; redis.call('SET',KEYS[2],ARGV[3]); redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]); return 1";
    const ok=await redis(['EVAL',script,2,index,path,ref,record.id,JSON.stringify(record)]);
    return ok?res.json({saved:true}):res.status(409).end();
  }catch{return res.status(502).json({error:'Archive service unavailable'})}
};
