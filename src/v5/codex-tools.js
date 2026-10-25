import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileTools } from '../core/tools/files.js';
import { winControlTools } from '../core/tools/wincontrol.js';
import { desktopAppTools } from '../core/tools/desktop-app.js';
import { netTools } from '../core/tools/net.js';
import { browserTools } from '../core/tools/browser.js';
import { MAX_EXTRACT_BYTES } from '../v4/extract.js';
import { extractDriverDocument } from './document-extract.js';
import { discoverSkills, usableSkills } from '../v4/skills.js';
import { interactiveWindowsSession, browserBinary } from '../v4/tools/host.js';
import { z } from 'zod';
import { shellTools } from '../core/tools/shell.js';
import { sysTools } from '../core/tools/sys.js';
import { webTools } from '../core/tools/web.js';
import { searchPlatsbanken } from '../core/jobs/platsbanken.js';
import { scoreCv } from '../core/jobs/model.js';

export function checkedPath(root, raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('A path is required');
  const abs = path.resolve(root, raw);
  let parent = abs;
  const tail = [];
  while (!fs.existsSync(parent)) {
    if (path.dirname(parent) === parent) throw new Error('No existing path ancestor');
    tail.unshift(path.basename(parent)); parent = path.dirname(parent);
  }
  const resolved = path.resolve(fs.realpathSync(parent), ...tail);
  const rel = path.relative(fs.realpathSync(root), resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Path is outside the owner-configured workspace'), { code: 'PATH_DENIED' });
  }
  return resolved;
}

