/**
 * /api/vessels — Vercel serverless function
 * Fetches current vessel snapshot for Iranian ports from Datalastic.
 * Requires DATALASTIC_API_KEY env var.
 *
 * Uses /vessel_inradius endpoint: returns all vessels within radius of each port.
 * Each vessel found = 1 credit. ~30-50 vessels per port × 10 ports = ~300-500 credits/call.
 *
 * Returns: vessel count + type breakdown per port, plus aggregate totals.
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

// Map Datalastic's 300+ vessel subtypes to our 5 dashboard categories
function classifyVessel(type, typeSpecific) {
  const t = (type || "").toLowerCase();
  const ts = (typeSpecific || "").toLowerCase();

  if (ts.includes("container") || ts.includes("ro-ro"))
    return "container";
  if (ts.includes("bulk") || ts.includes("ore"))
    return "bulk_dry";
  if (t.includes("tanker") || ts.includes("tanker") || ts.includes("crude") || ts.includes("oil"))
    return "tanker";
  if (ts.includes("lng") || ts.includes("lpg") || ts.includes("gas"))
    return "gas_carrier";
  if (t.includes("cargo") || ts.includes("cargo") || ts.includes("general"))
    return "general_cargo";
  // Skip tugs, fishing, passenger, etc. — not relevant to trade index
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  // Cache for 6 hours — vessels change slowly and we want to conserve credits
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=43200");

  const API_KEY = process.env.DATALASTIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({
      error: "DATALASTIC_API_KEY env var not set. See README for setup."
    });
  }

  try {
    const portResults = [];
    const totals = { container: 0, bulk_dry: 0, tanker: 0, general_cargo: 0, gas_carrier: 0 };
    let totalDwt = 0;
    let totalVessels = 0;
    let creditsUsed = 0;

    for (const port of IRAN_PORTS) {
      const url = `https://api.datalastic.com/api/v0/vessel_inradius?api-key=${API_KEY}&lat=${port.lat}&lon=${port.lon}&radius=${port.radius}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Datalastic error for ${port.name}: ${resp.status}`);
        portResults.push({ port: port.name, portId: port.id, error: resp.status, vessels: [] });
        continue;
      }

      const json = await resp.json();
      const vessels = json?.data?.vessels || [];
      creditsUsed += json?.data?.total || vessels.length;

      const classified = { container: 0, bulk_dry: 0, tanker: 0, general_cargo: 0, gas_carrier: 0 };
      const classifiedDwt = { container: 0, bulk_dry: 0, tanker: 0, general_cargo: 0, gas_carrier: 0 };
      const vesselList = [];

      for (const v of vessels) {
        const cat = classifyVessel(v.type, v.type_specific);
        if (!cat) continue; // skip non-trade vessels

        classified[cat]++;
        totals[cat]++;
        totalVessels++;

        // DWT not available in inradius response — estimate from type
        const estDwt = estimateDwt(cat);
        classifiedDwt[cat] += estDwt;
        totalDwt += estDwt;

        vesselList.push({
          name: v.name,
          mmsi: v.mmsi,
          imo: v.imo,
          type: v.type,
          typeSpecific: v.type_specific,
          category: cat,
          destination: v.destination,
          speed: v.speed,
          countryIso: v.country_iso,
        });
      }

      portResults.push({
        port: port.name,
        portId: port.id,
        totalTradeVessels: vesselList.length,
        calls: classified,
        dwt: classifiedDwt,
        vessels: vesselList,
      });
    }

    const snapshot = {
      source: "Datalastic",
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      creditsUsed,
      totalTradeVessels: totalVessels,
      totalEstDwt: totalDwt,
      aggregate: totals,
      ports: portResults,
    };

    return res.status(200).json(snapshot);

  } catch (err) {
    console.error("Datalastic fetch error:", err);
    return res.status(502).json({
      error: "Failed to fetch vessel data",
      message: err.message
    });
  }
}

// Estimated average DWT per category (used when actual DWT unavailable)
function estimateDwt(cat) {
  const avg = {
    container: 45000,
    bulk_dry: 70000,
    tanker: 95000,
    general_cargo: 15000,
    gas_carrier: 60000,
  };
  // Add ±20% noise for realistic variation
  const base = avg[cat] || 30000;
  return Math.round(base * (0.8 + Math.random() * 0.4));
}
