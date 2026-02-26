/**
 * /api/routes — Vercel serverless function
 * Queries Datalastic vessel_inradius for each Iranian port, then parses
 * vessel destinations to build route pairs (iranPort ↔ intlPort).
 *
 * Credit cost: ~300-500 credits per call (10 ports × 30-50 vessels each)
 * Cache: 6 hours (vessel patterns change slowly)
 *
 * Returns: { routes: [{ iranPort, intlPort, dir, cat, vol, vessels }] }
 */

const API_KEY_ENV = "DATALASTIC_API_KEY";
const BASE = "https://api.datalastic.com/api/v0";

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

// Iranian port UNLOCODEs and aliases — used to detect "homebound" vessels
const IRAN_ALIASES = [
  "BANDAR ABBAS", "BND ABBAS", "IRBND", "IR BND", "SHAHID RAJAEE", "SH RAJAEE",
  "KHOMEINI", "IRBKM", "IR BKM", "BIK",
  "ASSALUYEH", "ASALUYEH", "IRASA", "IR ASA",
  "KHARG", "KHARK",
  "CHABAHAR", "CHAH BAHAR", "IRZBR", "IR ZBR",
  "ANZALI", "IRBAZ", "IR BAZ",
  "BUSHEHR", "BUSHIRE", "IRBUZ", "IR BUZ",
  "AMIRABAD", "IRAMD", "IR AMD",
  "LENGEH", "IRBDH", "IR BDH",
  "NOWSHAHR", "NOSHAHR", "BANDAR NOWSHAHR",
];

