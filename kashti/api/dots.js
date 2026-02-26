/**
 * /api/dots — Vercel serverless proxy for IMF DOTS API
 * Proxies requests to dataservices.imf.org to avoid CORS issues.
 * The IMF SDMX API does not send Access-Control-Allow-Origin headers,
 * so browser-based fetches fail. This proxy adds CORS headers.
 *
 * Returns monthly Direction of Trade Statistics for Iran:
 *   - TXG_FOB_USD: World exports to Iran (Iran's imports)
 *   - TMG_CIF_USD: World imports from Iran (Iran's exports)
 */

const IMF_API_BASE = "https://dataservices.imf.org/REST/SDMX_JSON.svc";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  // Cache 24h — DOTS updates monthly
  res.setHeader(
    "Cache-Control",
    "s-maxage=86400, stale-while-revalidate=172800"
  );

  try {
    const startYear =
      req.query.startYear ||
      new Date(
        new Date().getTime() - 260 * 7 * 864e5
      ).getFullYear();

    const url = `${IMF_API_BASE}/CompactData/DOT/M.W00.TXG_FOB_USD+TMG_CIF_USD.IR?startPeriod=${startYear}`;
    console.log(`DOTS proxy fetching: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`IMF API returned ${response.status}`);
    }

    const data = await response.json();
    const series = data?.CompactData?.DataSet?.Series;
    if (!series) {
      throw new Error("Unexpected IMF API response structure");
    }

    // Series can be a single object or an array; normalise to array
    const seriesArr = Array.isArray(series) ? series : [series];

    // Extract observations keyed by indicator
    const byIndicator = {};
    for (const s of seriesArr) {
      const indicator = s["@INDICATOR"];
      const obs = Array.isArray(s.Obs) ? s.Obs : s.Obs ? [s.Obs] : [];
      byIndicator[indicator] = {};
      for (const o of obs) {
        const period = o["@TIME_PERIOD"]; // "2020-01"
        const value = parseFloat(o["@OBS_VALUE"]);
        if (period && !isNaN(value)) {
          byIndicator[indicator][period] = Math.round(value);
        }
      }
    }

    const txgData = byIndicator["TXG_FOB_USD"] || {};
    const tmgData = byIndicator["TMG_CIF_USD"] || {};

    // Merge all months present in either series
    const allMonths = new Set([
      ...Object.keys(txgData),
      ...Object.keys(tmgData),
    ]);
    const months = [...allMonths].sort().map((date) => {
      const txg = txgData[date] || 0;
      const tmg = tmgData[date] || 0;
      return { date, txg, tmg, total: txg + tmg };
    });

    console.log(
      `DOTS: ${months.length} months, ${months[0]?.date} – ${months[months.length - 1]?.date}`
    );

    return res.status(200).json({
      source: "IMF Direction of Trade Statistics",
      updated: new Date().toISOString(),
      monthCount: months.length,
      dateRange: {
        first: months[0]?.date,
        last: months[months.length - 1]?.date,
      },
      months,
    });
  } catch (err) {
    console.error("DOTS proxy error:", err);
    return res
      .status(502)
      .json({ error: "Failed to fetch IMF DOTS data", message: err.message });
  }
}
