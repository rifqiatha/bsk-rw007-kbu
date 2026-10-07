#!/bin/sh
# Menautkan folder data persisten ke lokasi yang dipakai Kifayah.py
# (BASE_DIR = /app, sehingga database dan uploads harus ada di /app).
set -e

PERSIST_DIR="${PERSIST_DIR:-/app/persist}"
mkdir -p "$PERSIST_DIR"

# Database SQLite
if [ ! -e /app/kifayah.sqlite3 ] || [ -L /app/kifayah.sqlite3 ]; then
    touch "$PERSIST_DIR/kifayah.sqlite3"
    rm -f /app/kifayah.sqlite3
    ln -s "$PERSIST_DIR/kifayah.sqlite3" /app/kifayah.sqlite3
fi

# Folder unggahan
if [ ! -e /app/uploads ] || [ -L /app/uploads ]; then
    mkdir -p "$PERSIST_DIR/uploads"
    rm -rf /app/uploads
    ln -s "$PERSIST_DIR/uploads" /app/uploads
fi

exec "$@"