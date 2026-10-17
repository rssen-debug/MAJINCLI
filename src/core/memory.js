/**
 * MAJIN — memory + skills.
 * Plain files in the data dir: facts.md (vem användaren är), events.jsonl (vad som hänt),
 * skills/*.md (hur man gör saker). Agenten skriver i dem själv — det är hela "vuxen"-delen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dirs, resolveData } from './paths.js';
import { bus } from './log.js';

const stop = new Set(['och', 'att', 'det', 'som', 'för', 'med', 'den', 'the', 'and', 'this', 'that', 'with', 'from', 'jag', 'du', 'pa', 'på', 'av', 'en', 'et', 'at', 'är', 'ar', 'har', 'ha', 'ska', 'borde', 'kunde']);

function words(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

function tokenize(s) {
  return new Set(words(s));
}

export class Memory {
  constructor(cfg) {
    this.cfg = cfg;
    this.dir = resolveData(cfg?.get('memory.dir'), dirs.memory);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  get factsFile() {
    return path.join(this.dir, 'facts.md');
  }

  get eventsFile() {
    return path.join(this.dir, 'events.jsonl');
  }

  facts() {
    try {
      return fs
        .readFileSync(this.factsFile, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2));
    } catch {
      return [...(this.cfg.get('memory.facts') || [])];
    }
  }

  remember(text, tags = []) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean) return { ok: false, why: 'tom text' };
    const existing = this.facts();
    const tk = tokenize(clean);
    const dup = existing.findIndex((f) => {
      const ek = tokenize(f);
      const inter = [...tk].filter((w) => ek.has(w)).length;
      return ek.size && inter / Math.max(1, new Set([...tk, ...ek]).size) > 0.75;
    });
    const line = dup >= 0 ? `- ${clean}${tags.length ? ` \`${tags.join('` \`')}\`` : ''}` : `- ${clean}${tags.length ? ` \`${tags.join('` \`')}\`` : ''}`;
    if (dup >= 0) existing[dup] = line.replace(/^- /, '- ');
    else existing.unshift(line);
    const capped = existing.slice(0, this.cfg?.get('memory.maxNotes') || 400);
    fs.writeFileSync(this.factsFile, `# Minnen\n\n${capped.join('\n')}\n`);
    bus.info('memory.remember', { dup: dup >= 0, chars: clean.length });
    return { ok: true, count: capped.length, replaced: dup >= 0 ? clean : null, file: this.factsFile };
  }

  forget(query) {
    const existing = this.facts();
    const q = tokenize(query);
    const keep = existing.filter((f) => {
      const k = tokenize(f.replace(/^- /, ''));
      const inter = [...q].filter((w) => k.has(w)).length;
      return !(inter >= 1 && inter / Math.max(1, q.size) > 0.5);
    });
    fs.writeFileSync(this.factsFile, `# Minnen\n\n${keep.join('\n')}\n`);
    return { ok: true, removed: existing.length - keep.length };
  }

  event(type, data = {}) {
    try {
      fs.appendFileSync(this.eventsFile, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n');
    } catch (err) {
      bus.debug('memory.event.failed', { error: err.message });
    }
    return { ok: true };
  }

  recall(query, k = 8) {
    const q = tokenize(query);
    if (!q.size) return [];
    const scored = this.facts()
      .map((f) => {
        const t = tokenize(f);
        let s = 0;
        for (const w of q) if (t.has(w)) s += 1;
        return { text: f, score: s / Math.max(3, t.size) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  recentEvents(n = 12) {
    try {
      const lines = fs.readFileSync(this.eventsFile, 'utf8').trim().split('\n').filter(Boolean).slice(-n);
      return lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { type: 'raw', text: l.slice(0, 200) };
        }
      });
    } catch {
      return [];
    }
  }

  digest() {
    const cap = this.cfg?.get('memory.digestChars') || 2200;
    const facts = this.facts().slice(0, 40);
    const events = this.recentEvents(8);
    const lines = [
      facts.length ? `Knows about the user:\n${facts.map((f) => `- ${f}`).join('\n')}` : '',
      events.length ? `Senaste:\n${events.map((e) => `- ${e.type}: ${String(e.summary || e.text || e.msg || '').slice(0, 120)}`).join('\n')}` : '',
    ].filter(Boolean);
    const out = lines.join('\n\n');
    return out.length > cap ? `${out.slice(0, cap)}\n…` : out;
  }

  stats() {
    return { facts: this.facts().length, events: this.recentEvents(1000).length, dir: this.dir };
  }
}

/* ------------------------------- skills ----------------------------------- */

const FRONT = /^---\n([\s\S]*?)\n---\n?/;

export class Skills {
  constructor(cfg) {
    this.cfg = cfg;
    this.dir = resolveData(cfg?.get('skills.dir'), dirs.skills);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list() {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const raw = fs.readFileSync(path.join(this.dir, f), 'utf8');
          const m = FRONT.exec(raw);
          const meta = {};
          if (m) {
            for (const line of m[1].split('\n')) {
              const i = line.indexOf(':');
              if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            }
          }
          return { file: f, name: meta.name || f.replace(/\.md$/, ''), when: meta.when || '', tools: meta.tools || '', steps: raw.replace(FRONT, '').trim(), meta };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  save({ name, when, steps, tools = '' }) {
    const slug = String(name || 'skill')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    if (!slug) return { ok: false, why: 'namnet gick inte att skriva till filnamn' };
    const file = path.join(this.dir, `${slug}.md`);
    const body = `---\nname: ${name}\nwhen: ${when || ''}\ntools: ${Array.isArray(tools) ? tools.join(', ') : tools || ''}\nupdated: ${new Date().toISOString()}\n---\n${(steps || '').trim()}\n`;
    fs.writeFileSync(file, body);
    bus.info('skill.save', { name: slug, file });
    return { ok: true, file, name: slug };
  }

  match(text, k = 4) {
    const q = tokenize(text);
    if (!q.size) return [];
    return this.list()
      .map((s) => {
        const t = tokenize(`${s.name} ${s.when}`);
        let score = 0;
        for (const w of q) if (t.has(w)) score += 1;
        return { ...s, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  prompt() {
    const max = this.cfg?.get('skills.maxInPrompt') || 12;
    const list = this.list().slice(0, max);
    if (!list.length) return '';
    return `Learned skills (follow them when they fit):\n${list.map((s) => `- ${s.name} — ${s.when}\n${s.steps.split('\n').slice(0, 12).map((l) => `    ${l}`).join('\n')}`).join('\n')}`;
  }
}

export { tokenize, words };
