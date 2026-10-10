# Deploy Kifayah ke CasaOS (Armbian)

Panduan ini memakai Docker Compose di dalam CasaOS. CasaOS sendiri tidak
memiliki fitur "push" seperti Vercel, jadi sinkronisasi kode dilakukan dengan
`git fetch` + `docker compose up -d` secara otomatis setiap menit.

Yang sudah disiapkan di repo:

| Berkas | Fungsi |
| --- | --- |
| `Dockerfile` | Build image Python 3.10 + dependensi |
| `deploy/entrypoint.sh` | Menautkan `kifayah.sqlite3` dan `uploads/` ke folder persisten |
| `deploy/docker-compose.yml` | Menjalankan layanan di port 8000, hanya localhost |
| `deploy/auto-update.sh` | Tarik perubahan dari repo, backup DB, bangun ulang container |
| `deploy/nginx-kifayah.conf` | Contoh config reverse proxy + batas ukuran unggah |
| `deploy/kifayah-auto-update.service`/`.timer` | Menjalankan auto-update tiap 60 detik |
| `.dockerignore` | Mengecilkan konteks build |

## 1. Pastikan Docker aktif di Armbian

```bash
docker --version
docker compose version
```

Kalau `docker compose` tidak ada, pasang plugin Compose v2 lewat CasaOS:
App Store → **Custom Install** → isi `docker.io` dan `docker-compose-plugin`.

## 2. Buat repo GitHub (privat)

Di komputer Anda:

```powershell
git remote -v
```

Buat repo baru di GitHub (centang **Private**), lalu hubungkan:

```powershell
git remote add origin https://github.com/<user>/kifayah.git
git add -A
git commit -m "Deploy ke CasaOS"
git push -u origin main
```

Jangan pernah commit `kifayah.sqlite3` dan `uploads/` — keduanya sudah masuk
`.gitignore` karena berisi data warga.

## 3. Siapkan folder di server

SSH ke Armbian (user CasaOS biasanya `username` atau `root`):

```bash
sudo apt update && sudo apt install -y git
sudo mkdir -p /opt/kifayah
sudo chown "$USER":"$USER" /opt/kifayah
git clone https://github.com/<user>/kifayah.git /opt/kifayah
cd /opt/kifayah
mkdir -p deploy/persist deploy/backups
chmod +x deploy/auto-update.sh deploy/entrypoint.sh
```

Bila repo privat, buat deploy key lebih dulu (di server):

```bash
ssh-keygen -t ed25519 -C "kifayah-casaos" -f ~/.ssh/kifayah_deploy -N ""
cat ~/.ssh/kifayah_deploy.pub
```

Salin isi yang muncul ke GitHub → Settings → Deploy keys → **Add deploy key**
(tick **Allow write access** tidak perlu diaktifkan). Lalu:

```bash
mkdir -p ~/.ssh
cat >> ~/.ssh/config <<'EOF'
Host github.com-kifayah
  HostName github.com
  User git
  IdentityFile ~/.ssh/kifayah_deploy
  StrictHostKeyChecking accept-new
EOF

git -C /opt/kifayah remote set-url origin git@github.com-kifayah:<user>/kifayah.git
```

## 4. Jalankan aplikasi

```bash
cd /opt/kifayah/deploy
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=50
```

Log yang bersih (tanpa traceback) berarti aplikasi siap. Cek dari komputer/server:

```bash
curl -I http://127.0.0.1:8081
```

Login pertama memakai username `admin`, kata sandi `admin`, lalu segera ganti.

### Pindahkan data dari PC ke server

Supaya data warga yang sekarang tidak hilang, salin dari PC:

```powershell
scp kifayah.sqlite3 user@IP-SERVER:/opt/kifayah/deploy/persist/
scp -r uploads user@IP-SERVER:/opt/kifayah/deploy/persist/
ssh user@IP-SERVER "docker compose -f /opt/kifayah/deploy/docker-compose.yml restart"
```

## 5. Pasang reverse proxy + HTTPS

Jangan buka port 8000 ke internet. Pakai Caddy (paling sederhana):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Buat `/etc/caddy/Caddyfile`. Port **8081** adalah port host dari
`deploy/docker-compose.yml` (port 8000 hanya di dalam container):

```
kifayah.domain.id {
    reverse_proxy 127.0.0.1:8081
}
```

Arahkan DNS domain (A record) ke IP publik server, lalu:

```bash
sudo systemctl reload caddy
sudo ufw allow 80/tcp 443/tcp
sudo ufw enable
```

Alternatif tanpa domain: pasang **Nginx Proxy Manager** dari App Store CasaOS
dan buat Proxy Host baru yang meneruskan ke `127.0.0.1:8081`.

### 5a. Wajib: naikkan batas ukuran unggah

Reverse proxy memblokir unggah besar **sebelum** aplikasi sempat memprosesnya.
Nginx memakai batas bawaan **1 MB**, sedangkan impor 12 file XLSX sudah
melebihi 2 MB setelah dikodekan sebagai base64. Gejalanya halaman putih
bertuliskan `413 Request Entity Too Large`.

Untuk Nginx, salin `deploy/nginx-kifayah.conf` ke blok `server` domain Kifayah:

