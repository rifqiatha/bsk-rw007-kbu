FROM python:3.10-slim

WORKDIR /app

# Zona waktu Indonesia dan port aplikasi
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Jakarta \
    PORT=8000

# Pasang tzdata supaya jadwal server mengikuti WIB
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

# Pasang dependensi (openpyxl, PyMuPDF, RapidOCR, Pillow, dll)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Salin semua file proyek ke dalam container
COPY . /app

# Siapkan skrip entrypoint dan folder data persisten
RUN chmod +x /app/deploy/entrypoint.sh && mkdir -p /app/persist

EXPOSE 8000

# Mulai aplikasi
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["python", "Kifayah.py"]