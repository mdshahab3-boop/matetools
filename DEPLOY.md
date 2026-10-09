# Deploying MateTools on a Hostinger VPS with Cloudflare Tunnel

Target: **https://tools.mateops.com.au**, running entirely on your VPS, with
Cloudflare as the only front door. No ports are opened on the VPS.

```
                 Cloudflare edge (DNS · TLS · CDN · WAF · rate-limit · DDoS)
                                      │  Cloudflare Tunnel (outbound only)
   ┌──────────────────────────────── VPS (Docker) ───────────────────────────────┐
   │  cloudflared  ──internal──►  app (FastAPI + LibreOffice + Ghostscript)       │
   │  (edge + internal nets)       (internal net only — no outbound internet)     │
   └──────────────────────────────────────────────────────────────────────────── ┘
```

---

## 1. Prerequisites

- A Hostinger VPS (Ubuntu 22.04/24.04 recommended, ≥ 2 GB RAM — LibreOffice is memory-hungry).
- The domain `mateops.com.au` already managed in your Cloudflare account.
- Docker + Docker Compose installed on the VPS:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in afterwards
```

## 2. Get the code

```bash
git clone https://github.com/mdshahab3-boop/matetools.git
cd matetools
cp .env.example .env
```

## 3. Create the Cloudflare Tunnel

1. Go to **Cloudflare Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Choose **Cloudflared**, name it `matetools`.
3. On the install screen, copy the **token** (the long string after `--token`).
4. Paste it into `.env`:

```ini
CF_TUNNEL_TOKEN=eyJ...your-token...
MAX_UPLOAD_MB=100
```

5. Still in the tunnel setup, add a **Public Hostname**:
   - **Subdomain:** `tools`
   - **Domain:** `mateops.com.au`
   - **Service:** `HTTP` → `app:8000`

   (Cloudflare creates the `tools.mateops.com.au` DNS record for you.)

## 4. Launch

```bash
docker compose up -d --build
```

First build takes a few minutes (it installs LibreOffice). Check it:

```bash
docker compose ps
docker compose logs -f app        # should show: Uvicorn running on 0.0.0.0:8000
```

Then open **https://tools.mateops.com.au** — the MateTools UI should load.
Health check: `https://tools.mateops.com.au/health` → `{"status":"ok"}`.

## 5. Harden at the Cloudflare edge (recommended)

In the `mateops.com.au` zone:

- **Rate limiting** (Security → WAF → Rate limiting rules):
  limit `POST` requests to `/api/*` to e.g. **20 requests / minute / IP**.
- **WAF managed rules:** leave Cloudflare Managed Ruleset enabled.
- **Cache rule:** cache static assets (`/`, `/styles.css`, `/app.js`) and
  bypass cache for `/api/*`.
- Optional: a **Cloudflare Turnstile** challenge on the page if abuse appears.

## 6. Updating later

```bash
cd matetools
git pull
docker compose up -d --build
```

## 7. Operations

```bash
docker compose logs -f app        # app logs (no file contents are logged)
docker compose restart app        # restart just the app
docker compose down               # stop everything
docker stats                      # watch RAM/CPU during conversions
```

### Tuning

- **Workers:** edit the `--workers` count in the `Dockerfile` CMD. Each worker
  can handle one conversion at a time; 2 is a safe default for a small VPS.
- **Upload cap:** change `MAX_UPLOAD_MB` in `.env`, then `docker compose up -d`.
- **Memory:** LibreOffice can use ~300–500 MB per conversion. If you see OOM
  kills in `docker compose logs`, add swap or upgrade the VPS plan.

---

## Why this architecture

- **LibreOffice can't run on Cloudflare Workers**, so conversion must live on the VPS.
- **The Tunnel keeps every inbound port closed** — your VPS IP is never exposed,
  and TLS/DDoS/WAF are handled free at Cloudflare's edge.
- **The app has no outbound internet** (internal Docker network), so even in a
  worst case it cannot exfiltrate a user's file. This is the privacy promise,
  enforced by infrastructure rather than just a policy page.
