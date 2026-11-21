import { useState } from "react";
import { useNavigate } from "react-router-dom";

/** Type a Yahoo symbol (AAPL, D05.SI, 0700.HK, BTC-USD) and jump to its page. */
export function SymbolSearch() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const s = q.trim().toUpperCase();
        if (s) nav(`/s/${encodeURIComponent(s)}`);
        setQ("");
      }}
    >
      <input aria-label="Go to symbol" placeholder="Symbol…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 120 }} />
    </form>
  );
}
