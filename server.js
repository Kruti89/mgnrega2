import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 4000;

// === Configuration ===
const CACHE_DIR = path.resolve("./cache");
const MGNREGA_API =
  "https://api.data.gov.in/resource/ee03643a-ee4c-48c2-ac30-9f2ff26ab722";
const API_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"; // your key
const CACHE_FILE = path.join(CACHE_DIR, "mgnrega_data.json");
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
// =======================

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

app.use(express.json());
app.use(helmet());
app.use(morgan("tiny"));

app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// Function to fetch from API
async function fetchMGNREGAFromAPI() {
  const url = `${MGNREGA_API}?api-key=${API_KEY}&format=json&limit=5000`;
  console.log("Fetching latest data from Data.gov.in...");

  try {
    const { data } = await axios.get(url, { timeout: 30000 });

    if (data && data.records) {
      const enriched = {
        fetchedAt: new Date().toISOString(),
        count: data.records.length,
        records: data.records,
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(enriched, null, 2), "utf-8");
      console.log("✅ Cache updated successfully!");
      return enriched;
    } else {
      throw new Error("Invalid API response format");
    }
  } catch (err) {
    console.error("⚠️ Error fetching from Data.gov.in:", err.message);
    throw err;
  }
}

// Function to read cached file
function readCache() {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  }
  return null;
}

// Endpoint: Serve cached or fresh data
app.get("/api/mgnrega", async (req, res) => {
  const cache = readCache();
  const now = Date.now();

  if (cache && cache.fetchedAt) {
    const cacheAge = now - new Date(cache.fetchedAt).getTime();
    // Serve cached data immediately
    res.json({
      source: "cache",
      lastUpdated: cache.fetchedAt,
      data: cache.records,
    });

    // Background refresh if cache is old
    if (cacheAge > CACHE_TTL) {
      fetchMGNREGAFromAPI().catch(() =>
        console.log("Background refresh failed (API down)")
      );
    }
  } else {
    // No cache yet — fetch live
    try {
      const data = await fetchMGNREGAFromAPI();
      res.json({ source: "live", lastUpdated: data.fetchedAt, data: data.records });
    } catch (err) {
      res.status(500).json({ error: "API unavailable and no cache found." });
    }
  }
});

// Endpoint: Filter by state or district (optional)
app.get("/api/mgnrega/filter", (req, res) => {
  const { state, district } = req.query;
  const cache = readCache();

  if (!cache) return res.status(404).json({ error: "No cached data found" });

  let filtered = cache.records;
  if (state)
    filtered = filtered.filter(
      (r) =>
        r.state_name?.toLowerCase() === state.toLowerCase() ||
        r.state?.toLowerCase() === state.toLowerCase()
    );
  if (district)
    filtered = filtered.filter(
      (r) => r.district_name?.toLowerCase() === district.toLowerCase()
    );

  res.json({
    source: "cache",
    lastUpdated: cache.fetchedAt,
    count: filtered.length,
    data: filtered,
  });
});

// Auto-refresh cache once daily
cron.schedule("0 4 * * *", async () => {
  console.log("🕓 Scheduled cache refresh starting...");
  try {
    await fetchMGNREGAFromAPI();
  } catch (e) {
    console.log("Failed to refresh cache during cron job.");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MGNREGA Backend running on port ${PORT}`);
});
