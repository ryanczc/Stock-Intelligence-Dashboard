"""Publish the list of tickers Ryan holds and watches for the weekly Claude research routine.

Writes research/universe.json to the `data` branch (never main, so it doesn't trigger a site deploy).
Only tickers are published, never quantities or prices paid. Runs at the end of the data job.

  python -m pipeline.universe            # publish (needs GITHUB_TOKEN, GITHUB_REPOSITORY)
  python -m pipeline.universe --print    # just print
"""
from __future__ import annotations

import base64
import json
import os
import sys
from collections import defaultdict

import requests

BRANCH = "data"
PATH = "research/universe.json"


def build(store) -> dict:
    qty: dict[str, float] = defaultdict(float)
    for r in store._get("transactions", {"select": "symbol,type,quantity", "type": "in.(buy,sell)"}):
        qty[r["symbol"]] += float(r["quantity"] or 0) * (1 if r["type"] == "buy" else -1)
    holdings = sorted(s for s, q in qty.items() if q > 1e-9)
    watch = sorted({r["symbol"] for r in store._get("watchlist", {"select": "symbol"})} - set(holdings))
    classes = {r["symbol"]: r.get("asset_class") for r in store._get("instruments", {"select": "symbol,asset_class"})}
    skip = {s for s, c in classes.items() if c in ("cash", "bond")}
    return {"holdings": [s for s in holdings if s not in skip], "watchlist": [s for s in watch if s not in skip]}


def publish(universe: dict, token: str, repo: str) -> str:
    api = f"https://api.github.com/repos/{repo}"
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    r = requests.get(f"{api}/git/ref/heads/{BRANCH}", headers=h, timeout=30)
    if r.status_code == 404:
        main = requests.get(f"{api}/git/ref/heads/main", headers=h, timeout=30)
        main.raise_for_status()
        requests.post(f"{api}/git/refs", headers=h, json={"ref": f"refs/heads/{BRANCH}", "sha": main.json()["object"]["sha"]}, timeout=30).raise_for_status()
    cur = requests.get(f"{api}/contents/{PATH}", headers=h, params={"ref": BRANCH}, timeout=30)
    sha = None
    if cur.status_code == 200:
        sha = cur.json()["sha"]
        old = json.loads(base64.b64decode(cur.json()["content"]))
        if {k: old.get(k) for k in ("holdings", "watchlist")} == universe:
            return "unchanged"
    import datetime as dt

    body = {**universe, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    payload = {"message": "Update tracked tickers for weekly research", "branch": BRANCH,
               "content": base64.b64encode((json.dumps(body, indent=2) + "\n").encode()).decode()}
    if sha:
        payload["sha"] = sha
    requests.put(f"{api}/contents/{PATH}", headers=h, json=payload, timeout=30).raise_for_status()
    return "updated"


def main() -> int:
    from .store import Store

    u = build(Store())
    print(f"universe: {len(u['holdings'])} holdings, {len(u['watchlist'])} watchlist")
    if "--print" in sys.argv:
        print(json.dumps(u, indent=2))
        return 0
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("GITHUB_TOKEN/GITHUB_REPOSITORY not set; skipping publish")
        return 0
    print(f"universe: {publish(u, token, repo)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
