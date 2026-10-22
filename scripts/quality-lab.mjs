/**
 * MAJIN V1 quality lab: bounded, reproducible quality gate.
 * Nothing in this report claims real microphone, speaker or live-provider validation.
 * Run: node scripts/quality-lab.mjs [--quick]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const quick=process.argv.includes('--quick');
const output=process.env.MAJIN_QUALITY_DIR || path.join('work','quality');
const checks=[
  {name:'Unit / integration / security',command:['npm','test'],timeout:180000,kind:'automated'},
  {name:'Static syntax',command:['npm','run','check'],timeout:60000,kind:'automated'},
  {name:'Localization',command:['npm','run','i18n'],timeout:60000,kind:'automated'},
  {name:'Agent deterministic benchmark',command:['node','scripts/bench.mjs','--json'],timeout:180000,kind:'mock-model'},
  {name:'100 simulated voice transcripts',command:['node','scripts/voice100.mjs'],timeout:60000,kind:'classifier-simulation'},
  {name:'50 scripted end-to-end agent tasks',command:['node','scripts/bench.mjs','--matrix50','--json'],timeout:180000,kind:'mock-agent-50-distinct-fixtures'},
  ...(!quick?[{name:'Real Chromium UI',command:['npm','run','test:ui'],timeout:180000,kind:'headless-browser'}]:[]),
];
const manuallyRequired=[
 {name:'Swedish/English microphone + speaker end-to-end',status:'NOT_TESTED',reason:'Needs actual audio hardware and acoustic verification'},
 {name:'Real provider accuracy and price',status:'NOT_TESTED',reason:'Mock-model benchmark cannot measure live model quality'},
 {name:'Desktop control outside sandbox',status:'NOT_TESTED',reason:'Requires isolated Windows machine with guarded actions'},
 {name:'Long-session CPU/RAM and audio interruption',status:'NOT_TESTED',reason:'Needs measured long-running Windows hardware session'},
 {name:'Fresh install/update/uninstall executable',status:'NOT_TESTED',reason:'Verified separately by Windows release workflow'},
];
function execute(check){
 return new Promise(resolve=>{
  const start=Date.now();
  const [exe,...args]=check.command;
  let stdout='',stderr='',finished=false;
  const child=spawn(process.platform==='win32'&&exe==='npm'?'npm.cmd':exe,args,{shell:false,env:{...process.env,CI:'1'},stdio:['ignore','pipe','pipe']});
  const capture=(field,chunk)=>{
   const text=String(chunk);
   if(field==='out')stdout=(stdout+text).slice(-12000);
   else stderr=(stderr+text).slice(-12000);
  };
  child.stdout.on('data',d=>capture('out',d));child.stderr.on('data',d=>capture('err',d));
  const timer=setTimeout(()=>{if(!finished)child.kill('SIGKILL')},check.timeout);
  child.on('error',e=>{stderr+=e.message;done(null)});
  child.on('close',code=>done(code));
  function done(code){
   if(finished)return;finished=true;clearTimeout(timer);
   resolve({name:check.name,kind:check.kind,status:code===0?'PASS':'FAIL',exitCode:code,durationMs:Date.now()-start,stdout,stderr});
  }
 });
}
await mkdir(output,{recursive:true});
const results=[];
for(const check of checks){
 process.stdout.write('Running '+check.name+'...\n');
 const result=await execute(check);results.push(result);
 process.stdout.write('  '+result.status+' ('+result.durationMs+' ms)\n');
}
const passed=results.filter(x=>x.status==='PASS').length;
const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'MAJIN V1',mode:quick?'quick':'full',verdict:passed===results.length?'PASS':'FAIL',automated:{passed,total:results.length,checks:results},manual:manuallyRequired};
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
const rows=results.map(x=>'| '+x.name+' | '+x.status+' | '+x.durationMs+' |').join('\n');
const manual=manuallyRequired.map(x=>'| '+x.name+' | '+x.status+' | '+x.reason+' |').join('\n');
const markdown='# MAJIN V1 Quality Lab\n\n**Automated verdict: '+report.verdict+' ('+passed+'/'+results.length+')**. Headless and mock-model tests do not prove full real-world readiness.\n\n| Automated test | Result | Milliseconds |\n|---|---|---:|\n'+rows+'\n\n| Requires separate evidence | Status | Reason |\n|---|---|---|\n'+manual+'\n';
await writeFile(path.join(output,'report.md'),markdown);
process.stdout.write('\n'+markdown);
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,markdown,{flag:'a'});
process.exitCode=passed===results.length?0:1;
