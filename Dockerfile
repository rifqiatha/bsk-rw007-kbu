FROM python:3.10-slim

# Pasang dependensi sistem yang sering dibutuhkan oleh modul Python tertentu
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Salin requirements dan instal (abaikan error jika ada modul yang tidak cocok versi)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt || pip install --no-cache-dir -r requirements.txt --break-system-packages

COPY . .

# Menjalankan aplikasi utama Anda
CMD ["python", "Kifayah.py"]
