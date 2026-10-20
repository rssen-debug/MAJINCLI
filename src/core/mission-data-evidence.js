/**
 * Verify cross-file data lineage for an explicit "ALL job IDs from JSON
 * to Markdown" mission. A model cannot replace source identifiers with
 * Job1/Job2 placeholders and claim the output is verified.
 * Unsupported/ambiguous formats return null, NOT a fictional PASS.
 */
import fs from 'node:fs';
import path from 'node:path';
const SOURCE = /(?<![\w./\\-])([\w.-]+\.json)\b/gi;
const TARGET = /(?<![\w./\\-])([\w.-]+\.md)\b/gi;

export function verifyJobIdLineage(goal, workspace) {
  const prompt = String(goal || '');
  const root = typeof workspace === 'string' ? path.resolve(workspace) : '';
  if (!root || !/\ball\s+(?:(?:three|two|four|five|\d+)\s+)?job\s+ids?\b/i.test(prompt)) return null;
  const sources = [...new Set([...prompt.matchAll(SOURCE)].map(m => m[1]))];
  const outputs = [...new Set([...prompt.matchAll(TARGET)].map(m => m[1]))];
  if (sources.length !== 1 || outputs.length !== 1) return null;
  const src = path.resolve(root, sources[0]), dst = path.resolve(root, outputs[0]);
  if (path.dirname(src) !== root || path.dirname(dst) !== root) return null;
  const base = { type: 'job_id_lineage', source: sources[0], output: outputs[0] };
  let data;
  try { data = JSON.parse(fs.readFileSync(src, 'utf8')); }
  catch { return { ...base, ok: false, missing: [], reason: 'source JSON missing or invalid' }; }
  const jobs = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : null;
  if (!jobs?.length || jobs.length > 100 || !jobs.every(j => typeof j?.id === 'string' && j.id.trim())) {
    return { ...base, ok: false, missing: [], reason: 'source has no valid job ID collection' };
  }
  const ids = [...new Set(jobs.map(j => j.id.trim()))];
  const titles = [...new Set(jobs.filter(j => typeof j.title === 'string' && j.title.trim()).map(j => j.title.trim()))];
  let output;
  try { output = fs.readFileSync(dst, 'utf8'); }
  catch { return { ...base, ok: false, missing: ids, reason: 'target Markdown is absent' }; }
  const hasWholeId = id => {
    const index = output.indexOf(id);
    if (index < 0) return false;
    const before = output[index - 1] || '', after = output[index + id.length] || '';
    return !/[\w-]/.test(before) && !/[\w-]/.test(after);
  };
  const missing = ids.filter(id => !hasWholeId(id));
  const missingTitles = titles.filter(title => !output.includes(title));
  const ok = missing.length === 0 && missingTitles.length === 0;
  return { ...base, ok, count: ids.length, missing, missingTitles,
    reason: ok ? 'all source IDs and titles independently found in output' :
      'source-identifier integrity failed: ' + missing.length + ' missing IDs, ' + missingTitles.length + ' missing titles' };
}
