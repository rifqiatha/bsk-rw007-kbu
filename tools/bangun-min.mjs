#!/usr/bin/env node
// Bangun berkas .min dari sumber yang bisa dibaca.
//
// Jalankan:  node tools/bangun-min.mjs
//
// Sumber (app.js, styles.css, ...) tetap utuh dan tetap dibaca manusia.
// Yang compressing peramban adalah berkas .min yang dihasilkan skrip ini.
// Jalankan ulang setiap kali sumber berubah, lalu naikkan nomor ?v= di
// web/index.html dan web/login.html supaya peramban mengambil berkas baru.
import { execFileSync } from "node:child_process";
import { statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");

const JS = [
  ["app.js", "es2020"],
  ["auth.js", "es2020"],
  ["registration.js", "es2020"],
  ["reveal.js", "es2020"],
];
const CSS = ["styles.css", "auth.css", "theme.css"];

// Menjalankan npx dari Node di Windows harus lewat shell: Node versi baru
// menolak membuat proses .cmd tanpa shell (EINVAL). Karena argumennya
// dirangkai jadi satu baris perintah, setiap argumen yang mengandung spasi
// harus diapit tanda kutip, kalau tidak path seperti "...\Tugas 1 - Kifayah\web"
// pecah jadi beberapa argumen dan esbuild melaporkan "Invalid build flag".
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const Windows = process.platform === "win32";
const quote = (a) => (Windows ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));
const esbuild = (args) => execFileSync(NPX, ["--yes", "--loglevel=error", "esbuild", ...args].map(quote), {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: Windows,
});

const hasil = [];
for (const [file, target] of JS) {
  const out = file.replace(/\.js$/, ".min.js");
  const kode = esbuild([join(web, file), "--minify", `--target=${target}`, "--log-level=error"]);
  writeFileSync(join(web, out), kode, "utf8");
  hasil.push([file, out]);
}
for (const file of CSS) {
  const out = file.replace(/\.css$/, ".min.css");
  const kode = esbuild([join(web, file), "--minify", "--loader:.css=css", "--log-level=error"]);
  writeFileSync(join(web, out), kode, "utf8");
  hasil.push([file, out]);
}

const kb = (n) => (n / 1024).toFixed(1).padStart(7) + " KB";
let totalAsli = 0, totalMini = 0;
console.log("berkas                asli        minified     hemat");
for (const [src, min] of hasil) {
  const a = statSync(join(web, src)).size;
  const b = statSync(join(web, min)).size;
  totalAsli += a; totalMini += b;
  console.log(src.padEnd(18), kb(a), kb(b), "  " + (100 - (b / a) * 100).toFixed(0) + "%");
}
console.log("TOTAL".padEnd(18), kb(totalAsli), kb(totalMini), "  " + (100 - (totalMini / totalAsli) * 100).toFixed(0) + "%");

// Peringatan: kalau ada .min yang lebih tua dari sumbernya, hasilnya basi.
const basi = hasil.filter(([src, min]) =>
  statSync(join(web, min)).mtimeMs < statSync(join(web, src)).mtimeMs);
if (basi.length) console.log("\nPERINGATAN: berkas minified lebih tua dari sumber:", basi.map((b) => b[0]).join(", "));