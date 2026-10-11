"""
MateTools — free, privacy-first document tools by MateOps.

SEO-first architecture: the homepage plus one dedicated, keyword-targeted
landing page per tool (e.g. /pdf-to-word), each server-rendered with its own
title, meta description, canonical, Open Graph and JSON-LD structured data.

Nothing uploaded is stored: each conversion runs in a temp directory that is
deleted the moment the file is sent back.
"""

import os
import re
import json
import tempfile
from pathlib import Path
from typing import List

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import Response, JSONResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .content import TOOLS, tool_list, SITE, BRAND, TAGLINE

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "100"))
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
BASE = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE / "templates"))

app = FastAPI(title=BRAND, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


@app.middleware("http")
async def limit_body(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_BYTES:
        return JSONResponse({"error": f"File too large. Maximum is {MAX_UPLOAD_MB} MB."}, status_code=413)
    return await call_next(request)


# --------------------------------------------------------------------------
# Structured data (JSON-LD) — helps Google show rich results.
# --------------------------------------------------------------------------
def _software_schema(slug, t):
    return {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": f"{t['name']} — {BRAND}",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "url": f"{SITE}/{slug}",
        "description": t["meta"],
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "AUD"},
        "publisher": {"@type": "Organization", "name": "MateOps", "url": "https://mateops.com.au"},
    }


def _faq_schema(t):
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q,
             "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in t["faqs"]
        ],
    }


def _breadcrumb_schema(slug, t):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "MateTools", "item": SITE},
            {"@type": "ListItem", "position": 2, "name": t["name"], "item": f"{SITE}/{slug}"},
        ],
    }


def _home_schema():
    return [
        {"@context": "https://schema.org", "@type": "WebSite", "name": BRAND, "url": SITE,
         "description": TAGLINE},
        {"@context": "https://schema.org", "@type": "Organization", "name": "MateOps",
         "url": "https://mateops.com.au",
         "subOrganization": {"@type": "Organization", "name": BRAND, "url": SITE}},
        {"@context": "https://schema.org", "@type": "ItemList",
         "itemListElement": [
             {"@type": "ListItem", "position": i + 1, "name": t["name"], "url": f"{SITE}/{s}"}
             for i, (s, t) in enumerate(TOOLS.items())]},
    ]


def _render(name, context):
    return templates.TemplateResponse(name, context)


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return _render("home.html", {
        "request": request, "site": SITE, "brand": BRAND, "tagline": TAGLINE,
        "tools": tool_list(), "canonical": SITE + "/",
        "page_title": f"Free PDF & Document Tools — No Sign-up | {BRAND}",
        "page_meta": "Free online PDF and document tools: convert PDF to Word, Word to PDF, merge, split, compress, JPG to PDF and more. No sign-up, no watermarks, nothing stored.",
        "json_ld": json.dumps(_home_schema()),
    })


@app.get("/health")
async def health():
    return {"status": "ok", "service": "matetools"}


@app.get("/robots.txt", response_class=PlainTextResponse)
async def robots():
    return f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {SITE}/sitemap.xml\n"


@app.get("/sitemap.xml")
async def sitemap():
    urls = [(SITE + "/", "1.0")] + [(f"{SITE}/{s}", "0.9") for s in TOOLS]
    items = "".join(
        f"<url><loc>{loc}</loc><changefreq>monthly</changefreq><priority>{p}</priority></url>"
        for loc, p in urls
    )
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{items}</urlset>'
    return Response(content=xml, media_type="application/xml")


