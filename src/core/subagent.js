/**
 * LENT — subagent.
 * Eget huvud, egna verktyg, ingen historik, litet stegbudschet. Används för
 * parallellt gräv (triagea tre filer, kolla två hypoteser) utan att förorena main.
 */
import { loop } from './loop.js';
import { routeFor } from './router.js';

export async function run({ cfg, task, job = 'tasks', maxSteps = 10, registry, session, emit, memory }) {
  const route = routeFor(cfg, job);
  const messages = [
    {
      role: 'system',
      content: [
        `Du är en subagent inom ${cfg.get('name')}. Du får en avgränsad uppgift och levererar ett komprimerat faktasvar — ingen konversation, ingen självberättelse.`,
        `Verktyg: ${registry.list().length} tillgängliga, alla på. Jobb: ${job}, modell: ${route?.ref || 'default'}.`,
        'Jobba tyst: kör verktyg, samla bevis, svara sedan med 3–12 rader: vad du hittade, sökvägar/värden, osäkerheter.',
        memory?.digest?.() ? `Kontext från minnet:\n${memory.digest().slice(0, 900)}` : '',
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
  });
  return { text: res.text, steps: res.steps, tools: res.toolLog.map((t) => t.tool), usage: res.usage, error: res.error };
}
