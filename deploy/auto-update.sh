#!/bin/sh
# Tarik perubahan dari repo lalu bangun ulang container.
# Dijalankan otomatis oleh systemd timer (setiap 60 detik) atau manual.
set -eu

BRANCH="${BRANCH:-main}"

# Lokasi repo tidak selalu /opt/kifayah. Pada CasaOS repo sering diletakkan
# di /DATA/AppData/nginx/config/www. Script ini mencari sendiri lewat lokasi
# dirinya, jadi tidak perlu mengatur APP_DIR di server mana pun.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
COMPOSE_DIR="$APP_DIR/deploy"
LOG="$APP_DIR/deploy/auto-update.log"
BACKUP_DIR="$APP_DIR/deploy/backups"
LOCK_FILE="$APP_DIR/deploy/.auto-update.lock"

if [ ! -f "$APP_DIR/Kifayah.py" ]; then
    printf '%s  GAGAL: Kifayah.py tidak ditemukan di %s\n' "$(date -Iseconds)" "$APP_DIR" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

log() {
    printf '%s  %s\n' "$(date -Iseconds)" "$1" >> "$LOG"
}

# Pembaruan timer dan pembaruan manual tidak boleh menjalankan Git/Docker
# bersamaan. flock melepaskan kunci otomatis jika proses dihentikan mendadak.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "Pembaruan lain masih berjalan; giliran ini dilewati."
    exit 0
fi

cd "$APP_DIR"

# CasaOS bisa menjalankan timer dengan user yang berbeda. Opsi ini membuat
# pemeriksaan kepemilikan Git aman bagi folder aplikasi tanpa konfigurasi
# global yang rapuh atau bergantung pada user tertentu.
git_safe() {
    git -c safe.directory="$APP_DIR" "$@"
}

# Perubahan lokal di-stash, bukan sekadar dilewati. Dulu script berhenti
# begitu ada satu file yang berubah, sehingga server bisa tertinggal banyak
# versi tanpa ada yang tahu. Stash dipakai supaya update tetap jalan.
if ! git_safe diff --quiet 2>/dev/null; then
    log "Ada perubahan lokal yang belum di-commit; disimpan lewat stash lalu update dilanjutkan."
    if ! git_safe stash push --include-untracked -m "auto-update $(date -Iseconds)" >>"$LOG" 2>&1; then
        log "GAGAL: tidak bisa menyimpan perubahan lokal. Jalankan 'cd $APP_DIR && git status' untuk diperiksa."
        exit 0
    fi
fi

current="$(git_safe rev-parse HEAD)"
if ! git_safe fetch --quiet origin "$BRANCH"; then
    log "GAGAL: tidak bisa menghubungi repo. Akan coba lagi nanti."
    exit 0
fi
incoming="$(git_safe rev-parse "origin/$BRANCH")"

if [ "$current" = "$incoming" ]; then
    exit 0
fi

log "HEAD lokal = $current ; HEAD remote = $incoming"

log "Ada versi baru: $(echo "$current" | cut -c1-7) -> $(echo "$incoming" | cut -c1-7)"

# Kode utama ter-mount langsung sehingga cukup restart. Image dibangun ulang
# otomatis ketika basis image, dependensi, entrypoint, atau Compose berubah.
needs_rebuild=0
if git_safe diff --name-only "$current" "$incoming" | grep -Eq '^(Dockerfile|requirements\.txt|deploy/(entrypoint\.sh|docker-compose\.yml))$'; then
    needs_rebuild=1
fi

# Cadangkan database sebelum mengganti kode. Lokasi database berbeda-bedanya:
# di /opt/kifayah biasanya deploy/persist, sedangkan di CasaOS database ikut
# volume mount sehingga ada di root repo. Ketiganya dicoba, dan lokasi yang
# dipakai dicatat agar jelas database mana yang diamankan.
DB_PATH=""
for candidate in "$APP_DIR/deploy/persist/kifayah.sqlite3" "$APP_DIR/kifayah.sqlite3" "$APP_DIR/deploy/persist/www/kifayah.sqlite3"; do
    if [ -f "$candidate" ]; then
        DB_PATH="$candidate"
        break
    fi
done
if [ -n "$DB_PATH" ]; then
    cp "$DB_PATH" "$BACKUP_DIR/kifayah-$(date +%Y%m%d-%H%M%S).sqlite3"
    ls -1t "$BACKUP_DIR"/*.sqlite3 2>/dev/null | tail -n +11 | xargs -r rm -f
    log "Cadangan database: $DB_PATH"
else
    log "PERINGATAN: kifayah.sqlite3 tidak ditemukan, tidak ada cadangan dibuat."
fi

if ! git_safe merge --ff-only "origin/$BRANCH"; then
    log "GAGAL: tidak bisa fast-forward, perlu intervensi manual."
    exit 1
fi

cd "$COMPOSE_DIR"

# docker-compose.yml memasang kode dari folder repo. Folder itu harus sama
# dengan APP_DIR; kalau tidak, KIFAYAH_DIR diteruskan supaya docker compose
# tidak memakai lokasi bawaan yang keliru.
KIFAYAH_DIR="${KIFAYAH_DIR:-$APP_DIR}"
export KIFAYAH_DIR

# Kode diambil dari folder repo lewat volume mount (lihat docker-compose.yml),
# jadi build image tidak perlu diulang. Build hanya perlu saat requirements.txt
# berubah, yaitu ketika KIFAYAH_REBUILD=1.
if [ "${KIFAYAH_REBUILD:-0}" = "1" ] || [ "$needs_rebuild" = "1" ]; then
	log "Perubahan image/dependensi terdeteksi: membangun ulang image sebelum restart."
    if ! docker compose build --no-cache >>"$LOG" 2>&1; then
        log "GAGAL: build image gagal."
        exit 1
    fi
fi

# --force-recreate wajib karena volume mount baru hanya berlaku pada container
# yang benar-benar dibuat ulang, bukan saat restart biasa.
if docker compose up -d --force-recreate >>"$LOG" 2>&1; then
	log "Sukses: container dijalankan ulang pada $(git_safe -C "$APP_DIR" rev-parse --short HEAD)."
else
    log "GAGAL: container gagal dijalankan ulang."
    exit 1
fi

# Pastikan container benar-benar hidup dan menjawab.
sleep 8
expected_build="$(grep -m1 '^APP_BUILD' "$APP_DIR/Kifayah.py" | sed 's/.*"\(.*\)".*/\1/')"
health="$(curl -fsS --max-time 15 http://127.0.0.1:8081/health 2>>"$LOG" || true)"
running_build="$(printf '%s' "$health" | sed -n 's/.*"build"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if docker compose ps --status running | grep -q kifayah && [ -n "$running_build" ] && [ "$running_build" = "$expected_build" ]; then
	log "Verifikasi: container sehat dan build $running_build sesuai commit $(git_safe -C "$APP_DIR" rev-parse --short HEAD)."
else
	log "GAGAL VERIFIKASI: container/build tidak sesuai (harap $expected_build, respons: ${health:-tidak ada}). Cek 'docker compose logs -n 50'."
	exit 1
fi
