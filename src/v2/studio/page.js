/**
 * MAJIN V2 Studio — operator surface, inline single-file page.
 *
 * Zero external assets BY CONSTRUCTION: the tool-approval rule for this
 * project forbids CDN scripts/styles/fonts (they would also break the
 * offline/Windows-first story). Everything the page needs ships in this
 * string. Read-only: the scaffold observes; operator WRITE actions arrive in
 * a later lane behind the existing consent gate (never silently here).
 */

export const STUDIO_VERSION = '0.1.0-scaffold';

export function renderStudioPage({ title = 'MAJIN V2 Studio' } = {}) {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;--bg:#0b0e12;--panel:#12161d;--line:#232a35;--fg:#d7dde6;--dim:#8b95a3;--ok:#3fcf8e;--bad:#f26d6d;--warn:#e8b44a;--accent:#5aa2ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:baseline}
header h1{font-size:16px;margin:0;color:var(--accent)}
header .tag{color:var(--dim);font-size:12px}
main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 16px}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;min-height:180px}
section h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:0 0 8px}
#audit .ok{color:var(--ok)} #audit .broken{color:var(--bad)}
#audit .head{color:var(--dim);word-break:break-all;font-size:11px}
#events{grid-column:1/-1;max-height:44vh;overflow:auto}
.row{font-size:12px;border-bottom:1px solid var(--line);padding:3px 0;display:flex;gap:8px}
.row .t{color:var(--dim);white-space:nowrap}
.row .k{color:var(--accent);min-width:140px}
.row .p{color:var(--fg);opacity:.85;word-break:break-all}
.kv{display:flex;justify-content:space-between;font-size:12px;border-bottom:1px solid var(--line);padding:3px 0}
.kv span:last-child{color:var(--accent)}
#conn{font-size:11px;color:var(--warn)}
#conn.live{color:var(--ok)}
.empty{color:var(--dim);font-size:12px}
</style>
</head>
<body>
<header>
  <h1>MAJIN V2 Studio</h1>
  <span class="tag">read-only scaffold v${STUDIO_VERSION} · observing real kernel surfaces</span>
  <span id="conn">connecting…</span>
</header>
<main>
  <section id="audit">
    <h2>Audit chain</h2>
    <div id="audit-body" class="empty">loading…</div>
  </section>
  <section id="telemetry">
    <h2>Telemetry (7 days)</h2>
    <div id="telemetry-body" class="empty">loading…</div>
  </section>
  <section id="events">
    <h2>Live events</h2>
    <div id="events-body"><div class="empty">waiting for events…</div></div>
  </section>
</main>
<script>
(function(){
  var MAX_ROWS = 200;
  var conn = document.getElementById('conn');
  var evBody = document.getElementById('events-body');

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

  fetch('/api/audit/verify').then(function(r){return r.json()}).then(function(v){
    var b=document.getElementById('audit-body');
    b.className='';
    if(v.ok){
      b.innerHTML='<div class="ok">AUDIT ok — '+v.entries+' entries</div>'+
        '<div class="head">head '+esc((v.head||'').slice(0,32))+'…</div>';
    } else {
      b.innerHTML='<div class="broken">AUDIT broken — line '+esc(v.brokenAt)+' reason '+esc(v.reason)+'</div>'+
        '<div class="head">'+esc(v.detail||'')+'</div>';
    }
  }).catch(function(e){
    document.getElementById('audit-body').textContent='audit endpoint error: '+e.message;
  });

  fetch('/api/telemetry?days=7').then(function(r){return r.json()}).then(function(t){
    var b=document.getElementById('telemetry-body');
    b.className='';
    var rows=[];
    rows.push(['shards', (t.from||'—')+' → '+(t.to||'—')]);
    rows.push(['events', t.events]);
    rows.push(['goals (finished)', t.goals.count+' ('+(t.goals.completedRate*100).toFixed(0)+'% completed)']);
    rows.push(['goal duration p50', t.goals.durationMsP50!=null?t.goals.durationMsP50+' ms':'n/a']);
    rows.push(['model calls', t.models.callCount+' ('+t.models.tokenTotal+' tokens)']);
    rows.push(['verifications', t.verification.count+' ('+(t.verification.successRate*100).toFixed(0)+'% pass)']);
    var fc=Object.keys(t.failureClasses||{});
    rows.push(['failure classes', fc.length?fc.map(function(k){return k+'×'+t.failureClasses[k]}).join(', '):'none']);
    b.innerHTML=rows.map(function(r){return '<div class="kv"><span>'+esc(r[0])+'</span><span>'+esc(r[1])+'</span></div>'}).join('');
  }).catch(function(e){
    document.getElementById('telemetry-body').textContent='telemetry endpoint error: '+e.message;
  });

  function addEvent(e){
    var first=evBody.querySelector('.empty'); if(first) first.remove();
    var row=document.createElement('div'); row.className='row';
    var payload=Object.assign({},e); delete payload.type; delete payload.at;
    var p=JSON.stringify(payload); if(p.length>240)p=p.slice(0,240)+'…';
    row.innerHTML='<span class="t">'+esc((e.at||'').slice(11,19))+'</span>'+
      '<span class="k">'+esc(e.type)+'</span><span class="p">'+esc(p)+'</span>';
    evBody.insertBefore(row, evBody.firstChild);
    while(evBody.children.length>MAX_ROWS) evBody.removeChild(evBody.lastChild);
  }

  var es=new EventSource('/api/events');
  es.onopen=function(){conn.textContent='live';conn.className='live'};
  es.onerror=function(){conn.textContent='disconnected (retrying)';conn.className=''};
  es.onmessage=function(m){
    try{ addEvent(JSON.parse(m.data)); }catch(_){/* heartbeat comments are not messages */}
  };
})();
</script>
</body>
</html>`;
}
