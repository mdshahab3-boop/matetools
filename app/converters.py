"""
MateTools conversion engine.

Every function takes a working directory and input file path(s), produces an
output file inside that same working directory, and returns:
    (output_path, media_type, download_name)

The caller (main.py) runs everything inside a per-request temp directory that
is deleted as soon as the response is sent. Nothing is ever persisted.
"""

import os
import re
import subprocess
import uuid
import zipfile
from pathlib import Path

from pdf2docx import Converter as Pdf2DocxConverter
from pypdf import PdfReader, PdfWriter
from PIL import Image
import img2pdf
import fitz  # PyMuPDF

SOFFICE_TIMEOUT = 180
GS_TIMEOUT = 180

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class ConversionError(Exception):
    """Raised when a conversion fails for a reason worth showing the user."""


def _run(cmd, timeout):
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if proc.returncode != 0:
        msg = proc.stderr.decode(errors="ignore")[:500] or "conversion failed"
        raise ConversionError(msg)
    return proc


# --- PDF <-> Office ---------------------------------------------------------

def pdf_to_word(workdir, pdf_path):
    out = os.path.join(workdir, Path(pdf_path).stem + ".docx")
    cv = Pdf2DocxConverter(pdf_path)
    try:
        cv.convert(out)
    except Exception as exc:  # pdf2docx raises various errors
        raise ConversionError(f"Could not convert PDF to Word: {exc}")
    finally:
        cv.close()
    if not os.path.exists(out):
        raise ConversionError("Could not convert PDF to Word")
    return out, DOCX_MIME, Path(pdf_path).stem + ".docx"


def office_to_pdf(workdir, src_path):
    # Isolated LibreOffice profile per call so concurrent jobs don't lock.
    profile = f"/tmp/lo_{uuid.uuid4().hex}"
    _run(
        [
            "soffice", "--headless", "--nologo", "--nofirststartwizard",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to", "pdf", "--outdir", workdir, src_path,
        ],
        SOFFICE_TIMEOUT,
    )
    out = os.path.join(workdir, Path(src_path).stem + ".pdf")
    if not os.path.exists(out):
        raise ConversionError("Could not convert this file to PDF")
    return out, "application/pdf", Path(src_path).stem + ".pdf"


# --- PDF toolkit ------------------------------------------------------------

def merge_pdfs(workdir, pdf_paths):
    if len(pdf_paths) < 2:
        raise ConversionError("Select at least two PDF files to merge")
    writer = PdfWriter()
    for p in pdf_paths:
        try:
            reader = PdfReader(p)
        except Exception as exc:
            raise ConversionError(f"Could not read {Path(p).name}: {exc}")
        for page in reader.pages:
            writer.add_page(page)
    out = os.path.join(workdir, "merged.pdf")
    with open(out, "wb") as f:
        writer.write(f)
    return out, "application/pdf", "merged.pdf"


def _parse_ranges(ranges, n):
    pages = []
    for part in ranges.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(part))
    return [p - 1 for p in pages if 1 <= p <= n]


def split_pdf(workdir, pdf_path, ranges=""):
    reader = PdfReader(pdf_path)
    n = len(reader.pages)
    stem = Path(pdf_path).stem

    if ranges.strip():
        try:
            idx = _parse_ranges(ranges, n)
        except ValueError:
            raise ConversionError("Page range must look like: 1-3,5,8")
        if not idx:
            raise ConversionError("No valid pages in the requested range")
        writer = PdfWriter()
        for i in idx:
            writer.add_page(reader.pages[i])
        out = os.path.join(workdir, f"{stem}_extracted.pdf")
        with open(out, "wb") as f:
            writer.write(f)
        return out, "application/pdf", f"{stem}_extracted.pdf"

    # No range given: explode into one PDF per page, returned as a zip.
    out = os.path.join(workdir, f"{stem}_pages.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for i in range(n):
            w = PdfWriter()
            w.add_page(reader.pages[i])
            pth = os.path.join(workdir, f"page_{i + 1}.pdf")
            with open(pth, "wb") as f:
                w.write(f)
            z.write(pth, f"page_{i + 1}.pdf")
    return out, "application/zip", f"{stem}_pages.zip"


def compress_pdf(workdir, pdf_path, level="ebook"):
    if level not in {"screen", "ebook", "printer", "prepress"}:
        level = "ebook"
    out = os.path.join(workdir, Path(pdf_path).stem + "_compressed.pdf")
    _run(
        [
            "gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4",
            f"-dPDFSETTINGS=/{level}", "-dNOPAUSE", "-dQUIET", "-dBATCH",
            f"-sOutputFile={out}", pdf_path,
        ],
        GS_TIMEOUT,
    )
    if not os.path.exists(out):
        raise ConversionError("Could not compress this PDF")
    return out, "application/pdf", Path(pdf_path).stem + "_compressed.pdf"


# --- Images <-> PDF ---------------------------------------------------------

def images_to_pdf(workdir, image_paths):
    prepared = []
    for i, p in enumerate(image_paths):
        try:
            im = Image.open(p)
        except Exception:
            raise ConversionError(f"{Path(p).name} is not a readable image")
        # img2pdf rejects alpha channels; flatten to RGB first.
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGB")
        pth = os.path.join(workdir, f"img_{i}.png")
        im.save(pth)
        prepared.append(pth)
    out = os.path.join(workdir, "images.pdf")
    with open(out, "wb") as f:
        f.write(img2pdf.convert(prepared))
    return out, "application/pdf", "images.pdf"


def pdf_to_images(workdir, pdf_path, dpi=150):
    try:
        dpi = max(50, min(int(dpi), 400))
    except (TypeError, ValueError):
        dpi = 150
    doc = fitz.open(pdf_path)
    stem = Path(pdf_path).stem
    out = os.path.join(workdir, f"{stem}_images.zip")
    mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat)
            pth = os.path.join(workdir, f"page_{i + 1}.png")
            pix.save(pth)
            z.write(pth, f"page_{i + 1}.png")
    doc.close()
    return out, "application/zip", f"{stem}_images.zip"


