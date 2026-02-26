/**
 * /api/portwatch — Vercel serverless function
 * Fetches daily port data for Iranian ports from IMF PortWatch (ArcGIS).
 * Free, no API key needed.
 *
 * Uses the Daily_Ports_Data FeatureServer which includes:
 *   - Port calls by vessel type: portcalls_container, portcalls_dry_bulk,
 *     portcalls_general_cargo, portcalls_roro, portcalls_tanker
 *   - Import volumes by type (metric tons): import_container, etc.
 *   - Export volumes by type (metric tons): export_container, etc.
 *   - Daily granularity from 2019-01-01 to present
 *
 * Returns data aggregated to ISO-week granularity with per-port breakdowns,
 * matching the dashboard's WEEKS data structure.
 */

const PORTWATCH_BASE =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0";

const FIELDS = [
  "date", "year", "month", "day", "portid", "portname", "country", "ISO3",
  "portcalls_container", "portcalls_dry_bulk", "portcalls_general_cargo",
  "portcalls_roro", "portcalls_tanker", "portcalls_cargo", "portcalls",
  "import_container", "import_dry_bulk", "import_general_cargo",
  "import_roro", "import_tanker", "import_cargo", "import",
  "export_container", "export_dry_bulk", "export_general_cargo",
  "export_roro", "export_tanker", "export_cargo", "export",
].join(",");

// ArcGIS has a per-request record limit (usually 2000).
// Iran has ~10 ports × ~2200 days ≈ 22,000 rows → need pagination.
async function fetchAllRecords() {
  const all = [];
  let offset = 0;
  const batch = 2000;

  while (true) {
    const params = new URLSearchParams({
      where: "ISO3='IRN'",
      outFields: FIELDS,
      orderByFields: "date ASC, portid ASC",
      resultOffset: String(offset),
      resultRecordCount: String(batch),
      f: "json",
    });

    const resp = await fetch(`${PORTWATCH_BASE}/query?${params}`);
    if (!resp.ok) throw new Error(`ArcGIS returned ${resp.status}`);

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "ArcGIS query error");

    const features = data.features || [];
    for (const f of features) all.push(f.attributes);

    if (!data.exceededTransferLimit && features.length < batch) break;
    offset += features.length;
    if (offset > 60000) break; // safety
  }
  return all;
}

