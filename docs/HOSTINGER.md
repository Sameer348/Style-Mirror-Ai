# Deploying to Hostinger (shared web hosting)

Hostinger web hosting serves static files and PHP. It cannot run the Python
(FastAPI) backend. So the website goes on Hostinger as a **static export**, and
the backend (needed only for AI clothes try-on and saved history) is hosted
separately.

| Feature | On Hostinger alone | Needs the backend |
|---|---|---|
| Landing, privacy pages | ✅ | |
| Glasses photo try-on | ✅ (runs in the browser) | |
| Live glasses (webcam) | ✅ (needs HTTPS) | |
| 3D studio | ✅ | |
| AI clothes try-on | Shows "not connected" | ✅ |
| Sign-in | ✅ with Supabase keys in `config.js` | |
| Saved history | | ✅ |

## 1. Build the zip

```bash
cd frontend
npm install
NEXT_PUBLIC_SITE_URL=https://your-domain.com npm run build:static
cd out && zip -r ../../stylemirror-hostinger.zip . -x "*.DS_Store"
```

`out/` already contains `.htaccess` (HTTPS redirect, security headers, WASM MIME
type, caching) and `config.js`.

## 2. Upload

1. hPanel → **Websites → your domain → File Manager** → open `public_html`.
2. If the domain already has a site you want to keep, back it up first, or use a
   subdomain (hPanel → Domains → Subdomains, e.g. `style.your-domain.com`) and
   upload into that subdomain's folder instead.
3. Upload `stylemirror-hostinger.zip`, right-click → **Extract** into
   `public_html`. `index.html`, `.htaccess`, `_next/`, `studio/` and the others must sit
   directly inside `public_html`, not inside a sub-folder.
4. Delete the zip file afterwards.
5. hPanel → **Security → SSL**: make sure SSL is active (the webcam needs HTTPS).

Open `https://your-domain.com`. You should see the landing page.

## 3. Connect the AI try-on later (optional)

1. Deploy `backend/` to a host that runs Python containers: Render, Railway,
   Fly.io, or a Hostinger **VPS**. See [DEPLOYMENT.md](DEPLOYMENT.md). Set in its
   environment:
   `FRONTEND_ORIGINS=https://your-domain.com`, `TRYON_PROVIDER=replicate`,
   `REPLICATE_API_TOKEN=…`, `ENVIRONMENT=production`.
2. On Hostinger, edit `public_html/config.js` in File Manager:
   ```js
   window.STYLEMIRROR_CONFIG = {
     apiUrl: "https://your-backend.onrender.com",
     supabaseUrl: "",       // optional
     supabaseAnonKey: "",   // optional (anon/public key only)
   };
   ```
3. Save and reload the site. No rebuild needed.

Never put the Supabase **service-role** key or the Replicate token in
`config.js`. Everything in that file is public.
