# Iran Maritime Dashboard

Interactive maritime analytics dashboard built with React and Recharts.

## Local Development

```bash
npm install
npm run dev
```

## Deploying to Vercel via GitHub

### Step 1 — Push to GitHub

1. Go to [github.com/new](https://github.com/new) and create a new repository (e.g. `iran-maritime-dashboard`). Keep it **Public** or **Private** — either works.
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
3. Find and **Import** your `iran-maritime-dashboard` repository.
4. Vercel will auto-detect the Vite framework. The defaults are correct:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Click **Deploy**. In ~60 seconds your site will be live at `https://your-project.vercel.app`.

### Step 3 (Optional) — Custom Domain

1. In the Vercel project dashboard, go to **Settings → Domains**.
2. Add your custom domain and follow the DNS instructions.

That's it — any future `git push` to `main` will auto-deploy!