# --- Phase 2: image tools ---------------------------------------------------

def heic_to_jpg(workdir, src_path):
    import pillow_heif
    pillow_heif.register_heif_opener()
    try:
        im = Image.open(src_path)
    except Exception:
        raise ConversionError("Could not read this image. Is it a valid HEIC/HEIF file?")
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    out = os.path.join(workdir, Path(src_path).stem + ".jpg")
    im.save(out, "JPEG", quality=90)
    return out, "image/jpeg", Path(src_path).stem + ".jpg"


def compress_image(workdir, src_path, quality="medium"):
    q = {"high": 85, "medium": 65, "low": 45}.get(quality, 65)
    try:
        im = Image.open(src_path)
    except Exception:
        raise ConversionError("Could not read this image")
    stem = Path(src_path).stem
    if im.mode in ("RGBA", "LA", "P"):  # keep transparency -> optimized PNG
        out = os.path.join(workdir, stem + ".png")
        im.save(out, "PNG", optimize=True)
        return out, "image/png", stem + ".png"
    if im.mode != "RGB":
        im = im.convert("RGB")
    out = os.path.join(workdir, stem + ".jpg")
    im.save(out, "JPEG", quality=q, optimize=True)
    return out, "image/jpeg", stem + ".jpg"


def resize_image(workdir, src_path, width="", height=""):
    try:
        im = Image.open(src_path)
    except Exception:
        raise ConversionError("Could not read this image")
    w0, h0 = im.size

    def _int(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None

    w, h = _int(width), _int(height)
    if not w and not h:
        raise ConversionError("Enter a width and/or height in pixels")
    if w and not h:
        h = round(h0 * (w / w0))
    elif h and not w:
        w = round(w0 * (h / h0))
    w = max(1, min(w, 20000))
    h = max(1, min(h, 20000))
    im = im.resize((w, h))
    stem = Path(src_path).stem
    ext = (Path(src_path).suffix or ".png").lower()
    if ext in (".jpg", ".jpeg"):
        fmt, suffix, media = "JPEG", ".jpg", "image/jpeg"
        if im.mode != "RGB":
            im = im.convert("RGB")
    else:
        fmt, suffix, media = "PNG", ".png", "image/png"
    out = os.path.join(workdir, f"{stem}_{w}x{h}{suffix}")
    im.save(out, fmt)
    return out, media, os.path.basename(out)


# --- Phase 2: QR code -------------------------------------------------------

def qr_code(workdir, text):
    import segno
    text = (text or "").strip()
    if not text:
        raise ConversionError("Enter some text or a URL for the QR code")
    if len(text) > 2000:
        raise ConversionError("Text is too long for a QR code (max 2000 characters)")
    out = os.path.join(workdir, "qr-code.png")
    segno.make(text, error="m").save(out, scale=8, border=2)
    return out, "image/png", "qr-code.png"


# --- Phase 2: more PDF tools ------------------------------------------------

def rotate_pdf(workdir, pdf_path, angle="90"):
    try:
        ang = int(angle)
    except (TypeError, ValueError):
        ang = 90
    if ang not in (90, 180, 270):
        ang = 90
    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    for page in reader.pages:
        page.rotate(ang)
        writer.add_page(page)
    out = os.path.join(workdir, Path(pdf_path).stem + "_rotated.pdf")
    with open(out, "wb") as f:
        writer.write(f)
    return out, "application/pdf", Path(pdf_path).stem + "_rotated.pdf"


def protect_pdf(workdir, pdf_path, password=""):
    import pikepdf
    password = (password or "").strip()
    if not password:
        raise ConversionError("Enter a password to protect the PDF")
    out = os.path.join(workdir, Path(pdf_path).stem + "_protected.pdf")
    try:
        with pikepdf.open(pdf_path) as pdf:
            pdf.save(out, encryption=pikepdf.Encryption(owner=password, user=password, R=6))
    except pikepdf.PasswordError:
        raise ConversionError("This PDF is already password-protected — unlock it first")
    return out, "application/pdf", Path(pdf_path).stem + "_protected.pdf"


def unlock_pdf(workdir, pdf_path, password=""):
    import pikepdf
    out = os.path.join(workdir, Path(pdf_path).stem + "_unlocked.pdf")
    try:
        with pikepdf.open(pdf_path, password=(password or "")) as pdf:
            pdf.save(out)
    except pikepdf.PasswordError:
        raise ConversionError("Wrong password, or this PDF is not password-protected")
    return out, "application/pdf", Path(pdf_path).stem + "_unlocked.pdf"


def pdf_to_excel(workdir, pdf_path):
    import pdfplumber
    from openpyxl import Workbook

    wb = Workbook()
    wb.remove(wb.active)
    found = False
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            for j, table in enumerate(tables or []):
                found = True
                title = f"P{i + 1}" + (f"-{j + 1}" if len(tables) > 1 else "")
                ws = wb.create_sheet(title=title[:31])
                for row in table:
                    ws.append(["" if c is None else str(c) for c in row])
    if not found:
        raise ConversionError("No tables found in this PDF. PDF to Excel works on PDFs that contain tables.")
    out = os.path.join(workdir, Path(pdf_path).stem + ".xlsx")
    wb.save(out)
    return (out,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Path(pdf_path).stem + ".xlsx")
