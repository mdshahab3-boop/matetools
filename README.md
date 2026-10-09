# MateTools

**Free, privacy-first document tools — part of the [MateOps](https://mateops.com.au) platform.**

A self-hosted web app that converts and manipulates documents entirely on your
own server. No accounts, no watermarks, **nothing is ever stored** — every file
is processed inside a temporary directory that is deleted the moment the result
is sent back.

Runs as two Docker containers on a single VPS (e.g. Hostinger), fronted by a
**Cloudflare Tunnel** so no inbound ports are ever exposed.

## Tools included

| Tool | What it does | Engine |
|------|--------------|--------|
| PDF → Word | PDF to editable `.docx` | `pdf2docx` |
| Office → PDF | Word / Excel / PowerPoint / ODF / RTF / TXT / CSV → PDF | LibreOffice |
| Merge PDFs | Combine several PDFs into one | `pypdf` |
| Split PDF | Extract a page range, or burst every page into a `.zip` | `pypdf` |
| Compress PDF | Shrink file size (4 quality levels) | Ghostscript |
| Images → PDF | JPG / PNG → a single PDF | `img2pdf` |
| PDF → Images | Each page to PNG, returned as a `.zip` | PyMuPDF |

## Privacy model

- Each request runs in a per-request `tempfile.TemporaryDirectory()`, deleted on response.
- The output is read into memory and streamed back; the temp files are gone before you download.
- `/tmp` is mounted as **tmpfs** (RAM) in Docker — nothing touches disk.
- The `app` container is on an **internal-only** Docker network with **no outbound internet** — it literally cannot send your files anywhere.
- No database. No object storage. No logs of file contents.

## Quick start (local test)

```bash
git clone https://github.com/mdshahab3-boop/matetools.git
cd matetools
docker build -t matetools .
docker run --rm -p 8000:8000 matetools
# open http://localhost:8000
```

## Production deploy

See **[DEPLOY.md](DEPLOY.md)** for the full Hostinger VPS + Cloudflare Tunnel
setup (`tools.mateops.com.au`), rate-limiting and hardening.

## Tech

- **Backend:** FastAPI + Uvicorn (Python 3.12)
- **Engines:** LibreOffice (headless), Ghostscript, pdf2docx, pypdf, img2pdf, PyMuPDF
- **Front end:** vanilla HTML/CSS/JS (no build step)
- **Infra:** Docker Compose + Cloudflare Tunnel

## License

MIT — see [LICENSE](LICENSE). Note that LibreOffice (MPL-2.0/LGPL) and
Ghostscript (AGPL) are invoked as external programs; review their licenses for
your own distribution.
