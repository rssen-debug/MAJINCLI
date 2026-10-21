/**
 * MAJIN strategy recovery.
 *
 * Recover exactly once when an agent repeats a previously FAILED action.
 * Never re-execute the repeated action, never override permissions, and never
 * treat a changed prompt as proof of progress. The next model step must choose
 * an observably different tool/action; otherwise the existing watchdog stops.
 *
 * Uses no framework, model weights or additional services on the user's PC.
 */
const BROWSER=/^browser\./;
const FILE=/^fs\./;
const EXEC=/^(?:exec\.|shell\.|sys\.)/;

export function recoveryHint(name, error='') {
  const tool=String(name||'tool').slice(0,70);
  const reason=String(error||'operation failed').slice(0,360);
  const method=BROWSER.test(tool)
    ? 'Read the current page state or take a fresh screenshot. Check the URL, visible elements and blockers. Select a NEW grounded target; do not retry the same coordinates or selector.'
    : FILE.test(tool)
      ? 'Inspect the actual filesystem path, permissions and existing content. Check the artifact independently before attempting a corrected write.'
      : EXEC.test(tool)
        ? 'Inspect exit code and stderr. Check the working directory, environment and dependencies, then use a materially different command.'
        : 'Observe the current state with a read-only tool and select a different evidence-based action.';
  return [
    'RECOVERY REQUIRED: Your identical tool action already FAILED and was NOT executed again.',
    'Tool: '+tool+'. Previous failure: '+reason+'.',
    method,
    'You have ONE corrective strategy turn. Do not repeat the same call or claim completion.',
    'If no safe alternative is possible, explain the blocker accurately.'
  ].join(' ');
}

export class RecoveryBudget {
  constructor(max=1){this.max=Math.max(0,Math.min(2,Number(max)||0));this.used=0;}
  assess({tool,key,toolLog=[]}={}){
    const k=String(key||'');
    const previous=[...toolLog].reverse().find(x=>x?.tool===tool && x?.repeatKey===k);
    if(!previous || previous.ok || this.used>=this.max){
      return {recover:false,why:previous?.ok?'duplicate successful action':this.used>=this.max?'recovery exhausted':'no matching failed action'};
    }
    this.used++;
    return {recover:true,attempt:this.used,remaining:this.max-this.used,hint:recoveryHint(tool,previous.error)};
  }
}