// Aggregate daily records → ISO weeks, matching dashboard WEEKS shape
function aggregateToWeeks(records) {
  const byWeek = {};

  for (const r of records) {
    const dateStr =
      typeof r.date === "number"
        ? new Date(r.date).toISOString().slice(0, 10)
        : r.date;

    const d = new Date(dateStr + "T00:00:00Z");
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
    const wk = mon.toISOString().slice(0, 10);

    if (!byWeek[wk]) byWeek[wk] = { weekStart: wk, ports: {} };

    const week = byWeek[wk];
    const pid = r.portid;

    if (!week.ports[pid]) {
      week.ports[pid] = {
        portName: r.portname,
        portId: pid,
        pc_container: 0, pc_bulk_dry: 0, pc_general_cargo: 0,
        pc_roro: 0, pc_tanker: 0, pc_total: 0,
        imp_container: 0, imp_bulk_dry: 0, imp_general_cargo: 0,
        imp_roro: 0, imp_tanker: 0, imp_total: 0,
        exp_container: 0, exp_bulk_dry: 0, exp_general_cargo: 0,
        exp_roro: 0, exp_tanker: 0, exp_total: 0,
      };
    }

    const p = week.ports[pid];
    p.pc_container += r.portcalls_container || 0;
    p.pc_bulk_dry += r.portcalls_dry_bulk || 0;
    p.pc_general_cargo += r.portcalls_general_cargo || 0;
    p.pc_roro += r.portcalls_roro || 0;
    p.pc_tanker += r.portcalls_tanker || 0;
    p.pc_total += r.portcalls || 0;

    p.imp_container += r.import_container || 0;
    p.imp_bulk_dry += r.import_dry_bulk || 0;
    p.imp_general_cargo += r.import_general_cargo || 0;
    p.imp_roro += r.import_roro || 0;
    p.imp_tanker += r.import_tanker || 0;
    p.imp_total += r["import"] || 0;

    p.exp_container += r.export_container || 0;
    p.exp_bulk_dry += r.export_dry_bulk || 0;
    p.exp_general_cargo += r.export_general_cargo || 0;
    p.exp_roro += r.export_roro || 0;
    p.exp_tanker += r.export_tanker || 0;
    p.exp_total += r["export"] || 0;
  }

  return Object.values(byWeek)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week) => {
      const ports = Object.values(week.ports);
      const agg = {
        weekStart: week.weekStart,
        container: 0, bulk_dry: 0, general_cargo: 0, roro: 0, tanker: 0,
        totalCalls: 0,
        container_vol: 0, bulk_dry_vol: 0, general_cargo_vol: 0,
        roro_vol: 0, tanker_vol: 0, totalVolume: 0,
        totalImport: 0, totalExport: 0,
        ports: {},
      };

      for (const p of ports) {
        agg.container += p.pc_container;
        agg.bulk_dry += p.pc_bulk_dry;
        agg.general_cargo += p.pc_general_cargo;
        agg.roro += p.pc_roro;
        agg.tanker += p.pc_tanker;
        agg.totalCalls += p.pc_total;

        const impT = p.imp_total;
        const expT = p.exp_total;
        agg.totalImport += impT;
        agg.totalExport += expT;

        agg.container_vol += p.imp_container + p.exp_container;
        agg.bulk_dry_vol += p.imp_bulk_dry + p.exp_bulk_dry;
        agg.general_cargo_vol += p.imp_general_cargo + p.exp_general_cargo;
        agg.roro_vol += p.imp_roro + p.exp_roro;
        agg.tanker_vol += p.imp_tanker + p.exp_tanker;

        agg.ports[p.portId] = {
          portName: p.portName,
          calls: {
            container: p.pc_container,
            bulk_dry: p.pc_bulk_dry,
            general_cargo: p.pc_general_cargo,
            roro: p.pc_roro,
            tanker: p.pc_tanker,
          },
          volume: {
            container: p.imp_container + p.exp_container,
            bulk_dry: p.imp_bulk_dry + p.exp_bulk_dry,
            general_cargo: p.imp_general_cargo + p.exp_general_cargo,
            roro: p.imp_roro + p.exp_roro,
            tanker: p.imp_tanker + p.exp_tanker,
          },
          totalCalls: p.pc_total,
          totalVolume: impT + expT,
        };
      }

      agg.totalVolume = agg.totalImport + agg.totalExport;
      agg.avgVolPerCall =
        agg.totalCalls > 0 ? Math.round(agg.totalVolume / agg.totalCalls) : 0;

      return agg;
    });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  // Cache 6 h — PortWatch updates weekly (Tue 9 AM ET)
  res.setHeader(
    "Cache-Control",
    "s-maxage=21600, stale-while-revalidate=43200"
  );

  try {
    const records = await fetchAllRecords();
    if (!records.length) {
      return res.status(404).json({ error: "No Iranian port data found" });
    }

    const weeks = aggregateToWeeks(records);
    const ports = [...new Set(records.map((r) => r.portname))].sort();

    return res.status(200).json({
      source: "IMF PortWatch Daily Ports Data",
      updated: new Date().toISOString(),
      totalDailyRecords: records.length,
      weekCount: weeks.length,
      dateRange: {
        first: weeks[0]?.weekStart,
        last: weeks[weeks.length - 1]?.weekStart,
      },
      ports,
      weeks,
    });
  } catch (err) {
    console.error("PortWatch fetch error:", err);
    return res
      .status(502)
      .json({ error: "Failed to fetch PortWatch data", message: err.message });
  }
}
