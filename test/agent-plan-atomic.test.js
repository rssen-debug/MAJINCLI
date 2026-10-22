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
