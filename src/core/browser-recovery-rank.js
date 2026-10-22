/**
 * Safe, deterministic browser recovery suggestions.
 * Inspired by Playwright MCP accessible locators: use observed labels/IDs,
 * never guess selectors or automatically click a likely match.
 */
const terms = s => String(s || '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);

export function rankRecoveryControls(requested, controls, {limit=4}={}){
  const raw=String(requested||'').slice(0,300);
  const target=new Set(terms(raw).filter(t=>t.length>1));
  if(!target.size||!Array.isArray(controls))return [];
  const options=[];
  for(const c of controls.slice(0,60)){
    const selector=String(c?.selector||'');
    // These are the only selector forms emitted by VISIBLE_CONTROLS_JS.
    if(!/^#[A-Za-z][\w-]{0,62}$/.test(selector) &&
       !/^(input|textarea|button|select)\[name="[A-Za-z][\w-]{0,62}"\]$/.test(selector))continue;
    if(['password','hidden','file'].includes(String(c?.type||'').toLowerCase()))continue;
    const label=String(c?.label||'').slice(0,80);
    const tokens=new Set(terms([selector,label,c?.tag,c?.type].join(' ')));
    let overlap=0;
    for(const term of target)if(tokens.has(term))overlap++;
    const matched=overlap/target.size;
    // Require common words, not vague similarity. A low-score suggestion
    // can waste time or trigger wrong actions, so omit it altogether.
    if(matched<.4||overlap<1)continue;
    options.push({selector,label,score:Math.round(matched*100),disabled:Boolean(c?.disabled)});
  }
  return options.sort((a,b)=>b.score-a.score||a.selector.localeCompare(b.selector)).slice(0,Math.max(0,Math.min(limit,8)));
}
export function formatRecoverySuggestions(requested,controls){
  const ranked=rankRecoveryControls(requested,controls);
  if(!ranked.length)return '';
  return '\nPossible CURRENT page controls (not clicked, verify before using):\n'+
    ranked.map(x=>'- '+x.selector+' — '+x.label+' ('+x.score+'% keyword overlap)').join('\n')+
    '\nRefresh browser.elements if the page changed. Do NOT guess a selector or blindly repeat the failed click.';
}
