# MAJIN Marketing Autopilot (Meta Ads, analysis only)

Built into MAJIN: no Python process, no paid MCP service, no additional LLM calls just to compute campaign economics. The optimizer itself is deterministic.

## Connect directly in chat (no panels)

1. Select your MAJIN AI provider and model once, using the normal onboarding.
2. Say **"MAJIN, optimize my Facebook ads"** (or an equivalent explicit marketing task in Swedish).
3. If Meta is not connected, MAJIN asks for only the required data **in the chat** and shows a temporary secure connection form next to your conversation. Nothing is permanently added to the sidebars, settings or header.
4. Enter your Meta ad account ID, its actual currency, a Marketing API token with **ads_read** permission, your product sale price, costs and an advisory daily budget. Tap **Connect & analyze**. MAJIN resumes your original request automatically.

**Important:** Never paste an API key into the chat composer. The contextual token field sends it to MAJIN's authenticated local configuration API, not to the language model or chat history. As with MAJIN provider keys, saved tokens are local but **not encrypted**. You can also set environment variable MAJIN_META_ACCESS_TOKEN for the MAJIN process instead of pasting a token; the default config refers to it.

Costs, selling price and ad spend must use the **same currency**. Convert before entering them if your shop sells in SEK while your ad account bills in USD. Connection settings are not proof that Meta accepted the token; the first actual analysis verifies API access.

No AI-token usage is needed for the first-use question or for calculating the marketing metrics. The selected AI model is used only for reasoning about the analysis and other normal MAJIN tasks.

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
