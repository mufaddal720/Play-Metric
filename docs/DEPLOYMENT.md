# Deployment

## Current status (honest)
- The production build (`npm run build` → `dist/`, about 12 MB including the two models and the WASM runtime) is complete and tested under the production security headers, using `node scripts/serve-dist.mjs`.
- **No public URL exists yet.** In the build session, creating a public hosting repository on the owner's GitHub account was not permitted without the owner's direct action. Nothing in this repository claims a live URL. Add it here only after completing the post-deployment checklist below.

## What the app needs from a host
A static HTTPS host, because camera access requires a secure context. There is no server code, database, secret or API key. Video never leaves the device, so **no family data reaches the host**: the only data residency concern is the app files themselves.

## Hosting evaluation for the UAE

| Option | Where it is served from | UAE latency | Cost | HTTPS | Fit |
|---|---|---|---|---|---|
| **GitHub Pages** (workflow included) | Global CDN (Fastly); origin outside the UAE | Good (CDN cache) | Free (public repo) | Automatic on `*.github.io`; custom domains supported | ✅ Simplest. Recommended for the competition |
| **Cloudflare Pages** (`public/_headers` used) | Global edge network with points of presence in the UAE (Dubai, Fujairah); origin not UAE-specific | Very good | Free tier | Automatic | ✅ Best latency. Applies the security headers file |
| Netlify / Vercel (`netlify.toml`, `vercel.json`) | Global CDN; origin outside the UAE | Good | Free tiers | Automatic | ✅ Fine alternatives |
| AWS S3 in `me-central-1` (UAE region) + CloudFront | Origin in the UAE; CDN edges include the UAE | Very good | Pay-as-you-go (low for a static site) | Via CloudFront + ACM certificate | ✅ Use if UAE-resident hosting is a requirement. Needs an AWS account |
| Azure Storage static website in *UAE North* (Dubai) | Origin in the UAE | Very good | Pay-as-you-go | Default `*.web.core.windows.net` endpoint is HTTPS; custom domain via Front Door/CDN | ✅ UAE-resident alternative. Needs an Azure account |

Recommendation: deploy to **GitHub Pages or Cloudflare Pages** for the competition, and disclose that the files are served from a global CDN, not from a UAE data centre. Because all processing happens on the visitor's device, gameplay data is never stored outside the UAE by the host. If the organisers require UAE-resident hosting, use AWS `me-central-1` or Azure UAE North. Region names, pricing and availability change, so confirm them in the provider console at deployment time.

Do **not** describe the site as "hosted in the UAE" unless one of the UAE-region options is actually used.

## Fastest path: GitHub Pages (about 5 minutes)
1. Create an empty **public** repository on GitHub, e.g. `uae-family-ai-game-day`.
2. Push this project:
   ```bash
   git remote add origin https://github.com/<your-user>/uae-family-ai-game-day.git
   git push -u origin main
   ```
3. On GitHub, open the repository's **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. The included workflow (`.github/workflows/deploy-pages.yml`) runs the unit tests, builds, and publishes. When it finishes, the URL is shown in the **Actions** run, normally `https://<your-user>.github.io/<repo>/` (this project: `https://mufaddal720.github.io/Play-Metric/`).
5. Run the post-deployment checklist below, then add the tested URL to the README.

GitHub Pages cannot set custom response headers, so the CSP in `public/_headers` is not applied there. The app works without it. For the strict headers, use Cloudflare Pages or Netlify.

## Cloudflare Pages
Dashboard → Workers & Pages → Create → Pages → connect the repository. Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=20`. The `_headers` file is applied automatically. URL: `https://<project>.pages.dev`.

## Netlify / Vercel
Import the repository. `netlify.toml` / `vercel.json` already contain the build command, output folder and headers.

## AWS (UAE region) outline
1. Create an S3 bucket in `me-central-1` with public access blocked, then upload `dist/`. Set `Content-Type: application/wasm` for `*.wasm`.
2. Create a CloudFront distribution with the bucket as origin (Origin Access Control) and default root object `index.html`.
3. Add a response-headers policy with the CSP and Permissions-Policy values from `public/_headers`.
4. Attach an ACM certificate (issued in `us-east-1` for CloudFront) for a custom domain.

## Connecting a `.ae` domain
`.ae` domains are administered by the .ae Domain Administration (aeDA, under the TDRA) and sold by accredited registrars. Use a domain only if the project owner has registered it and controls its DNS.
- **GitHub Pages:** Settings → Pages → Custom domain → `games.example.ae`. At the registrar, add a `CNAME` record `games` → `<your-user>.github.io`. Tick **Enforce HTTPS** once the certificate has been issued.
- **Cloudflare Pages:** Custom domains → add the domain, then follow the CNAME instructions shown.
- The app uses relative asset paths and hash routing, so it works unchanged at a domain root or a sub-path. To build for a fixed sub-path, set `BASE_PATH`, e.g. `BASE_PATH=/games/ npm run build`.

## Post-deployment checklist (do before announcing the URL)
- [ ] The URL loads over **https://**, with a padlock and no mixed-content warnings.
- [ ] It opens on a phone using **mobile data** (not the developer's Wi-Fi) and on a desktop, from a **UAE internet connection**.
- [ ] The camera permission prompt appears on a game screen, and the preview shows. Denying permission shows the help message and **Try again**.
- [ ] The header clock matches UAE time (GST). Match history shows times with "GST".
- [ ] Freeze & Fool: play one round end to end, and confirm the verdict shows evidence.
- [ ] Football: complete calibration and the ball test (check the analysis speed ≥ 10 frames/s on the demo device), then score one goal.
- [ ] Action Detective: complete one turn with a guess.
- [ ] Works in a private/incognito window, with no developer login and no local paths.
- [ ] DevTools → Network: after the page loads, no requests go to any other domain.
