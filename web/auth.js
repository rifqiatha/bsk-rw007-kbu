const loginForm = document.querySelector("#login-form");
const dashboard = document.querySelector("#resident-dashboard");
const loginError = document.querySelector("#login-error");
const savedTheme = localStorage.getItem("kifayah-theme");
const authUsesDarkTheme = savedTheme ? savedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.dataset.mode = authUsesDarkTheme ? "dark" : "light";
document.documentElement.style.colorScheme = authUsesDarkTheme ? "dark" : "light";
function authSurfaceIsDark(element) {
  let node = element;
  while (node && node !== document.documentElement) {
    const background = getComputedStyle(node).backgroundColor;
    const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && (match[4] === undefined || Number(match[4]) > 0.05)) {
      return (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255 < 0.5;
    }
    node = node.parentElement;
  }
  return document.documentElement.dataset.mode === "dark";
}
function authUpdateProfileLogos(configuredUrl) {
  document.querySelectorAll(".theme-profile-logo").forEach((image) => {
    const host = image.closest(".resident-account-avatar, .resident-account-trigger") || image.parentElement || image;
    image.src = configuredUrl || (authSurfaceIsDark(host) ? "/assets/bsk-logo-dark.webp" : "/assets/bsk-logo-light.webp");
  });
}
authUpdateProfileLogos(null);

// HEADER: tombol tema memakai kunci localStorage yang sama dengan panel
// /admin, jadi pilihan territory di salah satu halaman ikut berlaku di
// halaman lain tanpa perlu menyetel ulang.
const AUTH_THEME_ICONS = {
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.3M12 19.1v2.3M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.6 12h2.3M19.1 12h2.3M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>',
};
function authApplyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.mode = isDark ? "dark" : "light";
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  const toggle = document.querySelector("#auth-theme-toggle");
  if (toggle) {
    document.querySelector("#auth-theme-icon").innerHTML = AUTH_THEME_ICONS[isDark ? "dark" : "light"];
    toggle.title = isDark ? "Tema gelap" : "Tema terang";
  }
}
authApplyTheme(authUsesDarkTheme ? "dark" : "light");
document.querySelector("#auth-theme-toggle")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.mode === "dark" ? "light" : "dark";
  localStorage.setItem("kifayah-theme", next);
  authApplyTheme(next);
});

function authUpdateBrandLogo(settings) {
  const image = document.querySelector("#auth-brand-icon");
  const markText = document.querySelector("#auth-brand-mark-text");
  if (!image || !markText) return;
  const theme = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
  const configured = settings?.theme_logo_ready?.logo1?.[theme] ? `/media/theme-logo/logo1/${theme}` : null;
  const source = configured || (settings?.site_icon_ready ? "/media/site-icon" : null);
  if (!source) {
    image.hidden = true;
    markText.hidden = false;
    return;
  }
  markText.hidden = true;
  image.hidden = false;
  const scale = Number(settings.icon_zoom_1 || 100) / 100;
  image.style.width = `${40 * scale}px`;
  image.style.height = `${44 * scale}px`;
  if (image.getAttribute("src") !== source) image.src = source;
}
authUpdateBrandLogo(null);
fetch("/api/settings").then((response) => response.ok ? response.json() : null).then((settings) => {
  if (!settings) return;
  document.querySelector("#auth-brand-area").textContent = settings.footer_area || "Warga Kota Bambu Utara";
  const mode = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
  const isConfigured = settings.theme_logo_ready?.logo2?.[mode];
  authUpdateProfileLogos(isConfigured ? `/media/theme-logo/logo2/${mode}` : null);
  authUpdateBrandLogo(settings);
}).catch(() => {});
// Reverse proxy dapat membalas halaman HTML (misal 413 Request Entity Too
// Large) alih-alih JSON, sehingga response.json() melempar SyntaxError dan
// menutupi penyebab sebenarnya. Badan respons dibaca sebagai teks dulu.
async function readApiResponse(response, fallbackMessage) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (payload !== null) {
    if (!response.ok) throw new Error(payload.error || fallbackMessage);
    return payload;
  }
  if (response.status === 413) {
    throw new Error("Ukuran data terlalu besar untuk server. Pilih file yang lebih kecil.");
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new Error("Server tidak dapat dihubungi saat ini. Coba beberapa saat lagi.");
  }
  throw new Error(`${fallbackMessage} (HTTP ${response.status})`);
}

