# Cart integrity

A small revenue dashboard over a public mock commerce feed
([dummyjson.com/carts](https://dummyjson.com/carts), 208 carts) that **refuses to plot a
number it could not verify**.

## Why this and not a chart

The brief said one useful metric. Any dashboard can sum a column. The interesting
question in a DTC operation is the one underneath: *how do you know the number is right?*

Order and tracking feeds fail quietly. A payload says the cart was worth $163.11, the
line items add up to $152.44, nobody asks, and the difference lands in a revenue chart
that someone makes a decision from. There is no exception, no red log line — just a wrong
number that looks exactly like a right one.

So the dashboard has two halves:

- **Metrics** — net revenue, discount leakage, AOV, units per order, revenue by category
- **An ingestion integrity panel** — how many records arrived, how many were trusted, and
  precisely why the rest were not

Every metric is computed only from records that survived ingestion. A number on this page
never includes a record the system could not verify.

## The checks

Each record passes two gates before it reaches a metric (`src/ingest.ts`):

**1. Schema validation** (Zod) — shape, types, and domain constraints: no negative
quantities, no empty carts, discount percentage within 0–100.

**2. Arithmetic reconciliation** — every reported aggregate is recomputed from the line
items and compared:

| Check | Catches |
|---|---|
| `total` vs sum of line totals | Dropped or duplicated line items |
| `discountedTotal` vs sum of line net | Discount applied at the wrong level |
| `totalQuantity` vs sum of line quantities | Partial payload |
| `totalProducts` vs line count | Truncated array |
| `price × quantity` vs line `total` | Currency/rounding drift at the line |
| net ≤ gross | Impossible discount |

A failing record is **rejected with a reason, not coerced and not silently dropped**, and
the raw payload is retained so anything rejected stays replayable.

## Fault injection

The live feed is internally consistent — every one of the 208 carts reconciles. That makes
the panel look decorative, and **a data-quality check nobody has seen fail is decoration.**

So there is a toggle: **Inject corrupted feed** damages a deterministic slice with the
three failures that actually show up in production — a missing field, a total that drifts
7%, and an impossible quantity. Accepted drops from 208 to 160 and the panel lists all 48
rejects with the reason each one failed.

That toggle is the point of the whole exercise. It is the difference between claiming the
data is validated and being able to watch the validation work.

## Running it

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 8 tests over the ingestion rules
npm run build
```

## What I would add next, in order

1. **Persist the accept rate over time.** A single snapshot says the feed is healthy today.
   The useful artifact is the trend — a drop from 99% to 94% on a Tuesday is the alert.
2. **Reconcile against a second source.** Line-item arithmetic catches internal
   inconsistency, not systematic loss. Comparing the event feed to orders in the database
   catches the events that never fired at all, which is the failure that costs the most
   and shows up the least.
3. **Alert instead of display.** A panel only works if someone opens it. The threshold
   breach should reach a channel a human already reads.
4. **Attribute the gap.** Once the discrepancy is measured, break it down by source so the
   answer to "which integration is lying" takes a click rather than an afternoon.

## Stack

React 19, TypeScript, Vite, Zod. No chart library — the bars are CSS, which keeps the
bundle honest for something this size. Tests run on `node:test` with native type stripping,
no test-runner dependency.

---

Built by [Kelwin Vieira](https://kelwin.vercel.app/) · [github.com/kelwinv](https://github.com/kelwinv)
