import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repairLiteralEscapedNewlineCliWrite, inspectRequestedArtifact } from '../src/core/goal-artifact.js';

const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'majin-escaped-newline-'));
const name='agent-qwen.mjs';
const goal='Actually create agent-qwen.mjs. Export function respond(message) and implement a working CLI entrypoint using process.argv and a different runtime argument. No external dependencies.';
const known = "export function respond(message) { return `Received: ${message}`; }\\nconsole.log(respond(process.argv[2] || \"\"));";

test('known Qwen escaped-newline source is repaired to working dynamic ESM',()=>{
  const r=repairLiteralEscapedNewlineCliWrite(goal,workspace,'fs.write',{path:name,content:known});
  assert.equal(r?.corrected,true);
  const out=path.join(workspace,name);
  fs.writeFileSync(out,r.args.content);
  assert.equal(inspectRequestedArtifact(goal,workspace).ok,true);
  const check=spawnSync(process.execPath,['--check',out],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
  const a=spawnSync(process.execPath,[out,'QA_PING_ONE'],{encoding:'utf8'});
  const b=spawnSync(process.execPath,[out,'QA_OTHER_TWO'],{encoding:'utf8'});
  assert.equal(a.status,0,a.stderr); assert.equal(b.status,0,b.stderr);
  assert.equal(a.stdout.trim(),'Received: QA_PING_ONE');
  assert.equal(b.stdout.trim(),'Received: QA_OTHER_TWO');
});

test('refuses unrelated source or goals instead of editing arbitrary user code',()=>{
  const bad=[
    known+'\nconsole.log("side effect");',
    known.replace('return `Received: ${message}`','return `hardcoded`'),
    known.replace('console.log','eval'),
    known.replace('export function','function'),
    'console.log("unrelated");',
  ];
  for(const content of bad)assert.equal(repairLiteralEscapedNewlineCliWrite(goal,workspace,'fs.write',{path:name,content}),null);
  assert.equal(repairLiteralEscapedNewlineCliWrite(goal+' Also create other.mjs',workspace,'fs.write',{path:name,content:known}),null);
  assert.equal(repairLiteralEscapedNewlineCliWrite(goal,workspace,'fs.write',{path:'other.mjs',content:known}),null);
  assert.equal(repairLiteralEscapedNewlineCliWrite(goal,workspace,'fs.read',{path:name,content:known}),null);
});
