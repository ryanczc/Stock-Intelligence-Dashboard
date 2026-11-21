// Fallback reference values, used only until the data job has loaded Damodaran's current datasets.
// Approximate (Damodaran, January 2025). The app shows which source each assumption came from.
import type { IndustryRef, ReferenceData } from "../types";

export const FALLBACK_REFERENCE: ReferenceData = {
  source: "Built-in fallback (approx. Damodaran Jan 2025). Run the data job to load current values.",
  erp: 0.0433,
  riskFree: { USD: 0.042 },
  countries: {
    "United States": { erp: 0.0433, crp: 0 },
    Singapore: { erp: 0.0433, crp: 0 },
    "Hong Kong": { erp: 0.0503, crp: 0.007 },
    China: { erp: 0.0518, crp: 0.0085 },
  },
  industries: {
    US: {
      "Total Market": { unleveredBeta: 0.9, operatingMargin: 0.13, salesToCapital: 1.6, pe: 24, evEbitda: 14, pb: 3.5 },
      "Software (System & Application)": { unleveredBeta: 1.2, operatingMargin: 0.3, salesToCapital: 1.4, pe: 40, evEbitda: 26, pb: 10 },
      "Software (Internet)": { unleveredBeta: 1.4, operatingMargin: 0.15, salesToCapital: 1.4, pe: 35, evEbitda: 22, pb: 6 },
      Semiconductor: { unleveredBeta: 1.45, operatingMargin: 0.32, salesToCapital: 0.9, pe: 40, evEbitda: 28, pb: 8 },
      "Computers/Peripherals": { unleveredBeta: 1.1, operatingMargin: 0.26, salesToCapital: 2.4, pe: 33, evEbitda: 24, pb: 20 },
      "Bank (Money Center)": { unleveredBeta: 0.85, pe: 12, pb: 1.3, roe: 0.11 },
      "Banks (Regional)": { unleveredBeta: 0.45, pe: 12, pb: 1.1, roe: 0.1 },
      "Insurance (Life)": { unleveredBeta: 0.7, pe: 12, pb: 1.3, roe: 0.11 },
      "Insurance (General)": { unleveredBeta: 0.7, pe: 14, pb: 1.6, roe: 0.12 },
      "R.E.I.T.": { unleveredBeta: 0.6, pe: 30, evEbitda: 18, pb: 1.8 },
      "Retail (General)": { unleveredBeta: 0.9, operatingMargin: 0.06, salesToCapital: 3, pe: 28, evEbitda: 15, pb: 6 },
      "Drugs (Pharmaceutical)": { unleveredBeta: 1.0, operatingMargin: 0.25, salesToCapital: 1, pe: 25, evEbitda: 15, pb: 6 },
    },
  },
};