```bash
sudo cp /opt/kifayah/deploy/nginx-kifayah.conf /etc/nginx/sites-available/kifayah
sudo ln -s /etc/nginx/sites-available/kifayah /etc/nginx/sites-enabled/kifayah
sudo nginx -t && sudo systemctl reload nginx
```

Untuk Nginx Proxy Manager, buka Proxy Host → **Advanced** lalu isi:

| Field | Value |
| --- | --- |
| Custom Nginx Configuration | `client_max_body_size 96m;` |

Nilai ini harus sama atau lebih besar dari `MAX_BODY_BYTES` di `Kifayah.py`
(96 MB). Kalau Nginx lebih kecil, proxy membalas 413 lebih dulu dan aplikasi
tidak pernah menerima file yang diunggah.

Untuk Caddy, tidak perlu disetel karena Caddy tidak membatasi ukuran badan.

Setelah selesai, uji dengan mengimpor beberapa file sekaligus.

## 5c. Kode langsung dari folder repo, tanpa build ulang

`deploy/docker-compose.yml` memasang `Kifayah.py`, `importers.py`, dan folder
`web/` dari folder repo ke dalam container. Efeknya `git reset --hard` di host
langsung berlaku begitu container direstart — **tanpa** `docker compose build`
yang memakan 5–10 menit.

Cara memperbarui sekarang cukup:

```bash
cd /DATA/AppData/nginx/config/www
git reset --hard origin/main
cd deploy && docker compose up -d --force-recreate
```

Bila folder repo tidak di `/DATA/AppData/nginx/config/www`, set `KIFAYAH_DIR`:

```bash
cd /opt/kifayah/deploy
KIFAYAH_DIR=/opt/kifayah docker compose up -d --force-recreate
```

Build image tetap diperlukan hanya bila `requirements.txt` berubah:

```bash
KIFAYAH_REBUILD=1 sh /DATA/AppData/nginx/config/www/deploy/auto-update.sh
```

Bila nanti ada modul `.py` atau folder web baru yang perlu ikut ter-mount,
tambahkan barisnya di `volumes:` pada `deploy/docker-compose.yml` supaya tidak
lupa saat build ulang.

## 5b. Lokasi repo tidak selalu `/opt/kifayah`

Pada CasaOS, repo sering diletakkan di `/DATA/AppData/nginx/config/www`
supaya Nginx bisa menyajikan layanannya. `auto-update.sh`, `check-update.sh`, dan
unit systemd sudah mencari lokasi repo sendiri, jadi ketiganya tetap jalan
walau repo tidak di `/opt/kifayah`. Kalau memindahkan repo ke tempat lain,
jalankan manual dengan menyertakan lokasi:

```bash
APP_DIR=/DATA/AppData/nginx/config/www sh /path/ke/repo/deploy/auto-update.sh
```

Untuk melihat repo terdeteksi di mana:

```bash
sh /DATA/AppData/nginx/config/www/deploy/check-update.sh
```

## 6. Aktifkan auto-update dari push

Pasang timer systemd agar perubahan di GitHub langsung dipakai server:

```bash
sudo cp /opt/kifayah/deploy/kifayah-auto-update.service /etc/systemd/system/
sudo cp /opt/kifayah/deploy/kifayah-auto-update.timer /etc/systemd/system/
sudo git config --global --add safe.directory /opt/kifayah
sudo git config --global --add safe.directory /DATA/AppData/nginx/config/www
sudo systemctl daemon-reload
sudo systemctl enable --now kifayah-auto-update.timer
systemctl list-timers | grep kifayah
```

Alurnya setelah ini:

1. Di PC: `git push`.
2. Server mendeteksi dalam ≤60 detik (`git fetch`).
3. Database dicadangkan ke `deploy/backups/` (10 salinan terakhir).
4. Container di-build ulang dan di-restart.

Periksa hasil:

```bash
tail -f /opt/kifayah/deploy/auto-update.log
```

Untuk memicu langsung tanpa menunggu timer:

```bash
sudo systemctl start kifayah-auto-update.service
```

Kalau `requirements.txt` berubah, build image berjalan lagi dan dependensi
baru ikut terpasang. Build pertama cukup lama (±5-10 menit) karena mengunduh
RapidOCR dan PyMuPDF.

## 7. Cadangan rutin

Tambahkan timer harian untuk menyalin database ke folder lain:

```bash
sudo mkdir -p /opt/kifayah/backup
sudo tee /etc/cron.d/kifayah-backup >/dev/null <<'EOF'
17 2 * * * root cp /opt/kifayah/deploy/persist/kifayah.sqlite3 /opt/kifayah/backup/kifayah-$(date +\%F).sqlite3
EOF
```

## Catatan penting

- Arkitektur Armbian harus `arm64` (aarch64). Cek dengan `uname -m`. Untuk
  `armv7`, image tidak bisa dibangun karena PyMuPDF/onnxruntime tidak punya
  wheel untuk 32-bit.
- RAM minimal 2 GB, disarankan 4 GB, karena OCR impor berjalan lokal.
- Aplikasi ini masih HTTP tanpa proteksi tambahan. Batasi akses lewat HTTPS,
  kata sandi kuat, dan jangan bagikan tautan repo publik.
- `deploy/persist/` adalah satu-satunya folder berisi data. Jangan dihapus
  saat `git pull` atau `docker compose down`.