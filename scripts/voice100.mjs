/* 100 deterministic simulated spoken-utterance intent cases.
 * Executes MAJIN's shipped voice-intent classifier in a VM, not a replacement
 * implementation. Does NOT test sound, STT, acoustic echo, TTS, or microphones.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={window:{}};vm.createContext(context);
vm.runInContext(readFileSync('src/ui/voice-intent.js','utf8'),context,{filename:'voice-intent.js'});
const classify=context.window.MAJIN_VOICE_INTENT.classify;
assert.equal(typeof classify,'function');
const cases=[];
for(let i=0;i<25;i++){
 cases.push({utterance:['nej','v\u00e4nta','stopp','avbryt','cancel'][i%5],busy:true,kind:'cancel'});
 cases.push({utterance:'nej v\u00e4nta \u00f6ppna '+(i+1)+' jobb',busy:true,kind:'replace',text:'\u00f6ppna '+(i+1)+' jobb'});
 cases.push({utterance:'s\u00f6k efter IT-jobb '+(i+1),busy:true,kind:'send'});
 cases.push({utterance:'jag s\u00e4ger nej till alternativ '+(i+1),busy:false,kind:'send'});
}
assert.equal(cases.length,100);
const results=cases.map((c,i)=>{
 try {
   const actual=classify(c.utterance,c.busy);
   assert.equal(actual.kind,c.kind);
   if(c.text)assert.equal(actual.text,c.text);
   return {id:i+1,pass:true,input:c.utterance,kind:c.kind};
 }catch(e){return {id:i+1,pass:false,input:c.utterance,error:e.message};}
});
const pass=results.filter(r=>r.pass).length;
const report={name:'Voice intent simulation',scope:'100 simulated transcripts; classifier only; no physical audio',passed:pass,total:100,results};
mkdirSync('work/quality',{recursive:true});
writeFileSync('work/quality/voice100.json',JSON.stringify(report,null,2));
process.stdout.write('Voice classifier simulated transcripts: '+pass+'/100 PASS\n');
if(pass!==100)process.exitCode=1;
