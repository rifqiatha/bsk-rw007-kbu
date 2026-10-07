/**
 * Google Apps Script — kirim data dari Google Sheets ke aplikasi Kifayah
 * tiap beberapa menit secara otomatis.
 *
 * Cara pakai:
 * 1. Buka Google Sheets → Ekstensi → Apps Script.
 * 2. Tempel seluruh kode ini.
 * 3. Isi dua konstanta di bawah (SERVER_URL dan SHEETS_TOKEN).
 * 4. Jalankan fungsi syncOnce sekali untuk mengetes (lihat menu Eksekusi).
 * 5. Buat trigger: jam(5w) → pilih fungsi syncOnce supaya berjalan tiap 5 menit.
 */

const SERVER_URL = 'https://DOMAIN-ANDA.com/api/sync/sheets';
const SHEETS_TOKEN = 'ganti-dengan-token-rahasia';

function syncOnce() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NamaSheet');
  if (!sheet) { throw new Error('Sheet tidak ditemukan'); }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) { throw new Error('Sheet kosong'); }
  const headers = values[0].map(h => String(h).trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = {};
    const source = values[i];
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = source[j];
    }
    // abaikan baris tanpa nama
    if (!String(row['nama'] || row['nama lengkap'] || row['full_name'] || '').trim()) continue;
    rows.push(row);
  }
  const res = UrlFetchApp.fetch(SERVER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + SHEETS_TOKEN },
    payload: JSON.stringify({ rows: rows }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  Logger.log('HTTP ' + code + ' → ' + res.getContentText());
  if (code < 200 || code >= 300) throw new Error('Sync gagal: ' + res.getContentText());
}
