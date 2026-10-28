import fs from 'node:fs';
import path from 'node:path';
import { JobStore, loadProfiles } from '../src/v6/jobs/store.js';
const home=process.env.MAJIN_V6_HOME||'C:/Users/Ghost/AppData/Local/MAJIN/v6-merged479-state';
const outFile='C:/Users/Ghost/Desktop/Jobbradar-Lavinia-jobindex-cph.json';
const queries=['content creator','social media','digital marketing','marketing','kommunikation','influencer','video','e-handel'];
const cph=/(københavn|koebenhavn|kbh|frederiksberg|amager|valby|hvidovre|hellerup|lyngby|gentofte|gladsaxe|rødovre|brøndby|ballerup|taastrup|ishøj|tårnby|dragør|søborg|virum|nærum|charlottenlund|klampenborg|storkøbenhavn)/i;
const good=/(content|social|marketing|brand|kommunik|communication|copywrit|creator|video|design|e-commerce|ecommerce|seo|influencer|ugc|community|\bpr\b)/i;
const bad=/(senior|director|leder|projektleder|assistent|sundhed|sygeplej|pædagog|lærer|studerende|student|studentermedhj|praktik|intern\b|trainee|lead\b|manager|direktør|direktor|head\b|chef\b|relocate|greece|abroad|store manager|assistant store|massage|cleaner|driver|sales advisor|therapist|warehouse|tour guide|travel counselor|nurse|teacher|accountant|engineer|developer|technician|receptionist|waiter|barista|security|logistics|caregiver|fisioterap|physio|optician|dentist|pharmac|lawyer|jurist|økonom|power trader|investment associate|game artist|ui designer|product designer|art director|ledsager|indkøb|procurement|skadebehandler|analyst|automation)/i;
function strip(html){ return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ').trim(); }
async function search(q,page){ const url=`https://www.jobindex.dk/jobsoegning?q=${encodeURIComponent(q)}&page=${page}`; const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36','accept-language':'da-DK,da;q=0.9,en;q=0.8'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const html=await r.text(); const m=html.match(/Stash = (\{[\s\S]*?\});/); if(!m) throw new Error('no Stash'); const data=JSON.parse(m[1]); return data['jobsearch/result_app/list']?.storeData?.searchResponse?.results||[]; }
const jobs=[]; const notes=[]; const seen=new Set();
for(const q of queries){
 for(const page of [1,2]){
  try{
   const list=await search(q,page); notes.push(`${q} p${page}: ${list.length}`);
   for(const j of list){
    const title=strip(j.headline); const company=j.company?.name||j.companytext||'Jobindex'; const city=j.area||j.addresses?.[0]?.city||'';
    if(!title||!good.test(title)||bad.test(title)) continue;
    if(!cph.test(city+' '+(j.addresses?.map(a=>a.city).join(' ')||''))) continue;
    const tid=j.tid||j.id; if(!tid||seen.has(tid)) continue; seen.add(tid);
    const url=j.share_url||`https://www.jobindex.dk/jobannonce/${tid}`;
    jobs.push({site:'jobindex',siteId:String(tid),title,company,city,country:'DK',url,apply:j.app_apply_url?{url:j.app_apply_url}:{url},description:strip(j.html).slice(0,12000),deadline:j.apply_deadline||null,published:j.firstdate||null,mustHave:[],niceToHave:[],source:'jobindex'});
   }
  }catch(e){ notes.push(`${q} p${page}: ERROR ${e.message}`); }
 }
}
const profiles=loadProfiles(path.join(home,'jobs','profiles.json')); if(!profiles.ok) throw new Error(profiles.error.reason);
const store=new JobStore({file:path.join(home,'jobs','applications.json')}); let created=0,existing=0;
for(const job of jobs){ const r=await store.upsertDiscovered(job,'lavinia'); if(r.created) created++; else existing++; }
const payload={generatedAt:new Date().toISOString(),queries,matched:jobs.length,imported:created,existing,notes,jobs}; fs.writeFileSync(outFile,JSON.stringify(payload,null,2),'utf8');
console.log(JSON.stringify({matched:jobs.length,imported:created,existing,outFile,notes,sample:jobs.slice(0,12)},null,2));
