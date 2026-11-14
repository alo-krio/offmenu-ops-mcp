// Synthetic demo data. Every merchant, subscriber and order here is fictional.
// It is generated from a fixed seed so results are the same on every request.

export type Channel = "instagram" | "in_store_flyer" | "email_list" | "paid_ads" | "referral";
export type ChurnReason = "too_expensive" | "menu_fatigue" | "moving" | "delivery_issue" | "pausing";
export type Cadence = "weekly" | "monthly";

export interface Merchant {
  id: string;
  name: string;
  cuisine: string;
  city: string;
  payoutCadence: Cadence;
  plan: "software_only_15" | "growth_25"; // 15% fee, or 25% fee with paid acquisition included
  products: { sku: string; name: string; kind: "meal_plan" | "cpg"; price: number }[];
}

export interface Subscriber {
  id: string;
  merchantId: string;
  name: string;
  email: string;
  joinedWeek: number; // 0..7
  churnedWeek: number | null;
  churnReason: ChurnReason | null;
  channel: Channel;
  coupon: string | null;
}

export interface Order {
  id: string;
  merchantId: string;
  subscriberId: string;
  week: number;
  sku: string;
  amount: number; // pre-tax
  fulfilledAt: string; // ISO
  deliveryVendor: "uber" | "grubhub" | "dragonfly" | "ups";
}

export const WEEKS = 8;
export const WEEK0 = Date.UTC(2026, 8, 7); // Mon Sep 7, 2026
export const TAX_RATE = 0.08875; // NYC combined sales tax, used for illustration
export const DELIVERY_FEE = { uber: 7.5, grubhub: 7.0, dragonfly: 6.25, ups: 9.0 } as const;

export const merchants: Merchant[] = [
  {
    id: "m_bangkok_corner",
    name: "Bangkok Corner",
    cuisine: "Thai",
    city: "New York",
    payoutCadence: "weekly",
    plan: "growth_25",
    products: [
      { sku: "bc_weekly_4", name: "4 meals a week", kind: "meal_plan", price: 62 },
      { sku: "bc_curry_paste", name: "Green curry paste, 2 jars", kind: "cpg", price: 18 },
    ],
  },
  {
    id: "m_nonnas_table",
    name: "Nonna's Table",
    cuisine: "Italian",
    city: "Chicago",
    payoutCadence: "monthly",
    plan: "software_only_15",
    products: [
      { sku: "nt_weekly_3", name: "3 meals a week", kind: "meal_plan", price: 54 },
      { sku: "nt_frozen_ravioli", name: "Frozen ravioli, 2 lb", kind: "cpg", price: 24 },
    ],
  },
  {
    id: "m_seoul_dumpling",
    name: "Seoul Dumpling House",
    cuisine: "Korean",
    city: "New York",
    payoutCadence: "weekly",
    plan: "growth_25",
    products: [
      { sku: "sd_weekly_5", name: "5 meals a week", kind: "meal_plan", price: 70 },
      { sku: "sd_frozen_dumplings", name: "Frozen dumplings, 50 pack", kind: "cpg", price: 32 },
    ],
  },
];

// Small deterministic PRNG (mulberry32)
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const FIRST = ["Maya", "Leo", "Priya", "Sam", "Ava", "Noah", "Zara", "Eli", "Nina", "Omar", "Ivy", "Theo", "Lena", "Raj", "Kai", "Mia"];
const LAST = ["Chen", "Patel", "Garcia", "Kim", "Nguyen", "Rossi", "Singh", "Lopez", "Park", "Silva", "Khan", "Brown"];
const CHANNELS: Channel[] = ["instagram", "in_store_flyer", "email_list", "paid_ads", "referral"];
const REASONS: ChurnReason[] = ["too_expensive", "menu_fatigue", "moving", "delivery_issue", "pausing"];
const VENDORS = ["uber", "grubhub", "dragonfly", "ups"] as const;

function build() {
  const subs: Subscriber[] = [];
  const orders: Order[] = [];
  merchants.forEach((m, mi) => {
    const r = rng(1000 + mi * 77);
    const count = 26 + Math.floor(r() * 18);
    for (let i = 0; i < count; i++) {
      const first = pick(r, FIRST), last = pick(r, LAST);
      const joinedWeek = Math.floor(r() * WEEKS);
      const churns = r() < 0.32;
      const churnedWeek = churns ? Math.min(WEEKS - 1, joinedWeek + 1 + Math.floor(r() * 4)) : null;
      const channel = m.plan === "growth_25" && r() < 0.45 ? "paid_ads" : pick(r, CHANNELS.filter(c => c !== "paid_ads"));
      const s: Subscriber = {
        id: `s_${m.id.slice(2, 6)}_${String(i).padStart(3, "0")}`,
        merchantId: m.id,
        name: `${first} ${last}`,
        email: `${first}.${last}${i}@example.com`.toLowerCase(),
        joinedWeek,
        churnedWeek: churnedWeek !== null && churnedWeek > joinedWeek ? churnedWeek : null,
        churnReason: null,
        channel,
        coupon: r() < 0.3 ? pick(r, ["LAUNCH20", "FRIEND10", "FIRSTBOX"]) : null,
      };
      if (s.churnedWeek !== null) s.churnReason = pick(r, REASONS);
      subs.push(s);
      const end = s.churnedWeek ?? WEEKS;
      for (let w = s.joinedWeek; w < end; w++) {
        const ordersThisWeek: string[] = [m.products[0].sku];
        if (r() < 0.25) ordersThisWeek.push(m.products[1].sku);
        for (const sku of ordersThisWeek) {
          const p = m.products.find(x => x.sku === sku)!;
          const day = 1 + Math.floor(r() * 4);
          const fulfilledAt = new Date(WEEK0 + (w * 7 + day) * 86400000 + 17 * 3600000).toISOString();
          orders.push({
            id: `o_${s.id.slice(2)}_w${w}_${p.kind === "cpg" ? "c" : "m"}`,
            merchantId: m.id, subscriberId: s.id, week: w, sku, amount: p.price, fulfilledAt,
            deliveryVendor: pick(r, VENDORS),
          });
        }
      }
    }
  });
  return { subs, orders };
}

export const { subs: subscribers, orders } = build();

export function weekStartISO(week: number) {
  return new Date(WEEK0 + week * 7 * 86400000).toISOString().slice(0, 10);
}
export function weekFromISO(date: string): number | null {
  const t = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(t)) return null;
  const w = Math.floor((t - WEEK0) / (7 * 86400000));
  return w >= 0 && w < WEEKS ? w : null;
}
