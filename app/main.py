"""
MateTools — free, privacy-first document tools by MateOps.

Nothing uploaded here is stored. Each request runs inside a temporary directory
that is deleted the moment the converted file is sent back.
"""

import os
import re
import tempfile
from pathlib import Path
from typing import List

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import Response, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import converters as C

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "100"))
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="MateTools",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_BYTES:
        return JSONResponse(
            {"error": f"File too large. Maximum is {MAX_UPLOAD_MB} MB."},
            status_code=413,
        )
    return await call_next(request)


def _safe_name(name: str, fallback: str) -> str:
    name = os.path.basename(name or "")
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip()
    return name or fallback


async def _save(upload: UploadFile, workdir: str) -> str:
    data = await upload.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"File too large. Maximum is {MAX_UPLOAD_MB} MB.")
    if not data:
        raise HTTPException(400, "Empty file")
    pth = os.path.join(workdir, _safe_name(upload.filename, "input"))
    with open(pth, "wb") as f:
        f.write(data)
    return pth


def _deliver(out_path: str, media: str, download_name: str) -> Response:
    with open(out_path, "rb") as f:
        data = f.read()
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


def _fail(exc: C.ConversionError):
    raise HTTPException(422, str(exc))


@app.get("/health")
async def health():
    return {"status": "ok", "service": "matetools"}


@app.post("/api/pdf-to-word")
async def pdf_to_word(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.pdf_to_word(wd, src)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


@app.post("/api/office-to-pdf")
async def office_to_pdf(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.office_to_pdf(wd, src)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


@app.post("/api/merge")
async def merge(files: List[UploadFile] = File(...)):
    with tempfile.TemporaryDirectory() as wd:
        paths = [await _save(f, wd) for f in files]
        try:
            out, media, name = C.merge_pdfs(wd, paths)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


@app.post("/api/split")
async def split(file: UploadFile = File(...), ranges: str = Form("")):
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.split_pdf(wd, src, ranges)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


@app.post("/api/compress")
async def compress(file: UploadFile = File(...), level: str = Form("ebook")):
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.compress_pdf(wd, src, level)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


@app.post("/api/images-to-pdf")
async def images_to_pdf(files: List[UploadFile] = File(...)):
    with tempfile.TemporaryDirectory() as wd:
        paths = [await _save(f, wd) for f in files]
        try:
            out, media, name = C.images_to_pdf(wd, paths)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


@app.post("/api/pdf-to-images")
async def pdf_to_images(file: UploadFile = File(...), dpi: int = Form(150)):
    with tempfile.TemporaryDirectory() as wd:
        src = await _save(file, wd)
        try:
            out, media, name = C.pdf_to_images(wd, src, dpi)
        except C.ConversionError as e:
            _fail(e)
        return _deliver(out, media, name)


# Static front end (mounted last so /api/* and /health win).
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