// Map destination strings → international port IDs
// Patterns are tried in order; first match wins
const DEST_MAP = [
  // UAE
  { id: "jeb", patterns: ["JEBEL ALI", "AEJEA", "AE JEA", "JBL ALI", "JEBEL"] },
  { id: "kfk", patterns: ["KHOR FAKKAN", "AEKFK", "AE KFK", "KHORFAKKAN", "KHR FAKKAN"] },
  { id: "fuj", patterns: ["FUJAIRAH", "AEFJR", "AE FJR", "FUJAIRA", "FUJEIRA"] },
  { id: "shj", patterns: ["SHARJAH", "AESHJ", "AE SHJ"] },
  { id: "adu", patterns: ["ABU DHABI", "AEAUH", "AE AUH", "ABUDHABI"] },
  // Catch-all UAE — "DUBAI" often appears, map to Jebel Ali (main cargo port)
  { id: "jeb", patterns: ["DUBAI", "AEDXB", "AE DXB"] },

  // China
  { id: "sha", patterns: ["SHANGHAI", "CNSHA", "CN SHA"] },
  { id: "nin", patterns: ["NINGBO", "CNNBO", "CNNGB", "CN NGB", "CNNBG"] },

  // India
  { id: "mum", patterns: ["MUMBAI", "INMUM", "IN MUM", "NHAVA", "IN NVS", "JNPT", "JNPORT", "JAWAHARLAL"] },
  { id: "mun", patterns: ["MUNDRA", "INMUN", "IN MUN", "INADN"] },

  // East Asia
  { id: "bus", patterns: ["BUSAN", "KRPUS", "KR PUS", "PUSAN"] },
  { id: "sin", patterns: ["SINGAPORE", "SGSIN", "SG SIN"] },
  { id: "pkl", patterns: ["PORT KLANG", "MYPKG", "MY PKG", "KLANG", "PT KLANG"] },

  // Middle East
  { id: "soh", patterns: ["SOHAR", "OMSOH", "OM SOH"] },
  { id: "umq", patterns: ["UMM QASR", "IQUMQ", "IQ UMQ", "UMQASR"] },

  // South Asia
  { id: "kar", patterns: ["KARACHI", "PKKHI", "PK KHI"] },

  // Europe
  { id: "mer", patterns: ["MERSIN", "TRMER", "TR MER"] },
  { id: "pir", patterns: ["PIRAEUS", "GRPIR", "GR PIR"] },
  { id: "ham", patterns: ["HAMBURG", "DEHAM", "DE HAM"] },

  // Caspian / Russia
  { id: "nov", patterns: ["NOVOROSSIYSK", "RUNVS", "RU NVS", "NOVOROSS"] },
  { id: "akt", patterns: ["AKTAU", "KZAU", "KZ AKT"] },

  // Africa
  { id: "mom", patterns: ["MOMBASA", "KEMBA", "KE MBA"] },

  // Additional common destinations
  { id: "mus", patterns: ["MUSCAT", "OMMCT", "OM MCT"], name: "Muscat", lat: 23.61, lon: 58.54, country: "OM", region: "Gulf" },
  { id: "dam", patterns: ["DAMMAM", "SADMM", "SA DMM"], name: "Dammam", lat: 26.43, lon: 50.10, country: "SA", region: "Gulf" },
  { id: "che", patterns: ["CHENNAI", "INMAA", "IN MAA", "MADRAS"], name: "Chennai", lat: 13.09, lon: 80.28, country: "IN", region: "South Asia" },
  { id: "col", patterns: ["COLOMBO", "LKCMB", "LK CMB"], name: "Colombo", lat: 6.94, lon: 79.84, country: "LK", region: "South Asia" },
  { id: "qin", patterns: ["QINGDAO", "CNTAO", "CN TAO"], name: "Qingdao", lat: 36.07, lon: 120.38, country: "CN", region: "East Asia" },
  { id: "tia", patterns: ["TIANJIN", "CNTSN", "CN TSN"], name: "Tianjin", lat: 39.01, lon: 117.73, country: "CN", region: "East Asia" },
  { id: "kuw", patterns: ["KUWAIT", "KWKWI", "KW KWI", "SHUWAIKH"], name: "Kuwait", lat: 29.35, lon: 47.96, country: "KW", region: "Gulf" },
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

function matchDestination(destStr) {
  const d = (destStr || "").toUpperCase().trim();
  if (!d || d === "UNKNOWN" || d.length < 2) return null;

  // Check if destination is another Iranian port (skip — internal movement)
  if (IRAN_ALIASES.some(a => d.includes(a))) return "__IRAN__";

  for (const entry of DEST_MAP) {
    if (entry.patterns.some(p => d.includes(p))) return entry.id;
  }
  return null;
}

function inferDirection(iranPort, vessel) {
  // Heuristic: if vessel is heading TO another port (speed > 0.5 and destination is non-Iranian),
  // it's likely an export from Iran. If it's stationary or slow (loading/unloading), harder to tell.
  // Best proxy: if destination is non-Iranian → export; if vessel recently arrived → import.
  // Since we can't know arrival history from inradius, we use speed as proxy:
  //   speed > 1 kn + non-Iranian dest → departing (export)
  //   speed ≤ 1 kn + non-Iranian dest → could be either, default to import (just arrived or loading)

  const speed = vessel.speed || 0;

  // For oil export ports, assume tanker departures are exports
  const oilExportPorts = ["kh", "ass"]; // Kharg, Assaluyeh
  const cat = classifyVessel(vessel.type, vessel.type_specific);
  if (oilExportPorts.includes(iranPort.id) && (cat === "tanker" || cat === "gas_carrier")) {
    return "exp";
  }

  // General heuristic
  return speed > 2 ? "exp" : "imp";
}

const DWT_AVG = { container: 45000, bulk_dry: 70000, tanker: 95000, general_cargo: 15000, gas_carrier: 60000 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=43200");

  const API_KEY = process.env[API_KEY_ENV];
  if (!API_KEY) {
    return res.status(500).json({
      error: `${API_KEY_ENV} env var not set`,
      hint: "Add it in Vercel → Settings → Environment Variables"
    });
  }

  try {
    const routeMap = {}; // key: "iranId-intlId-dir" → { vol, dwt, cats: {} }
    const unmatchedDests = {};
    let creditsUsed = 0;
    let totalVessels = 0;

    for (const port of IRAN_PORTS) {
      const url = `${BASE}/vessel_inradius?api-key=${API_KEY}&lat=${port.lat}&lon=${port.lon}&radius=${port.radius}`;

      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Datalastic ${port.name}: HTTP ${resp.status}`);
        continue;
      }

      const json = await resp.json();
      const vessels = json?.data?.vessels || [];
      creditsUsed += json?.data?.total || vessels.length;

      for (const v of vessels) {
        const cat = classifyVessel(v.type, v.type_specific);
        if (!cat) continue;

        totalVessels++;
        const destId = matchDestination(v.destination);

        if (!destId) {
          const d = (v.destination || "").trim();
          if (d && d.length > 1) unmatchedDests[d] = (unmatchedDests[d] || 0) + 1;
          continue;
        }
        if (destId === "__IRAN__") continue; // internal movement

        const dir = inferDirection(port, v);
        const key = `${port.id}-${destId}-${dir}`;

        if (!routeMap[key]) {
          routeMap[key] = { iranPort: port.id, intlPort: destId, dir, vol: 0, dwt: 0, cats: {} };
        }
        routeMap[key].vol++;
        routeMap[key].dwt += DWT_AVG[cat] || 30000;
        routeMap[key].cats[cat] = (routeMap[key].cats[cat] || 0) + 1;
      }
    }

    // Convert to sorted array, pick dominant category per route
    const routes = Object.values(routeMap)
      .map(r => {
        // Dominant vessel type on this route
        const cat = Object.entries(r.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "general_cargo";
        return { ...r, cat, cats: undefined };
      })
      .sort((a, b) => b.vol - a.vol);

    return res.status(200).json({
      source: "datalastic",
      timestamp: new Date().toISOString(),
      creditsUsed,
      totalVessels,
      routeCount: routes.length,
      routes,
      unmatchedDestinations: Object.entries(unmatchedDests)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([dest, count]) => ({ dest, count })),
    });

  } catch (err) {
    console.error("Routes fetch error:", err);
    return res.status(502).json({ error: "Failed to build routes", message: err.message });
  }
}
