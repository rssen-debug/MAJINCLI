/* MAJIN Marketing — beginner-friendly, local-first Meta Ads dashboard.
 * No chart hallucinations, no mutation endpoints, no token in chat/history.
 */
(function () {
  'use strict';
  const root = document.getElementById('marketing');
  if (!root) return;
  function node(tag, text) {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = String(text);
    return e;
  }
  function line(label, input) {
    const wrap = node('label');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin:7px 0;font-size:12px';
    wrap.append(node('span', label), input);
    return wrap;
  }
  function field(type, placeholder) {
    const e = node('input');
    e.type = type;
    e.placeholder = placeholder || '';
    e.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 9px;font-size:13px;min-height:36px';
    return e;
  }
  function amount(placeholder) {
    const e = field('number', placeholder);
    e.min = '0';
    e.step = '0.01';
    return e;
  }
  const heading = node('div', 'Meta Ads · profit-first analysis');
  heading.style.cssText = 'font-size:13px;font-weight:700;margin:8px 0';
  const status = node('p', 'Loading…');
  status.style.cssText = 'font-size:12px;line-height:1.5';
  const acct = field('text', 'act_123456789');
  const curr = field('text', 'USD or SEK');
  const token = field('password', 'Paste Meta Marketing API access token');
  token.autocomplete = 'off';
  const price = amount('39.00');
  const cogs = amount('10.00');
  const shipping = amount('5.00');
  const fees = amount('2.00');
  const refunds = amount('5');
  refunds.max = '100';
  const profit = amount('5.00');
  const cap = amount('10.00');
  const fields = [
    ['Ad account ID', acct], ['Account currency', curr], ['Meta API access token (saved locally, never shown)', token],
    ['Selling price per order', price], ['Product + fulfillment cost', cogs], ['Extra shipping cost', shipping],
    ['Payment/platform fees per order', fees], ['Expected refund rate (%)', refunds],
    ['Minimum profit per order', profit], ['Planned maximum ad spend per day', cap],
  ];
  const form = node('div');
  for (const [label, input] of fields) form.append(line(label, input));
  const btnRow = node('div');
  btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin:10px 0';
  const save = node('button', 'Save connection');
  const analyze = node('button', 'Analyze last 7 days');
  const disconnect = node('button', 'Disconnect');
  for (const b of [save, analyze, disconnect]) {
    b.style.cssText = 'font-size:12px;padding:7px 9px;min-height:36px';
    btnRow.append(b);
  }
  const output = node('div');
  output.style.cssText = 'font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere';
  const caveat = node('p', 'Read-only. MAJIN never buys ads or changes budgets. Numbers are based on Meta-attributed events, not independently verified shop orders. Currency must match the ad account.');
  caveat.style.cssText = 'font-size:11px;opacity:.8;line-height:1.5';
  root.replaceChildren(heading, status, form, btnRow, output, caveat);
  const fmt = (v, curr) => v == null ? '—' : Number(v).toFixed(2) + ' ' + curr;
  function fail(e) { output.textContent = '⚠ ' + (e.message || String(e)); }
  function loading(value) { save.disabled = analyze.disabled = disconnect.disabled = value; }
  async function load() {
    const r = await api('/marketing');
    status.textContent = r.connected
      ? '✓ Meta connected (' + r.accountId + '). Analysis only, no spending permissions used.'
      : 'Connect a Meta Ads account and enter your product costs.';
    acct.value = r.accountId || '';
    curr.value = r.currency || '';
    const e = r.economics || {};
    for (const [name, el] of [['price',price],['cogs',cogs],['shipping',shipping],['fees',fees],['targetProfit',profit],['dailyCap',cap]]) {
      el.value = Number(e[name] || 0) || '';
    }
    refunds.value = e.refundRate ? Number((e.refundRate * 100).toFixed(2)) : '';
    token.value = '';
  }
  save.onclick = async () => {
    loading(true);
    output.textContent = 'Saving securely in MAJIN local configuration…';
    try {
      const economics = {
        price: Number(price.value), cogs: Number(cogs.value), shipping: Number(shipping.value),
        fees: Number(fees.value), refundRate: Number(refunds.value) / 100,
        targetProfit: Number(profit.value), dailyCap: Number(cap.value),
      };
      await api('/marketing', { method: 'POST', body: {
        action: 'save', accountId: acct.value.trim(), currency: curr.value.trim().toUpperCase(),
        ...(token.value.trim() ? { accessToken: token.value.trim() } : {}), economics,
      } });
      token.value = '';
      output.textContent = '✓ Saved locally. Click Analyze last 7 days when ready.';
      await load();
    } catch (e) { token.value = ''; fail(e); }
    finally { loading(false); }
  };
  analyze.onclick = async () => {
    loading(true);
    output.textContent = 'Reading Meta Ads Insights…';
    try {
      const r = await api('/marketing', { method: 'POST', body: { action: 'analyze' } });
      if (!r.ok) throw new Error((r.errors || []).join(' ') || r.error || 'analysis failed');
      const t = r.totals;
      const messages = [
        '7 DAYS · ' + r.currency + ' · attributed data',
        'Ad spend: ' + fmt(t.spend, r.currency),
        'Attributed purchases: ' + t.purchases,
        'Attributed CPA: ' + fmt(t.attributedCpa, r.currency),
        'Estimated contribution after ad spend: ' + fmt(t.estimatedContribution, r.currency),
        'Break-even CPA: ' + fmt(r.economics.breakEvenCpa, r.currency),
        'Target CPA: ' + fmt(r.economics.targetCpa, r.currency),
        'Average daily spend: ' + fmt(t.observedAvgDailySpend, r.currency) +
          ' / advisory limit: ' + fmt(t.advisoryDailyCap, r.currency),
        t.overAdvisoryCap ? '⚠ Observed spend is ABOVE your advisory daily cap.' : '',
        '',
      ];
      for (const c of r.campaigns) {
        messages.push(c.name + ' · ' + c.decision.replaceAll('_', ' '));
        messages.push('  Spend ' + fmt(c.spend,r.currency) + ' · purchases ' + c.purchases + ' · CPA ' + fmt(c.cpa,r.currency));
        messages.push('  ' + c.explanation);
      }
      if (!r.campaigns.length) messages.push('No campaign rows were returned for the past 7 days.');
      messages.push('', '⚠ These purchases are Meta-attributed signals, not verified WooCommerce sales.',
        'No ad settings or budgets were changed.');
      output.textContent = messages.filter((x) => x !== '').join('\n');
    } catch (e) { fail(e); }
    finally { loading(false); }
  };
  disconnect.onclick = async () => {
    if (!window.confirm('Disconnect Meta Ads from this MAJIN installation?')) return;
    loading(true);
    try {
      await api('/marketing', { method: 'POST', body: { action: 'disconnect' } });
      output.textContent = 'Meta disconnected.';
      await load();
    } catch (e) { fail(e); }
    finally { loading(false); }
  };
  load().catch(fail);
})();
