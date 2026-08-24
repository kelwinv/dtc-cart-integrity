import type { Cart, CategoryIndex } from "./ingest";

/**
 * Metrics are computed only from records that survived ingestion.
 *
 * Everything here reads from `accepted`, never from the raw payload. A number on
 * a dashboard should never include a record the system could not verify.
 */

export type Kpis = {
  orders: number;
  gross: number;
  net: number;
  discountLeakage: number;
  discountRate: number;
  aov: number;
  unitsPerOrder: number;
};

export type CategoryRow = {
  category: string;
  net: number;
  units: number;
  share: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeKpis(carts: Cart[]): Kpis {
  const gross = carts.reduce((sum, c) => sum + c.total, 0);
  const net = carts.reduce((sum, c) => sum + c.discountedTotal, 0);
  const units = carts.reduce((sum, c) => sum + c.totalQuantity, 0);
  const orders = carts.length;

  return {
    orders,
    gross: round2(gross),
    net: round2(net),
    discountLeakage: round2(gross - net),
    discountRate: gross > 0 ? (gross - net) / gross : 0,
    aov: orders > 0 ? round2(net / orders) : 0,
    unitsPerOrder: orders > 0 ? round2(units / orders) : 0,
  };
}

/**
 * Line items carry no category, so revenue by category requires joining each
 * line back to the product catalogue. A line whose product id is missing from
 * the catalogue is counted as "unmapped" rather than dropped — an unjoinable
 * row is itself a data-quality signal, and hiding it would understate revenue.
 */
export function revenueByCategory(carts: Cart[], categories: CategoryIndex): CategoryRow[] {
  const net = new Map<string, number>();
  const units = new Map<string, number>();

  for (const cart of carts) {
    for (const line of cart.products) {
      const category = categories.get(line.id) ?? "unmapped";
      net.set(category, (net.get(category) ?? 0) + line.discountedTotal);
      units.set(category, (units.get(category) ?? 0) + line.quantity);
    }
  }

  const totalNet = [...net.values()].reduce((sum, v) => sum + v, 0);
  return [...net.entries()]
    .map(([category, value]) => ({
      category,
      net: round2(value),
      units: units.get(category) ?? 0,
      share: totalNet > 0 ? value / totalNet : 0,
    }))
    .sort((a, b) => b.net - a.net);
}

/** Orders where the discount ate the most margin, in absolute money. */
export function topDiscountLeakage(carts: Cart[], limit = 6) {
  return carts
    .map((c) => ({
      id: c.id,
      userId: c.userId,
      gross: c.total,
      leakage: round2(c.total - c.discountedTotal),
      rate: c.total > 0 ? (c.total - c.discountedTotal) / c.total : 0,
    }))
    .sort((a, b) => b.leakage - a.leakage)
    .slice(0, limit);
}
