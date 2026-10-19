/**
 * MAJIN — subagent.
 * Eget huvud, egna verktyg, ingen historik, litet stegbudschet. Används för
 * parallellt gräv (triagea tre filer, kolla två hypoteser) utan att förorena main.
 */
import { loop } from './loop.js';
import { routeFor } from './router.js';

export async function run({ cfg, task, job = 'tasks', maxSteps = 10, registry, session, emit, memory, providerErrorCap = 4, providerRetries = null }) {
  const route = routeFor(cfg, job);
  const messages = [
    {
      role: 'system',
      content: [
        `You are a subagent inside ${cfg.get('name')}. You get one bounded task and deliver a compressed factual answer — no conversation, no self-narratelse.`,
        `Tools: ${registry.list().length} available, all on. Job: ${job}, model: ${route?.ref || 'default'}.`,
        'Work quietly: run tools, gather evidence, then answer with 3-12 lines: what you found, paths/values, uncertainties.',
        memory?.digest?.() ? `Context from memory:\n${memory.digest().slice(0, 900)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    { role: 'user', content: String(task).slice(0, 6000) },
  ];
  const res = await loop({
    cfg,
    registry,
    messages,
    job,
    maxSteps,
    usage: null,
    ctx: { session: `${session}:sub`, emit: (e) => emit?.({ ...e, sub: true }) },
    onEvent: (e) => emit?.({ ...e, sub: true }),
    label: 'sub',
    providerErrorCap,
    providerRetries,
  });
  return { text: res.text, steps: res.steps, tools: res.toolLog.map((t) => t.tool), usage: res.usage, error: res.error };
}
