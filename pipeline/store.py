"""Tiny Supabase (PostgREST) client for the data job. Uses the service-role key from GitHub Actions secrets."""
from __future__ import annotations

import base64
import json
import os
from typing import Any

import requests


def key_problem(key: str) -> str | None:
    """Return a plain-English problem if this is not a server (secret / service_role) key."""
    if key.startswith("sb_publishable_"):
        return "SUPABASE_SERVICE_ROLE_KEY holds the publishable key. Use the secret key (sb_secret_...) instead."
    if key.startswith("sb_"):
        return None
    try:
        payload = key.split(".")[1]
        role = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("role")
    except Exception:  # noqa: BLE001
        return "SUPABASE_SERVICE_ROLE_KEY doesn't look like a Supabase key. Copy the secret or service_role key again."
    if role != "service_role":
        return f"SUPABASE_SERVICE_ROLE_KEY holds the '{role}' key. Use the service_role key instead."
    return None


def check(r: requests.Response) -> None:
    """raise_for_status, but include Supabase's explanation so the Actions log says what went wrong."""
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase {r.status_code} on {r.request.method} {r.url.split('/rest/v1')[-1]}: {r.text[:500]}")


class Store:
    def __init__(self, url: str | None = None, key: str | None = None):
        # .strip(): secrets pasted into GitHub often carry a trailing newline, which requests rejects in headers.
        self.url = (url or os.environ["SUPABASE_URL"]).strip().rstrip("/") + "/rest/v1"
        key = (key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]).strip()
        # Legacy service_role keys are JWTs and go in both headers. New-style secret keys
        # (sb_secret_...) are not JWTs and must only be sent as `apikey`.
        if problem := key_problem(key):
            raise SystemExit(problem)
        self.h = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_"):
            self.h["Authorization"] = f"Bearer {key}"

    def _get(self, table: str, params: dict[str, str]) -> list[dict]:
        r = requests.get(f"{self.url}/{table}", headers=self.h, params=params, timeout=30)
        check(r)
        return r.json()

    def _upsert(self, table: str, rows: list[dict], on_conflict: str, ignore_duplicates=False) -> list[dict]:
        if not rows:
            return []
        prefer = "resolution=ignore-duplicates" if ignore_duplicates else "resolution=merge-duplicates"
        h = {**self.h, "Prefer": prefer + ",return=representation"}
        r = requests.post(f"{self.url}/{table}", headers=h, params={"on_conflict": on_conflict}, json=rows, timeout=60)
        check(r)
        return r.json() if r.text else []

    # --- reads ---
    def tracked_symbols(self) -> list[str]:
        syms: set[str] = set()
        manual = {r["symbol"] for r in self._get("instruments", {"select": "symbol", "asset_class": "in.(cash,bond)"})}
        for r in self._get("transactions", {"select": "symbol", "type": "in.(buy,sell)"}):
            syms.add(r["symbol"])
        for r in self._get("watchlist", {"select": "symbol"}):
            syms.add(r["symbol"])
        for r in self._get("valuations", {"select": "data"}):
            for c in (r.get("data") or {}).get("comps", []) or []:
                syms.add(c)
        return sorted(s for s in syms if s and s not in manual)

    def market_data(self) -> dict[str, dict]:
        return {r["symbol"]: r["data"] for r in self._get("market_data", {"select": "symbol,data"})}

    def reference(self, key: str) -> dict | None:
        rows = self._get("reference_data", {"select": "data,updated_at", "key": f"eq.{key}"})
        return rows[0] if rows else None

    def transactions_missing_fx(self) -> list[dict]:
        return self._get("transactions", {"select": "id,currency,trade_date", "fx_to_sgd": "is.null", "currency": "not.is.null"})

    def instruments(self) -> list[dict]:
        return self._get("instruments", {"select": "symbol,asset_class,extra"})

    def custom_events(self) -> list[dict]:
        return self._get("custom_events", {"select": "symbol,date,type,title"})

    # --- writes ---
    def save_market_data(self, docs: list[dict]) -> None:
        rows = [{"symbol": d["symbol"], "data": d, "updated_at": d["updatedAt"]} for d in docs]
        for i in range(0, len(rows), 20):
            self._upsert("market_data", rows[i : i + 20], "symbol")

    def save_reference(self, key: str, data: Any) -> None:
        import datetime as dt

        self._upsert("reference_data", [{"key": key, "data": data, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}], "key")

    def set_fx(self, tx_id: str, fx: float) -> None:
        r = requests.patch(f"{self.url}/transactions", headers=self.h, params={"id": f"eq.{tx_id}"}, json={"fx_to_sgd": fx}, timeout=30)
        check(r)

    def insert_alerts(self, alerts: list[dict]) -> list[dict]:
        """Insert alerts, skipping ones already sent (dedupe_key). Returns only the new ones."""
        return self._upsert("alerts", alerts, "dedupe_key", ignore_duplicates=True)
