/**
 * /api/cron/vessel-snapshot — Vercel Cron Job
 * Runs weekly (configured in vercel.json).
 * Calls Datalastic for each Iranian port, classifies vessels,
 * and appends the snapshot to Vercel KV for historical accumulation.
 *
 * Requires: DATALASTIC_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN env vars.
 * If KV is not configured, snapshot is returned but not persisted.
 *
 * Storage key pattern: "vessel-snapshot:{YYYY-WNN}" (ISO week)
 * History key: "vessel-snapshots:index" (list of all snapshot keys)
 */

const IRAN_PORTS = [
  { id: "ba",  name: "Bandar Abbas",   lat: 27.19, lon: 56.28, radius: 10 },
  { id: "bik", name: "BIK",            lat: 30.43, lon: 49.08, radius: 8  },
  { id: "ass", name: "Assaluyeh",      lat: 27.48, lon: 52.61, radius: 8  },
  { id: "kh",  name: "Kharg Island",   lat: 29.24, lon: 50.33, radius: 8  },
  { id: "ch",  name: "Chabahar",       lat: 25.29, lon: 60.64, radius: 8  },
  { id: "an",  name: "Anzali",         lat: 37.47, lon: 49.47, radius: 8  },
  { id: "bu",  name: "Bushehr",        lat: 28.97, lon: 50.83, radius: 8  },
  { id: "am",  name: "Amirabad",       lat: 36.85, lon: 53.36, radius: 8  },
  { id: "bl",  name: "Bandar Lengeh",  lat: 26.56, lon: 54.88, radius: 5  },
  { id: "no",  name: "Nowshahr",       lat: 36.65, lon: 51.50, radius: 5  },
];

function classifyVessel(type, typeSpecific) {
  const t = (type || "").toLowerCase();
  const ts = (typeSpecific || "").toLowerCase();
  if (ts.includes("container") || ts.includes("ro-ro")) return "container";
  if (ts.includes("bulk") || ts.includes("ore")) return "bulk_dry";
  if (t.includes("tanker") || ts.includes("tanker") || ts.includes("crude") || ts.includes("oil")) return "tanker";
  if (ts.includes("lng") || ts.includes("lpg") || ts.includes("gas")) return "gas_carrier";
  if (t.includes("cargo") || ts.includes("cargo") || ts.includes("general")) return "general_cargo";
  return null;
}

function getISOWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date - week1) / 864e5 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  // Verify this is a legitimate cron call (Vercel sends this header)
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const API_KEY = process.env.DATALASTIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "DATALASTIC_API_KEY not set" });
  }

  const weekKey = getISOWeek(new Date());
  const totals = { container: 0, bulk_dry: 0, tanker: 0, general_cargo: 0, gas_carrier: 0 };
  const portSummaries = {};

  for (const port of IRAN_PORTS) {
    try {
      const url = `https://api.datalastic.com/api/v0/vessel_inradius?api-key=${API_KEY}&lat=${port.lat}&lon=${port.lon}&radius=${port.radius}`;
      const resp = await fetch(url);
      if (!resp.ok) continue;

      const json = await resp.json();
      const vessels = json?.data?.vessels || [];

      const portCounts = { container: 0, bulk_dry: 0, tanker: 0, general_cargo: 0, gas_carrier: 0 };
      for (const v of vessels) {
        const cat = classifyVessel(v.type, v.type_specific);
        if (cat) {
          portCounts[cat]++;
          totals[cat]++;
        }
      }
      portSummaries[port.id] = { name: port.name, calls: portCounts };
    } catch (e) {
      console.warn(`Error fetching ${port.name}:`, e.message);
    }
  }

  const snapshot = {
    week: weekKey,
    date: new Date().toISOString(),
    aggregate: totals,
    totalTradeVessels: Object.values(totals).reduce((s, v) => s + v, 0),
    ports: portSummaries,
  };

  // Try to persist to Vercel KV if configured
  let persisted = false;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const kv = await import("@vercel/kv").then(m => m.kv);

      // Store this week's snapshot
      await kv.set(`vessel-snapshot:${weekKey}`, JSON.stringify(snapshot));

      // Update the index of all snapshots
      const indexRaw = await kv.get("vessel-snapshots:index");
      const index = indexRaw ? JSON.parse(indexRaw) : [];
      if (!index.includes(weekKey)) {
        index.push(weekKey);
        index.sort();
        await kv.set("vessel-snapshots:index", JSON.stringify(index));
      }
      persisted = true;
    } catch (e) {
      console.warn("KV storage failed:", e.message);
    }
  }

  return res.status(200).json({
    success: true,
    persisted,
    snapshot,
  });
}
