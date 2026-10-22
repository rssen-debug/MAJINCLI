/** Assemble a conservative recovery preview from persisted steps.
 * This is a read-only plan, not an executor.
 */
import { recoveryDecision } from './recovery-policy.js';
export function recoveryPreview(checkpoint) {
  const steps=checkpoint?.state?.steps;
  if (!Array.isArray(steps)) return { ready:false, reason:'no-steps', steps:[] };
  if (steps.length>1000) return { ready:false, reason:'too-many-steps', steps:[] };
  return { ready:true, steps:steps.map((step,index)=>({
    index, id:typeof step?.id==='string'?step.id:null,...recoveryDecision(step),
  })) };
}
