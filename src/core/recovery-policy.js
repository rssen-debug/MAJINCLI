/** Deterministic recovery policy: never assume an external side effect happened. */
export function recoveryDecision(step) {
  if (!step || typeof step !== 'object') return { action: 'inspect', reason: 'missing-step' };
  if (step.status === 'verified' && step.evidence && typeof step.evidence === 'string') {
    return { action: 'skip', reason: 'verified-evidence' };
  }
  if (step.status === 'running' || step.status === 'uncertain') {
    return { action: 'inspect', reason: 'outcome-unknown' };
  }
  if (step.risk === 'write' || step.risk === 'destructive' || step.risk === 'external') {
    return { action: 'approval', reason: 'side-effect-risk' };
  }
  if (step.status === 'pending' && step.risk === 'read') {
    return { action: 'resume', reason: 'safe-read' };
  }
  return { action: 'inspect', reason: 'unclassified' };
}
