# MateTools — single image: FastAPI app + LibreOffice + Ghostscript.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System tools used by the converters:
#   libreoffice-*  -> Office <-> PDF
#   ghostscript    -> PDF compression
#   libgl1/glib    -> OpenCV (pulled in by pdf2docx)
#   fonts-*        -> correct text rendering in LibreOffice output
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      ghostscript \
      libgl1 \
      libglib2.0-0 \
      fonts-dejavu \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

# Two workers is plenty for a VPS; conversions are CPU-bound and short-lived.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
