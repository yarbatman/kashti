/**
 * /api/vessel-history — Reads accumulated vessel type snapshots from Vercel KV.
 * Returns all weekly snapshots stored by the cron job, sorted chronologically.
 * If KV is not configured, returns empty history.
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(200).json({
      source: "vessel-history",
      message: "Vercel KV not configured — no historical snapshots available yet.",
      snapshots: []
    });
  }

  try {
    const kv = await import("@vercel/kv").then(m => m.kv);

    // Read the index of all snapshot keys
    const indexRaw = await kv.get("vessel-snapshots:index");
    const index = indexRaw ? JSON.parse(indexRaw) : [];

    // Fetch all snapshots
    const snapshots = [];
    for (const weekKey of index) {
      const raw = await kv.get(`vessel-snapshot:${weekKey}`);
      if (raw) {
        snapshots.push(typeof raw === "string" ? JSON.parse(raw) : raw);
      }
    }

    return res.status(200).json({
      source: "vessel-history",
      count: snapshots.length,
      snapshots: snapshots.sort((a, b) => a.week.localeCompare(b.week)),
    });

  } catch (err) {
    console.error("KV read error:", err);
    return res.status(500).json({ error: "Failed to read vessel history", message: err.message });
  }
}
