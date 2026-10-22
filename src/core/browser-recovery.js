/**
 * Deterministic browser recovery guidance. Model input is limited to observed
 * assertions and the selector provided by the user/model; no page secrets.
 * Inspired by Playwright MCP's fresh snapshots after a stale page state.
 */
export function explainVerifyFailure(criteria, failures=[]) {
  const issues=new Set(failures.map(f=>f.name));
  const steps=[];
  if(issues.has('element_present') || issues.has('element_visible')){
    steps.push('The target is absent or hidden. Call browser.elements({refresh:"true",query:'+
      JSON.stringify(String(criteria.selector||'').slice(0,70))+ '}) to ground CURRENT controls, or browser.read to inspect the page.');
  }
  if(issues.has('url_contains') || issues.has('title_contains')){
    steps.push('Navigation did not reach the expected page. Inspect browser.read and the live URL; look for redirects, login, or a popup before deciding to act again.');
  }
  if(issues.has('element_text_contains')){
    steps.push('The element exists but the requested text was not observed. Inspect browser.read({selector:'+
      JSON.stringify(String(criteria.selector||'').slice(0,100))+'}) rather than claiming success.');
  }
  if(issues.has('checkbox_checked')||issues.has('element_enabled')){
    steps.push('The control state did not match. Refresh browser.elements and verify enabled/checked state before another interaction.');
  }
  if(issues.has('stable_duration')){
    steps.push('Expected state appeared only briefly. The UI may be re-rendering; verify a persistent final state instead of a transient animation.');
  }
  if(!steps.length)steps.push('Take a fresh browser.elements snapshot and compare observed page state with the requested outcome.');
  steps.push('Do not repeat an identical click blindly and never report completion without a passing verification.');
  return steps.join(' ');
}
