import { orders } from "./data";

export type ReasonCode = "late_delivery" | "damaged_in_transit" | "missing_item" | "wrong_item" | "quality_issue";
export interface Refund { orderId: string; reason: ReasonCode; amount: number; chargedTo: "merchant" | "platform" }

// Who pays depends on who caused the issue.
export const ATTRIBUTION: Record<ReasonCode, "merchant" | "platform"> = {
  late_delivery: "platform",
  damaged_in_transit: "platform",
  missing_item: "merchant",
  wrong_item: "merchant",
  quality_issue: "merchant",
};

// A few historical refunds so reconciliation has something to attribute.
const HISTORY: { orderIndex: number; reason: ReasonCode; share: number }[] = [
  { orderIndex: 3, reason: "late_delivery", share: 1 },
  { orderIndex: 41, reason: "quality_issue", share: 0.5 },
  { orderIndex: 97, reason: "missing_item", share: 0.3 },
  { orderIndex: 160, reason: "damaged_in_transit", share: 1 },
  { orderIndex: 233, reason: "wrong_item", share: 1 },
];

export const historicalRefunds: Refund[] = HISTORY.filter(h => orders[h.orderIndex]).map(h => {
  const o = orders[h.orderIndex];
  return { orderId: o.id, reason: h.reason, amount: Math.round(o.amount * h.share * 100) / 100, chargedTo: ATTRIBUTION[h.reason] };
});

export function refundsFor(merchantId: string, week: number) {
  return historicalRefunds.filter(r => {
    const o = orders.find(x => x.id === r.orderId)!;
    return o.merchantId === merchantId && o.week === week;
  });
}