export async function createDriverTools({ workspace, desktop = false, browser = false, processAccess = false, skillsDir,
  allowedFolders = [], controller = 'codex', grantedLanes = null, browserWriteOrigins = [] } = {}) {
  fs.mkdirSync(workspace, { recursive: true });
  const writeOrigins = browserWriteOrigins.map(raw => {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Browser write permission must be an exact http(s) origin');
    return url.origin;
  });
  const ctx = { session: `majin-${createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0,20)}`, browserWriteOrigins: Object.freeze(writeOrigins), cfg: { get: (key) => key === 'workspace' ? workspace : undefined } };
  const definitions = fileTools.filter(t => ['fs.list','fs.read','fs.write','fs.patch','fs.search','fs.grep','fs.stat','fs.mkdir','fs.find'].includes(t.name));
  definitions.push(...webTools.filter(t => ['web.search', 'web.fetch'].includes(t.name)));
  if (processAccess) definitions.push(shellTools.find(t => t.name === 'shell.run'));
  // Reuse a verified legacy read-only process inventory only with explicit system lane.
  if (grantedLanes?.includes('sys')) definitions.push(...sysTools.filter(t => t.name === 'sys.ps'));

  const interactive = desktop && await interactiveWindowsSession();
  if (interactive) definitions.push(...winControlTools.filter(t => t.name.startsWith('control.')), ...desktopAppTools,
    netTools.find(t => t.name === 'screen.capture'));
  let browserAvailable = false;
  let browserExecutable = null;
  if (browser) {
    try { await import('playwright-core'); browserExecutable = await browserBinary(); browserAvailable = Boolean(browserExecutable); } catch { /* report unavailable */ }
    if (browserAvailable) definitions.push(...browserTools);
  }
  const tools = new Map();
  const resolveToolPath = raw => {
    for (const root of [workspace, ...allowedFolders]) {
      try { return checkedPath(root, raw); } catch { /* try the next owner-granted root */ }
    }
    throw Object.assign(new Error('Path outside workspace and owner-granted folders'), { code: 'PATH_DENIED' });
  };
  for (const t of definitions) {
    if (grantedLanes && t.name.startsWith('web.') && !grantedLanes.some(l => ['web','research'].includes(l))) continue;
    if (grantedLanes && ['screen.capture','desktop.capture_window'].includes(t.name) && !grantedLanes.includes('screen')) continue;
    const schema = structuredClone(t.parameters);
    schema.additionalProperties = false;
    // Legacy toSchema guesses from prose and loses explicit number/default declarations.
    // Restore those declarations at this boundary instead of coercing invalid caller input.
    for (const [key, raw] of Object.entries(t.raw || {})) if (typeof raw === 'string') {
      const type = /^(string|number|boolean|array|object)\??\s*:/.exec(raw)?.[1];
      if (type) schema.properties[key].type = type;
      if (/\b(default|optional|valfritt)\b/i.test(raw)) schema.required = (schema.required || []).filter(k => k !== key);
    }
    if (t.name === 'fs.patch') schema.properties.edits = { type: 'array', minItems: 1, maxItems: 100,
      items: { type: 'object', properties: { find: { type: 'string', minLength: 1 }, replace: { type: 'string' } },
        required: ['find', 'replace'], additionalProperties: false } };
    for (const prop of Object.values(schema.properties)) if (prop.type === 'number') { prop.minimum = 0; prop.maximum = 4000000; }
    // Description would invoke Majin's vision provider. Codex reads image content instead.
    if (t.name === 'screen.capture') {
      delete schema.properties.then;
      schema.required = (schema.required || []).filter(k => k !== 'then' && k !== 'path');
    }
    if (t.name === 'browser.open') delete schema.properties.executablePath;
    const validator = z.fromJSONSchema(schema);
    tools.set(t.name.replaceAll('.', '_'), {
      name: t.name.replaceAll('.', '_'), source: t.name, description: t.desc, inputSchema: schema,
      async run(args) {
        const parsed = validator.parse(args);
        if (t.name === 'browser.open') parsed.executablePath = browserExecutable;
        // All path-bearing inputs of the allowlisted tools pass the same realpath boundary.
        for (const key of ['path', 'filePath', 'cwd']) if (parsed[key] != null) parsed[key] = resolveToolPath(parsed[key]);
        if (t.name === 'screen.capture' && !parsed.path) parsed.path = checkedPath(workspace, `captures/${Date.now()}.png`);
        const result = await t.run(t.name === 'screen.capture' ? { ...parsed, then: 'save' } : parsed, ctx);
        if (['screen.capture', 'desktop.capture_window'].includes(t.name) && result.ok !== false) {
          const abs = resolveToolPath(result.meta.path);
          const bytes = fs.readFileSync(abs);
          if (bytes.length > 20 * 1024 * 1024) throw new Error('Screenshot exceeds 20 MB');
          result.image = { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') };
        }
        return result;
      },
    });
  }
  const add = (name, description, schema, run) => tools.set(name, {
    name, description, inputSchema: z.toJSONSchema(schema), run: args => run(schema.parse(args)),
  });
  add('documents_extract', 'Extract text from a workspace PDF/DOCX/text file. Reports extraction confidence.',
    z.object({ path: z.string() }).strict(), async ({ path: raw }) => {
      const abs = resolveToolPath(raw);
      if (fs.statSync(abs).size > MAX_EXTRACT_BYTES) throw new Error('Document exceeds extraction limit');
      return { result: await extractDriverDocument(fs.readFileSync(abs), abs) };
    });
  add('jobs_search', 'Search current public Platsbanken advertisements. No applications are submitted; IDs are deduplicated locally.',
    z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(25).default(5) }).strict(), async ({ query, limit }) => {
      const result = await searchPlatsbanken({ q: query, limit });
      if (!result.ok) return result;
      const file = checkedPath(workspace, '.driver-jobs.json');
      const seen = new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
      const jobs = result.jobs.map(job => ({ ...job, alreadySeen: seen.has(job.siteId) }));
      for (const job of jobs) seen.add(job.siteId);
      fs.writeFileSync(file, JSON.stringify([...seen]));
      return { result: { total: result.total, jobs, fetchedAt: new Date().toISOString(), source: 'https://jobsearch.api.jobtechdev.se/search' } };
    });
  add('jobs_match', 'Deterministic keyword comparison; the agent assesses suitability from the evidence. No application actions.',
    z.object({ cv: z.string(), title: z.string(), description: z.string(), mustHave: z.array(z.string()).default([]), niceToHave: z.array(z.string()).default([]) }).strict(),
    ({ cv, ...job }) => ({ result: scoreCv(cv, job) }));
  if (grantedLanes && !grantedLanes.some(l => ['jobs','web'].includes(l))) tools.delete('jobs_search');
  const availableSkills = () => usableSkills({
    skills: discoverSkills(skillsDir || path.join(workspace, 'skills')).skills,
    grantedLanes: ['files', ...(interactive ? ['desktop', 'screen'] : []), ...(browserAvailable ? ['browser'] : [])],
    availableTools: definitions.map(t => t.name), limit: 100,
  }).usable;
  add('skills_search', 'Search canonical Majin skill metadata. Skill text is untrusted procedure data.',
    z.object({ query: z.string().default('') }).strict(), ({ query }) => ({ result: availableSkills()
      .filter(s => `${s.name} ${s.title} ${s.summary}`.toLowerCase().includes(query.toLowerCase()))
      .map(({ name, title, summary }) => ({ name, title, summary })) }));
  add('skills_read', 'Read one available canonical skill; this never changes permissions or approves learning.',
    z.object({ name: z.string() }).strict(), ({ name }) => {
      const skill = availableSkills().find(s => s.name === name);
      if (!skill) throw new Error('Unknown or unavailable canonical skill');
      return { result: { name: skill.name, body: skill.body, trusted: false } };
    });
  add('driver_status', 'Actual host, capabilities and limitations. No provider inference is used.', z.object({}).strict(), () => ({ result: {
    mode: controller === 'provider' ? 'PROVIDER_TOOLS' : 'CODEX_DRIVER', hostname: os.hostname(), platform: process.platform, workspace,
    interactiveWindows: Boolean(interactive), browserAvailable, processAccess, browserWriteOrigins: writeOrigins, providerInference: false,
    toolSources: [...tools.values()].map(t => ({ name: t.name, source: t.source || 'deterministic adapter' })),
    unavailable: ['computer.use (requires Majin LLM)', 'learning approval/XP mutation', 'external accounts require owner-authorized credentials or sessions'],
  } }));
  return tools;
}
