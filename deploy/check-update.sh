#!/bin/sh
# Periksa apakah server benar-benar menjalankan kode terbaru.
#
# Jalankan:  sh deploy/check-update.sh
#
# Skrip ini hanya membaca; tidak mengubah apa pun. Cocok dipakai ketika
# fitur baru di peramban tidak berfungsi, misalnya impor yang masih memakai
# pesan error versi lama.
set -u

BRANCH="${BRANCH:-main}"
EXPECTED_BUILD="20261010-11"

# Lokasi repo dicari dari posisi script ini, sehingga jalan baik di
# /opt/kifayah maupun di /DATA/AppData/nginx/config/www (CasaOS).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"

printf '%s\n' "=== Kifayah: pemeriksaan versi ==="

cd "$APP_DIR" 2>/dev/null || {
    printf '%s\n' "GAGAL: folder $APP_DIR tidak ditemukan."
    exit 1
}

printf 'Folder aplikasi : %s\n' "$(pwd)"

# 1. Status git: apakah ada perubahan lokal yang menahan update?
if ! git diff --quiet 2>/dev/null; then
    printf '%s\n' "PERINGATAN: ada perubahan lokal yang belum di-commit:"
    git status --short
else
    printf '%s\n' "Perubahan lokal  : bersih"
fi

# 2. Versi lokal vs remote.
if git fetch --quiet origin "$BRANCH" 2>/dev/null; then
    local_head="$(git rev-parse --short HEAD)"
    remote_head="$(git rev-parse --short "origin/$BRANCH")"
    printf 'Commit lokal    : %s\n' "$local_head"
    printf 'Commit remote   : %s\n' "$remote_head"
    if [ "$local_head" = "$remote_head" ]; then
        printf '%s\n' "Kode            : sudah paling baru"
    else
        printf '%s\n' "Kode            : BELUM TERBARU, jalankan sh deploy/auto-update.sh"
    fi
else
    printf '%s\n' "GAGAL: tidak bisa menghubungi repo."
fi

# 3. Build yang benar-benar dijalankan proses Python.
running_build="$(grep -m1 '^APP_BUILD' Kifayah.py 2>/dev/null | sed 's/.*"\(.*\)".*/\1/')"
printf 'Build di kode   : %s\n' "${running_build:-(tidak ada)}"

# Di CasaOS nama container bisa berbeda, jadi dicari dari docker-compose
# di folder deploy, bukan hanya nama tetap "kifayah".
CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '(^|-)kifayah$' | head -n 1)"
if [ -n "$CONTAINER" ]; then
    # Build dari kode yang benar-benar di dalam container, bukan dari folder.
    printf 'Container        : %s\n' "$CONTAINER"
    container_build="$(docker exec "$CONTAINER" grep -m1 '^APP_BUILD' /app/Kifayah.py 2>/dev/null | sed 's/.*"\(.*\)".*/\1/')"
    if [ -z "$container_build" ]; then
        printf '%s\n' "Build di container: TIDAK ADA -> container memakai Kifayah.py versi lama."
        printf '%s\n' "Perbaiki dengan: sh deploy/auto-update.sh"
    elif [ "$container_build" = "$EXPECTED_BUILD" ]; then
        printf 'Build di container: %s (sesuai)\n' "$container_build"
    else
        printf 'Build di container: %s (HARAPNYA %s) -> versi berbeda\n' "$container_build" "$EXPECTED_BUILD"
        printf '%s\n' "Perbaiki dengan: sh deploy/auto-update.sh"
    fi
else
    printf '%s\n' "Container Kifayah tidak berjalan."
    printf '%s\n' "Periksa dengan: docker ps -a | grep -i kifayah"
fi

# 4. Catatan auto-update terakhir.
LOG="$APP_DIR/deploy/auto-update.log"
if [ -f "$LOG" ]; then
    printf '%s\n' "Catatan auto-update terakhir:"
    tail -n 8 "$LOG" | sed 's/^/  /'
else
    printf '%s\n' "Belum ada deploy/auto-update.log (auto-update belum pernah berjalan)."
fi

printf '%s\n' "=== selesai ==="