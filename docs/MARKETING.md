# MAJIN Marketing Autopilot (Meta Ads, analysis only)

Built into MAJIN: no Python process, no paid MCP service, no additional LLM calls just to compute campaign economics. The optimizer itself is deterministic.

## Connect in the app

1. Configure your normal MAJIN AI provider and model first.
2. Open **Expert → MARKETING**.
3. In Meta Business Manager, create a Marketing API token with read permission (**ads_read**). Enter your **ad account ID** (e.g. act_123456789) and **actual ad account currency**.
4. Enter your selling price, product/fulfillment costs, shipping, payment fees, expected refund fraction (UI asks for percent), minimum retained profit per order, and a *planned* daily advertising ceiling. **All money values must match the Meta ad account currency.** Convert product economics first if your Meta account uses USD and your store uses SEK.
5. Click **Save connection**, then **Analyze last 7 days**.

A Meta access token is a **different credential from your AI provider key**. The token field is not sent to the LLM or included in agent tool arguments. Like MAJIN's AI provider keys, a pasted Meta token is stored in MAJIN's local configuration, **not encrypted**. Alternatively set environment variable MAJIN_META_ACCESS_TOKEN for the MAJIN process and leave the token field empty; the default configuration uses that reference.

Never paste a Meta or AI key in chat.

## Chat tools

- **marketing.status** — show connection and settings without secret values.
- **marketing.analyze** — fetch last-7-day Meta Ads Insights and compute campaign CPA, after-spend attributed contribution, conservative recommendations and a comparison to the advisory daily spend ceiling.

Same calculations power the local Marketing panel. Meta Graph Marketing API v23.0, max five pages and 20-second request timeout.

## What profit-first really means

Contribution/order = selling price × (1 − expected refund fraction) − product/fulfillment costs − shipping − fees.

Break-even CPA = contribution/order. Target CPA holds back a minimum profit reserve (at least 20% of contribution). Decisions:

- **collect_data** — low sample; do not pretend certainty
- **review_tracking_or_pause** — significant spend and zero Meta-attributed purchases
- **review_loss** — enough attributed purchases but CPA is above margin
- **hold_and_verify** — inconclusive evidence
- **scale_candidate** — enough purchases and conservative CPA signal suggest a small *10% increase for manual consideration only*

ALL results are **read-only recommendations**, not verified profit. Meta pixel attribution can lag, duplicate or disagree with real WooCommerce orders, refunds and chargebacks. Purchase action types are prioritized, not summed. Estimated contribution is not confirmed net profit or true incrementality.

**No campaigns, bids or budgets are written.** The daily ceiling is advisory only, NOT an enforced Meta Ads budget. Set campaign/account spending caps independently in Meta Ads Manager. Any future write actions need explicit human approval, tested diff/rollback and audit logging. No automatic scaling loop runs.

## Known gaps

- No WooCommerce reconciliation, refund sync, checkout tracking diagnosis or multichannel attribution yet.
- Live Meta access is not verifiable in CI without your Meta access token/account; automated tests use a controlled stand-in.
- Missing or mismatched Meta currency blocks recommendations.
- Daily cap is not a hard spend limiter.

Sources: src/core/marketing.js, src/core/tools/marketing.js, src/ui/marketing.js; test/marketing.test.js.
