/* MAJIN Marketing: secure, contextual conversation step.
 * Render NOTHING until the user asks to work on ads. No dashboard, no panels.
 * Token goes directly to authenticated /api/marketing; never to /api/chat or LLM.
 */
(function () {
  'use strict';
  let active = null;
  const $ = (tag, text) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    return e;
  };
  function input(type, hint) {
    const e = $('input');
    e.type = type;
    e.placeholder = hint || '';
    e.autocomplete = 'off';
    e.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;min-height:42px;font:14px inherit;border-radius:10px;max-width:100%';
    if (type === 'number') { e.min = '0'; e.step = '0.01'; e.inputMode = 'decimal'; }
    return e;
  }
  function labeled(target, label, type, hint, required = false) {
    const wrap = $('label');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin:10px 0;font-size:13px';
    const cap = $('span', label);
    const field = input(type, hint);
    field.required = required;
    wrap.append(cap, field);
    target.append(wrap);
    return field;
  }
  async function show(prompt) {
    // Chat activity triggers this securely. Never create a permanent Marketing panel.
    if (active?.isConnected) active.remove();
    const scroller = document.getElementById('scroller');
    if (!scroller) return;
    const card = $('section');
    active = card;
    card.className = 'msg marketing-connection';
    card.setAttribute('aria-label', 'Connect Meta Ads securely');
    card.style.cssText = 'margin:12px 0;padding:15px;max-width:620px;border:1px solid var(--line,#666);border-radius:14px;background:var(--bg2,#1b1b24)';
    const title = $('h3', 'Connect your Facebook / Instagram ads');
    title.style.cssText = 'font:600 16px inherit;margin:0 0 5px';
    const hint = $('p', 'To understand which ads can earn money, I need your Meta account and the profit margin per order. Do this once, then I can analyze the ads for you.');
    hint.style.cssText = 'font-size:13px;line-height:1.55;opacity:.85;margin:0 0 10px';
    const fields = $('form');
    const account = labeled(fields,'Meta ad account ID','text','act_123456789',true);
    const currency = labeled(fields,'Ad account currency','text','SEK or USD',true);
    const key = labeled(fields,'Meta Ads access token — private','password','Paste Meta API token',false);
    const price = labeled(fields,'Product selling price','number','e.g. 345',true);
    const cogs = labeled(fields,'Product cost including fulfillment','number','e.g. 90',true);
    const daily = labeled(fields,'Your planned daily ad spend limit','number','e.g. 30',true);
    const extras = $('details');
    const exp = $('summary','Other costs (optional)');
    extras.append(exp);
    const shipping = labeled(extras,'Extra shipping cost per order','number','0');
    const fees = labeled(extras,'Fees per order','number','0');
    const refunds = labeled(extras,'Expected refund rate (%)','number','0');
    const profit = labeled(extras,'Minimum retained profit per order','number','auto: reserve 20%');
    fields.append(extras);
    const privacy = $('p','Your token is sent only to MAJIN on your computer, not included in your chat or AI-model request. A saved key is stored locally, not encrypted. MAJIN never changes ads or spends money here.');
    privacy.style.cssText='font-size:11px;opacity:.8;line-height:1.5';
    const status = $('p','');
    status.setAttribute('aria-live','polite');
    status.style.cssText='font-size:12px;white-space:pre-wrap';
    const actions=$('div');
    actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
    const save=$('button','Connect & analyze');
    save.type='submit';
    save.style.cssText='min-height:42px;padding:8px 14px;font-size:13px';
    const cancel=$('button','Not now');
    cancel.type='button';
    cancel.style.cssText='min-height:42px;padding:8px 14px;font-size:13px';
    cancel.onclick=()=>card.remove();
    actions.append(save,cancel);
    fields.append(privacy,status,actions);
    card.append(title,hint,fields);
    scroller.append(card);
    scroller.scrollTop=scroller.scrollHeight;
    try {
      const state = await api('/marketing');
      account.value=state.accountId||'';
      currency.value=state.currency||'';
      const e=state.economics||{};
      for (const [k,el] of [['price',price],['cogs',cogs],['shipping',shipping],['fees',fees],['dailyCap',daily],['targetProfit',profit]])
        if (Number(e[k])>0) el.value=e[k];
      if(Number(e.refundRate)>0) refunds.value=+(e.refundRate*100).toFixed(2);
    } catch { /* disconnected is expected */ }
    fields.onsubmit=async (event)=>{
      event.preventDefault();
      save.disabled=true;
      status.textContent='Saving connection securely…';
      try {
        const economics={
          price:Number(price.value),cogs:Number(cogs.value),shipping:Number(shipping.value||0),fees:Number(fees.value||0),
          refundRate:Number(refunds.value||0)/100,targetProfit:Number(profit.value||0),dailyCap:Number(daily.value),
        };
        await api('/marketing',{method:'POST',body:{
          action:'save',accountId:account.value.trim(),currency:currency.value.trim().toUpperCase(),
          ...(key.value.trim()?{accessToken:key.value.trim()}:{}),economics,
        }});
        key.value='';
        const current=await api('/marketing');
        if (!current.connected) {
          status.textContent='The account settings were saved, but I still need a valid Meta Ads token. Please paste one above.';
          return;
        }
        status.textContent='✓ Connection settings saved. I am starting the analysis. No ad spend will be changed.';
        card.remove();
        // This is the original user instruction, NOT the token or form values.
        setTimeout(()=>{ if(typeof send==='function') send(String(prompt||'Analyze my Meta ads').slice(0,1500)); },0);
      } catch(e) {
        key.value='';
        status.textContent='Could not connect: '+String(e.message||e);
      } finally { save.disabled=false; }
    };
  }
  window.MAJIN_MARKETING={show};
})();