@app.get("/{slug}", response_class=HTMLResponse)
async def tool_page(request: Request, slug: str):
    t = TOOLS.get(slug)
    if not t:
        raise HTTPException(404, "Page not found")
    schema = [_software_schema(slug, t), _faq_schema(t), _breadcrumb_schema(slug, t)]
    related = [{"slug": s, **TOOLS[s]} for s in t.get("related", []) if s in TOOLS]
    return _render("tool.html", {
        "request": request, "site": SITE, "brand": BRAND, "slug": slug, "t": t,
        "tools": tool_list(), "related": related, "canonical": f"{SITE}/{slug}",
        "page_title": t["title"], "page_meta": t["meta"],
        "widget": json.dumps({
            "endpoint": t["endpoint"], "accept": t.get("accept", ""),
            "multiple": t.get("multiple", False), "field": t.get("field", "file"),
            "options": t.get("options", []),
            "mode": t.get("mode", "upload"), "input": t.get("input"),
            "preview": t.get("preview", False), "cta": t.get("cta", "Convert"),
        }),
        "json_ld": json.dumps(schema),
        "max_mb": MAX_UPLOAD_MB,
    })


# --------------------------------------------------------------------------
# Conversion API (converters imported lazily so pages render without the
# heavy PDF/Office libraries — keeps startup fast and testable).
# --------------------------------------------------------------------------
def _safe_name(name, fallback):
    name = os.path.basename(name or "")
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip()
    return name or fallback


async def _save(upload, workdir):
    data = await upload.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"File too large. Maximum is {MAX_UPLOAD_MB} MB.")
    if not data:
        raise HTTPException(400, "Empty file")
    pth = os.path.join(workdir, _safe_name(upload.filename, "input"))
    with open(pth, "wb") as f:
        f.write(data)
    return pth


def _deliver(out_path, media, download_name):
    with open(out_path, "rb") as f:
        data = f.read()
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{download_name}"'})


@app.post("/api/pdf-to-word")
async def api_pdf_to_word(file: UploadFile = File(...)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.pdf_to_word(wd, src)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/office-to-pdf")
async def api_office_to_pdf(file: UploadFile = File(...)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.office_to_pdf(wd, src)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/merge")
async def api_merge(files: List[UploadFile] = File(...)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        paths = [await _save(f, wd) for f in files]
        try:
            out, media, name = C.merge_pdfs(wd, paths)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/split")
async def api_split(file: UploadFile = File(...), ranges: str = Form("")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.split_pdf(wd, src, ranges)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/compress")
async def api_compress(file: UploadFile = File(...), level: str = Form("ebook")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.compress_pdf(wd, src, level)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/images-to-pdf")
async def api_images_to_pdf(files: List[UploadFile] = File(...)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        paths = [await _save(f, wd) for f in files]
        try:
            out, media, name = C.images_to_pdf(wd, paths)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/pdf-to-images")
async def api_pdf_to_images(file: UploadFile = File(...), dpi: int = Form(150)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.pdf_to_images(wd, src, dpi)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


# --- Phase 2 endpoints ------------------------------------------------------

@app.post("/api/heic-to-jpg")
async def api_heic_to_jpg(file: UploadFile = File(...)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.heic_to_jpg(wd, src)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/compress-image")
async def api_compress_image(file: UploadFile = File(...), quality: str = Form("medium")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.compress_image(wd, src, quality)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/resize-image")
async def api_resize_image(file: UploadFile = File(...), width: str = Form(""), height: str = Form("")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.resize_image(wd, src, width, height)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/qr-code")
async def api_qr_code(text: str = Form("")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        try:
            out, media, name = C.qr_code(wd, text)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/rotate-pdf")
async def api_rotate_pdf(file: UploadFile = File(...), angle: str = Form("90")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.rotate_pdf(wd, src, angle)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/protect-pdf")
async def api_protect_pdf(file: UploadFile = File(...), password: str = Form("")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.protect_pdf(wd, src, password)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/unlock-pdf")
async def api_unlock_pdf(file: UploadFile = File(...), password: str = Form("")):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.unlock_pdf(wd, src, password)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)


@app.post("/api/pdf-to-excel")
async def api_pdf_to_excel(file: UploadFile = File(...)):
    from . import converters as C
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.pdf_to_excel(wd, src)
        except C.ConversionError as e:
            raise HTTPException(422, str(e))
        return _deliver(out, media, name)
