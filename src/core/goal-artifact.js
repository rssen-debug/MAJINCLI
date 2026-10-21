/**
 * MAJIN — independent artifact checks for explicit single-file goals.
 *
 * These checks DO NOT grade arbitrary natural language or claim a completed
 * project. They protect the common, measurable failure where a small LLM uses
 * fs.write against the wrong path, leaves out requested HTML elements, then
 * says "done". Unsupported/ambiguous goals return null (NOT VERIFIED).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TARGET = /(?<![\/\\\w.-])([\w-]+\.(?:txt|md|json|js|mjs|jsx|ts|tsx|html|css|py|csv|sol))\b/gi;

/** Only unambiguous BASENAMES under the MAJIN workspace are automatically checked. */
export function explicitTarget(input, workspace) {
  if (typeof input !== 'string' || typeof workspace !== 'string' || !workspace) return null;
  // Product/runtime names such as "Node.js" are not output artifacts.
  // Preserve lowercase "node.js" when the user deliberately names a file.
  const names = [...input.matchAll(TARGET)].map((m) => m[1])
    .filter((name) => name !== 'Node.js');
  const unique = [...new Set(names)];
  if (unique.length !== 1) return null;
  const name = unique[0];
  const root = path.resolve(workspace);
  const abs = path.resolve(root, name);
  if (path.dirname(abs) !== root) return null;
  return { name, path: abs, workspace: root };
}

