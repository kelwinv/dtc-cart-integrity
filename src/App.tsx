import { useEffect, useMemo, useState } from "react";
import { corrupt, fetchFeed, ingest, type CategoryIndex, type IngestResult } from "./ingest";
import { computeKpis, revenueByCategory, topDiscountLeakage } from "./metrics";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function App() {
  const [raw, setRaw] = useState<unknown[] | null>(null);
  const [categories, setCategories] = useState<CategoryIndex>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [injectFaults, setInjectFaults] = useState(false);

  useEffect(() => {
    fetchFeed()
      .then(({ carts, categories }) => {
        setRaw(carts);
        setCategories(categories);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const result: IngestResult | null = useMemo(() => {
    if (!raw) return null;
    return ingest(injectFaults ? corrupt(raw) : raw);
  }, [raw, injectFaults]);

  if (error) return <Shell><p className="error">Feed unavailable: {error}</p></Shell>;
  if (!result) return <Shell><p className="muted">Loading feed…</p></Shell>;

  const kpis = computeKpis(result.accepted);
  const byCategory = revenueByCategory(result.accepted, categories).slice(0, 8);
  const leakage = topDiscountLeakage(result.accepted);
  const acceptRate = result.received > 0 ? result.accepted.length / result.received : 0;

  return (
    <Shell>
      <section className="kpis">
        <Kpi label="Orders" value={String(kpis.orders)} note="verified only" />
        <Kpi label="Net revenue" value={money(kpis.net)} note={`gross ${money(kpis.gross)}`} />
        <Kpi
          label="Discount leakage"
          value={money(kpis.discountLeakage)}
          note={`${pct(kpis.discountRate)} of gross`}
          tone="warn"
        />
        <Kpi label="AOV" value={money(kpis.aov)} note={`${kpis.unitsPerOrder} units/order`} />
      </section>

      <section className="panel integrity" data-degraded={result.rejected.length > 0}>
        <header>
          <h2>Ingestion integrity</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={injectFaults}
              onChange={(e) => setInjectFaults(e.target.checked)}
            />
            <span>Inject corrupted feed</span>
          </label>
        </header>

        <div className="counters">
          <Counter label="Received" value={result.received} />
          <Counter label="Accepted" value={result.accepted.length} tone="ok" />
          <Counter
            label="Rejected"
            value={result.rejected.length}
            tone={result.rejected.length > 0 ? "bad" : undefined}
          />
          <Counter label="Accept rate" value={pct(acceptRate)} />
        </div>

        {result.rejected.length === 0 ? (
          <p className="muted">
            Every record passed schema validation and arithmetic reconciliation against its own
            line items. Flip the toggle to watch the checks fail.
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Cart</th><th>Stage</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {result.rejected.slice(0, 12).map((r, i) => (
                <tr key={`${r.cartId}-${i}`}>
                  <td className="mono">#{r.cartId}</td>
                  <td><span className={`tag ${r.stage}`}>{r.stage}</span></td>
                  <td className="mono reason">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {result.rejected.length > 12 && (
          <p className="muted">…and {result.rejected.length - 12} more rejected records.</p>
        )}
      </section>

      <div className="grid">
        <section className="panel">
          <h2>Net revenue by category</h2>
          <ul className="bars">
            {byCategory.map((row) => (
              <li key={row.category}>
                <span className="bar-label">{row.category}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${row.share * 100}%` }} />
                </span>
                <span className="bar-value mono">{money(row.net)}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Lines are joined to the product catalogue by id. Anything that fails to join is shown
            as <code>unmapped</code> rather than dropped — an unjoinable row understates revenue
            silently, so it is better surfaced than hidden.
          </p>
        </section>

        <section className="panel">
          <h2>Highest discount leakage</h2>
          <table>
            <thead>
              <tr><th>Cart</th><th>Gross</th><th>Leaked</th><th>Rate</th></tr>
            </thead>
            <tbody>
              {leakage.map((row) => (
                <tr key={row.id}>
                  <td className="mono">#{row.id}</td>
                  <td className="mono">{money(row.gross)}</td>
                  <td className="mono warn">{money(row.leakage)}</td>
                  <td className="mono">{pct(row.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <header className="masthead">
        <h1>Cart integrity</h1>
        <p>
          A revenue dashboard that refuses to plot a number it could not verify. Feed:{" "}
          <a href="https://dummyjson.com/carts" target="_blank" rel="noreferrer">
            dummyjson.com/carts
          </a>
        </p>
      </header>
      {children}
      <footer>
        Built by <a href="https://kelwin.vercel.app/">Kelwin Vieira</a> ·{" "}
        <a href="https://github.com/kelwinv">github.com/kelwinv</a>
      </footer>
    </main>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" }) {
  return (
    <div className="kpi" data-tone={tone}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "bad" }) {
  return (
    <div className="counter" data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
