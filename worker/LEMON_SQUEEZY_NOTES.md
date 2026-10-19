# Lemon Squeezy notes

Checked against the official docs on 2026-10-19.

## Confirmed in the docs

| Topic | What the docs say | Source |
|---|---|---|
| Signature | `X-Signature` header holds an HMAC-SHA256 **hex** digest of the raw request body, keyed with the signing secret set when the webhook was created. The Node sample compares it with `timingSafeEqual`. | [signing-requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests) |
| Headers | `Content-Type: application/json`, `X-Event-Name`, `X-Signature`. | [webhook-requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests) |
| Retries | Any non-200 is retried up to 3 more times with exponential backoff (5 s, 25 s, 125 s); after that, resend by hand from the dashboard. Duplicates are therefore possible. | [webhook-requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests), [webhooks guide](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks) |
| Body shape | JSON:API: `meta.event_name`, `meta.custom_data` (only if the checkout had custom data), `data.type` (`"subscriptions"`), `data.id` (a string, e.g. `"1"`), `data.attributes`. | [example-payloads](https://docs.lemonsqueezy.com/help/webhooks/example-payloads) |
| Event id | **None documented.** No event id or delivery id appears in the docs or examples, so we dedupe on SHA-256 of the raw body. | same |
| `test_mode` | Documented on `data.attributes.test_mode` (the subscription object). The documented examples' `meta` has only `event_name`. | [subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object) |
| Statuses | `on_trial`, `active`, `paused`, `past_due`, `unpaid`, `cancelled`, `expired`. `cancelled` keeps access until `ends_at` (grace period). `expired` means no access. `past_due` = renewal failed, 4 retries over about 2 weeks, then back to `active` or to `unpaid`. `unpaid`: "up to you". `paused` depends on `pause.mode` (`void` or `free`). | [subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object), [managing subscriptions](https://docs.lemonsqueezy.com/guides/developer-guide/managing-subscriptions) |
| Dates | `ends_at` is null unless `cancelled`/`expired`. `renews_at` is the end of the current billing cycle. `updated_at` uses microseconds: `2021-08-11T13:54:19.000000Z`. | [subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object) |
| Events | `subscription_created` (always sent with `order_created`), `_updated` (catch-all), `_cancelled`, `_resumed`, `_expired`, `_paused`, `_unpaused`. `subscription_payment_success/_failed/_recovered/_refunded` carry a **subscription invoice**, not a subscription. Cancel and expire are each followed by `subscription_updated`. The simulate page also lists `subscription_plan_changed`. | [event-types](https://docs.lemonsqueezy.com/help/webhooks/event-types), [simulate](https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events) |
| Custom data | Checkout link format: `https://[STORE].lemonsqueezy.com/checkout/buy/[VARIANT_ID]?checkout[custom][user_id]=123`. It comes back in `meta.custom_data` on "Order, Subscription or License key" webhooks. The example shows values as strings (`"123"`), even when the API sent a number. | [passing-custom-data](https://docs.lemonsqueezy.com/help/checkout/passing-custom-data) |
| Test vs live | Webhooks are separate objects, each with its own `test_mode` flag. "A test mode webhook will only be triggered for test mode data and vice versa." The secret is chosen per webhook when it is created. | [webhook object](https://docs.lemonsqueezy.com/api/webhooks/the-webhook-object), [simulate](https://docs.lemonsqueezy.com/help/webhooks/simulate-webhook-events) |

## Not confirmed (how the code copes)

- **Custom data on later events.** The docs say "Subscription" webhooks carry it but only show `order_created`. If an event has no `custom_data`, or names a player that does not exist, the stored player link is kept.
- **`meta.test_mode` / `meta.webhook_id`.** Community types include them, but the docs never show them. The code reads `data.attributes.test_mode` first, falls back to `meta.test_mode`, and never relies on `webhook_id`.
- **Custom data on `subscription_payment_*`.** Not documented. These events are recorded with result `ignored`; plan state comes only from `subscription_*` events whose `data.type` is `subscriptions`.
- **Separate secrets per mode.** Not stated. Use a different secret for the test webhook and the live webhook. If a test webhook ever pointed at production with the live secret, test purchases would grant Pro.
- **Link path and encoding.** The docs show `/checkout/buy/<variant>` with literal brackets. We append `checkout[custom][player_id]=<id>` to whatever `LS_STORE_URL` holds (the `/buy/<uuid>` share link or `/checkout/buy/...`). The brackets stay literal and the value is percent-encoded.
- **Access for `past_due`, `paused`, `unpaid`.** The docs leave these to the merchant (see decisions below).

## Decisions in this Worker

- **Pro** = any linked subscription that is `on_trial`, `active` or `past_due` (grace while LS retries the card), or is `cancelled` with `ends_at` in the future. `paused`, `unpaid` and `expired` are **free**.
- **Out-of-order guard.** Timestamps are stored as `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, 6 digits), so SQL compares them as text. An upsert only applies when the incoming `updated_at` is `>=` the stored one; an older event is recorded as `stale`.
- **Dedupe and atomicity.** The subscription upsert and the `webhook_events` insert run in one D1 batch (one transaction). A DB failure answers 500 and leaves nothing marked as seen, so the LS retry is processed.
- **Personal data.** The parser copies only `id`, `status`, `variant_id`, `renews_at`, `ends_at`, `test_mode`, `updated_at` and `custom_data.player_id`. `user_name`, `user_email`, card details and portal URLs are never stored or logged. The raw body is never logged.
- **Demo cancel** sends `subscription_cancelled` (status `cancelled`, `ends_at` = `renews_at`), then right away `subscription_expired` (status `expired`). That is the real lifecycle with the grace period skipped, so the plan drops to free at once.
- The webhook route does not enforce `Content-Type` (LS sends `application/json`; the signature is the gate).