export function inspectRequestedArtifact(input, workspace) {
  const target = explicitTarget(input, workspace);
  if (!target) return null; // ambiguous or unsupported; do not call it verified
  const missing = [];
  let data = '';
  try {
    const st = fs.statSync(target.path);
    if (!st.isFile()) missing.push('target is not a regular file');
    else if (st.size > 1024 * 1024) missing.push('file exceeds the 1 MiB verification cap');
    else data = fs.readFileSync(target.path, 'utf8');
  } catch {
    missing.push('named file is absent from the requested workspace path');
  }
  const lower = String(input).toLowerCase();
  if (!missing.length) {
    if (/\.html$/i.test(target.name)) {
      if (!/<html(?:\s|>)/i.test(data)) missing.push('HTML root element <html>');
      if (/\b(?:heading|rubrik)\b/i.test(input) && !/<h[1-6](?:\s|>)/i.test(data)) missing.push('requested heading');
      if (/\b(?:cta button|button|knapp)\b/i.test(input) && !/<button(?:\s|>)/i.test(data)) missing.push('requested HTML button');
      if (/\b(?:responsive|viewport)\b/i.test(input) && !/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(data)) missing.push('requested viewport meta element');
      if (/\b(?:style element|style tag|<style>)\b/i.test(lower) && !/<style(?:\s|>)/i.test(data)) missing.push('requested embedded <style> element');
      // A <style> tag that only styles the BODY does not fulfil "styled CTA
      // button". Require a rule for the button or an inline button style.
      if (/\bstyled\b.{0,30}\b(?:cta|button)\b/i.test(input) &&
          !/<button\b[^>]*\bstyle\s*=/i.test(data) &&
          !/(?:\bbutton(?:\.[\w-]+)?|\.cta|\.btn)\s*(?::[\w-]+)?\s*\{/i.test(data)) {
        missing.push('requested styled CTA button (missing button CSS rule or inline style)');
      }
    }
    // A regex match for "export respond" can never prove a working JS file:
    // real Qwen3B CI produced syntactically invalid CLI output but MAJIN
    // classified it as successful. Node's --check PARSES without executing
    // generated code. Never execute untrusted user code as proof here.
    if (/\.(?:mjs|js)$/i.test(target.name)) {
      const syntax = spawnSync(process.execPath, ['--check', target.path], {
        cwd: target.workspace, stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8', timeout: 3000, maxBuffer: 128 * 1024,
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      if (syntax.error || syntax.status !== 0) {
        missing.push('invalid JavaScript syntax (node --check failed; repair this file before claiming done)');
      }
    }
    if (/\.mjs$/i.test(target.name)) {
      const asksRespond = /\brespond\s*\(\s*message\s*\)/i.test(input);
      const asksExport = /\bexport\s+(?:a\s+)?(?:function\s+)?respond\b/i.test(input) ||
        /\bexport\s+function\s+respond/i.test(input);
      const asksCLI = /\bCLI\b|command.line\s+(?:entrypoint|interface)/i.test(input);
      const asksArgs = /\b(?:different|argument|process\.argv|QA_PING)\b/i.test(input);
      if (asksRespond && !/(?:function\s+respond\s*\(|(?:const|let)\s+respond\s*=)/i.test(data)) {
        missing.push('requested respond(message) implementation');
      }
      if (asksExport && !/(?:export\s+(?:async\s+)?function\s+respond\s*\(|export\s+(?:const|let)\s+respond\s*=)/i.test(data)) {
        missing.push('requested exported respond(message)');
      }
      if (asksCLI && !/(?:console\.log\s*\(|process\.stdout\.write\s*\()/i.test(data)) {
        missing.push('requested CLI output entrypoint');
      }
      if (asksCLI && asksArgs && !/process\.argv/i.test(data)) {
        missing.push('requested CLI argument handling (process.argv)');
      }
      if (/non.placeholder|helpful/i.test(input) && /(?:your response here|\bTODO\b|\bplaceholder\b)/i.test(data)) {
        missing.push('placeholder code is not a working response');
      }
    }
    const exact = /\bEXACTLY\s+(?:"([^"]{1,150})"|'([^']{1,150})'|([A-Za-z0-9_-]{3,150}))/i.exec(input);
    const wanted = exact?.[1] || exact?.[2] || exact?.[3];
    if (wanted && data.trim() !== wanted) missing.push('requested exact content differs');
  }
  return {
    ok: missing.length === 0,
    target: target.name,
    workspaceRelative: target.name,
    missing,
    reason: missing.length ? 'artifact contract failed: ' + missing.join('; ') : 'target artifact independently verified on disk',
  };
}


/**
 * Only for explicit, unambiguous SINGLE-FILE creation goals in the top-level
 * agent. If the model invents an absolute /tmp path or a different filename,
 * pin fs.write to the exact workspace-relative filename requested by the
 * user. This avoids stray writes while keeping arbitrary multi-file workflows
 * and user-explicit absolute paths untouched.
 *
 * Caller must separately prove the request is actionable and not read-only.
 */
export function pinSingleFileWrite(input, workspace, tool, args) {
  if (tool !== 'fs.write' || !args || typeof args.path !== 'string' || !args.path.trim()) return null;
  const target = explicitTarget(input, workspace);
  if (!target) return null;
  const attempted = path.resolve(target.workspace, args.path);
  if (attempted === target.path) return null;
  return {
    args: { ...args, path: target.name },
    originalPath: args.path,
    requestedPath: target.name,
    corrected: true,
    reason: 'single explicitly named output artifact is pinned to user-specified workspace basename',
  };
}


/**
 * Immediate WRITE-TIME proof for an explicit single JavaScript artifact.
 * When small LLMs write malformed CLI agents, waiting until their final answer
 * burns the turn budget on read/re-read loops. Give concrete, bounded evidence
 * IN the fs.write tool response so the model can repair in its NEXT action.
 *
 * This function never executes generated code: inspectRequestedArtifact uses
 * Node --check with a strict bound. Successful filesystem writes remain
 * successful tool calls, but they are NOT artifact completion proof.
 */
export function feedbackForJavaScriptWrite(goal, workspace, tool, args, writtenOk) {
  if (tool !== 'fs.write' || !writtenOk || !args || typeof args.path !== 'string') return null;
  const target = explicitTarget(goal, workspace);
  if (!target || !/\.(?:js|mjs)$/i.test(target.name)) return null;
  const actual = path.resolve(target.workspace, args.path);
  if (actual !== target.path) return null;
  const check = inspectRequestedArtifact(goal, workspace);
  if (!check) return null;
  return check.ok
    ? { ok: true, target: target.name,
        text: 'ARTIFACT WRITE CHECK: requested JavaScript file passed syntax and static contract checks (not yet execution-tested).' }
    : { ok: false, target: target.name,
        text: 'ARTIFACT WRITE CHECK FAILED for ' + target.name + ': ' +
          check.missing.join('; ').slice(0, 650) +
          '. Repair THIS SAME file using fs.write; do not claim done yet.' };
}
