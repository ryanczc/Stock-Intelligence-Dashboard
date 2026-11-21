import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { LocalStore, SupabaseStore, supabase, uid, type AppData, type DataStore } from "./store";
import { computeHoldings, totals, type Holding } from "../lib/portfolio";
import { valueSymbol, type SimpleTarget, type Valuation } from "../lib/valuation";
import type { Transaction } from "../lib/types";

interface Ctx {
  store: DataStore;
  data: AppData | null;
  error: string | null;
  session: Session | null;
  authReady: boolean;
  holdings: Holding[];
  totals: ReturnType<typeof totals>;
  valuation: (symbol: string) => Valuation | SimpleTarget | null;
  reload: () => Promise<void>;
  mutate: (fn: (store: DataStore) => Promise<void>) => Promise<void>;
  loadSample: () => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

const store: DataStore = supabase ? new SupabaseStore(supabase) : new LocalStore();

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await store.load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (store.mode === "local" || session) reload();
  }, [session, reload]);

  const mutate = useCallback(
    async (fn: (s: DataStore) => Promise<void>) => {
      try {
        await fn(store);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [reload],
  );

  const holdings = useMemo(() => (data ? computeHoldings(data.transactions, data.market, data.fx, data.instruments) : []), [data]);
  const tot = useMemo(() => totals(holdings), [holdings]);

  const cache = useMemo(() => new Map<string, Valuation | SimpleTarget | null>(), [data]);
  const valuation = useCallback(
    (symbol: string) => {
      if (!data) return null;
      if (cache.has(symbol)) return cache.get(symbol)!;
      const settings = data.valuations[symbol];
      const comps = (settings?.comps ?? []).map((c) => data.market[c]).filter(Boolean);
      let v: Valuation | SimpleTarget | null = null;
      try {
        v = valueSymbol(data.market[symbol], data.reference, data.fx, settings, comps, data.instruments[symbol]);
      } catch (e) {
        console.error("valuation failed", symbol, e);
      }
      if (!v && data.instruments[symbol]?.extra?.targetPrice5y) {
        v = { kind: "target", targetPrice5y: data.instruments[symbol].extra!.targetPrice5y!, cagr: null, price: data.instruments[symbol].manual_price ?? null };
      }
      cache.set(symbol, v);
      return v;
    },
    [data, cache],
  );

  const loadSample = useCallback(async () => {
    const t = (symbol: string, trade_date: string, quantity: number, price: number, currency: string, fx: number, platform: string, type: Transaction["type"] = "buy", fees = 0): Transaction => ({
      id: uid(), symbol, type, trade_date, quantity, price, currency, fx_to_sgd: fx, fees, platform, note: "sample",
    });
    await mutate(async (s) => {
      await s.upsertTransactions([
        t("AAPL", "2024-03-12", 20, 172.5, "USD", 1.335, "Tiger", "buy", 1.99),
        t("AAPL", "2025-04-08", 10, 181.0, "USD", 1.34, "Longbridge", "buy", 0.99),
        t("MSFT", "2024-08-05", 8, 395.0, "USD", 1.325, "Tiger", "buy", 1.99),
        t("NVDA", "2025-01-27", 40, 118.0, "USD", 1.355, "Longbridge", "buy", 0.99),
        t("NVDA", "2025-06-10", 10, 142.0, "USD", 1.285, "Longbridge", "sell", 0.99),
        t("D05.SI", "2024-05-20", 300, 35.2, "SGD", 1, "Tiger", "buy", 4.5),
        t("D05.SI", "2025-08-14", 1, 225, "SGD", 1, "Tiger", "dividend"),
        t("C38U.SI", "2024-11-02", 3000, 1.98, "SGD", 1, "Syfe", "buy", 2.0),
        t("ES3.SI", "2025-02-03", 500, 3.85, "SGD", 1, "Syfe"),
        t("0700.HK", "2025-03-18", 200, 505.0, "HKD", 0.172, "Longbridge", "buy", 15),
        t("BTC-USD", "2024-10-10", 0.15, 60500, "USD", 1.31, "Crypto"),
        t("ETH-USD", "2025-02-20", 2, 2700, "USD", 1.34, "Crypto"),
        t("CASH-SGD", "2025-01-01", 8000, 1, "SGD", 1, "Tiger", "deposit"),
      ]);
      for (const w of ["MSFT", "0700.HK"]) await s.setWatch(w, true);
      await s.saveInstrument({ symbol: "BTC-USD", asset_class: "crypto", extra: { targetPrice5y: 150000 } });
      await s.saveInstrument({ symbol: "ETH-USD", asset_class: "crypto", extra: { targetPrice5y: 5000 } });
      await s.saveInstrument({ symbol: "CASH-SGD", name: "Cash (SGD)", asset_class: "cash", currency: "SGD", manual_price: 1 });
      await s.saveThesis("AAPL", "Services mix shift keeps margins high; watch China demand and AI upgrade cycle.");
    });
  }, [mutate]);

  return (
    <AppCtx.Provider value={{ store, data, error, session, authReady, holdings, totals: tot, valuation, reload, mutate, loadSample }}>{children}</AppCtx.Provider>
  );
}