async function authRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readApiResponse(response, "Permintaan tidak berhasil. Coba kembali.");
}

function showDashboard(user) {
  loginForm.hidden = true;
  dashboard.hidden = false;
  document.querySelector("#auth-title").hidden = true;
  document.querySelector("#auth-description").hidden = true;
  document.querySelector(".auth-heading .eyebrow").hidden = true;
  document.querySelector("#dashboard-name").textContent = user.display_name || user.username;
  document.querySelector("#dashboard-username").textContent = user.username;
  document.querySelector("#dashboard-menu-name").textContent = user.display_name || user.username;
  document.querySelector("#dashboard-menu-username").textContent = user.username;
  document.querySelector("#dashboard-greeting").textContent = user.display_name || user.username;
  document.querySelector(".resident-account-initial").textContent = (user.display_name || user.username).trim().charAt(0).toUpperCase();
  activateResidentMenu("payments");
  document.title = "Dashboard Warga | Kifayah";
  const now = new Date();
  document.querySelector('#payment-form [name="paid_at"]').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  document.querySelector('#payment-form [name="period"]').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement.querySelector("input");
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Sembunyikan password" : "Tampilkan password");
    let slash = button.querySelector(".visibility-slash");
    if (visible && !slash) {
      slash = document.createElementNS("http://www.w3.org/2000/svg", "path");
      slash.setAttribute("class", "visibility-slash");
      slash.setAttribute("d", "m3 3 18 18");
      button.querySelector("svg").append(slash);
    } else if (!visible && slash) slash.remove();
  });
});

document.querySelector("#forgot-button").addEventListener("click", () => {
  const message = document.querySelector("#forgot-message");
  message.hidden = !message.hidden;
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const values = new FormData(loginForm);
  try {
    const result = await authRequest("/api/login", {
      username: values.get("username"),
      password: values.get("password"),
    });
    // Admin dan pengelola diarahkan ke panelnya. Dulu akun admin justru
    // ditolak di halaman ini sehingga pengguna harus mengetik /admin sendiri.
    if (result.user?.role !== "Warga") {
      window.location.href = "/admin";
      return;
    }
    window.location.href = "/dashboard-warga";
  } catch (error) {
    loginError.textContent = error.message;
  }
});

document.querySelector("#resident-logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  // Setelah keluar, tetap di halaman masuk supaya terlihat jelas bahwa sesi
  // sudah berakhir dan akun bisa dipakai untuk masuk kembali.
  window.location.href = "/masuk";
});

