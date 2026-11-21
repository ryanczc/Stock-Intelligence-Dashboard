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
        t("NOW", "2025-06-12", 40, 98.5, "USD", 1.285, "Tiger", "buy", 1.99),
        t("VST", "2025-03-04", 20, 128.0, "USD", 1.34, "Longbridge", "buy", 0.99),
        t("CEG", "2025-05-20", 8, 265.0, "USD", 1.295, "Tiger", "buy", 1.99),
        t("SOFI", "2025-01-15", 400, 14.2, "USD", 1.37, "Longbridge", "buy", 0.99),
        t("IREN", "2025-07-08", 300, 13.1, "USD", 1.275, "Longbridge", "buy", 0.99),
        t("FPS", "2026-03-10", 150, 21.0, "USD", 1.3, "Tiger", "buy", 1.99),
        t("ATAT", "2025-09-02", 100, 35.5, "USD", 1.285, "Tiger", "buy", 1.99),
        t("GRAB", "2025-02-11", 2000, 4.6, "USD", 1.35, "Syfe", "buy", 2.5),
        t("SE", "2025-04-22", 30, 118.0, "USD", 1.31, "Syfe", "buy", 2.5),
        t("MSTR", "2025-08-18", 10, 360.0, "USD", 1.28, "Syfe", "buy", 2.5),
        t("BMNR", "2025-10-06", 200, 48.0, "USD", 1.29, "Syfe", "buy", 2.5),
        t("BTC-USD", "2024-10-10", 0.05, 60500, "USD", 1.31, "Crypto"),
        t("PENDLE-USD", "2025-05-01", 800, 3.6, "USD", 1.30, "Crypto"),
        t("PURR-USD", "2025-09-15", 20000, 0.2, "USD", 1.28, "Crypto"),
        t("SYRUP-USD", "2025-08-01", 10000, 0.45, "USD", 1.285, "Crypto"),
        t("KNTQ-USD", "2026-02-01", 5000, 0.3, "USD", 1.27, "Crypto"),
        t("CARDS-USD", "2026-01-12", 8000, 0.25, "USD", 1.29, "Crypto"),
        t("CASH-SGD", "2025-01-01", 5000, 1, "SGD", 1, "Tiger", "deposit"),
      ]);
      for (const w of ["AAPL", "D05.SI", "C38U.SI", "0700.HK"]) await s.setWatch(w, true);
      await s.saveInstrument({ symbol: "BTC-USD", asset_class: "crypto", extra: { targetPrice5y: 150000 } });
      await s.saveInstrument({ symbol: "CASH-SGD", name: "Cash (SGD)", asset_class: "cash", currency: "SGD", manual_price: 1 });
      await s.saveThesis("VST", "Sample note: power demand from data centres; watch hedged margins and buyback pace.");
    });
  }, [mutate]);

  return (
    <AppCtx.Provider value={{ store, data, error, session, authReady, holdings, totals: tot, valuation, reload, mutate, loadSample }}>{children}</AppCtx.Provider>
  );
}
