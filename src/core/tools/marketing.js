/**
 * Marketing intelligence tools: the language model may INSPECT, NEVER spend.
 * Credentials enter via the local marketing panel or an env reference, not tool args.
 */
import { def } from './registry.js';
import { marketingStatus, analyzeMetaAccount } from '../marketing.js';

export const marketingTools = [
  def({
    name: 'marketing.status',
    group: 'marketing',
    risk: 'read',
    desc: 'Show whether Meta Ads marketing is connected and whether product economics are configured, without exposing any access tokens. No network calls.',
    params: {},
    async run(_args, ctx) {
      const s = marketingStatus(ctx.cfg);
      return {
        result: JSON.stringify(s, null, 2) + '\nOpen Expert > MARKETING to connect Meta and set price, costs, currency, refund rate and a daily spend ceiling.',
        meta: { connected: s.connected, mode: s.mode },
        summary: s.connected ? 'Meta account configured, read-only insights available' : 'Meta not connected',
      };
    },
  }),
  def({
    name: 'marketing.analyze',
    group: 'marketing',
    risk: 'read',
    desc: 'Fetch live last-7-day Meta Ads Insights and compute conservative, margin-aware recommendations. Reports CPA, estimated contribution, sample uncertainty and spend versus the advisory daily cap. Does not buy, pause or change any ad.',
    params: {},
    async run(_args, ctx) {
      try {
        const r = await analyzeMetaAccount(ctx.cfg);
        if (!r.ok) return { ok: false, error: { code: 'marketing_config', message: r.errors.join(' ') } };
        return {
          result: JSON.stringify(r, null, 2),
          meta: { currency: r.currency, campaigns: r.campaigns.length, analysisOnly: true },
          summary: r.campaigns.length + ' campaigns analyzed, no Meta changes made',
        };
      } catch (error) {
        return {
          ok: false,
          error: { code: 'marketing_api', message: error.message },
          summary: 'Meta analysis unavailable — check connection and economics',
        };
      }
    },
  }),
];
