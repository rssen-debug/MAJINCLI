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
  // Reserve tail space whenever the unique content exceeds the character budget,
  // even if the page has fewer than thirty rows.
  const hasTail=unique.length>30 || unique.join('\n').length>budget;
  const marker='… [middle page content omitted]';
  const tail=hasTail?unique.slice(-3):[];
  const reserve=hasTail?Math.min(450,Math.floor(budget*.4)):0;
  const headLimit=budget-reserve-marker.length-1;
  if(hasTail){
    for(const row of unique.slice(0,Math.max(0,unique.length-3)).slice(0,28)){
      if(used>=headLimit)break;
      const remaining=headLimit-used;
      if(remaining<30)break;
      const piece=row.slice(0,Math.min(remaining-1,450));
      selected.push(piece);used+=piece.length+1;
    }
    selected.push(marker);used+=marker.length+1;
    for(const row of tail)take(row.slice(0,110));
  } else {
    for(const row of unique)take(row);
  }
  const result=selected.join('\n').slice(0,cap);
  return {text:result,originalChars:String(input||'').length,outputChars:result.length,
    linesRead:rows.length,uniqueLines:unique.length,truncated:result.length<String(input||'').length};
}
