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

const TARGET = /(?<![\/\\\w.-])([\w-]+\.(?:txt|md|json|js|mjs|jsx|ts|tsx|html|css|py|csv|sol))\b/gi;

/** Only unambiguous BASENAMES under the MAJIN workspace are automatically checked. */
export function explicitTarget(input, workspace) {
  if (typeof input !== 'string' || typeof workspace !== 'string' || !workspace) return null;
  const names = [...input.matchAll(TARGET)].map((m) => m[1]);
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
