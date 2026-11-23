// Storage: Supabase when configured (real use), otherwise the browser's localStorage plus a bundled
// market-data snapshot (preview / demo mode).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Alert, Benchmarks, Decision, Instrument, JournalEntry, MarketData, MarketEvent, ReferenceData, Transaction, ValuationSettings } from "../lib/types";

export interface AppData {
  transactions: Transaction[];
  watchlist: string[];
  instruments: Record<string, Instrument>;
  valuations: Record<string, ValuationSettings>;
  notes: Record<string, string>;
  journal: JournalEntry[];
  customEvents: (MarketEvent & { id: string })[];
  alerts: Alert[];
  decisions: Decision[];
  market: Record<string, MarketData>;
  reference: ReferenceData | null;
  fx: Record<string, number>;
  fxUpdatedAt?: string;
  macro: MarketEvent[];
  benchmarks: Benchmarks;
  /** Database tables the app expects but couldn't read (an SQL update hasn't been run yet). */
  missingTables: string[];
}

export interface DataStore {
  mode: "supabase" | "local";
  load(): Promise<AppData>;
  upsertTransactions(txs: Transaction[]): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  setWatch(symbol: string, on: boolean): Promise<void>;
  saveInstrument(i: Instrument): Promise<void>;
  saveValuation(symbol: string, v: ValuationSettings): Promise<void>;
  saveThesis(symbol: string, text: string): Promise<void>;
  saveJournal(e: JournalEntry): Promise<void>;
  deleteJournal(id: string): Promise<void>;
  saveCustomEvent(e: MarketEvent & { id: string }): Promise<void>;
  deleteCustomEvent(id: string): Promise<void>;
  markAlertsRead(ids: string[]): Promise<void>;
  saveDecision(d: Decision): Promise<void>;
  deleteDecision(id: string): Promise<void>;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

// ---------------------------------------------------------------------------------------------
// Local (browser) store

const KEY = "sid:v1";
type LocalState = Omit<AppData, "market" | "reference" | "fx" | "fxUpdatedAt" | "macro" | "benchmarks" | "missingTables">;
const emptyLocal = (): LocalState => ({ transactions: [], watchlist: [], instruments: {}, valuations: {}, notes: {}, journal: [], customEvents: [], alerts: [], decisions: [] });

export class LocalStore implements DataStore {
  mode = "local" as const;
  private read(): LocalState {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...emptyLocal(), ...JSON.parse(raw) } : emptyLocal();
    } catch {
      return emptyLocal();
    }
  }
  private write(fn: (s: LocalState) => void) {
    const s = this.read();
    fn(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked: changes last for this session only */
    }
  }
  async load(): Promise<AppData> {
    const s = this.read();
    let snap: { market: MarketData[]; fx: Record<string, number>; reference: ReferenceData; generatedAt?: string; macro?: MarketEvent[]; benchmarks?: Benchmarks } = { market: [], fx: { SGD: 1 }, reference: {} };
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}demo/snapshot.json`);
      if (r.ok) snap = await r.json();
    } catch {
      /* offline */
    }
    return {
      ...s,
      market: Object.fromEntries(snap.market.map((m) => [m.symbol, m])),
      reference: snap.reference,
      fx: snap.fx,
      fxUpdatedAt: snap.generatedAt,
      macro: snap.macro ?? [],
      benchmarks: snap.benchmarks ?? {},
      missingTables: [],
    };
  }
  async saveDecision(d: Decision) {
    this.write((s) => {
      s.decisions = s.decisions.filter((x) => x.id !== d.id);
      s.decisions.push(d);
    });
  }
  async deleteDecision(id: string) {
    this.write((s) => void (s.decisions = s.decisions.filter((x) => x.id !== id)));
  }
  async upsertTransactions(txs: Transaction[]) {
    this.write((s) => {
      for (const t of txs) {
        const i = s.transactions.findIndex((x) => x.id === t.id || (t.import_ref && x.import_ref === t.import_ref));
        if (i >= 0) s.transactions[i] = { ...t, id: s.transactions[i].id };
        else s.transactions.push(t);
      }
    });
  }
  async deleteTransaction(id: string) {
    this.write((s) => void (s.transactions = s.transactions.filter((t) => t.id !== id)));
  }
  async setWatch(symbol: string, on: boolean) {
    this.write((s) => {
      s.watchlist = s.watchlist.filter((x) => x !== symbol);
      if (on) s.watchlist.push(symbol);
    });
  }
  async saveInstrument(i: Instrument) {
    this.write((s) => void (s.instruments[i.symbol] = i));
  }
  async saveValuation(symbol: string, v: ValuationSettings) {
    this.write((s) => void (s.valuations[symbol] = v));
  }
  async saveThesis(symbol: string, text: string) {
    this.write((s) => void (s.notes[symbol] = text));
  }
  async saveJournal(e: JournalEntry) {
    this.write((s) => {
      s.journal = s.journal.filter((x) => x.id !== e.id);
      s.journal.push(e);
    });
  }
  async deleteJournal(id: string) {
    this.write((s) => void (s.journal = s.journal.filter((x) => x.id !== id)));
  }
  async saveCustomEvent(e: MarketEvent & { id: string }) {
    this.write((s) => {
      s.customEvents = s.customEvents.filter((x) => x.id !== e.id);
      s.customEvents.push(e);
    });
  }
  async deleteCustomEvent(id: string) {
    this.write((s) => void (s.customEvents = s.customEvents.filter((x) => x.id !== id)));
  }
  async markAlertsRead(ids: string[]) {
    this.write((s) => void s.alerts.forEach((a) => ids.includes(a.id) && (a.read = true)));
  }
  exportJson() {
    return JSON.stringify(this.read(), null, 2);
  }
  importJson(text: string) {
    const parsed = JSON.parse(text);
    this.write((s) => Object.assign(s, emptyLocal(), parsed));
  }
}

// ---------------------------------------------------------------------------------------------
// Supabase store

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || undefined;
// Trim: values pasted into GitHub settings often carry a trailing newline, which breaks HTTP headers.
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || undefined;
export const supabase: SupabaseClient | null = SUPABASE_URL && SUPABASE_ANON ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;

function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export class SupabaseStore implements DataStore {
  mode = "supabase" as const;
  constructor(private db: SupabaseClient) {}
  async load(): Promise<AppData> {
    const d = this.db;
    const [tx, wl, ins, val, notes, journal, ev, alerts, market, ref, dec] = await Promise.all([
      d.from("transactions").select("*").order("trade_date"),
      d.from("watchlist").select("symbol"),
      d.from("instruments").select("*"),
      d.from("valuations").select("symbol,data"),
      d.from("notes").select("symbol,thesis"),
      d.from("journal").select("*").order("entry_date", { ascending: false }),
      d.from("custom_events").select("*"),
      d.from("alerts").select("*").order("created_at", { ascending: false }).limit(200),
      d.from("market_data").select("symbol,data"),
      d.from("reference_data").select("key,data,updated_at"),
      d.from("decisions").select("*").order("decision_date", { ascending: false }),
    ]);
    const num = (x: unknown) => (x == null ? x : Number(x));
    // Tables added after the first setup: if the SQL update hasn't been run yet, keep working without them.
    const missingTables: string[] = [];
    let decisions: Decision[] = [];
    if (dec.error) missingTables.push("decisions");
    else
      decisions = (dec.data ?? []).map((x: Decision) => ({
        ...x,
        price: Number(x.price),
        target_price: num(x.target_price) as number | null,
        stop_price: num(x.stop_price) as number | null,
        dcf_value: num(x.dcf_value) as number | null,
      }));
    const refs = Object.fromEntries((check(ref) ?? []).map((r: { key: string; data: unknown; updated_at: string }) => [r.key, r]));
    return {
      transactions: (check(tx) ?? []).map((t: Transaction) => ({ ...t, quantity: Number(t.quantity), price: Number(t.price), fees: Number(t.fees), fx_to_sgd: num(t.fx_to_sgd) as number | null })),
      watchlist: (check(wl) ?? []).map((r: { symbol: string }) => r.symbol),
      instruments: Object.fromEntries((check(ins) ?? []).map((i: Instrument) => [i.symbol, { ...i, manual_price: num(i.manual_price) as number | null }])),
      valuations: Object.fromEntries((check(val) ?? []).map((r: { symbol: string; data: ValuationSettings }) => [r.symbol, r.data])),
      notes: Object.fromEntries((check(notes) ?? []).map((r: { symbol: string; thesis: string }) => [r.symbol, r.thesis])),
      journal: check(journal) ?? [],
      customEvents: check(ev) ?? [],
      alerts: check(alerts) ?? [],
      market: Object.fromEntries((check(market) ?? []).map((r: { symbol: string; data: MarketData }) => [r.symbol, r.data])),
      reference: (refs.damodaran?.data as ReferenceData) ?? null,
      fx: (refs.fx?.data as { rates: Record<string, number> })?.rates ?? { SGD: 1 },
      fxUpdatedAt: refs.fx?.updated_at,
      macro: (refs.macro?.data as { events: MarketEvent[] })?.events ?? [],
      benchmarks: (refs.benchmarks?.data as Benchmarks) ?? {},
      decisions,
      missingTables,
    };
  }
  async upsertTransactions(txs: Transaction[]) {
    const withRef = txs.filter((t) => t.import_ref);
    const plain = txs.filter((t) => !t.import_ref);
    if (plain.length) check(await this.db.from("transactions").upsert(plain));
    if (withRef.length) check(await this.db.from("transactions").upsert(withRef, { onConflict: "import_ref" }));
  }
  async deleteTransaction(id: string) {
    check(await this.db.from("transactions").delete().eq("id", id));
  }
  async setWatch(symbol: string, on: boolean) {
    if (on) check(await this.db.from("watchlist").upsert({ symbol }));
    else check(await this.db.from("watchlist").delete().eq("symbol", symbol));
  }
  async saveInstrument(i: Instrument) {
    check(await this.db.from("instruments").upsert({ ...i, updated_at: new Date().toISOString() }));
  }
  async saveValuation(symbol: string, v: ValuationSettings) {
    check(await this.db.from("valuations").upsert({ symbol, data: v, updated_at: new Date().toISOString() }));
  }
  async saveThesis(symbol: string, text: string) {
    check(await this.db.from("notes").upsert({ symbol, thesis: text, updated_at: new Date().toISOString() }));
  }
  async saveJournal(e: JournalEntry) {
    check(await this.db.from("journal").upsert(e));
  }
  async deleteJournal(id: string) {
    check(await this.db.from("journal").delete().eq("id", id));
  }
  async saveCustomEvent(e: MarketEvent & { id: string }) {
    check(await this.db.from("custom_events").upsert({ id: e.id, symbol: e.symbol ?? null, date: e.date, type: e.type, title: e.title }));
  }
  async deleteCustomEvent(id: string) {
    check(await this.db.from("custom_events").delete().eq("id", id));
  }
  async markAlertsRead(ids: string[]) {
    if (ids.length) check(await this.db.from("alerts").update({ read: true }).in("id", ids));
  }
  async saveDecision(x: Decision) {
    check(await this.db.from("decisions").upsert(x));
  }
  async deleteDecision(id: string) {
    check(await this.db.from("decisions").delete().eq("id", id));
  }
}