// Yahoo industry -> Damodaran industry. Ordered: first keyword hit wins.
const INDUSTRY_MAP: [RegExp, string][] = [
  [/^banks? - (diversified|global)/i, "Bank (Money Center)"],
  [/^banks?/i, "Banks (Regional)"],
  [/insurance - life/i, "Insurance (Life)"],
  [/insurance - property/i, "Insurance (Prop/Cas.)"],
  [/reinsurance/i, "Reinsurance"],
  [/insurance/i, "Insurance (General)"],
  [/^reit - retail/i, "R.E.I.T."],
  [/^reit/i, "R.E.I.T."],
  [/real estate - development/i, "Real Estate (Development)"],
  [/real estate/i, "Real Estate (Operations & Services)"],
  [/asset management|capital markets/i, "Investments & Asset Management"],
  [/credit services|financial data/i, "Financial Svcs. (Non-bank & Insurance)"],
  [/software - infrastructure|software - application/i, "Software (System & Application)"],
  [/internet content|internet retail/i, "Software (Internet)"],
  [/electronic gaming|multimedia/i, "Software (Entertainment)"],
  [/semiconductor equipment/i, "Semiconductor Equip"],
  [/semiconductor/i, "Semiconductor"],
  [/consumer electronics|computer hardware/i, "Computers/Peripherals"],
  [/communication equipment/i, "Telecom. Equipment"],
  [/telecom/i, "Telecom. Services"],
  [/information technology services/i, "Computer Services"],
  [/drug manufacturers/i, "Drugs (Pharmaceutical)"],
  [/biotechnology/i, "Drugs (Biotechnology)"],
  [/medical devices|medical instruments/i, "Healthcare Products"],
  [/healthcare plans|medical care/i, "Healthcare Support Services"],
  [/auto manufacturers/i, "Auto & Truck"],
  [/auto parts/i, "Auto Parts"],
  [/discount stores|department stores/i, "Retail (General)"],
  [/grocery/i, "Retail (Grocery and Food)"],
  [/specialty retail/i, "Retail (Special Lines)"],
  [/restaurants/i, "Restaurant/Dining"],
  [/beverages - non/i, "Beverage (Soft)"],
  [/beverages/i, "Beverage (Alcoholic)"],
  [/packaged foods|confectioners/i, "Food Processing"],
  [/household/i, "Household Products"],
  [/oil & gas integrated/i, "Oil/Gas (Integrated)"],
  [/oil & gas e&p/i, "Oil/Gas (Production and Exploration)"],
  [/oil & gas midstream/i, "Oil/Gas Distribution"],
  [/oil & gas equipment/i, "Oilfield Svcs/Equip."],
  [/utilities - regulated water/i, "Utility (Water)"],
  [/utilities/i, "Utility (General)"],
  [/aerospace/i, "Aerospace/Defense"],
  [/airlines/i, "Air Transport"],
  [/railroads/i, "Transportation (Railroads)"],
  [/trucking/i, "Trucking"],
  [/marine shipping|integrated freight/i, "Transportation"],
  [/engineering & construction/i, "Engineering/Construction"],
  [/conglomerates/i, "Diversified"],
  [/specialty industrial machinery|farm & heavy/i, "Machinery"],
  [/electrical equipment/i, "Electrical Equipment"],
  [/steel/i, "Steel"],
  [/gold|silver|precious/i, "Precious Metals"],
  [/mining|copper|aluminum/i, "Metals & Mining"],
  [/chemicals/i, "Chemical (Specialty)"],
  [/entertainment/i, "Entertainment"],
  [/lodging|resorts|casinos|gambling/i, "Hotel/Gaming"],
  [/education/i, "Education"],
  [/advertising/i, "Advertising"],
  [/tobacco/i, "Tobacco"],
  [/apparel/i, "Apparel"],
];

export function mapIndustry(yahooIndustry: string | null | undefined): string {
  if (!yahooIndustry) return "Total Market";
  for (const [re, name] of INDUSTRY_MAP) if (re.test(yahooIndustry)) return name;
  return "Total Market";
}

export const MARGINAL_TAX: Record<string, number> = {
  "United States": 0.25,
  Singapore: 0.17,
  "Hong Kong": 0.165,
  China: 0.25,
};

/** Long-term government bond rates by reporting currency when the job has no value. Editable per stock. */
export const RISK_FREE_DEFAULTS: Record<string, number> = {
  USD: 0.042,
  SGD: 0.023,
  HKD: 0.042, // pegged to USD
  CNY: 0.018,
  EUR: 0.026,
  JPY: 0.015,
  GBP: 0.045,
  TWD: 0.016,
};

export function pickIndustry(ref: ReferenceData, industry: string, country?: string | null): { values: IndustryRef; region: string; name: string } {
  const regions = country === "United States" ? ["US", "Global"] : ["Global", "US"];
  const hits = regions.map((r) => ({ region: r, v: ref.industries?.[r]?.[industry] })).filter((h) => h.v);
  if (hits.length) {
    // primary region first; fill any metric it lacks from the other region
    const values = { ...(hits[1]?.v ?? {}), ...hits[0].v } as IndustryRef;
    return { values, region: hits[0].region, name: industry };
  }
  for (const region of regions) {
    const fb = FALLBACK_REFERENCE.industries!.US[industry];
    if (fb) return { values: fb, region: "fallback", name: industry };
    const table = ref.industries?.[region];
    const total = table?.["Total Market"] || table?.["Total Market (without financials)"];
    if (total) return { values: total, region, name: "Total Market" };
  }
  return { values: FALLBACK_REFERENCE.industries!.US["Total Market"], region: "fallback", name: "Total Market" };
}
