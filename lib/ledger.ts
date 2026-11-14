import { DELIVERY_FEE, TAX_RATE, merchants, orders, weekStartISO, type Merchant } from "./data";
import { refundsFor, type Refund } from "./refunds";

const round = (n: number) => Math.round(n * 100) / 100;
export const feeRate = (m: Merchant) => (m.plan === "growth_25" ? 0.25 : 0.15);
export const HOLD_HOURS = 48;

/**
 * Reconcile one merchant-week. Every dollar collected from subscribers is split into
 * tax, delivery cost, the platform fee, refunds (charged to whoever caused the issue)
 * and the restaurant's payout. Funds release 48 hours after the last fulfillment,
 * once refunds inside that window are processed.
 */
export function reconcileWeek(merchantId: string, week: number) {
  const m = merchants.find(x => x.id === merchantId);
  if (!m) throw new Error(`Unknown merchant ${merchantId}`);
  const os = orders.filter(o => o.merchantId === merchantId && o.week === week);
  const refunds: Refund[] = refundsFor(merchantId, week);

  const gross = os.reduce((a, o) => a + o.amount, 0);
  const tax = gross * TAX_RATE;
  const delivery = os.reduce((a, o) => a + DELIVERY_FEE[o.deliveryVendor], 0);
  const platformFee = gross * feeRate(m);
  const refundsMerchant = refunds.filter(r => r.chargedTo === "merchant").reduce((a, r) => a + r.amount, 0);
  const refundsPlatform = refunds.filter(r => r.chargedTo === "platform").reduce((a, r) => a + r.amount, 0);
  const lastFulfillment = os.map(o => o.fulfilledAt).sort().at(-1) ?? null;
  const releaseAt = lastFulfillment ? new Date(Date.parse(lastFulfillment) + HOLD_HOURS * 3600000).toISOString() : null;

  // Delivery is a platform cost on the 25% plan and passed through on the 15% plan.
  const deliveryChargedToMerchant = m.plan === "software_only_15" ? delivery : 0;
  const netPayout = gross - platformFee - deliveryChargedToMerchant - refundsMerchant;
  const platformNet = platformFee - (m.plan === "growth_25" ? delivery : 0) - refundsPlatform;

  const collected = gross + tax;
  // Where every collected dollar ends up. These must add back to what we collected.
  const destinations = {
    tax_authority: tax,
    restaurant_payout: netPayout,
    delivery_vendors: delivery,
    refunded_to_subscribers: refundsMerchant + refundsPlatform,
    platform_retained: platformNet,
  };
  const accountedFor = Object.values(destinations).reduce((a, b) => a + b, 0);

  return {
    merchant: m.name,
    week_start: weekStartISO(week),
    plan: m.plan,
    payout_cadence: m.payoutCadence,
    orders: os.length,
    lines: {
      collected_from_subscribers: round(collected),
      sales_tax_remitted: round(tax),
      platform_fee: round(platformFee),
      delivery_cost: round(delivery),
      delivery_charged_to_merchant: round(deliveryChargedToMerchant),
      refunds_charged_to_merchant: round(refundsMerchant),
      refunds_absorbed_by_platform: round(refundsPlatform),
      net_payout_to_merchant: round(netPayout),
      platform_contribution: round(platformNet),
    },
    where_the_money_went: Object.fromEntries(Object.entries(destinations).map(([k, v]) => [k, round(v)])),
    balanced: Math.abs(collected - accountedFor) < 0.01,
    release_at: releaseAt,
    release_rule: `Funds release ${HOLD_HOURS}h after the last fulfillment, after refunds in that window are processed.`,
    refunds,
  };
}