async function loadResidentPayments() {
  const history = document.querySelector("#payment-history");
  history.replaceChildren(document.createTextNode("Memuat riwayat pembayaran…"));
  try {
    const response = await fetch("/api/resident/payments", { cache: "no-store" });
    const payload = await readApiResponse(response, "Riwayat pembayaran tidak dapat dimuat.");
    history.replaceChildren();
    if (!payload.payments.length) {
      history.textContent = "Belum ada pembayaran yang dikirim.";
      return;
    }
    for (const item of payload.payments) {
      const card = document.createElement("article");
      card.className = "resident-payment-card";
      const heading = document.createElement("div");
      heading.className = "resident-payment-heading";
      const period = document.createElement("strong");
      period.textContent = item.period;
      const status = document.createElement("span");
      status.className = `payment-status payment-status-${item.status === "Terverifikasi" ? "verified" : item.status === "Ditolak" ? "rejected" : "pending"}`;
      status.textContent = item.status;
      heading.append(period, status);
      const amount = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(item.amount);
      const detail = document.createElement("p");
      detail.textContent = `${amount} · ${item.paid_at} · ${item.method}`;
      card.append(heading, detail);
      /* Bukti opsional: kalau tidak ada berkas, tampilkan keterangan saja
         supaya warga tidak mengira settornya gagal terkirim. */
      if (item.proof_url) {
        const proof = document.createElement("a");
        proof.href = item.proof_url;
        proof.target = "_blank";
        proof.rel = "noopener";
        proof.textContent = "Lihat bukti";
        card.append(proof);
      } else {
        const noProof = document.createElement("span");
        noProof.className = "resident-payment-no-proof";
        noProof.textContent = "Tanpa bukti (opsional)";
        card.append(noProof);
      }
      if (item.admin_note) {
        const note = document.createElement("p");
        note.className = "payment-review-note";
        note.textContent = `Catatan pengurus: ${item.admin_note}`;
        card.append(note);
      }
      history.append(card);
    }
  } catch (error) {
    history.textContent = error.message;
  }
}

async function loadProgramInfo() {
  const container = document.querySelector("#resident-program-info");
  container.textContent = "Memuat informasi program…";
  try {
    const response = await fetch("/api/program-info", { cache: "no-store" });
    const data = await readApiResponse(response, "Informasi program belum dapat dimuat.");
    container.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = data.title;
    const content = document.createElement("p");
    content.textContent = data.content;
    container.append(title, content);
  } catch (error) { container.textContent = error.message; }
}

async function loadDeathRecords() {
  const container = document.querySelector("#resident-death-list");
  container.textContent = "Memuat arsip warga…";
  try {
    const response = await fetch("/api/records", { cache: "no-store" });
    const data = await readApiResponse(response, "Data kematian belum dapat dimuat.");
    container.replaceChildren();
    if (!data.records.length) { container.textContent = "Belum ada data yang tersedia."; return; }
    for (const record of data.records) {
      const card = document.createElement("article");
      card.className = "resident-data-card";
      const name = document.createElement("strong");
      name.textContent = record.full_name;
      const detail = document.createElement("p");
      detail.textContent = `${record.area} · Wafat ${record.date_of_death}`;
      card.append(name, detail);
      container.append(card);
    }
  } catch (error) { container.textContent = error.message; }
}

async function loadResidentFinance() {
  const container = document.querySelector("#resident-finance-list");
  const summary = document.querySelector("#resident-finance-summary");
  container.textContent = "Memuat data keuangan…";
  try {
    const response = await fetch("/api/resident/finance", { cache: "no-store" });
    const data = await readApiResponse(response, "Data keuangan belum dapat dimuat.");
    container.replaceChildren();
    const totalIncome = data.entries.reduce((sum, entry) => sum + entry.income, 0);
    const totalExpense = data.entries.reduce((sum, entry) => sum + entry.expense, 0);
    const formatter = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
    summary.replaceChildren();
    summary.hidden = data.entries.length === 0;
    for (const [label, value] of [["Pemasukan tercatat", totalIncome], ["Pengeluaran tercatat", totalExpense]]) {
      const item = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = formatter.format(value);
      item.append(name, amount);
      summary.append(item);
    }
    if (!data.entries.length) { container.textContent = "Belum ada laporan keuangan yang dibagikan."; return; }
    for (const entry of data.entries) {
      const card = document.createElement("article");
      card.className = "resident-data-card";
      const heading = document.createElement("div");
      heading.className = "resident-data-card-heading";
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const isIncome = entry.income > 0;
      const amount = document.createElement("strong");
      amount.textContent = `${isIncome ? "+" : "−"}${formatter.format(isIncome ? entry.income : entry.expense)}`;
      heading.append(title, amount);
      const detail = document.createElement("p");
      detail.textContent = `${entry.entry_date}${entry.description ? ` · ${entry.description}` : ""}`;
      card.append(heading, detail);
      container.append(card);
    }
  } catch (error) { container.textContent = error.message; }
}

