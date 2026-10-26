#!/usr/bin/env node
// MAJIN OpenCode parallel task launcher (local-only data, no GitHub uploads).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const base=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'MAJIN','opencode-multi');
const tasks=path.join(base,'tasks');
const notes=path.join(base,'instructions.txt');
const cmd=process.argv[2];
const arg=process.argv.slice(3);
const ensure=()=>fs.mkdirSync(tasks,{recursive:true});
const taskPath=id=>path.join(tasks,id+'.json');
function readTask(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid task ID');return JSON.parse(fs.readFileSync(taskPath(id),'utf8'));}
function save(t){ensure();const dest=taskPath(t.id),tmp=dest+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(t,null,2),{mode:0o600});fs.renameSync(tmp,dest);}
function noteText(){return fs.existsSync(notes)?fs.readFileSync(notes,'utf8').slice(0,24000):'';}
function promptText(t){const owner=noteText();return ['You are working on one independent task in MAJIN using OpenCode. Follow the owner instructions. Never assume an external action succeeded without a receipt. Do not repeat job applications or skip explicit owner exclusions. If email verification is pending, inspect authorized Gmail tools and resume safely; if blocked, record the blocker and continue other independent work. Never print or commit secrets, CVs, verification codes or private email bodies.','OWNER CORRECTIONS (persistent):',owner||'(none)','TASK:',t.prompt].join('\n\n');}
function launch(prompt){
 if(!prompt.trim())throw Error('Enter a request');
 const t={id:randomUUID(),prompt,createdAt:new Date().toISOString(),status:'queued',workdir:process.cwd()};
 ensure();save(t);
 const child=spawn(process.execPath,[new URL(import.meta.url).pathname,'__worker',t.id],{cwd:t.workdir,detached:true,windowsHide:true,stdio:'ignore',env:process.env});
 child.unref();
 console.log('Task '+t.id+' started; use status / log '+t.id);
}
async function worker(id){
 const t=readTask(id),log=path.join(tasks,id+'.log');t.status='running';t.startedAt=new Date().toISOString();save(t);
 const out=fs.openSync(log,'a',0o600);
 const exe=process.platform==='win32'?'opencode.cmd':'opencode';
 const args=['run',promptText(t)];
 try {
  const p=spawn(exe,args,{cwd:t.workdir,env:process.env,shell:process.platform==='win32',windowsHide:true,stdio:['ignore',out,out]});
  const code=await new Promise((res,rej)=>{p.once('error',rej);p.once('exit',(c,signal)=>res(c??(signal?130:1)));});
  t.status=code===0?'finished':'failed';t.exitCode=code;
 }catch(e){t.status='failed';t.error=String(e.message).slice(0,300);}
 finally{t.endedAt=new Date().toISOString();save(t);fs.closeSync(out);}
}
try {
 if(cmd==='__worker')await worker(arg[0]);
 else if(cmd==='start')launch(arg.join(' '));
 else if(cmd==='from-file'){const filename=arg[0];if(!filename)throw Error('Provide a UTF-8 file path');launch(fs.readFileSync(filename,'utf8'));}
 else if(cmd==='remember'){const correction=arg.join(' ').trim();if(!correction||correction.length>5000)throw Error('Correction must be 1–5000 characters');ensure();fs.appendFileSync(notes,'- '+new Date().toISOString()+': '+correction.replace(/[\r\n]+/g,' ')+'\n',{mode:0o600});console.log('Correction saved locally for future tasks.');}
 else if(cmd==='memory')console.log(noteText()||'(no owner corrections)');
 else if(cmd==='status'){ensure();const items=fs.readdirSync(tasks).filter(x=>/^[a-f0-9-]{36}\.json$/.test(x)).map(x=>JSON.parse(fs.readFileSync(path.join(tasks,x),'utf8'))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));for(const t of items.slice(0,40))console.log(t.id+'  '+t.status+'  '+t.prompt.slice(0,85).replace(/\s+/g,' '));}
 else if(cmd==='log'){const t=readTask(arg[0]);const log=path.join(tasks,t.id+'.log');console.log(fs.existsSync(log)?fs.readFileSync(log,'utf8').slice(-16000):'No output yet');}
 else if(cmd==='followup'){const t=readTask(arg[0]);const msg=arg.slice(1).join(' ');if(!msg.trim())throw Error('Follow-up text required');launch('Follow-up to prior task '+t.id+': '+t.prompt+'\nOwner says: '+msg+'\nCheck actual filesystem/logs and previous effects; never duplicate external actions.');}
 else console.log('Usage:\n node scripts/v5/opencode-multi.mjs start "task"\n node scripts/v5/opencode-multi.mjs from-file "prompt.txt"\n node scripts/v5/opencode-multi.mjs status\n node scripts/v5/opencode-multi.mjs log TASK_ID\n node scripts/v5/opencode-multi.mjs followup TASK_ID "new instructions"\n node scripts/v5/opencode-multi.mjs remember "persistent correction"\n node scripts/v5/opencode-multi.mjs memory');
}catch(e){console.error('MAJIN multi: '+e.message);process.exitCode=1;}
