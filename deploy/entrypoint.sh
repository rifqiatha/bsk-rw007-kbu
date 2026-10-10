#!/bin/sh
# Menautkan folder data persisten ke lokasi yang dipakai Kifayah.py
# (BASE_DIR = /app, sehingga database dan uploads harus ada di /app).
set -e

PERSIST_DIR="${PERSIST_DIR:-/app/persist}"
mkdir -p "$PERSIST_DIR"

# Folder di /app boleh dihapus hanya kalau benar-benar isi image, bukan
# folder yang dipasang dari host. Kalau sebuah folder merupakan titik mount,
# `rm -rf` akan ikut menghapus data pengguna. is_mountpoint dipakai sebagai
# penjaga supaya penghapusan tidak terjadi pada folder semacam itu.
is_mountpoint() {
    [ -n "$(findmnt -n -o TARGET "$1" 2>/dev/null)" ] || grep -q " $1 " /proc/mounts 2>/dev/null
}

# Database SQLite
if [ ! -e /app/kifayah.sqlite3 ] || [ -L /app/kifayah.sqlite3 ]; then
    touch "$PERSIST_DIR/kifayah.sqlite3"
    rm -f /app/kifayah.sqlite3
    ln -s "$PERSIST_DIR/kifayah.sqlite3" /app/kifayah.sqlite3
fi

# Folder unggahan
if [ ! -e /app/uploads ] || [ -L /app/uploads ]; then
    mkdir -p "$PERSIST_DIR/uploads"
    if [ -e /app/uploads ] && ! is_mountpoint /app/uploads; then
        rm -rf /app/uploads
    fi
    ln -sfn "$PERSIST_DIR/uploads" /app/uploads
fi

exec "$@"
