import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/core/agent.js';

test('agent plan persistence replaces journal atomically without stray temp files', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'majin-plan-journal-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const agent=Object.create(Agent.prototype);
 agent.plans=new Map([['demo',[{id:'first'}]]]);
 agent.bus={emit(){}};
 agent.planPath=()=>path.join(dir,'demo.plan.json');
 assert.equal(agent.persistPlan('demo'),true);
 agent.plans.set('demo',[{id:'second'}]);
 assert.equal(agent.persistPlan('demo'),true);
 assert.equal(JSON.parse(fs.readFileSync(agent.planPath(),'utf8')).plan[0].id,'second');
 assert.deepEqual(fs.readdirSync(dir),['demo.plan.json']);
 assert.equal(agent.lastPlanPersistError,null);
});

test('agent refuses a plan journal belonging to another session', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'majin-plan-owner-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const agent=Object.create(Agent.prototype);
 agent.plans=new Map();
 agent.planPath=()=>path.join(dir,'session.plan.json');
 fs.writeFileSync(agent.planPath(),JSON.stringify({session:'other',plan:[{id:'foreign'}]}));
 assert.equal(agent.loadPlan('current'),null);
 assert.equal(agent.plans.size,0);
});

test('agent refuses oversized plan journal before parsing', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'majin-plan-large-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const agent=Object.create(Agent.prototype);
 agent.plans=new Map();
 agent.planPath=()=>path.join(dir,'too-large.plan.json');
 fs.writeFileSync(agent.planPath(),'x'.repeat(1100000));
 assert.equal(agent.loadPlan('demo'),null);
 assert.equal(agent.plans.size,0);
});
