# Iran Maritime Dashboard

Interactive maritime analytics dashboard built with React and Recharts, featuring live IMF trade data integration.

## Features

- **AIS-derived maritime traffic index** — weekly port call and tonnage data
- **Live IMF DOTS integration** — real Direction of Trade Statistics via the IMF SDMX API
- **Correlation analysis** — maritime index calibrated against official trade figures
- **Trade forecasting** — index-based projections with confidence intervals
- **Route network visualization** — interactive map of Iran's maritime trade routes
- **Graceful fallback** — uses synthetic data if the IMF API is unreachable

## IMF API Integration

The dashboard fetches real trade data from the **IMF Direction of Trade Statistics (DOTS)** using mirror statistics:

- **Reporter:** World (W00)
- **Counterpart:** Iran (IR)
- **Indicators:**
  - `TXG_FOB_USD` — World exports to Iran (proxy for Iran's imports)
  - `TMG_CIF_USD` — World imports from Iran (proxy for Iran's exports)

**API endpoint:**
```
https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/DOT/M.W00.TXG_FOB_USD+TMG_CIF_USD.IR?startPeriod=2020
```

No API key is required. The data source status is shown in the header bar:
- 🟢 **IMF DOTS (live)** — real data loaded successfully
- 🟠 **Synthetic (offline)** — API unavailable, using generated fallback data

## Local Development

```bash
npm install
npm run dev
```

## Deploying to Vercel via GitHub

### Step 1 — Push to GitHub

1. Go to [github.com/new](https://github.com/new) and create a new repository.
2. **Do NOT** initialize with a README (this repo already has one).
3. Unzip this project folder, open a terminal inside it, and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/iran-maritime-dashboard.git
git push -u origin main
```

### Step 2 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account.
2. Click **"Add New…" → Project**.
3. Find and **Import** your repository.
4. Vercel will auto-detect the Vite framework. The defaults are correct:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Click **Deploy**. In ~60 seconds your site will be live.

### Step 3 (Optional) — Custom Domain

In the Vercel project dashboard, go to **Settings → Domains** and follow the instructions.

## Notes on CORS

The IMF SDMX API supports cross-origin requests. If you encounter CORS issues, the dashboard falls back to synthetic data automatically. To resolve persistent CORS issues you can set up a Vercel serverless function as a proxy.
