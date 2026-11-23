import { NavLink, Route, Routes } from "react-router-dom";
import { useApp } from "./data/AppContext";
import { supabase } from "./data/store";
import Dashboard from "./pages/Dashboard";
import Holdings from "./pages/Holdings";
import Watchlist from "./pages/Watchlist";
import StockPage from "./pages/StockPage";
import Calendar from "./pages/Calendar";
import Risk from "./pages/Risk";
import Review from "./pages/Review";
import Trades from "./pages/Trades";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import { SymbolSearch } from "./components/SymbolSearch";

export default function App() {
  const { store, session, authReady, data, error } = useApp();
  if (store.mode === "supabase" && authReady && !session) return <Login />;
  return (
    <>
      <header className="topbar">
        <div className="brand">
          Stock<span>Intel</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/holdings">Holdings</NavLink>
          <NavLink to="/watchlist">Watchlist</NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
          <NavLink to="/risk">Risk</NavLink>
          <NavLink to="/review">Review</NavLink>
          <NavLink to="/trades">Trades</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="spacer" />
        <SymbolSearch />
      </header>
      <main>
        {store.mode === "local" && (
          <div className="banner small">
            Preview mode: your entries are saved in this browser only, and prices come from a bundled snapshot of {Object.keys(data?.market ?? {}).length} tickers
            taken {data?.fxUpdatedAt ?? ""}. Connect Supabase (see Settings) for live twice-daily data and sync across phone and computer.
          </div>
        )}
        {error && <div className="banner err small">Something went wrong: {error}{supabase && " (check that your Google email is in the app_owner table)."}</div>}
        {!data ? (
          <div className="empty">Loading…</div>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/s/:symbol" element={<StockPage />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/risk" element={<Risk />} />
            <Route path="/review" element={<Review />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        )}
      </main>
    </>
  );
}
