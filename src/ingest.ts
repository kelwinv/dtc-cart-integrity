import { z } from "zod";

/**
 * The ingestion boundary.
 *
 * The point of this file is not to fetch data — it is to refuse to trust it.
 * Every record is schema-validated and then arithmetically reconciled against
 * its own line items before it is allowed to reach a metric. A record that
 * fails is rejected with a reason, never silently coerced or dropped.
 */

const LineItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  total: z.number().nonnegative(),
  discountPercentage: z.number().min(0).max(100),
  discountedTotal: z.number().nonnegative(),
});

const CartSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  products: z.array(LineItemSchema).min(1),
  total: z.number().nonnegative(),
  discountedTotal: z.number().nonnegative(),
  totalProducts: z.number().int().positive(),
  totalQuantity: z.number().int().positive(),
});

export type Cart = z.infer<typeof CartSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;

export type Rejection = {
  cartId: number | string;
  stage: "schema" | "reconciliation";
  reason: string;
};

export type IngestResult = {
  received: number;
  accepted: Cart[];
  rejected: Rejection[];
  /** Raw payload is never discarded — a rejected record must stay replayable. */
  raw: unknown[];
};

/** Money comparisons need a tolerance; floats accumulate. One cent is the bar. */
const CENT = 0.02;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recomputes every reported aggregate from the line items.
 *
 * This is the check that a tracking or order feed usually lacks: the payload
 * says the order was worth X, and nobody ever asks the line items whether they
 * agree. When they disagree, the revenue number is wrong and no error is thrown.
 */
function reconcile(cart: Cart): string | null {
  const lineTotal = round2(cart.products.reduce((sum, p) => sum + p.total, 0));
  if (Math.abs(lineTotal - cart.total) > CENT) {
    return `total ${cart.total.toFixed(2)} != sum of line totals ${lineTotal.toFixed(2)}`;
  }

  const lineNet = round2(cart.products.reduce((sum, p) => sum + p.discountedTotal, 0));
  if (Math.abs(lineNet - cart.discountedTotal) > CENT) {
    return `discountedTotal ${cart.discountedTotal.toFixed(2)} != sum of line net ${lineNet.toFixed(2)}`;
  }

  const units = cart.products.reduce((sum, p) => sum + p.quantity, 0);
  if (units !== cart.totalQuantity) {
    return `totalQuantity ${cart.totalQuantity} != sum of line quantities ${units}`;
  }

  if (cart.products.length !== cart.totalProducts) {
    return `totalProducts ${cart.totalProducts} != line count ${cart.products.length}`;
  }

  const badLine = cart.products.find(
    (p) => Math.abs(round2(p.price * p.quantity) - p.total) > CENT,
  );
  if (badLine) {
    return `line "${badLine.title}": price x qty = ${round2(badLine.price * badLine.quantity).toFixed(2)}, reported ${badLine.total.toFixed(2)}`;
  }

  if (cart.discountedTotal > cart.total + CENT) {
    return `net ${cart.discountedTotal.toFixed(2)} exceeds gross ${cart.total.toFixed(2)}`;
  }

  return null;
}

export function ingest(payload: unknown[]): IngestResult {
  const accepted: Cart[] = [];
  const rejected: Rejection[] = [];

  for (const record of payload) {
    const parsed = CartSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const id = (record as { id?: number })?.id ?? "unknown";
      rejected.push({
        cartId: id,
        stage: "schema",
        reason: `${issue.path.join(".") || "root"}: ${issue.message}`,
      });
      continue;
    }

    const drift = reconcile(parsed.data);
    if (drift) {
      rejected.push({ cartId: parsed.data.id, stage: "reconciliation", reason: drift });
      continue;
    }

    accepted.push(parsed.data);
  }

  return { received: payload.length, accepted, rejected, raw: payload };
}

/**
 * Fault injection.
 *
 * A data-quality check nobody has seen fail is decoration. This corrupts a
 * deterministic slice of the feed with the three failures that actually show up
 * in production — a missing field, a drifting total, and an impossible quantity —
 * so the panel can be watched catching them.
 */
export function corrupt(payload: unknown[]): unknown[] {
  return payload.map((record, index) => {
    if (index % 13 === 5) {
      const { totalQuantity: _omitted, ...missingField } = record as Cart;
      return missingField;
    }
    if (index % 13 === 9) {
      const cart = record as Cart;
      return { ...cart, total: round2(cart.total * 1.07) };
    }
    if (index % 13 === 11) {
      const cart = record as Cart;
      return {
        ...cart,
        products: cart.products.map((p, i) => (i === 0 ? { ...p, quantity: -p.quantity } : p)),
      };
    }
    return record;
  });
}

const CARTS_URL = "https://dummyjson.com/carts?limit=0";
const PRODUCTS_URL = "https://dummyjson.com/products?limit=0&select=id,category";

export type CategoryIndex = Map<number, string>;

export async function fetchFeed(): Promise<{ carts: unknown[]; categories: CategoryIndex }> {
  const [cartsRes, productsRes] = await Promise.all([fetch(CARTS_URL), fetch(PRODUCTS_URL)]);
  if (!cartsRes.ok) throw new Error(`carts feed responded ${cartsRes.status}`);
  if (!productsRes.ok) throw new Error(`products feed responded ${productsRes.status}`);

  const cartsBody = (await cartsRes.json()) as { carts: unknown[] };
  const productsBody = (await productsRes.json()) as {
    products: Array<{ id: number; category: string }>;
  };

  const categories: CategoryIndex = new Map(
    productsBody.products.map((p) => [p.id, p.category]),
  );
  return { carts: cartsBody.carts, categories };
}
