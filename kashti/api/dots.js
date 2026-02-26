/**
 * /api/dots — Vercel serverless proxy for IMF DOTS trade data
 *
 * The legacy IMF API (dataservices.imf.org) was retired Nov 2025.
 * Primary source: DBnomics API (mirrors IMF DOTS, free, no auth, CORS-friendly)
 * Fallback: old IMF SDMX API (may still partially work)
 *
 * Returns monthly Direction of Trade Statistics for Iran:
 *   - TXG_FOB_USD: World exports to Iran (Iran's imports)
 *   - TMG_CIF_USD: World imports from Iran (Iran's exports)
 */

// ── DBnomics approach ──────────────────────────────────────────
async function fetchOneSeries(seriesCode) {
  // DBnomics v22: series code goes in the URL path, not as a query param
  const url = `https://api.db.nomics.world/v22/series/IMF/DOT/${seriesCode}?observations=1&format=json`;
  console.log("DOTS: fetching", url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`DBnomics ${seriesCode}: HTTP ${resp.status}`);
  const data = await resp.json();
  const s = data?.series?.docs?.[0];
  if (!s) throw new Error(`DBnomics: no data for ${seriesCode}`);
  return s;
}

async function fetchFromDBnomics(startYear) {
  // Fetch both series in parallel
  const [txgSeries, tmgSeries] = await Promise.all([
    fetchOneSeries("M.W00.TXG_FOB_USD.IR"),
    fetchOneSeries("M.W00.TMG_CIF_USD.IR"),
  ]);

  // Build lookup by indicator
  const byIndicator = {};
  for (const s of [txgSeries, tmgSeries]) {
    const indicator = s.series_code.split(".")[2]; // TXG_FOB_USD or TMG_CIF_USD
    const periods = s.period || [];
    const values = s.value || [];
    byIndicator[indicator] = {};
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const value = values[i];
      if (period && value != null && !isNaN(value)) {
        const key = period.slice(0, 7);
        byIndicator[indicator][key] = Math.round(value);
      }
    }
  }

  return buildMonths(byIndicator, startYear);
}

// ── Old IMF API fallback ───────────────────────────────────────
async function fetchFromIMF(startYear) {
  const url =
    `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/DOT/M.W00.TXG_FOB_USD+TMG_CIF_USD.IR?startPeriod=${startYear}`;

  console.log("DOTS: trying legacy IMF API…", url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`IMF API returned ${resp.status}`);

    const data = await resp.json();
    const series = data?.CompactData?.DataSet?.Series;
    if (!series) throw new Error("Unexpected IMF API response structure");

    const seriesArr = Array.isArray(series) ? series : [series];
    const byIndicator = {};
    for (const s of seriesArr) {
      const indicator = s["@INDICATOR"];
      const obs = Array.isArray(s.Obs) ? s.Obs : s.Obs ? [s.Obs] : [];
      byIndicator[indicator] = {};
      for (const o of obs) {
        const period = o["@TIME_PERIOD"];
        const value = parseFloat(o["@OBS_VALUE"]);
        if (period && !isNaN(value)) {
          byIndicator[indicator][period] = Math.round(value);
        }
      }
    }

    return buildMonths(byIndicator, startYear);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── Shared month builder ───────────────────────────────────────
function buildMonths(byIndicator, startYear) {
  const txgData = byIndicator["TXG_FOB_USD"] || {};
  const tmgData = byIndicator["TMG_CIF_USD"] || {};

  const allMonths = new Set([
    ...Object.keys(txgData),
    ...Object.keys(tmgData),
  ]);

  const months = [...allMonths]
    .filter((d) => d >= `${startYear}-01`)
    .sort()
    .map((date) => {
      const txg = txgData[date] || 0;
      const tmg = tmgData[date] || 0;
      return { date, txg, tmg, total: txg + tmg };
    });

  if (months.length === 0) throw new Error("No monthly trade data found");
  return months;
}

// ── Handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader(
    "Cache-Control",
    "s-maxage=86400, stale-while-revalidate=172800"
  );

  const startYear =
    req.query.startYear ||
    new Date(new Date().getTime() - 260 * 7 * 864e5).getFullYear();

  let months;
  let source;
  const errors = [];

  // Try DBnomics first (reliable, actively maintained)
  try {
    months = await fetchFromDBnomics(startYear);
    source = "DBnomics (IMF DOTS mirror)";
  } catch (err) {
    console.warn("DBnomics failed:", err.message);
    errors.push(`DBnomics: ${err.message}`);
  }

  // Fallback to legacy IMF API
  if (!months) {
    try {
      months = await fetchFromIMF(startYear);
      source = "IMF SDMX API (legacy)";
    } catch (err) {
      console.warn("IMF API failed:", err.message);
      errors.push(`IMF: ${err.message}`);
    }
  }

  if (!months) {
    return res.status(502).json({
      error: "Failed to fetch trade data from all sources",
      details: errors,
    });
  }

  console.log(
    `DOTS [${source}]: ${months.length} months, ${months[0]?.date} – ${months[months.length - 1]?.date}`
  );

  return res.status(200).json({
    source,
    updated: new Date().toISOString(),
    monthCount: months.length,
    dateRange: {
      first: months[0]?.date,
      last: months[months.length - 1]?.date,
    },
    months,
  });
}
