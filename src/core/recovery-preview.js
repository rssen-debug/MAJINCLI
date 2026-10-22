/** Read-only restart preview; never invokes tools or mutates checkpoints. */
import { recoveryDecision } from './recovery-policy.js';
export function recoveryPreview(checkpoint) {
  const steps = checkpoint?.state?.steps;
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
  return { ready:true, steps:results };
}