const residentGroups = [...document.querySelectorAll(".resident-menu-group")];
const residentPanels = new Map(residentGroups.map((group) => [group.dataset.residentGroup, group.querySelector(".resident-view")]));
const residentWorkspace = document.querySelector("#resident-workspace-content");
const residentMobileQuery = window.matchMedia("(max-width: 760px)");
let activeResidentMenu = "payments";

function arrangeResidentDashboard() {
  const mobile = residentMobileQuery.matches;
  for (const group of residentGroups) {
    const name = group.dataset.residentGroup;
    const panel = residentPanels.get(name);
    const destination = mobile ? group : residentWorkspace;
    if (panel.parentElement !== destination) destination.append(panel);
    panel.hidden = !mobile && name !== activeResidentMenu;
    group.open = name === activeResidentMenu;
  }
}

async function activateResidentMenu(name) {
  if (!residentPanels.has(name)) return;
  activeResidentMenu = name;
  arrangeResidentDashboard();
  const loaders = {
    payments: loadResidentPayments,
    program: loadProgramInfo,
    deaths: loadDeathRecords,
    finances: loadResidentFinance,
  };
  await loaders[name]?.();
}

residentGroups.forEach((group) => {
  group.addEventListener("toggle", () => {
    const name = group.dataset.residentGroup;
    if (group.open && name !== activeResidentMenu) activateResidentMenu(name);
    else if (!group.open && !residentMobileQuery.matches && name === activeResidentMenu) group.open = true;
  });
});
residentMobileQuery.addEventListener("change", arrangeResidentDashboard);
arrangeResidentDashboard();

document.querySelector("#payment-refresh").addEventListener("click", loadResidentPayments);
document.querySelector("#payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#payment-error");
  const submit = form.querySelector('[type="submit"]');
  const values = new FormData(form);
  const file = values.get("proof");
  error.textContent = "";
  /* Bukti bersifat opsional. Bila ada berkas, tetap diperiksa ukuran dan
     jenisnya; kalau kosong, setoran tetap dikirim tanpa bukti. */
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile && file.size > 5 * 1024 * 1024) {
    error.textContent = "Ukuran file bukti maksimal 5 MB.";
    return;
  }
  submit.disabled = true;
  submit.textContent = "Mengirim…";
  try {
    let contentType = "";
    let contentBase64 = "";
    if (hasFile) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
      }
      contentType = file.type;
      contentBase64 = btoa(binary);
    }
    const response = await fetch("/api/resident/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: values.get("period"),
        amount: Number(values.get("amount")),
        paid_at: values.get("paid_at"),
        method: values.get("method"),
        content_type: contentType,
        content_base64: contentBase64,
      }),
    });
    await readApiResponse(response, "Setoran tidak dapat dikirim.");
    form.reset();
    const now = new Date();
    document.querySelector('#payment-form [name="paid_at"]').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    document.querySelector('#payment-form [name="period"]').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await loadResidentPayments();
  } catch (submissionError) {
    error.textContent = submissionError.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Kirim Setoran";
  }
});

async function loadPortal() {
  const isDashboard = window.location.pathname === "/dashboard-warga";
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    const session = await readApiResponse(response, "Sesi tidak dapat diperiksa.");
    if (session.admin && session.user?.role === "Warga") {
      showDashboard(session.user);
      return;
    }
    if (session.admin && session.user?.role !== "Warga") {
      window.location.replace("/admin");
      return;
    }
  } catch { /* Formulir login tetap dapat dipakai bila pengecekan sesi gagal. */ }
  if (isDashboard) {
    window.location.replace("/masuk");
    return;
  }
  loginForm.querySelector("input[name='username']").focus();
}

loadPortal();
