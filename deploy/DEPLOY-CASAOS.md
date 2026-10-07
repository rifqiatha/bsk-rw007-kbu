# Deploy Kifayah ke CasaOS (Armbian)

Panduan ini memakai Docker Compose di dalam CasaOS. CasaOS sendiri tidak
memiliki fitur "push" seperti Vercel, jadi sinkronisasi kode dilakukan dengan
`git fetch` + `docker compose up -d` secara otomatis setiap menit.

Yang sudah disiapkan di repo:

| Berkas | Fungsi |
| --- | --- |
| `deploy/Dockerfile` | Build image Python 3.11 + dependensi |
| `deploy/entrypoint.sh` | Menautkan `kifayah.sqlite3` dan `uploads/` ke folder persisten |
| `deploy/docker-compose.yml` | Menjalankan layanan di port 8000, hanya localhost |
| `deploy/auto-update.sh` | Tarik perubahan dari repo, backup DB, bangun ulang container |
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
curl -I http://127.0.0.1:8000
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

Buat `/etc/caddy/Caddyfile`:

```
kifayah.domain.id {
    reverse_proxy 127.0.0.1:8000
}
```

Arahkan DNS domain (A record) ke IP publik server, lalu:

```bash
sudo systemctl reload caddy
sudo ufw allow 80/tcp 443/tcp
sudo ufw enable
```

Alternatif tanpa domain: pasang **Nginx Proxy Manager** dari App Store CasaOS
dan buat Proxy Host baru yang meneruskan ke `127.0.0.1:8000`.

## 6. Aktifkan auto-update dari push

Pasang timer systemd agar perubahan di GitHub langsung dipakai server:

```bash
sudo cp /opt/kifayah/deploy/kifayah-auto-update.service /etc/systemd/system/
sudo cp /opt/kifayah/deploy/kifayah-auto-update.timer /etc/systemd/system/
sudo git config --global --add safe.directory /opt/kifayah
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