/**
 * Browser task evidence, inspired by Playwright's assertions and agent-browser's
 * observe/act/verify separation. Evaluates read-only DOM state, never performs
 * an action or infers "success" from an HTTP 200 / successful click.
 */
export const VERIFY_JS = String.raw`((args) => {
  const selector = args.selector || '';
  let el = null, count = 0;
  try {
    if (selector) {
      const matches = document.querySelectorAll(selector);
      count = matches.length;
      // A non-unique selector cannot prove which element the agent observed.
      if (count === 1) el = matches[0];
    }
  } catch { return { valid: false, reason: 'invalid_selector' }; }
  const visible = (node) => {
    if (!node) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  // No inputs, password values, page HTML, cookies or tokens are returned.
  const text = el ? String(el.innerText || el.textContent || '') : '';
  const state = { valid: true, url: location.href, title: document.title,
    exists: selector ? count > 0 : null, unique: selector ? count === 1 : null,
    matchCount: selector ? Math.min(count, 1000) : null, visible: selector ? visible(el) : null,
    checked: el?.matches?.('input[type="checkbox"],input[type="radio"]') ? !!el.checked : null,
    enabled: el ? !el.matches(':disabled,[aria-disabled="true"],[inert]') && !el.closest('[inert]') : null,
    textMatch: args.text ? text.toLowerCase().includes(args.text.toLowerCase()) : null,
    urlMatch: args.url ? location.href.includes(args.url) : null,
    titleMatch: args.title ? document.title.toLowerCase().includes(args.title.toLowerCase()) : null,
  };
  return state;
})(__MAJIN_ARGS__)`;

export function verificationCriteria(input = {}) {
  const selector = String(input.selector || '').trim().slice(0, 350);
  const text = String(input.text || '').trim().slice(0, 200);
  const url = String(input.url || '').trim().slice(0, 350);
  const title = String(input.title || '').trim().slice(0, 200);
  const present = ['true','false'].includes(String(input.present)) ? String(input.present) === 'true' : null;
  const checked = ['true','false'].includes(String(input.checked)) ? String(input.checked) === 'true' : null;
  const enabled = ['true','false'].includes(String(input.enabled)) ? String(input.enabled) === 'true' : null;
  if (!selector && !url && !title) return { ok:false, reason:'Specify a selector, URL fragment or title fragment to verify' };
  if ((text || present !== null || checked !== null || enabled !== null) && !selector) return {ok:false, reason:'Element text, presence and checkbox checks require selector'};
  if (checked !== null && !selector) return {ok:false, reason:'Checkbox assertion requires selector'};
  if (present === false && (text || checked !== null || enabled !== null))
    return {ok:false, reason:'An absent element cannot also have matching text or checkbox state'};
  return { ok:true, selector, text, url, title, present, checked, enabled };
}

export function verifyObserved(criteria, observed) {
  if (!criteria?.ok) return {ok:false, reason:criteria?.reason || 'invalid_expectation'};
  if (!observed?.valid) return {ok:false, reason:observed?.reason || 'observation_failed'};
  const assertions = [];
  if (criteria.selector) {
    assertions.push({name:'element_present', expected:criteria.present ?? true, actual:observed.exists === true});
    if (criteria.present !== false) {
      assertions.push({name:'element_unique',expected:true,actual:observed.unique === true});
      assertions.push({name:'element_visible',expected:true,actual:observed.visible === true});
      if (criteria.text) assertions.push({name:'element_text_contains',expected:true,actual:observed.textMatch === true});
      if (criteria.checked !== null) assertions.push({name:'checkbox_checked',expected:criteria.checked,actual:observed.checked});
      if (criteria.enabled !== null) assertions.push({name:'element_enabled',expected:criteria.enabled,actual:observed.enabled});
    }
  }
  if (criteria.url) assertions.push({name:'url_contains',expected:true,actual:observed.urlMatch === true});
  if (criteria.title) assertions.push({name:'title_contains',expected:true,actual:observed.titleMatch === true});
  const failures = assertions.filter(x=>x.expected!==x.actual);
  return {ok:failures.length===0,assertions,failures,
    observed:{url:String(observed.url||'').slice(0,500),title:String(observed.title||'').slice(0,200),
      matchCount:Number.isInteger(observed.matchCount) ? observed.matchCount : null}};
}

/**
 * Bounded, deterministic recovery suggestions for observed DOM assertions.
 * Inspired by the evidence-first retry patterns in ReliableAgent / pi-reflect:
 * errors should explain the next DIFFERENT observation, never blindly retry.
 */
export function browserRecoveryAdvice(failures = []) {
  const names = new Set((Array.isArray(failures) ? failures : []).map(x => String(x?.name || '')));
  if (names.has('element_unique')) return {code:'ambiguous_selector',
    next:'The selector matched multiple elements. Use browser.elements, choose a unique visible ref or more specific selector, then verify again.'};
  if (names.has('element_present')) return {code:'element_missing',
    next:'The expected element is absent. Read the current page and URL, then find the element actually shown; do not repeat the same click.'};
  if (names.has('element_visible')) return {code:'element_hidden',
    next:'Element exists but is hidden. Inspect overlays, tabs and expanded sections before a different action.'};
  if (names.has('checkbox_checked') || names.has('element_enabled')) return {code:'state_mismatch',
    next:'The control state does not match. Re-observe its live state and any validation or consent prerequisites.'};
  if (names.has('url_contains') || names.has('title_contains')) return {code:'navigation_mismatch',
    next:'The browser is on a different page than expected. Read URL/title, check redirect or new tab, and update navigation strategy.'};
  if (names.has('element_text_contains')) return {code:'content_mismatch',
    next:'The element is present but its visible text differs. Read that element to diagnose missing save, loading state, or actual error.'};
  if (names.has('stable_duration')) return {code:'transient_success',
    next:'Success was visible only briefly. Inspect the page after rerender before claiming the task succeeded.'};
  return {code:'unverified_result',next:'Re-observe the current page and choose a different evidence-based step.'};
}
