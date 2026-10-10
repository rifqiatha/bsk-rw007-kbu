#!/bin/sh
# Tarik perubahan dari repo lalu bangun ulang container.
# Dijalankan otomatis oleh systemd timer (setiap 60 detik) atau manual.
set -eu

APP_DIR="${APP_DIR:-/opt/kifayah}"
BRANCH="${BRANCH:-main}"
COMPOSE_DIR="$APP_DIR/deploy"
LOG="$APP_DIR/deploy/auto-update.log"
BACKUP_DIR="$APP_DIR/deploy/backups"

mkdir -p "$BACKUP_DIR"

log() {
    printf '%s  %s\n' "$(date -Iseconds)" "$1" >> "$LOG"
}

cd "$APP_DIR"

# Perubahan lokal di-stash, bukan sekadar dilewati. Dulu script berhenti
# begitu ada satu file yang berubah, sehingga server bisa tertinggal banyak
# versi tanpa ada yang_MEMBER tahu. Stash dipakai supaya update tetap jalan.
if ! git diff --quiet 2>/dev/null; then
    log "Ada perubahan lokal yang belum di-commit; disimpan lewat stash lalu update dilanjutkan."
    if ! git stash push --include-untracked -m "auto-update $(date -Iseconds)" >>"$LOG" 2>&1; then
        log "GAGAL: tidak bisa menyimpan perubahan lokal. Jalankan 'cd $APP_DIR && git status' untuk diperiksa."
        exit 0
    fi
fi

current="$(git rev-parse HEAD)"
if ! git fetch --quiet origin "$BRANCH"; then
    log "GAGAL: tidak bisa menghubungi repo. Akan coba lagi nanti."
    exit 0
fi
incoming="$(git rev-parse "origin/$BRANCH")"

if [ "$current" = "$incoming" ]; then
    exit 0
fi

log "HEAD lokal = $current ; HEAD remote = $incoming"

log "Ada versi baru: $(echo "$current" | cut -c1-7) -> $(echo "$incoming" | cut -c1-7)"

# Cadangkan database sebelum mengganti kode.
if [ -f "$APP_DIR/deploy/persist/kifayah.sqlite3" ]; then
    cp "$APP_DIR/deploy/persist/kifayah.sqlite3" "$BACKUP_DIR/kifayah-$(date +%Y%m%d-%H%M%S).sqlite3"
    ls -1t "$BACKUP_DIR"/*.sqlite3 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

if ! git merge --ff-only "origin/$BRANCH"; then
    log "GAGAL: tidak bisa fast-forward, perlu intervensi manual."
    exit 1
fi

cd "$COMPOSE_DIR"

# Build tanpa cache. Cache Docker bisa mengembalikan image lama sehingga
# container terlihat sudah restart, padahal kodenya belum berubah.
if docker compose build --no-cache && docker compose up -d --force-recreate; then
    log "Sukses: container dijalankan ulang pada $(git -C "$APP_DIR" rev-parse --short HEAD)."
else
    log "GAGAL: build atau restart container gagal."
    exit 1
fi

# Pastikan container benar-benar hidup dan menjawab.
sleep 8
if docker compose ps --status running | grep -q kifayah; then
    log "Verifikasi: container kifayah berjalan pada commit $(git -C "$APP_DIR" rev-parse --short HEAD)."
else
    log "PERINGATAN: container tidak berjalan setelah update. Cek 'docker compose logs -n 50'."
fi