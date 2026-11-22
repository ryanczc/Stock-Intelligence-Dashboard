import datetime as dt
import io

import pandas as pd

from pipeline import alerts, damodaran, yahoo


def test_row_and_series():
    df = pd.DataFrame(
        {pd.Timestamp("2024-09-30"): [100.0, 30.0], pd.Timestamp("2023-09-30"): [90.0, None]},
        index=["Total Revenue", "Operating Income"],
    )
    assert yahoo.row(df, "Missing", "Total Revenue") == 100.0
    assert yahoo.row(df, "Operating Income", col=1) is None
    assert yahoo.series(df, "Total Revenue") == [{"year": 2023, "value": 90.0}, {"year": 2024, "value": 100.0}]
    assert yahoo.row(None, "x") is None


def test_classify():
    assert yahoo.classify({"quoteType": "CRYPTOCURRENCY"}, "BTC-USD") == "crypto"
    assert yahoo.classify({"quoteType": "ETF"}, "ES3.SI") == "etf"
    assert yahoo.classify({"industry": "REIT - Retail"}, "C38U.SI") == "reit"
    assert yahoo.classify({"industry": "Banks - Regional"}, "D05.SI") == "bank"
    assert yahoo.classify({"industry": "Insurance - Life"}, "1299.HK") == "insurer"
    assert yahoo.classify({"industry": "Consumer Electronics"}, "AAPL") == "stock"


def test_make_alerts():
    today = dt.date(2026, 11, 21)
    doc = {
        "symbol": "AAPL",
        "currency": "USD",
        "price": 106.0,
        "prevClose": 100.0,
        "events": [{"date": "2026-11-25", "type": "earnings", "title": "Earnings release"}, {"date": "2027-02-01", "type": "earnings", "title": "later"}],
        "insiders": [
            {"date": "2026-11-15", "insider": "COOK TIM", "position": "CEO", "text": "Sale", "shares": 10000, "value": 2_000_000},
            {"date": "2026-11-15", "insider": "SMALL", "value": 10_000},
        ],
        "institutions": [{"holder": "Vanguard", "pctChange": 0.25, "date": "2026-09-30"}, {"holder": "X", "pctChange": 0.01}],
    }
    out = alerts.make_alerts(doc, today)
    kinds = sorted(a["kind"] for a in out)
    assert kinds == ["earnings", "fund", "insider", "price_move"]
    assert len({a["dedupe_key"] for a in out}) == len(out)


def test_macro_alerts():
    out = alerts.macro_alerts([{"date": "2026-11-22", "type": "macro", "title": "FOMC"}, {"date": "2026-12-30", "title": "x"}], dt.date(2026, 11, 21))
    assert [a["message"] for a in out] == ["FOMC on 2026-11-22"]


def _xlsx(frames: dict) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        for name, df in frames.items():
            df.to_excel(w, sheet_name=name, header=False, index=False)
    return buf.getvalue()


def test_parse_industry_table_finds_header_row():
    raw = pd.DataFrame(
        [
            ["Date updated:", "January 2026", None],
            [None, None, None],
            ["Industry Name", "Number of firms", "Unlevered beta corrected for cash"],
            ["Software (System & Application)", 300, 1.2],
            ["R.E.I.T.", 200, 0.6],
        ]
    )
    t = damodaran.parse_industry_table(_xlsx({"Industry Averages": raw}), {"unleveredBeta": [["unlevered beta corrected for cash"]]})
    assert t["Software (System & Application)"]["unleveredBeta"] == 1.2
    assert t["R.E.I.T."]["unleveredBeta"] == 0.6


def test_parse_country_premiums():
    raw = pd.DataFrame(
        [
            ["Country", "Moody's rating", "Total Equity Risk Premium", "Country Risk Premium"],
            ["United States", "Aa1", 0.0433, 0.0],
            ["China", "A1", 0.0510, 0.0077],
        ]
    )
    c = damodaran.parse_country_premiums(_xlsx({"ERPs by country": raw}))
    assert c["United States"]["erp"] == 0.0433
    assert c["China"]["crp"] == 0.0077


def test_key_problem():
    import base64, json
    from pipeline.store import key_problem

    def jwt(role):
        body = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
        return f"eyJhbGciOiJIUzI1NiJ9.{body}.sig"

    assert key_problem(jwt("service_role")) is None
    assert "anon" in key_problem(jwt("anon"))
    assert key_problem("sb_secret_abc") is None
    assert "publishable" in key_problem("sb_publishable_abc")
