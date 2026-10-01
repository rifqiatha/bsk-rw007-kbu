FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ganti 'Kifayah.py' jika file utama aplikasinya menggunakan nama lain
CMD ["python", "Kifayah.py"] 
