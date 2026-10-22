/** Compact read-only browser transcript for smaller cloud-model contexts.
 * Inspired by token-efficient accessibility snapshots, not a copied driver.
 * Keep early + late evidence and headings instead of unbounded page dumps.
 */
export function compactBrowserText(input,{maxChars=2600}={}){
  const cap=Math.max(400,Math.min(6000,Math.floor(Number(maxChars)||2600)));
  const rows=String(input||'').split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const unique=[];const seen=new Set();
  for(const row of rows){
    const key=row.toLocaleLowerCase().slice(0,180);
    if(!key||seen.has(key))continue;
    seen.add(key);unique.push(row);
  }
  const budget=Math.max(0,cap-180);
  const selected=[];
  let used=0;
  const take=(row)=>{
    if(used>=budget)return;
    const remaining=budget-used;
    if(remaining<30)return;
    const piece=row.slice(0,Math.min(remaining-1,450));
    if(piece){selected.push(piece);used+=piece.length+1;}
  };
  // Main content first, then late-page status/footer evidence, both bounded.
  for(const row of unique.slice(0,Math.min(28,unique.length)))take(row);
  if(unique.length>30 || unique.join('\n').length>budget){
    selected.push('… [middle page content omitted]');
    used+=34;
    for(const row of unique.slice(-8))take(row);
  }
  const result=selected.join('\n').slice(0,cap);
  return {text:result,originalChars:String(input||'').length,outputChars:result.length,
    linesRead:rows.length,uniqueLines:unique.length,truncated:result.length<String(input||'').length};
}
