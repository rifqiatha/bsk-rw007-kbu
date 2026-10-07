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

if ! git diff --quiet 2>/dev/null; then
    log "LEWATI: ada perubahan lokal di server, tidak ditimpa."
    exit 0
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

log "Ada versi baru: $(echo "$current" | cut -c1-7) -> $(echo "$incoming" | cut -c1-7)"

# Cadangkan database sebelum mengganti kode.
if [ -f "$APP_DIR/deploy/persist/kifayah.sqlite3" ]; then
    cp "$APP_DIR/deploy/persist/kifayah.sqlite3" "$BACKUP_DIR/kifayah-$(date +%Y%m%d-%H%M%S).sqlite3"
    ls -1t "$BACKUP_DIR"/*.sqlite3 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

if ! git merge --ff-only "origin/$BRANCH"; then
    log "GAGAL: tidak bisa fast-forward, perlu interventions manual."
    exit 1
fi

cd "$COMPOSE_DIR"
if docker compose build && docker compose up -d; then
    log "Sukses: container dijalankan ulang pada $(git -C "$APP_DIR" rev-parse --short HEAD)."
else
    log "GAGAL: build atau restart container gagal."
    exit 1
fi