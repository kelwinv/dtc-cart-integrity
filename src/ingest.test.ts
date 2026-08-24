import { test } from "node:test";
import assert from "node:assert/strict";
import { corrupt, ingest, type Cart } from "./ingest.ts";

const cart = (over: Partial<Cart> = {}): Cart => ({
  id: 1,
  userId: 7,
  products: [
    { id: 10, title: "Tee", price: 20, quantity: 2, total: 40, discountPercentage: 10, discountedTotal: 36 },
    { id: 11, title: "Cap", price: 15, quantity: 1, total: 15, discountPercentage: 0, discountedTotal: 15 },
  ],
  total: 55,
  discountedTotal: 51,
  totalProducts: 2,
  totalQuantity: 3,
  ...over,
});

test("accepts a self-consistent cart", () => {
  const r = ingest([cart()]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.rejected.length, 0);
});

test("rejects a total that disagrees with its line items", () => {
  const r = ingest([cart({ total: 61 })]);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].stage, "reconciliation");
  assert.match(r.rejected[0].reason, /sum of line totals/);
});

test("rejects a quantity that disagrees with its line items", () => {
  const r = ingest([cart({ totalQuantity: 9 })]);
  assert.match(r.rejected[0].reason, /totalQuantity/);
});

test("rejects a missing required field at the schema stage", () => {
  const { totalQuantity: _gone, ...broken } = cart();
  const r = ingest([broken]);
  assert.equal(r.rejected[0].stage, "schema");
});

test("rejects a negative quantity before it can reach a metric", () => {
  const c = cart();
  c.products[0].quantity = -2;
  const r = ingest([c]);
  assert.equal(r.accepted.length, 0);
});

test("rejects net revenue larger than gross", () => {
  // Line items agree with the reported net, so the earlier sum checks pass and
  // the gross/net sanity check is the one that has to catch this.
  const c = cart({ discountedTotal: 80 });
  c.products[0].discountedTotal = 65;
  c.products[1].discountedTotal = 15;
  const r = ingest([c]);
  assert.match(r.rejected[0].reason, /exceeds gross/);
});

test("keeps the raw payload even for rejected records", () => {
  const r = ingest([cart({ total: 61 })]);
  assert.equal(r.raw.length, 1);
});

test("fault injection is caught by the checks", () => {
  const clean = Array.from({ length: 39 }, (_, i) => cart({ id: i + 1 }));
  assert.equal(ingest(clean).rejected.length, 0);

  const damaged = ingest(corrupt(clean));
  assert.equal(damaged.rejected.length, 9, "3 faults per 13 records over 39 records");
  assert.ok(damaged.rejected.some((r) => r.stage === "schema"));
  assert.ok(damaged.rejected.some((r) => r.stage === "reconciliation"));
});
