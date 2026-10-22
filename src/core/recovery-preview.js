/** Read-only restart preview; never invokes tools or mutates checkpoints. */
import { recoveryDecision } from './recovery-policy.js';
export function recoveryPreview(checkpoint) {
  if (checkpoint?.schema !== 1 || typeof checkpoint?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(checkpoint.id)) return { ready:false, reason:'invalid-checkpoint', steps:[] };
  const steps = checkpoint.state?.steps;
  if (!Array.isArray(steps)) return { ready:false, reason:'no-steps', steps:[] };
  if (steps.length > 1000) return { ready:false, reason:'too-many-steps', steps:[] };
  const seen = new Set();
  const results = [];
  for (const [index, step] of steps.entries()) {
    const id = typeof step?.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(step.id) ? step.id : null;
    if (!id || seen.has(id)) return { ready:false, reason:'invalid-or-duplicate-step-id', steps:[] };
    seen.add(id);
    const decision = recoveryDecision(step);
    results.push({ index, id, action: decision.action, reason: decision.reason });
  }
  const counts = { resume:0, skip:0, inspect:0, approval:0 };
  for (const step of results) counts[step.action]++;
  return { ready:true, counts, steps:results };
}
