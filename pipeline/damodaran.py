"""Download and parse Aswath Damodaran's public datasets (https://pages.stern.nyu.edu/~adamodar/).

Produces the `reference` document the web app uses to seed DCF assumptions:
  erp, riskFree, countries {name: {erp, crp}}, industries {US|Global: {industry: metrics}}.
Damodaran updates these each January (and ERP monthly), so a weekly refresh is plenty.
"""
from __future__ import annotations

import io
import re
import datetime as dt
from typing import Any

import pandas as pd
import requests

BASE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/"
UA = {"User-Agent": "Mozilla/5.0 (personal portfolio dashboard; data refresh)"}

# file -> {our metric: [header keywords, all must appear in the column name (lower-case)]}
INDUSTRY_FILES: dict[str, dict[str, list[list[str]]]] = {
    "betas": {
        "unleveredBeta": [["unlevered beta corrected for cash"], ["unlevered beta"]],
        "deRatio": [["d/e ratio"]],
        "taxRate": [["effective tax rate"], ["tax rate"]],
    },
    "margin": {
        "operatingMargin": [["pre-tax unlevered operating margin"], ["pre-tax", "operating margin"], ["operating margin"]],
        "netMargin": [["net margin"]],
    },
    "capex": {
        "salesToCapital": [["sales/ invested capital"], ["sales/invested capital"], ["sales", "capital"]],
    },
    "pe": {
        "pe": [["current pe"], ["trailing pe"]],
        "forwardPe": [["forward pe"]],
        "expectedGrowth": [["expected growth"]],
    },
    "vebitda": {"evEbitda": [["ev/ebitda"]]},
    "pbvdata": {"pb": [["pbv"]], "roe": [["roe"]]},
    "wacc": {"costOfCapital": [["cost of capital"]], "costOfEquity": [["cost of equity"]]},
    "fundgr": {"fundamentalGrowth": [["expected growth"], ["growth"]]},
}

REGION_SUFFIX = {"US": "", "Global": "Global"}


def _fetch(name: str) -> bytes | None:
    for ext in (".xls", ".xlsx"):
        try:
            r = requests.get(BASE + name + ext, headers=UA, timeout=60)
            if r.status_code == 200 and len(r.content) > 1000:
                return r.content
        except requests.RequestException:
            continue
    return None


def _num(v: Any) -> float | None:
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        if isinstance(v, str):
            m = re.match(r"^\s*(-?[\d.]+)\s*%\s*$", v)
            if m:
                return float(m.group(1)) / 100
        return None


def parse_industry_table(content: bytes, metrics: dict[str, list[list[str]]]) -> dict[str, dict[str, float]]:
    """Find the sheet/row whose first column header is 'Industry Name' and map the requested metrics."""
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    for _, raw in sheets.items():
        hdr_idx = None
        for i in range(min(len(raw), 30)):
            cells = [str(c).strip().lower() for c in raw.iloc[i].tolist()]
            if "industry name" in cells or "industry  name" in cells:
                hdr_idx = i
                break
        if hdr_idx is None:
            continue
        headers = [re.sub(r"\s+", " ", str(c).strip().lower()) for c in raw.iloc[hdr_idx].tolist()]
        name_col = next(i for i, h in enumerate(headers) if h.startswith("industry"))
        col_for: dict[str, int] = {}
        for metric, options in metrics.items():
            for keywords in options:
                hit = next((i for i, h in enumerate(headers) if all(k in h for k in keywords)), None)
                if hit is not None:
                    col_for[metric] = hit
                    break
        if not col_for:
            continue
        out: dict[str, dict[str, float]] = {}
        for i in range(hdr_idx + 1, len(raw)):
            name = raw.iat[i, name_col]
            if not isinstance(name, str) or not name.strip():
                continue
            vals = {m: _num(raw.iat[i, c]) for m, c in col_for.items()}
            out[name.strip()] = {k: v for k, v in vals.items() if v is not None}
        if out:
            return out
    return {}


def parse_country_premiums(content: bytes) -> dict[str, dict[str, float]]:
    """ctryprem.xlsx: country -> {erp, crp}. Searches every sheet for a 'Country' header with ERP/CRP columns."""
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    best: dict[str, dict[str, float]] = {}
    for _, raw in sheets.items():
        for i in range(min(len(raw), 40)):
            headers = [re.sub(r"\s+", " ", str(c).strip().lower()) for c in raw.iloc[i].tolist()]
            if not headers or "country" not in headers:
                continue
            c_col = headers.index("country")
            erp_col = next((j for j, h in enumerate(headers) if "total equity risk premium" in h or h == "equity risk premium" or h == "erp"), None)
            crp_col = next((j for j, h in enumerate(headers) if "country risk premium" in h or h == "crp"), None)
            if erp_col is None and crp_col is None:
                continue
            out = {}
            for r in range(i + 1, len(raw)):
                name = raw.iat[r, c_col]
                if not isinstance(name, str) or not name.strip():
                    continue
                d = {}
                if erp_col is not None and _num(raw.iat[r, erp_col]) is not None:
                    d["erp"] = _num(raw.iat[r, erp_col])
                if crp_col is not None and _num(raw.iat[r, crp_col]) is not None:
                    d["crp"] = _num(raw.iat[r, crp_col])
                if d:
                    out[name.strip()] = d
            if len(out) > len(best):
                best = out
            break
    return best


def build_reference(risk_free_usd: float | None, log=print) -> dict:
    ref: dict[str, Any] = {
        "source": "Damodaran Online datasets",
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "industries": {},
        "countries": {},
        "riskFree": {},
    }
    if risk_free_usd:
        ref["riskFree"]["USD"] = risk_free_usd
    cp = _fetch("ctryprem")
    if cp:
        try:
            ref["countries"] = parse_country_premiums(cp)
            us = ref["countries"].get("United States", {})
            if us.get("erp"):
                ref["erp"] = us["erp"]
            log(f"damodaran: {len(ref['countries'])} countries, mature ERP {ref.get('erp')}")
        except Exception as e:  # noqa: BLE001
            log(f"damodaran: ctryprem parse failed: {e}")
    else:
        log("damodaran: ctryprem download failed")

    for region, suffix in REGION_SUFFIX.items():
        merged: dict[str, dict[str, float]] = {}
        for base, metrics in INDUSTRY_FILES.items():
            content = _fetch(base + suffix)
            if not content:
                log(f"damodaran: {base + suffix} download failed")
                continue
            try:
                table = parse_industry_table(content, metrics)
                for ind, vals in table.items():
                    merged.setdefault(ind, {}).update(vals)
                log(f"damodaran: {base + suffix}: {len(table)} industries")
            except Exception as e:  # noqa: BLE001
                log(f"damodaran: {base + suffix} parse failed: {e}")
        ref["industries"][region] = merged
    return ref
