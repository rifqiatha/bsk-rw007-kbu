const listElement = document.querySelector("#record-list tbody");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const adminRecordSearchInput = document.querySelector("#admin-record-search");
const adminRecordSortSelect = document.querySelector("#admin-record-sort");
const importDestinationSelect = document.querySelector("#import-destination");
const importTemplateLink = document.querySelector("#import-template-link");
const countElement = document.querySelector("#record-count");
const emptyState = document.querySelector("#empty-state");
const dialog = document.querySelector("#admin-dialog");
const loginForm = document.querySelector("#login-form");
const managerPanel = document.querySelector("#manager-panel");
const recordForm = document.querySelector("#record-form");
const mobileTaskDialog = document.querySelector("#mobile-task-dialog");
let mobileTaskPlaceholder = null;
let mobileTaskTarget = null;
let mobileTaskReturnTab = "records";
const settingsForm = document.querySelector("#settings-form");
const records = [];
let hasRenderedRecords = false;
let settingsPayloadSignature = null;
const settings = { rt_count: 1, rw_count: 7, icon_zoom_1: 100, icon_zoom_2: 100, hero_background_scale: 100, hero_image_position: "right", site_font_preset: "kifayah", site_font_scale: 100, site_font_style: "normal", site_font_style_target: "all", intro_text_alignment: "left", news_text_alignment: "left", directory_text_alignment: "left" };
let familyFilterKK = null;
const siteIconAvailability = { 1: false, 2: false };
const themeLogoAvailability = {
  logo1: { light: false, dark: false },
  logo2: { light: false, dark: false },
  hero: { light: false, dark: false },
  slideshow: { light: false, dark: false },
};
const donationSettings = {};
let heroPlaylist = [];
let heroPlaylistSourceItems = [];
let heroPlaylistSignature = null;
let heroPlaylistItemsSignature = null;
let heroSlideTimer = null;
let heroVideo = null;
let heroHasFallbackImage = false;
// Media yang gagal ditampilkan dicatat agar tidak dicoba berulang tanpa henti.
const heroFailedMedia = new Set();
let contributionResidents = [];
let originalContributionResidents = [];
let contributionResidentsSignature = "";
const heroImageElement = document.querySelector("#hero-image");
const THEME_STORAGE_KEY = "kifayah-theme";
const DARK_BSK_LOGO_URL = new URL("/assets/bsk-logo-dark.png", document.baseURI).href;
const LIGHT_BSK_LOGO_URL = new URL("/assets/bsk-logo-light.png", document.baseURI).href;
function themedBskLogoUrl(target, theme) {
  if (themeLogoAvailability[target]?.[theme]) return `/media/theme-logo/${target}/${theme}`;
  if (target === "logo2" || target === "hero") return theme === "dark" ? DARK_BSK_LOGO_URL : LIGHT_BSK_LOGO_URL;
  return "";
}
const HOME_NOTIFICATIONS_STORAGE_KEY = "kifayah-home-notifications-seen";
let importRows = [];
let lastImportReport = null;
let importDestination = "records";
let isAdmin = false;
let currentUser = null;
let adminUsers = [];
const rolePermissionDefaults = {
  Staff: ["records"],
  Admin: ["records", "import", "news", "family", "maintenance", "typography", "payments", "program", "finance", "contacts", "registration"],
  "Super Admin": ["records", "import", "news", "area", "family", "media", "maintenance", "typography", "users", "export", "payments", "program", "finance", "contacts", "registration"],
  Warga: [],
};
let selectedGenderFilter = "";
let tableSortKey = "";
let tableSortDirection = "asc";
let recordsPage = 0;
const RECORDS_PAGE_SIZE = 10;
let contributionStatusKey = "all";
let adminRecordsPage = 0;
let contributionResidentsPage = 0;
const CONTRIBUTION_PAGE_SIZE = 10;
const ADMIN_RECORDS_PAGE_SIZE = 10;
const isAdminPage = window.location.pathname === "/admin";
document.body.classList.toggle("admin-page", isAdminPage);
if (isAdminPage) document.title = "Admin | Data Kifayah";
function clearAdminTaskFragment() {
  if (isAdminPage && window.location.hash) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }
}
clearAdminTaskFragment();

const publicSectionPaths = {
  "intro-section": "/home",
  "news-section": "/berita",
  "contacts-section": "/kontak",
};
let hasRestoredPublicRoute = false;
let pendingPublicSection = "";
let pendingPublicSectionTimer = 0;

function updatePublicSectionPath(sectionId, method = "replaceState") {
  const path = publicSectionPaths[sectionId];
  if (!path || isAdminPage || (method === "replaceState" && /^\/berita\//.test(window.location.pathname))) return;
  if (window.location.pathname !== path || window.location.hash) {
    window.history[method]({}, "", path);
  }
}

function restorePublicRoute() {
  if (isAdminPage || hasRestoredPublicRoute) return;
  hasRestoredPublicRoute = true;
  if (/^\/berita\/[^/]+\/?$/.test(window.location.pathname) || (window.location.hash && newsArticleFromLocation())) return;
  const legacySection = {
    "intro-section": "intro-section",
    "news-section": "news-section",
    "contacts-section": "contacts-section",
  }[decodeURIComponent(window.location.hash.slice(1)).toLowerCase()];
  const pathToSection = Object.fromEntries(Object.entries(publicSectionPaths).map(([id, path]) => [path, id]));
  const requestedSection = pathToSection[window.location.pathname] || legacySection || "intro-section";
  const section = document.getElementById(requestedSection);
  if (!section || section.hidden) {
    updatePublicSectionPath("intro-section");
    return;
  }
  updatePublicSectionPath(requestedSection);
  window.requestAnimationFrame(() => section.scrollIntoView({ behavior: "auto", block: "start" }));
}

// The IDE preview on localhost:8000 can serve static files without API routes;
// send its login link to the running Kifayah server on 8001 in that case.
document.querySelectorAll("#resident-login-open, #mobile-resident-login-open").forEach((link) => {
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    let destination = new URL("/masuk", window.location.origin);
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) throw new Error("API route unavailable");
    } catch {
      if (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "8000") {
        destination = new URL("/masuk", `${window.location.protocol}//${window.location.hostname}:8001`);
      }
    }
    window.location.assign(destination.href);
  });
});

const siteHeader = document.querySelector(".topbar");
if (siteHeader && !isAdminPage) {
  let headerScrollFrame = 0;
  const updateHeaderScrollState = () => {
    const scrolledFromTop = window.scrollY >= 50;
    siteHeader.toggleAttribute("data-scrolled", scrolledFromTop);
    headerScrollFrame = 0;
  };
  updateHeaderScrollState();
  window.addEventListener("scroll", () => {
    if (headerScrollFrame) return;
    headerScrollFrame = window.requestAnimationFrame(() => {
      updateHeaderScrollState();
    });
  }, { passive: true });
}

document.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || event.isComposing) return;
  const nameFields = ["full_name", "living_family_name"];
  if (!nameFields.includes(input.name) && !nameFields.includes(input.dataset.importField)) return;
  const originalValue = input.value;
  const uppercaseValue = originalValue.toLocaleUpperCase("id-ID");
  if (uppercaseValue === originalValue) return;
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  input.value = uppercaseValue;
  if (selectionStart !== null && selectionEnd !== null) {
    input.setSelectionRange(
      originalValue.slice(0, selectionStart).toLocaleUpperCase("id-ID").length,
      originalValue.slice(0, selectionEnd).toLocaleUpperCase("id-ID").length,
    );
  }
}, true);

const recordImportFields = [
  ["full_name", "Nama", "text"],
  ["gender", "Jenis kelamin", "gender"],
  ["rt", "RT", "number"],
  ["rw", "RW", "number"],
  ["date_of_death", "Tanggal wafat", "date"],
  ["address", "Alamat", "text"],
  ["family_card_number", "Nomor kartu keluarga", "text"],
  ["national_id_number", "NIK", "text"],
  ["birthplace", "Tempat lahir", "text"],
  ["birth_date", "Tanggal lahir", "date"],
  ["religion", "Agama", "text"],
  ["living_family_name", "Nama anggota keluarga", "text"],
  ["living_family_relationship", "Hubungan keluarga", "text"],
];
const contributionImportFields = [
  ["full_name", "Nama", "text"],
  ["gender", "Jenis kelamin", "gender"],
  ["rt", "RT", "number"],
  ["rw", "RW", "number"],
  ["birth_date", "Tanggal lahir", "date"],
  ["address", "Alamat lengkap", "text"],
  ["family_card_number", "Nomor kartu keluarga", "text"],
  ["national_id_number", "NIK", "text"],
  ["birthplace", "Tempat lahir", "text"],
  ["religion", "Agama", "text"],
  ["relationship", "Hubungan", "text"],
  ["phone", "No HP", "text"],
  ["residence_status", "Status", "text"],
  ["payment_recipient", "Disetorkan kepada", "text"],
  ["payment_period", "Bulan iuran (opsional)", "month"],
  ["paid_at", "Tanggal pembayaran (opsional)", "date"],
  ["amount", "Nominal setoran (opsional)", "number"],
];
function currentImportFields() {
  return importDestination === "contributions" ? contributionImportFields : recordImportFields;
}

// TEMA: paket CERAMIC memegang atribut data-theme, jadi mode malam memakai data-mode.
const THEME_ICONS = {
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.6v2.3M12 19.1v2.3M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.6 12h2.3M19.1 12h2.3M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"/></svg>',
};
function setHeroImageSource(image, source) {
  image.dataset.themeSource = source ? new URL(source, document.baseURI).href : "";
  delete image.dataset.themeVariant;
  delete image.dataset.themeDarkVariant;
  image.closest(".hero-visual")?.classList.remove("uses-theme-bsk-logo");
  if (source) image.src = source;
  else image.removeAttribute("src");
}
function heroImageHasTransparency(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 245) transparent += 1;
    return transparent > pixels.length / 4 * 0.04;
  } catch {
    return false;
  }
}
function updateHeroLogoContrast() {
  const image = heroImageElement;
  if (!image?.complete || !image.naturalWidth || image.hidden) return;
  const original = image.dataset.themeSource || image.currentSrc || image.src;
  const visual = image.closest(".hero-visual");
  const theme = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
  const configuredHeroLogo = themedBskLogoUrl("hero", theme);
  if (original.endsWith("/media/hero") && (themeLogoAvailability.hero[theme] || heroImageHasTransparency(image))) {
    visual?.classList.add("uses-theme-bsk-logo");
    const themedLogo = configuredHeroLogo || (theme === "dark" ? DARK_BSK_LOGO_URL : LIGHT_BSK_LOGO_URL);
    if (image.src !== themedLogo) image.src = themedLogo;
    return;
  }
  if (configuredHeroLogo && original === configuredHeroLogo) {
    visual?.classList.add("uses-theme-bsk-logo");
    return;
  }
  visual?.classList.remove("uses-theme-bsk-logo");
  if (image.src !== original) image.src = original;
}
heroImageElement.addEventListener("load", updateHeroLogoContrast);
function surfaceIsDark(element) {
  let node = element;
  while (node && node !== document.documentElement) {
    const background = getComputedStyle(node).backgroundColor;
    const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && (match[4] === undefined || Number(match[4]) > 0.05)) {
      const luminance = (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255;
      return luminance < 0.5;
    }
    node = node.parentElement;
  }
  const rootBackground = getComputedStyle(document.documentElement).backgroundColor;
  const match = rootBackground.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return document.documentElement.dataset.mode === "dark";
  return (0.299 * Number(match[1]) + 0.587 * Number(match[2]) + 0.114 * Number(match[3])) / 255 < 0.5;
}
function updateThemeSensitiveLogos() {
  const theme = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
  document.querySelectorAll(".theme-profile-logo").forEach((image) => {
    const configured = themeLogoAvailability.logo2?.[theme] ? themedBskLogoUrl("logo2", theme) : "";
    let logoUrl = configured;
    if (!logoUrl) {
      const host = image.closest(".admin-profile-avatar, .resident-account-avatar, .admin-profile-trigger, .resident-account-trigger") || image.parentElement || image;
      logoUrl = surfaceIsDark(host) ? DARK_BSK_LOGO_URL : LIGHT_BSK_LOGO_URL;
    }
    if (image.getAttribute("src") !== logoUrl) image.src = logoUrl;
  });
  updateHeroPlaylist(heroPlaylistSourceItems, heroHasFallbackImage);
}
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.mode = isDark ? "dark" : "light";
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  document.querySelector("#browser-theme-color").content = isDark ? "#171717" : "#ededed";
  updateHeroLogoContrast();
  updateBrandLogoDisplay();
  updateThemeSensitiveLogos();
  const toggle = document.querySelector("#theme-toggle");
  if (!toggle) return;
  document.querySelector("#theme-icon").innerHTML = THEME_ICONS[isDark ? "dark" : "light"];
  toggle.setAttribute("aria-label", "Pilih tema");
  toggle.title = isDark ? "Tema gelap" : "Tema terang";
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.themeChoice === (isDark ? "dark" : "light")));
  });
}

const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
applyTheme(savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

function applyIconZoom(slot, value) {
  document.documentElement.style.setProperty(`--brand-logo-zoom-${slot}`, String(value / 100));
}

function applySiteTypography({ font_preset, font_scale, font_style, font_style_target, intro_text_alignment, news_text_alignment, directory_text_alignment }) {
  const root = document.documentElement;
  root.dataset.fontPreset = font_preset;
  root.style.setProperty("--site-font-scale", String(font_scale / 100));
  root.style.setProperty("--intro-text-align", intro_text_alignment);
  root.style.setProperty("--news-text-align", news_text_alignment);
  root.style.setProperty("--directory-text-align", directory_text_alignment);
  const style = ["normal", "bold", "italic", "bolditalic"].includes(font_style) ? font_style : "normal";
  document.body.classList.toggle("site-font-bold", style === "bold" || style === "bolditalic");
  document.body.classList.toggle("site-font-italic", style === "italic" || style === "bolditalic");
  const target = ["all", "headings", "highlight", "body"].includes(font_style_target) ? font_style_target : "all";
  document.body.classList.remove("target-all", "target-headings", "target-highlight", "target-body");
  document.body.classList.add(`target-${target}`);
}

function applyHeroBackgroundScale(value) {
  const scale = Math.max(0, Number(value) || 0);
  document.documentElement.style.setProperty("--hero-background-scale", String(scale / 100));
}

function applyHeroImagePosition(value) {
  const position = ["left", "center", "right"].includes(value) ? value : "right";
  document.querySelector("#intro-section").dataset.heroPosition = position;
}

function importDateIsValid(value) {
  const parsedDate = new Date(`${value}T00:00:00Z`);
  return Boolean(value) && !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === value;
}

// Kembalikan daftar alasan kenapa satu baris perlu diperiksa.
//
// Catatan: ini hanya informational. Baris bermasalah tetap dikirim ke server
// supaya data tidak hilang; server membersihkan field yang tak terbaca dan
// mencatat sisanya di Tinjauan Data. Hanya baris tanpa nama yang benar-benar
// tidak bisa disimpan.
function importRowProblems(row) {
  const text = (field) => typeof row[field] === "string" ? row[field].trim() : "";
  const problems = [];
  const fullName = text("full_name");
  const gender = text("gender").toUpperCase();
  const dateOfDeath = text("date_of_death");
  const birthDate = text("birth_date");
  const rtText = row.rt == null ? "" : String(row.rt).trim();
  const rwText = row.rw == null ? "" : String(row.rw).trim();
  const familyName = text("living_family_name");
  const familyRelationship = text("living_family_relationship");
  const paymentPeriod = text("payment_period");
  const paymentDate = text("paid_at");
  const amountText = row.amount == null ? "" : String(row.amount).trim();
  const hasPaymentData = Boolean(paymentPeriod || paymentDate || amountText);
  const contributions = importDestination === "contributions";

  if (!fullName.length) problems.push("nama warga kosong");
  // Nilai di luar rentang RT/RW hanya diperingatkan. Server tetap menyimpannya
  // supaya RT 012 tidak hilang hanya karena pengaturan situs masih RT 10.
  if (rtText && !/^\d+$/.test(rtText)) problems.push(`RT "${rtText}" bukan angka`);
  else if (rtText && Number(rtText) < 1) problems.push(`RT "${rtText}" di luar 1-${settings.rt_count}`);
  else if (rtText && Number(rtText) > settings.rt_count) problems.push(`RT "${rtText}" di luar 1-${settings.rt_count}, tetap disimpan`);
  if (rwText && !/^\d+$/.test(rwText)) problems.push(`RW "${rwText}" bukan angka`);
  else if (rwText && Number(rwText) < 1) problems.push(`RW "${rwText}" di luar 1-${settings.rw_count}`);
  else if (rwText && Number(rwText) > settings.rw_count) problems.push(`RW "${rwText}" di luar 1-${settings.rw_count}, tetap disimpan`);
  if (gender && !["P", "L"].includes(gender)) problems.push(`jenis kelamin "${gender}" tidak dikenali, dikosongkan`);
  if (birthDate && !importDateIsValid(birthDate)) problems.push(`tanggal lahir "${birthDate}" tidak terbaca, dikosongkan`);
  if (!contributions && dateOfDeath && !importDateIsValid(dateOfDeath)) {
    problems.push(`tanggal wafat "${dateOfDeath}" tidak terbaca, dikosongkan`);
  }
  if (hasPaymentData) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(paymentPeriod)) {
      problems.push(`bulan iuran "${paymentPeriod}" tidak berformat YYYY-MM`);
    }
    if (!paymentDate) problems.push("tanggal pembayaran kosong padahal ada setoran");
    else if (!importDateIsValid(paymentDate)) problems.push(`tanggal pembayaran "${paymentDate}" tidak berformat YYYY-MM-DD`);
    if (!/^\d+$/.test(amountText)) problems.push(`nominal "${amountText}" bukan angka bulat`);
  }
  return problems;
}

// Hanya baris tanpa nama yang tidak bisa diimpor. Selebihnya tetap dikirim
// dan dibersihkan di server.
function importRowIsValid(row) {
  return String(row.full_name ?? "").trim().length > 0;
}

function updateImportSummary() {
  const selectedRows = importRows.filter((row) => row.selected);
  const validCount = selectedRows.filter(importRowIsValid).length;
  const skippedCount = selectedRows.length - validCount;
  const selectableRows = importRows.slice();
  const selectedSelectableCount = selectableRows.filter((row) => row.selected).length;
  const selectAll = document.querySelector("#import-select-all");
  selectAll.disabled = selectableRows.length === 0;
  selectAll.checked = selectableRows.length > 0 && selectedSelectableCount === selectableRows.length;
  selectAll.indeterminate = selectedSelectableCount > 0 && selectedSelectableCount < selectableRows.length;
  const button = document.querySelector("#import-commit");
  button.disabled = validCount === 0;
  const duplicateCount = selectedRows.filter((row) => row.duplicate).length;
  const duplicateTotal = importRows.filter((row) => row.duplicate).length;
  const duplicateChoice = document.querySelector("#import-duplicate-choice");
  if (duplicateChoice) duplicateChoice.hidden = duplicateTotal === 0;
  const replaceRadio = document.querySelector('input[name="import_duplicate_action"][value="replace"]');
  const replaceHint = document.querySelector("#import-duplicate-replace-hint");
  if (replaceRadio && replaceHint) {
    replaceRadio.disabled = duplicateCount === 0;
    replaceHint.textContent = duplicateCount
      ? "Data lama ditimpa dengan data dari file."
      : "Centang dulu baris duplikat yang ingin ditimpa.";
  }
  const duplicateNote = duplicateTotal
    ? `; ${duplicateTotal} suspected duplikat (${duplicateCount} dicentang)`
    : "";
  const problemCounts = new Map();
  for (const row of selectedRows) {
    for (const problem of importRowProblems(row)) {
      problemCounts.set(problem, (problemCounts.get(problem) || 0) + 1);
    }
  }
  const problemNote = problemCounts.size
    ? `; ${[...problemCounts.entries()].map(([problem, count]) => `${problem} (${count} baris)`).join(", ")}`
    : "";
  document.querySelector("#import-summary").textContent = importRows.length
    ? `${importRows.length} baris ditemukan. ${selectedRows.length} akan disalin${duplicateNote}${problemNote ? `. Catatan: ${problemNote}` : "."}`
    : "";
  const detail = document.querySelector("#import-problem-detail");
  if (detail) {
    const list = detail.querySelector("ul");
    list.replaceChildren();
    for (const [problem, count] of problemCounts) {
      const item = document.createElement("li");
      item.textContent = `${count} baris: ${problem}`;
      list.append(item);
    }
    detail.hidden = !problemCounts.size;
  }
}

document.querySelector("#import-preview-previous")?.addEventListener("click", () => {
  importPreviewPage = Math.max(0, importPreviewPage - 1);
  renderImportRows();
});
document.querySelector("#import-preview-next")?.addEventListener("click", () => {
  const pageCount = Math.max(1, Math.ceil(importRows.length / IMPORT_PREVIEW_PAGE_SIZE));
  importPreviewPage = Math.min(pageCount - 1, importPreviewPage + 1);
  renderImportRows();
});

const IMPORT_PREVIEW_PAGE_SIZE = 10;
let importPreviewPage = 0;

function renderImportPageNumbers() {
  const container = document.querySelector("#import-preview-page-numbers");
  if (!container) return;
  container.replaceChildren();
  const pageCount = Math.max(1, Math.ceil(importRows.length / IMPORT_PREVIEW_PAGE_SIZE));
  importPreviewPage = Math.min(importPreviewPage, pageCount - 1);
  let start = 0;
  if (pageCount > 7) start = Math.min(Math.max(importPreviewPage - 3, 0), pageCount - 7);
  const end = Math.min(start + 7, pageCount);
  for (let page = start; page < end; page += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-page-number";
    button.textContent = String(page + 1);
    button.setAttribute("aria-label", `Buka halaman ${page + 1}`);
    button.setAttribute("aria-current", String(page === importPreviewPage));
    button.addEventListener("click", () => {
      importPreviewPage = page;
      renderImportRows();
      document.querySelector("#import-preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    container.append(button);
  }
}

function renderImportRows() {
  const list = document.querySelector("#import-preview-list");
  list.replaceChildren();
  const pageCount = Math.max(1, Math.ceil(importRows.length / IMPORT_PREVIEW_PAGE_SIZE));
  importPreviewPage = Math.min(importPreviewPage, pageCount - 1);
  const pageStart = importPreviewPage * IMPORT_PREVIEW_PAGE_SIZE;
  const pageRows = importRows.slice(pageStart, pageStart + IMPORT_PREVIEW_PAGE_SIZE);
  pageRows.forEach((row, offset) => {
    const index = pageStart + offset;
    const card = document.createElement("article");
    card.className = "import-row";
    card.dataset.rowIndex = String(index);
    const heading = document.createElement("div");
    heading.className = "import-row-heading";
    const selectLabel = document.createElement("label");
    selectLabel.className = "import-row-select";
    const select = document.createElement("input");
    select.type = "checkbox";
    if (typeof row.selected !== "boolean") row.selected = importRowIsValid(row);
    select.checked = row.selected;
    select.addEventListener("change", () => {
      row.selected = select.checked;
      updateImportSummary();
    });
    selectLabel.append(select, document.createTextNode(`Baris ${index + 1}`));
    const title = document.createElement("strong");
    title.textContent = row.full_name || "Nama belum terbaca";
    if (row.source_file) title.title = `Sumber: ${row.source_file}`;
    const problems = importRowProblems(row);
    const status = document.createElement("span");
    status.className = !importRowIsValid(row)
      ? "import-status invalid"
      : problems.length
        ? "import-status review"
        : row.duplicate
          ? "import-status duplicate"
          : row.ocr_confidence < 0.7 ? "import-status review" : "import-status";
    status.textContent = !importRowIsValid(row)
      ? "Tidak bisa disimpan: nama kosong"
      : problems.length
        ? `Perlu diperiksa: ${problems.join("; ")}`
        : row.duplicate ? "Duplikat (boleh di-replace)" : row.ocr_confidence < 0.7 ? "Periksa OCR" : "Pratinjau";
    if (problems.length) status.title = problems.join("; ");
    heading.append(selectLabel, title, status);
    if (row.source_file) {
      const source = document.createElement("small");
      source.className = "import-row-source";
      source.textContent = row.source_file;
      heading.append(source);
    }
    const fields = document.createElement("div");
    fields.className = "import-fields";
    for (const [field, labelText, type] of currentImportFields()) {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = type === "gender" ? document.createElement("select") : document.createElement("input");
      if (type === "gender") {
        input.add(new Option("Pilih Jenis Kelamin", ""));
        input.add(new Option("P — Perempuan", "P"));
        input.add(new Option("L — Laki-laki", "L"));
      } else {
        input.type = type;
      }
      input.dataset.importField = field;
      input.value = row[field] ?? "";
      if (type === "number") {
        input.min = "1";
        input.max = String(field === "rt" ? settings.rt_count : field === "rw" ? settings.rw_count : 1_000_000_000_000);
        input.step = "1";
      }
      input.addEventListener("input", () => {
        row[field] = input.value;
        if (field === "full_name") title.textContent = input.value || "Nama belum terbaca";
        updateImportSummary();
      });
      label.append(input);
      fields.append(label);
    }
    card.append(heading, fields);
    list.append(card);
  });
  const pagination = document.querySelector("#import-preview-pagination");
  if (pagination) pagination.hidden = pageCount <= 1;
  const previous = document.querySelector("#import-preview-previous");
  const next = document.querySelector("#import-preview-next");
  if (previous) previous.disabled = importPreviewPage === 0;
  if (next) next.disabled = importPreviewPage >= pageCount - 1;
  const status = document.querySelector("#import-preview-page-status");
  if (status) {
    status.textContent = pageCount > 1
      ? `Halaman ${importPreviewPage + 1} dari ${pageCount} · baris ${pageStart + 1}–${pageStart + pageRows.length} dari ${importRows.length}`
      : "";
  }
  renderImportPageNumbers();
  updateImportSummary();
}

// BERANDA: label tanggal, wilayah, dan tautan lokasi.
function formatDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = /\d{4}-\d{2}-\d{2}/.test(raw) ? `${raw.slice(0, 10)}T00:00:00` : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatAuditTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatWords(value) {
  const text = String(value || "").trim().toLocaleLowerCase("id-ID");
  return text.replace(/(^|\s|[-/(])([a-zà-ÿ])/g, (match, boundary, letter) => `${boundary}${letter.toLocaleUpperCase("id-ID")}`);
}

function formatGenderLabel(value) {
  const text = String(value || "").trim().toUpperCase();
  if (text === "P" || text === "PEREMPUAN" || text === "WANITA") return "Perempuan";
  if (text === "L" || text.startsWith("LAKI") || text === "PRIA") return "Laki-Laki";
  return formatWords(value);
}

function formatAreaLabel(value) {
  const match = String(value || "").match(/RT\s*0*(\d+).*?RW\s*0*(\d+)/i);
  return match ? `RT ${match[1].padStart(3, "0")} / RW ${match[2].padStart(3, "0")}` : value;
}

function rtRwSearchVariants(value) {
  const match = String(value || "").match(/RT\s*0*(\d+).*?RW\s*0*(\d+)/i);
  if (!match) return [];
  const rt = match[1];
  const rw = match[2];
  return [
    `rt ${rt}`, `rt ${rt.padStart(3, "0")}`, `rt${rt}`, `rt${rt.padStart(3, "0")}`,
    `rw ${rw}`, `rw ${rw.padStart(3, "0")}`, `rw${rw}`, `rw${rw.padStart(3, "0")}`,
  ];
}

function residentRtRwVariants(rt, rw) {
  const parts = [];
  if (rt !== null && rt !== undefined && String(rt).trim() !== "") {
    const raw = String(rt).trim();
    const num = raw.replace(/^0+/, "") || "0";
    parts.push(`rt ${raw}`, `rt ${num}`, `rt ${num.padStart(3, "0")}`, `rt${raw}`, `rt${num}`, `rt${num.padStart(3, "0")}`);
  }
  if (rw !== null && rw !== undefined && String(rw).trim() !== "") {
    const raw = String(rw).trim();
    const num = raw.replace(/^0+/, "") || "0";
    parts.push(`rw ${raw}`, `rw ${num}`, `rw ${num.padStart(3, "0")}`, `rw${raw}`, `rw${num}`, `rw${num.padStart(3, "0")}`);
  }
  return parts;
}

function mapLink(label, address, service) {
  const url = service === "apple"
    ? `https://maps.apple.com/?q=${encodeURIComponent(address)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const link = document.createElement("a");
  link.className = "map-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  link.append(document.createTextNode(label));
  return link;
}

function visibleRecords() {
  const query = searchInput.value.trim().toLocaleLowerCase("id-ID");
  const filtered = records.filter((record) => `${record.full_name} ${record.area} ${rtRwSearchVariants(record.area).join(" ")}`.toLocaleLowerCase("id-ID").includes(query)
    && (!selectedGenderFilter || record.gender === selectedGenderFilter));
  const sortKey = tableSortKey || (sortSelect.value === "name" ? "name" : "date");
  const direction = tableSortKey ? tableSortDirection : sortSelect.value === "oldest" ? "asc" : "desc";
  const valueFor = (record) => {
    if (sortKey === "name") return record.full_name || "";
    if (sortKey === "rt") return String(record.area || "").match(/RT\s*0*(\d+)/i)?.[1] || "0";
    if (sortKey === "rw") return String(record.area || "").match(/RW\s*0*(\d+)/i)?.[1] || "0";
    if (sortKey === "gender") return record.gender || "";
    if (sortKey === "address") return record.address || "";
    return record.date_of_death || "";
  };
  return filtered.sort((left, right) => {
    const comparison = sortKey === "name" || sortKey === "address" || sortKey === "gender"
      ? valueFor(left).localeCompare(valueFor(right), "id")
      : Number(valueFor(left)) - Number(valueFor(right)) || valueFor(left).localeCompare(valueFor(right), "id");
    return direction === "asc" ? comparison : -comparison;
  });
}

function openRecordDetail(record, index) {
  const dialogContent = document.querySelector("#record-detail-content");
  dialogContent.replaceChildren();
  let portrait;
  if (record.portrait_url) {
    portrait = document.createElement("img");
    portrait.className = "record-detail-portrait";
    portrait.src = record.portrait_url;
    portrait.alt = `Foto ${record.full_name}`;
  }
  const title = document.createElement("h2");
  title.id = "record-detail-name";
  title.textContent = record.full_name || "Nama belum dilengkapi";
  const metadata = document.createElement("div");
  metadata.className = "record-detail-meta";
  const details = [formatAreaLabel(record.area)];
  if (record.gender === "L") details.push("Laki-Laki");
  if (record.gender === "P") details.push("Perempuan");
  if (record.date_of_death) details.push(formatDate(record.date_of_death));
  metadata.textContent = details.join(" · ");
  dialogContent.append(title, metadata);
  if (portrait) dialogContent.append(portrait);
  if (record.address) {
    const address = document.createElement("p");
    address.className = "record-detail-address";
    address.textContent = record.address;
    const mapLinks = document.createElement("div");
    mapLinks.className = "record-detail-map-links";
    mapLinks.append(mapLink("Google Maps", record.address, "google"), mapLink("Apple Maps", record.address, "apple"));
    dialogContent.append(address, mapLinks);
  }
  document.querySelector("#record-detail-dialog").showModal();
}

function render() {
  if (!listElement || !countElement || !emptyState || !searchInput || !sortSelect) return;
  const initialRender = !hasRenderedRecords;
  hasRenderedRecords = true;
  document.querySelector("#total-data strong").textContent = records.length;
  document.querySelector("#total-l strong").textContent = records.filter((record) => record.gender === "L").length;
  document.querySelector("#total-p strong").textContent = records.filter((record) => record.gender === "P").length;
  document.querySelector("#total-data").setAttribute("aria-pressed", String(!selectedGenderFilter));
  document.querySelector("#total-l").setAttribute("aria-pressed", String(selectedGenderFilter === "L"));
  document.querySelector("#total-p").setAttribute("aria-pressed", String(selectedGenderFilter === "P"));
  const visible = visibleRecords();
  const pageCount = Math.max(1, Math.ceil(visible.length / RECORDS_PAGE_SIZE));
  recordsPage = Math.min(recordsPage, pageCount - 1);
  const pageStart = recordsPage * RECORDS_PAGE_SIZE;
  const pageRecords = visible.slice(pageStart, pageStart + RECORDS_PAGE_SIZE);
  listElement.replaceChildren();
  countElement.textContent = new Intl.NumberFormat("id-ID").format(visible.length);
  emptyState.hidden = visible.length > 0;
  document.querySelector("#empty-title").textContent = records.length ? "Tidak Ada Hasil" : "Belum Ada Data";
  document.querySelector("#empty-copy").textContent = records.length
  ? "Coba kata kunci atau jenis kelamin lainnya."
  : "Entri yang telah diverifikasi akan ditampilkan di sini.";

  pageRecords.forEach((record, index) => {
    const row = document.createElement("tr");
    if (initialRender) row.classList.add("initial-render");
    const number = document.createElement("td");
    number.textContent = String(pageStart + index + 1).padStart(2, "0");
    const name = document.createElement("button");
    name.className = "record-detail-trigger";
    name.type = "button";
    name.textContent = record.full_name || "Nama belum dilengkapi";
    name.setAttribute("aria-haspopup", "dialog");
    name.setAttribute("aria-label", `Buka detail ${record.full_name || "warga tanpa nama"}`);
    name.addEventListener("click", () => openRecordDetail(record, pageStart + index));
    const nameCell = document.createElement("td");
    nameCell.append(name);
    const areaMatch = String(record.area || "").match(/RT\s*0*(\d+).*?RW\s*0*(\d+)/i);
    const rtCell = document.createElement("td");
    rtCell.textContent = areaMatch ? areaMatch[1].padStart(3, "0") : "-";
    const rwCell = document.createElement("td");
    rwCell.textContent = areaMatch ? areaMatch[2].padStart(3, "0") : "-";
    const genderCell = document.createElement("td");
    genderCell.textContent = record.gender === "L" ? "Laki-Laki" : record.gender === "P" ? "Perempuan" : "-";
    const dateCell = document.createElement("td");
    dateCell.textContent = record.date_of_death ? formatDate(record.date_of_death) : "Belum dilengkapi";
    const addressCell = document.createElement("td");
    addressCell.textContent = record.address ? "Tersedia" : "Privat";
    row.append(number, nameCell, rtCell, rwCell, genderCell, dateCell, addressCell);
    listElement.append(row);
  });
  const pageNumbers = document.querySelector("#records-page-numbers");
  pageNumbers.replaceChildren();
  const pageIndexes = [];
  if (pageCount <= 7) {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) pageIndexes.push(pageIndex);
  } else {
    pageIndexes.push(0, 1, 2, 3, 4);
    if (recordsPage > 5 && recordsPage < pageCount - 6) pageIndexes.push(recordsPage - 1, recordsPage, recordsPage + 1);
    pageIndexes.push(pageCount - 3, pageCount - 2, pageCount - 1);
  }
  let previousPageIndex = -1;
  for (const pageIndex of [...new Set(pageIndexes)].sort((left, right) => left - right)) {
    if (pageIndex - previousPageIndex > 1) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "record-page-ellipsis";
      ellipsis.textContent = "...";
      ellipsis.setAttribute("aria-hidden", "true");
      pageNumbers.append(ellipsis);
    }
    const pageButton = document.createElement("button");
    pageButton.className = "record-page-number";
    pageButton.type = "button";
    pageButton.role = "listitem";
    pageButton.textContent = String(pageIndex + 1);
    pageButton.setAttribute("aria-label", `Buka halaman ${pageIndex + 1}`);
    pageButton.setAttribute("aria-current", String(pageIndex === recordsPage));
    pageButton.addEventListener("click", () => {
      recordsPage = pageIndex;
      render();
    });
    pageNumbers.append(pageButton);
    previousPageIndex = pageIndex;
  }
  document.querySelector("#records-previous").disabled = recordsPage === 0;
  document.querySelector("#records-next").disabled = recordsPage >= pageCount - 1;
}

function formatNewsDate(value) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

let newsArticles = [];
let newsArticlesSignature = null;
let hasRenderedNews = false;
let initialNewsRevealPending = false;
let newsArchivePage = 0;
const NEWS_ARCHIVE_PAGE_SIZE = 2;
let homeNotificationsInitialized = false;
let seenHomeNotificationIds = new Set();

function getHomeNotificationItems() {
  return [
    ...records.map((record) => ({
      id: `record:${record.id}`,
      type: "record",
      title: record.full_name || "Warga tanpa nama",
      date: record.date_of_death ? formatDate(record.date_of_death) : "Tanggal wafat belum dilengkapi",
      timestamp: Date.parse(record.date_of_death || "") || 0,
      record,
    })),
    ...newsArticles.map((article) => ({
      id: `news:${article.id}`,
      type: "news",
      title: article.title,
      date: formatNewsDate(article.uploaded_at),
      timestamp: Date.parse(article.uploaded_at) || 0,
      article,
    })),
  ].sort((left, right) => right.timestamp - left.timestamp);
}

function saveSeenHomeNotifications() {
  localStorage.setItem(HOME_NOTIFICATIONS_STORAGE_KEY, JSON.stringify([...seenHomeNotificationIds]));
}

function renderHomeNotifications() {
  if (isAdminPage) return;
  const items = getHomeNotificationItems();
  if (!homeNotificationsInitialized) {
    try {
      const saved = localStorage.getItem(HOME_NOTIFICATIONS_STORAGE_KEY);
      seenHomeNotificationIds = new Set(saved ? JSON.parse(saved) : items.map((item) => item.id));
    } catch {
      seenHomeNotificationIds = new Set(items.map((item) => item.id));
    }
    homeNotificationsInitialized = true;
    saveSeenHomeNotifications();
  }
  const unreadCount = items.filter((item) => !seenHomeNotificationIds.has(item.id)).length;
  const badge = document.querySelector("#notifications-badge");
  const toggle = document.querySelector("#notifications-toggle");
  const list = document.querySelector("#notifications-list");
  badge.hidden = unreadCount === 0;
  badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  toggle.setAttribute("aria-label", unreadCount ? `Notifikasi, ${unreadCount} belum dibaca` : "Notifikasi");
  document.querySelector("#notifications-mark-read").disabled = unreadCount === 0;
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "notifications-empty";
    empty.textContent = "Belum ada berita atau data warga terbaru.";
    list.append(empty);
    return;
  }
  for (const item of items.slice(0, 10)) {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    button.className = `notification-item${seenHomeNotificationIds.has(item.id) ? "" : " is-unread"}`;
    button.type = "button";
    button.dataset.notificationId = item.id;
    const marker = document.createElement("span");
    marker.className = `notification-marker ${item.type}`;
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "notification-copy";
    const type = document.createElement("strong");
    type.textContent = item.type === "record" ? "Warga Wafat" : "Berita Terbaru";
    const title = document.createElement("span");
    title.textContent = item.title;
    const date = document.createElement("small");
    date.textContent = item.date;
    copy.append(type, title, date);
    button.append(marker, copy);
    button.addEventListener("click", () => {
      seenHomeNotificationIds.add(item.id);
      saveSeenHomeNotifications();
      renderHomeNotifications();
      document.querySelector("#notifications-panel").hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (item.type === "record") openRecordDetail(item.record, records.indexOf(item.record));
      else openNewsArticle(item.article);
    });
    entry.append(button);
    list.append(entry);
  }
}

function markHomeNotificationsRead() {
  getHomeNotificationItems().forEach((item) => seenHomeNotificationIds.add(item.id));
  saveSeenHomeNotifications();
  renderHomeNotifications();
}

const notificationsControl = document.querySelector(".notifications-control");
const notificationsToggle = document.querySelector("#notifications-toggle");
const notificationsPanel = document.querySelector("#notifications-panel");
const themeControl = document.querySelector(".theme-control");
const themeToggle = document.querySelector("#theme-toggle");
const themeMenu = document.querySelector("#theme-menu");
const mobileNavToggle = document.querySelector("#mobile-nav-toggle");
const mobileNavMenu = document.querySelector("#mobile-nav-menu");

function setMobileNavigationOpen(open) {
  mobileNavMenu.hidden = !open;
  mobileNavToggle.setAttribute("aria-expanded", String(open));
  mobileNavToggle.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
  mobileNavToggle.title = open ? "Tutup menu" : "Buka menu";
}

mobileNavToggle.addEventListener("click", () => {
  const opening = mobileNavMenu.hidden;
  if (opening) {
    closeHeaderPopover(notificationsPanel, notificationsToggle);
    closeHeaderPopover(themeMenu, themeToggle);
  }
  setMobileNavigationOpen(opening);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || mobileNavMenu.hidden) return;
  event.preventDefault();
  setMobileNavigationOpen(false);
});
document.addEventListener("click", (event) => {
  if (mobileNavMenu.hidden || event.target.closest(".topbar")) return;
  setMobileNavigationOpen(false);
});
window.matchMedia("(max-width: 650px)").addEventListener("change", (event) => {
  if (!event.matches) setMobileNavigationOpen(false);
});
mobileNavMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setMobileNavigationOpen(false));
});

function positionHeaderPopover(panel, anchor) {
  if (!window.matchMedia("(max-width: 650px)").matches) {
    panel.style.removeProperty("position");
    panel.style.removeProperty("top");
    panel.style.removeProperty("right");
    panel.style.removeProperty("left");
    return;
  }
  const anchorRect = anchor.getBoundingClientRect();
  const headerRect = document.querySelector(".topbar").getBoundingClientRect();
  panel.style.position = "fixed";
  panel.style.top = `${Math.ceil(Math.max(anchorRect.bottom, headerRect.bottom) + 8)}px`;
  panel.style.right = "16px";
  panel.style.left = "auto";
}

function closeHeaderPopover(panel, toggle) {
  panel.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  for (const property of ["position", "top", "right", "left"]) panel.style.removeProperty(property);
}

notificationsToggle.addEventListener("click", () => {
  const opening = notificationsPanel.hidden;
  notificationsPanel.hidden = !opening;
  notificationsToggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    positionHeaderPopover(notificationsPanel, notificationsToggle);
    markHomeNotificationsRead();
  } else {
    closeHeaderPopover(notificationsPanel, notificationsToggle);
  }
});
document.querySelector("#notifications-mark-read").addEventListener("click", markHomeNotificationsRead);
document.addEventListener("click", (event) => {
  if (notificationsPanel.hidden || notificationsControl.contains(event.target)) return;
  closeHeaderPopover(notificationsPanel, notificationsToggle);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || notificationsPanel.hidden) return;
  closeHeaderPopover(notificationsPanel, notificationsToggle);
  notificationsToggle.focus();
});

themeToggle.addEventListener("click", () => {
  const opening = themeMenu.hidden;
  themeMenu.hidden = !opening;
  themeToggle.setAttribute("aria-expanded", String(opening));
  if (opening) positionHeaderPopover(themeMenu, themeToggle);
  else closeHeaderPopover(themeMenu, themeToggle);
});
document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    const theme = button.dataset.themeChoice;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
    closeHeaderPopover(themeMenu, themeToggle);
    themeToggle.focus();
  });
});
document.addEventListener("click", (event) => {
  if (themeMenu.hidden || themeControl.contains(event.target)) return;
  closeHeaderPopover(themeMenu, themeToggle);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || themeMenu.hidden) return;
  closeHeaderPopover(themeMenu, themeToggle);
  themeToggle.focus();
});
window.addEventListener("resize", () => {
  if (!notificationsPanel.hidden) positionHeaderPopover(notificationsPanel, notificationsToggle);
  if (!themeMenu.hidden) positionHeaderPopover(themeMenu, themeToggle);
});

function newsArticleSlug(article) {
  return article.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function newsArticleFromLocation() {
  const articlePath = /^\/berita\/([^/]+)\/?$/.exec(window.location.pathname);
  if (articlePath) {
    const slug = decodeURIComponent(articlePath[1]).toLowerCase();
    return newsArticles.find((article) => newsArticleSlug(article) === slug);
  }
  const fragment = decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
  const legacyId = /^berita-(\d+)$/.exec(fragment);
  if (legacyId) return newsArticles.find((article) => Number(article.id) === Number(legacyId[1]));
  return newsArticles.find((article) => newsArticleSlug(article) === fragment);
}

function openNewsArticle(article, updateLocation = true) {
  if (!article) return;
  const detailDialog = document.querySelector("#news-detail-dialog");
  if (updateLocation) {
    window.history.pushState({}, "", `/berita/${newsArticleSlug(article)}`);
  }
  if (detailDialog.open && detailDialog.dataset.articleId === String(article.id)) return;
  detailDialog.dataset.articleId = String(article.id);
  const content = document.querySelector("#news-detail-content");
  content.replaceChildren();
  if (article.image_url) {
    const image = document.createElement("img");
    image.src = article.image_url;
    image.alt = article.title;
    const applyImageEdgeColor = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 40;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, 40, 40);
        const pixels = context.getImageData(0, 0, 40, 40).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let y = 0; y < 40; y += 1) {
          for (let x = 0; x < 40; x += 1) {
            if (x > 2 && x < 37 && y > 2 && y < 37) continue;
            const offset = (y * 40 + x) * 4;
            red += pixels[offset];
            green += pixels[offset + 1];
            blue += pixels[offset + 2];
            count += 1;
          }
        }
        image.style.backgroundColor = `rgb(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)})`;
      } catch {
        image.style.backgroundColor = "var(--green-soft)";
      }
    };
    image.addEventListener("load", applyImageEdgeColor, { once: true });
    content.append(image);
    if (image.complete) applyImageEdgeColor();
  }
  const title = document.createElement("h2");
  title.id = "news-detail-title";
  title.tabIndex = -1;
  title.textContent = article.title;
  const headline = document.createElement("p");
  headline.className = "news-detail-headline";
  headline.textContent = article.headline;
  const metadata = document.createElement("div");
  metadata.className = "news-detail-meta";
  metadata.textContent = `${article.author} · ${formatNewsDate(article.uploaded_at)}`;
  const body = document.createElement("p");
  body.className = "news-detail-body";
  body.textContent = article.body;
  content.append(title, headline, metadata, body);
  const shareActions = document.querySelector("#news-share-actions");
  shareActions.hidden = false;
  shareActions.dataset.title = article.title;
  shareActions.dataset.url = `${window.location.origin}/berita/${newsArticleSlug(article)}`;
  if (!detailDialog.open) detailDialog.showModal();
  window.requestAnimationFrame(() => title.focus({ preventScroll: false }));
}

function syncNewsArticleWithLocation() {
  const detailDialog = document.querySelector("#news-detail-dialog");
  const article = newsArticleFromLocation();
  const articleRoute = /^\/berita\/[^/]+\/?$/.test(window.location.pathname);
  const legacyArticleHash = /^#berita-\d+$/i.test(window.location.hash) || Boolean(window.location.hash && article);
  if (!articleRoute && !legacyArticleHash) {
    if (detailDialog.open) detailDialog.close();
    return;
  }
  if (article) openNewsArticle(article, false);
}

function renderDonationDialog() {
  document.querySelector("#donation-title").textContent = donationSettings.donation_title || "Dana Apresiasi";
  document.querySelector("#donation-description").textContent = donationSettings.donation_description || "Dukungan sukarela warga untuk membantu pengelolaan website Data Kifayah.";
  document.querySelector("#donation-recipient").textContent = donationSettings.donation_recipient ? `Penerima: ${donationSettings.donation_recipient}` : "";
  const methods = document.querySelector("#donation-methods");
  methods.replaceChildren();
  const entries = [
    ["Dana", donationSettings.donation_dana, donationSettings.donation_dana_link],
    ["OVO", donationSettings.donation_ovo, donationSettings.donation_ovo_link],
    [donationSettings.donation_bank_name || "Bank", donationSettings.donation_bank_account ? `${donationSettings.donation_bank_account}${donationSettings.donation_bank_holder ? ` · ${donationSettings.donation_bank_holder}` : ""}` : "", donationSettings.donation_bank_link],
  ].filter(([, value]) => value);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "Informasi pembayaran belum diatur oleh pengelola.";
    methods.append(empty);
    return;
  }
  entries.forEach(([label, value, link]) => {
    const item = document.createElement("div");
    item.className = "donation-method";
    const name = document.createElement("strong");
    name.textContent = label;
    const detail = link ? document.createElement("a") : document.createElement("span");
    detail.textContent = value;
    if (link) {
      detail.href = link;
      detail.target = "_blank";
      detail.rel = "noopener noreferrer";
    }
    item.append(name, detail);
    methods.append(item);
  });
}

function createNewsCard(article, featured = false) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = featured ? "news-featured" : "news-article-card";
  card.setAttribute("aria-label", `Baca berita: ${article.title}`);
  if (article.image_url) {
    const image = document.createElement("img");
    image.className = featured ? "news-featured-image" : "news-article-image";
    image.src = article.image_url;
    image.alt = "";
    image.loading = "lazy";
    card.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = featured ? "news-featured-placeholder" : "news-article-placeholder";
    placeholder.textContent = "Kifayah";
    card.append(placeholder);
  }
  const copy = document.createElement("span");
  copy.className = featured ? "news-featured-copy" : "news-article-copy";
  const date = document.createElement("time");
  date.dateTime = article.uploaded_at;
  date.textContent = formatNewsDate(article.uploaded_at);
  const title = document.createElement("span");
  title.className = featured ? "news-featured-title" : "news-article-title";
  title.id = newsArticleSlug(article);
  title.textContent = article.title;
  const headline = document.createElement("span");
  headline.className = featured ? "news-featured-headline" : "news-article-headline";
  headline.textContent = article.headline;
  const author = document.createElement("span");
  author.className = featured ? "news-byline" : "news-article-author";
  author.textContent = article.author;
  copy.append(date, title, headline, author);
  card.append(copy);
  card.addEventListener("click", () => openNewsArticle(article));
  return card;
}

function renderNewsArchive() {
  const list = document.querySelector("#news-list");
  const archive = newsArticles.slice(1);
  const pageCount = Math.ceil(archive.length / NEWS_ARCHIVE_PAGE_SIZE);
  newsArchivePage = Math.min(newsArchivePage, Math.max(0, pageCount - 1));
  const start = newsArchivePage * NEWS_ARCHIVE_PAGE_SIZE;
  const cards = archive.slice(start, start + NEWS_ARCHIVE_PAGE_SIZE).map((article) => {
    const card = createNewsCard(article);
    if (initialNewsRevealPending) card.classList.add("initial-render");
    return card;
  });
  list.replaceChildren(...cards);
  const archiveSection = document.querySelector("#news-archive");
  archiveSection.hidden = archive.length === 0;
  document.querySelector("#news-page-status").textContent = pageCount ? `${newsArchivePage + 1} / ${pageCount}` : "";
  document.querySelector("#news-previous").disabled = newsArchivePage === 0;
  document.querySelector("#news-next").disabled = newsArchivePage >= pageCount - 1;
}

function renderNews(articles) {
  const signature = JSON.stringify(articles);
  const section = document.querySelector("#news-section");
  if (signature === newsArticlesSignature && (!articles.length || !section.hidden)) return false;
  const initialRender = !hasRenderedNews;
  hasRenderedNews = true;
  newsArticlesSignature = signature;
  newsArticles = articles;
  const newsNavigationLinks = document.querySelectorAll('[data-section-link="news-section"]');
  const featured = document.querySelector("#news-featured");
  featured.replaceChildren();
  section.hidden = articles.length === 0;
  newsNavigationLinks.forEach((link) => { link.hidden = articles.length === 0; });
  if (articles.length) featured.append(createNewsCard(articles[0], true));
  initialNewsRevealPending = initialRender;
  renderNewsArchive();
  initialNewsRevealPending = false;
  renderHomeNotifications();
  syncNewsArticleWithLocation();
  return true;
}

async function loadNews() {
  try {
    const payload = await request("/api/news");
    const changed = renderNews(payload.articles);
    restorePublicRoute();
    return changed;
  } catch {
    document.querySelector("#news-section").hidden = true;
    document.querySelectorAll('[data-section-link="news-section"]').forEach((link) => { link.hidden = true; });
    restorePublicRoute();
    return false;
  }
}

/* KONTAK RT/RW: nomor pengurus wilayah dari panel admin. */
let areaContacts = [];
let areaContactsSignature = "";
// Modul pendaftaran memakai ini untuk mengisi nama Ketua RT, LMK, dan
// Ketua RW secara otomatis dari data kontak yang sudah ada.
window.kifayahAreaContacts = areaContacts;

function contactUnitLabel(contact) {
  return `${contact.unit_type} ${String(contact.unit_number).padStart(3, "0")}`;
}

function whatsappContactUrl(phone) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  const normalized = digits.startsWith("62") ? digits : `62${digits.replace(/^0+/, "")}`;
  return `https://wa.me/${normalized}`;
}

function renderAreaContacts(contacts) {
  const signature = JSON.stringify(contacts);
  if (signature === areaContactsSignature) return false;
  areaContactsSignature = signature;
  areaContacts = contacts;
  window.kifayahAreaContacts = contacts;
  const section = document.querySelector("#contacts-section");
  const list = document.querySelector("#contacts-list");
  if (!section || !list) return false;
  const navigationLinks = document.querySelectorAll('[data-section-link="contacts-section"]');
  section.hidden = contacts.length === 0;
  navigationLinks.forEach((link) => { link.hidden = contacts.length === 0; });
  list.replaceChildren();
  // Satu kartu per wilayah. Kartu wilayah baru dibuka saat diklik agar
  // halaman tetap ringkas ketika jumlah wilayah RT/RW banyak.
  const groups = new Map();
  contacts.forEach((contact) => {
    const key = `${contact.unit_type}-${contact.unit_number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(contact);
  });
  groups.forEach((members, key) => {
    const first = members[0];
    const card = document.createElement("article");
    card.className = "contact-card";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "contact-card-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const heading = document.createElement("h3");
    heading.className = "contact-unit";
    heading.textContent = contactUnitLabel(first);
    const summary = document.createElement("span");
    summary.className = "contact-card-summary";
    summary.textContent = `${members.length} pengurus`;
    const chevron = document.createElement("span");
    chevron.className = "contact-card-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    const head = document.createElement("span");
    head.className = "contact-card-head";
    head.append(heading, summary);
    toggle.append(head, chevron);
    const detail = document.createElement("div");
    detail.className = "contact-card-detail";
    detail.id = `contact-detail-${key}`;
    detail.hidden = true;
    // Contacts of the same unit are listed from the highest to the lowest position.
    members.forEach((contact) => {
      const item = document.createElement("div");
      item.className = "contact-row";
      const copy = document.createElement("div");
      copy.className = "contact-row-copy";
      const position = document.createElement("p");
      position.className = "contact-position";
      position.textContent = contact.position_name || "Pengurus";
      const name = document.createElement("p");
      name.className = "contact-name";
      name.textContent = contact.contact_name;
      copy.append(position, name);
      const link = document.createElement("a");
      link.className = "contact-phone";
      link.href = whatsappContactUrl(contact.phone);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = contact.phone;
      item.append(copy, link);
      detail.append(item);
    });
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      detail.hidden = expanded;
    });
    card.append(toggle, detail);
    list.append(card);
  });
  return true;
}

async function loadContacts() {
  try {
    const payload = await request("/api/contacts");
    const changed = renderAreaContacts(payload.contacts || []);
    restorePublicRoute();
    return changed;
  } catch {
    document.querySelector("#contacts-section").hidden = true;
    document.querySelectorAll('[data-section-link="contacts-section"]').forEach((link) => { link.hidden = true; });
    restorePublicRoute();
    return false;
  }
}

/* SCROLL-SPY: menentukan section yang sedang dibaca lalu menyelaraskan
   tautan navigasi dan URL. Section aktif dibaca dari posisi semua section
   saat ini, bukan dari entries satu callback IntersectionObserver, karena
   entries hanya berisi section yang kebetulan melewati ambang. */
if (!isAdminPage) {
  const sectionLinks = [...document.querySelectorAll("[data-section-link]")];
  const watchedSections = sectionLinks
    .map((link) => ({ link, section: document.getElementById(link.dataset.sectionLink) }))
    .filter((item) => item.section);
  let spyFrame = 0;
  let spyActiveId = "";

  const setActivePublicSection = (activeId) => {
    if (!activeId || activeId === spyActiveId) return;
    spyActiveId = activeId;
    sectionLinks.forEach((link) => {
      if (link.hidden) return;
      if (link.dataset.sectionLink === activeId) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    if (!hasRestoredPublicRoute) return;
    if (pendingPublicSection) {
      if (activeId === pendingPublicSection) {
        pendingPublicSection = "";
        window.clearTimeout(pendingPublicSectionTimer);
      }
      return;
    }
    updatePublicSectionPath(activeId);
  };

  /* Garis pemantau berada 40% tinggi viewport. Section aktif adalah
     section terakhir yang bagian atasnya sudah melewati garis itu dan
     yang masih membentang hingga bawah garis. Section yang sudah
     sepenuhnya terlewat tidak ikut dipilih. */
  const activePublicSectionId = () => {
    const probeLine = window.innerHeight * 0.4;
    let crossedId = "";
    let spanningId = "";
    for (const { link, section } of watchedSections) {
      if (section.hidden || link.hidden) continue;
      const rect = section.getBoundingClientRect();
      if (rect.top <= probeLine) crossedId = section.id;
      if (rect.top <= probeLine && rect.bottom > probeLine) spanningId = section.id;
    }
    return spanningId || crossedId || watchedSections[0]?.section.id || "";
  };

  const refreshPublicSectionSpy = () => {
    spyFrame = 0;
    setActivePublicSection(activePublicSectionId());
  };

  const schedulePublicSectionSpy = () => {
    if (spyFrame) return;
    spyFrame = window.requestAnimationFrame(refreshPublicSectionSpy);
  };

  if (watchedSections.length) {
    refreshPublicSectionSpy();
    window.addEventListener("scroll", schedulePublicSectionSpy, { passive: true });
    window.addEventListener("resize", schedulePublicSectionSpy, { passive: true });
    window.addEventListener("load", schedulePublicSectionSpy, { once: true });
  }
}

document.querySelectorAll("[data-section-link]").forEach((link) => {
  link.addEventListener("click", (event) => {
    const sectionId = link.dataset.sectionLink;
    const section = document.getElementById(sectionId);
    if (!section || section.hidden) return;
    event.preventDefault();
    pendingPublicSection = sectionId;
    window.clearTimeout(pendingPublicSectionTimer);
    pendingPublicSectionTimer = window.setTimeout(() => { pendingPublicSection = ""; }, 1600);
    updatePublicSectionPath(sectionId, "pushState");
    const detailDialog = document.querySelector("#news-detail-dialog");
    if (detailDialog.open) detailDialog.close();
    section.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    const mobileMenu = document.querySelector("#mobile-nav-menu");
    const mobileToggle = document.querySelector("#mobile-nav-toggle");
    if (mobileMenu && !mobileMenu.hidden) {
      mobileMenu.hidden = true;
      mobileToggle?.setAttribute("aria-expanded", "false");
    }
  });
});

function restoreSectionFromCurrentPath() {
  if (isAdminPage || /^\/berita\/[^/]+\/?$/.test(window.location.pathname)) return;
  const pathToSection = Object.fromEntries(Object.entries(publicSectionPaths).map(([id, path]) => [path, id]));
  const sectionId = pathToSection[window.location.pathname];
  const section = sectionId && document.getElementById(sectionId);
  if (section && !section.hidden) {
    section.scrollIntoView({ behavior: "auto", block: "start" });
  }
}

window.addEventListener("popstate", () => {
  syncNewsArticleWithLocation();
  restoreSectionFromCurrentPath();
});

document.querySelector("#news-previous")?.addEventListener("click", () => {
  newsArchivePage = Math.max(0, newsArchivePage - 1);
  renderNewsArchive();
});
document.querySelector("#news-next")?.addEventListener("click", () => {
  const pageCount = Math.ceil(Math.max(0, newsArticles.length - 1) / NEWS_ARCHIVE_PAGE_SIZE);
  newsArchivePage = Math.min(pageCount - 1, newsArchivePage + 1);
  renderNewsArchive();
});
document.querySelector("#news-detail-close")?.addEventListener("click", () => {
  document.querySelector("#news-detail-dialog").close();
});
document.querySelector("#news-detail-dialog")?.addEventListener("close", () => {
  const detailDialog = document.querySelector("#news-detail-dialog");
  delete detailDialog.dataset.articleId;
  if (/^\/berita\/[^/]+\/?$/.test(window.location.pathname) || /^#berita-\d+$/i.test(window.location.hash)) {
    window.history.replaceState({}, "", "/berita");
  }
});
window.addEventListener("hashchange", syncNewsArticleWithLocation);
document.querySelector("#donation-open")?.addEventListener("click", () => {
  renderDonationDialog();
  document.querySelector("#donation-dialog").showModal();
});
document.querySelector("#donation-close")?.addEventListener("click", () => {
  document.querySelector("#donation-dialog").close();
});
document.querySelector("#donation-dialog")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelectorAll("[data-share]").forEach((button) => {
  button.addEventListener("click", async () => {
    const actions = document.querySelector("#news-share-actions");
    const title = actions.dataset.title || document.title;
    const url = actions.dataset.url || window.location.href;
    const shareType = button.dataset.share;
    const links = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    };
    if (shareType === "native" && navigator.share) {
      await navigator.share({ title, url }).catch(() => {});
    } else if (shareType === "copy") {
      await navigator.clipboard?.writeText(url);
      button.textContent = "Tersalin";
      window.setTimeout(() => { button.textContent = "Salin Tautan"; }, 1400);
    } else if (links[shareType]) {
      window.open(links[shareType], "_blank", "noopener,noreferrer");
    }
  });
});
document.querySelector("#record-detail-close")?.addEventListener("click", () => {
  document.querySelector("#record-detail-dialog").close();
});
for (const selector of ["#news-detail-dialog", "#record-detail-dialog"]) {
  const detailDialog = document.querySelector(selector);
  detailDialog.addEventListener("click", (event) => {
    if (event.target !== detailDialog) return;
    const bounds = detailDialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom
    ) {
      detailDialog.close();
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const openDialog = ["#record-detail-dialog", "#news-detail-dialog", "#donation-dialog"]
    .map((selector) => document.querySelector(selector))
    .reverse()
    .find((candidate) => candidate.open);
  if (!openDialog) return;
  event.preventDefault();
  openDialog.close();
});

const processingDialog = document.querySelector("#processing-dialog");
let processingCount = 0;
let processingTimer;

processingDialog.addEventListener("cancel", (event) => event.preventDefault());

function beginProcessing(message = "Memproses permintaan...") {
  window.clearTimeout(processingTimer);
  processingCount += 1;
  document.querySelector("#processing-label").textContent = message;
  if (!processingDialog.open) processingDialog.showModal();
  document.body.setAttribute("aria-busy", "true");
}

function endProcessing() {
  processingCount = Math.max(0, processingCount - 1);
  if (processingCount) return;
  processingTimer = window.setTimeout(() => {
    processingTimer = null;
    if (!processingCount && processingDialog.open) {
      processingDialog.close();
      document.body.removeAttribute("aria-busy");
    }
  }, 120);
}

async function withProcessing(operation, message) {
  beginProcessing(message);
  try {
    return await operation();
  } finally {
    endProcessing();
  }
}

// Reverse proxy (nginx/Caddy) dapat menjawab dengan halaman HTML, bukan JSON.
// Contohnya 413 Request Entity Too Large saat unggah melebihi client_max_body_size.
// response.json() akan melempar SyntaxError dan menutupi penyebab aslinya, jadi
// badan respons dibaca sebagai teks lebih dulu dan diterjemahkan ke pesan yang jelas.
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
    if (response.status === 503 && payload.maintenance) window.location.replace("/");
    if (!response.ok) throw new Error(payload.error || fallbackMessage);
    return payload;
  }
  // Bukan JSON: kemungkinan halaman error proxy, Cloudflare, atau outage.
  if (response.status === 413) {
    throw new Error("Ukuran data terlalu besar untuk server. Kurangi jumlah atau ukuran file, atau minta admin menaikkan batas unggah reverse proxy (client_max_body_size).");
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new Error("Server tidak dapat dihubungi saat ini. Coba beberapa saat lagi.");
  }
  if (response.status === 401) {
    throw new Error("Sesi berakhir. Muat ulang halaman lalu masuk kembali.");
  }
  throw new Error(`${fallbackMessage} (HTTP ${response.status})`);
}

async function request(url, options = {}) {
  const sendRequest = async () => {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    return readApiResponse(response, "Permintaan tidak dapat diproses.");
  };
  const processingMessages = {
    "/api/admin/media": "Mengunggah media...",
    "/api/admin/import/preview": "Menyiapkan pratinjau impor...",
    "/api/admin/import/commit": "Menyimpan data impor...",
    "/api/admin/maintenance": "Menyimpan jadwal maintenance...",
    "/api/admin/typography": "Menyimpan pengaturan font...",
  };
  if (url === "/api/admin/media" && options.method === "DELETE") {
    return withProcessing(sendRequest, "Menghapus media...");
  }
  if (processingMessages[url]) return withProcessing(sendRequest, processingMessages[url]);
  return sendRequest();
}

function fillLocationSelect(select, prefix, count) {
  const selected = Number(select.value);
  select.replaceChildren();
  for (let value = 1; value <= count; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${prefix} ${String(value).padStart(3, "0")}`;
    select.append(option);
  }
  if (selected > 0 && selected <= count) select.value = String(selected);
}

// Kolom nomor wilayah pada form kontak mengikuti jumlah RT/RW yang di pengaturan.
const contactUnitSelect = document.querySelector("#contact-form select[name='unit_number']");
function fillContactUnitSelect() {
  if (!contactUnitSelect) return;
  const unitType = document.querySelector("#contact-form select[name='unit_type']")?.value || "RT";
  const previous = contactUnitSelect.value;
  fillLocationSelect(contactUnitSelect, unitType, unitType === "RW" ? settings.rw_count : settings.rt_count);
  if (previous && contactUnitSelect.value !== previous) contactUnitSelect.value = previous;
}
document.querySelector("#contact-form select[name='unit_type']")?.addEventListener("change", fillContactUnitSelect);

function fillContributionLocationSelect(select, prefix, count) {
  const selected = select.value;
  fillLocationSelect(select, prefix, count);
  select.prepend(new Option(`Pilih ${prefix}`, ""));
  select.value = selected;
}

function utcToLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function updateSiteIconControls() {
  const form = document.querySelector("#site-icon-form");
  const slot = Number(form.elements.slot.value);
  const exists = siteIconAvailability[slot];
  const status = document.querySelector("#site-icon-status");
  const remove = document.querySelector("#delete-site-icon-button");
  status.textContent = exists ? `Logo ${slot} tersimpan.` : `Logo ${slot} belum dipasang.`;
  remove.hidden = !exists;
  remove.textContent = `Hapus Logo ${slot}`;
}
function updateThemeLogoControls() {
  const form = document.querySelector("#theme-logo-form");
  if (!form) return;
  const theme = Number(form.elements.slot.value) === 1 ? "light" : "dark";
  const target = selectedMediaTarget();
  const exists = themeLogoAvailability[target][theme];
  const targetLabel = mediaTargetLabel(target);
  document.querySelector("#theme-logo-status").textContent = exists
    ? `Logo mode ${theme === "light" ? "terang" : "gelap"} untuk ${targetLabel} tersimpan.`
    : `Belum ada logo khusus mode ${theme === "light" ? "terang" : "gelap"} untuk ${targetLabel}.`;
  document.querySelector("#delete-theme-logo-button").hidden = !exists;
}
function selectedMediaTarget() {
  return document.querySelector("#media-target-select")?.value || "logo1";
}
function mediaTargetLabel(target) {
  return document.querySelector(`#media-target-select option[value="${target}"]`)?.textContent.trim() || "Logo Pertama";
}
function updateThemeLogoLocationControls() {
  const target = selectedMediaTarget();
  const isSiteLogo = target === "logo1" || target === "logo2";
  const isHero = target === "hero";
  const isSlideshow = target === "slideshow";
  document.querySelector("#site-logo-target-controls").hidden = !isSiteLogo;
  document.querySelector("#site-icon-form").elements.slot.value = target === "logo1" ? "1" : "2";
  document.querySelector("#hero-target-controls").hidden = !isHero && !isSlideshow;
  document.querySelector("#hero-target-heading").hidden = !isHero;
  document.querySelector("#hero-image-form").hidden = !isHero;
  document.querySelector("#hero-background-scale-form").hidden = !isHero;
  document.querySelector("#hero-playlist-panel").hidden = !isSlideshow;
  updateSiteIconControls();
  updateThemeLogoControls();
}

function updateBrandLogoDisplay(overrideSlot = null, overrideScale = null) {
  const scaleFor = (slot) => slot === overrideSlot ? overrideScale : settings[`icon_zoom_${slot}`];
  const theme = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
  const showPrimary = (siteIconAvailability[1] || themeLogoAvailability.logo1[theme]) && scaleFor(1) > 0;
  const showSecondary = (siteIconAvailability[2] || themeLogoAvailability.logo2[theme]) && scaleFor(2) > 0;
  const hasVisibleLogo = showPrimary || showSecondary;
  const brandIcon = document.querySelector("#brand-icon");
  const secondaryIcon = document.querySelector("#brand-icon-secondary");
  const logoGroup = document.querySelector("#brand-logo-group");
  const divider = document.querySelector("#brand-logo-divider");
  document.querySelector(".brand-mark").classList.toggle("has-icon", hasVisibleLogo);
  brandIcon.classList.toggle("brand-icon-bsk", !showPrimary);
  logoGroup.hidden = !hasVisibleLogo;
  document.querySelector("#brand-mark-text").hidden = hasVisibleLogo;
  brandIcon.hidden = !hasVisibleLogo;
  secondaryIcon.hidden = !(showPrimary && showSecondary);
  divider.hidden = secondaryIcon.hidden;
  if (!hasVisibleLogo) return;
  const visibleSlot = showPrimary ? 1 : 2;
  const isDark = theme === "dark";
  const themedPrimary = themedBskLogoUrl("logo1", theme);
  const themedSecondary = themedBskLogoUrl("logo2", theme);
  const brandIconUrl = showPrimary ? (themedPrimary || "/media/site-icon") : (themedSecondary || (theme === "dark" ? DARK_BSK_LOGO_URL : LIGHT_BSK_LOGO_URL));
  if (brandIcon.getAttribute("src") !== brandIconUrl) brandIcon.src = brandIconUrl;
  const secondaryIconUrl = themedSecondary || "/media/site-icon/2";
  if (showPrimary && showSecondary && secondaryIcon.getAttribute("src") !== secondaryIconUrl) {
    secondaryIcon.src = secondaryIconUrl;
  }
  if (secondaryIcon.hidden) {
    document.documentElement.style.setProperty("--brand-logo-single-zoom", String(scaleFor(visibleSlot) / 100));
  }
}

function updateFooterLogoScalePreview() {
  const form = document.querySelector("#footer-settings-form");
  const slot = Number(form.elements.logo_scale_slot.value);
  const scale = Number(form.elements.logo_scale.value);
  const image = document.querySelector("#footer-logo-scale-preview-image");
  const empty = document.querySelector("#footer-logo-scale-preview-empty");
  settings[`icon_zoom_${slot}`] = scale;
  const available = siteIconAvailability[slot];
  const visibleAtScale = available && scale > 0;
  image.hidden = !visibleAtScale;
  empty.hidden = visibleAtScale;
  empty.textContent = available ? `Logo ${slot} disetel 0% (tidak terlihat).` : `Logo ${slot} belum dipasang.`;
  if (available) {
    const url = slot === 1 ? "/media/site-icon" : "/media/site-icon/2";
    if (image.getAttribute("src") !== url) image.src = url;
    image.style.setProperty("--logo-preview-scale", String(scale / 100));
  }
  document.querySelector("#footer-logo-scale-value").value = `${scale}%`;
  applyIconZoom(slot, scale);
  updateBrandLogoDisplay(slot, scale);
}

function updateMaintenanceStatus(payload) {
  const maintenanceForm = document.querySelector("#maintenance-form");
  if (!maintenanceForm || maintenanceForm.dataset.dirty === "true") return;
  const now = Date.now();
  const startsAt = Date.parse(payload.maintenance_starts_at || "");
  const endsAt = Date.parse(payload.maintenance_ends_at || "");
  const status = document.querySelector("#maintenance-status");
  if (!payload.maintenance_enabled) status.textContent = "Maintenance tidak aktif.";
  else if (startsAt > now) status.textContent = "Jadwal tersimpan dan belum dimulai.";
  else if (endsAt > now) status.textContent = "Maintenance sedang berlangsung.";
  else status.textContent = "Waktu jadwal sudah lewat; situs kembali normal secara otomatis.";
}

async function loadSettings() {
  const payload = await request("/api/settings");
  const payloadSignature = JSON.stringify(payload);
  if (payloadSignature === settingsPayloadSignature) {
    updateMaintenanceStatus(payload);
    return false;
  }
  settingsPayloadSignature = payloadSignature;
  siteIconAvailability[1] = Boolean(payload.site_icon_ready);
  siteIconAvailability[2] = Boolean(payload.site_icon_2_ready);
  for (const target of ["logo1", "logo2", "hero", "slideshow"]) {
    for (const mode of ["light", "dark"]) themeLogoAvailability[target][mode] = Boolean(payload.theme_logo_ready?.[target]?.[mode]);
  }
  settings.rt_count = payload.rt_count;
  settings.rw_count = payload.rw_count;
  settings.icon_zoom_1 = payload.icon_zoom_1;
  settings.icon_zoom_2 = payload.icon_zoom_2;
  settings.hero_background_scale = Number.isFinite(Number(payload.hero_background_scale))
    ? Math.max(0, Number(payload.hero_background_scale))
    : 100;
  settings.hero_image_position = payload.hero_image_position || "right";
  settings.site_font_preset = payload.site_font_preset || "kifayah";
  settings.site_font_scale = payload.site_font_scale || 100;
  settings.site_font_style = payload.site_font_style || "normal";
  settings.site_font_style_target = payload.site_font_style_target || "all";
  settings.intro_text_alignment = payload.intro_text_alignment || "left";
  settings.news_text_alignment = payload.news_text_alignment || "left";
  settings.directory_text_alignment = payload.directory_text_alignment || "left";
  const typographyForm = document.querySelector("#typography-form");
  if (typographyForm && typographyForm.dataset.dirty !== "true") {
    typographyForm.elements.font_preset.value = settings.site_font_preset;
    typographyForm.elements.font_scale.value = settings.site_font_scale;
    typographyForm.elements.font_style.value = settings.site_font_style;
    typographyForm.elements.font_style_target.value = settings.site_font_style_target;
    typographyForm.elements.intro_text_alignment.value = settings.intro_text_alignment;
    typographyForm.elements.news_text_alignment.value = settings.news_text_alignment;
    typographyForm.elements.directory_text_alignment.value = settings.directory_text_alignment;
    document.querySelector("#site-font-scale-value").value = `${settings.site_font_scale}%`;
  }
  const typographyPreview = typographyForm?.dataset.dirty === "true" ? {
    font_preset: typographyForm.elements.font_preset.value,
    font_scale: Number(typographyForm.elements.font_scale.value),
    font_style: typographyForm.elements.font_style.value,
    font_style_target: typographyForm.elements.font_style_target.value,
    intro_text_alignment: typographyForm.elements.intro_text_alignment.value,
    news_text_alignment: typographyForm.elements.news_text_alignment.value,
    directory_text_alignment: typographyForm.elements.directory_text_alignment.value,
  } : {
    font_preset: settings.site_font_preset,
    font_scale: settings.site_font_scale,
    font_style: settings.site_font_style,
    font_style_target: settings.site_font_style_target,
    intro_text_alignment: settings.intro_text_alignment,
    news_text_alignment: settings.news_text_alignment,
    directory_text_alignment: settings.directory_text_alignment,
  };
  applySiteTypography(typographyPreview);
  const exportHeaderForm = document.querySelector("#export-header-form");
  if (exportHeaderForm && exportHeaderForm.dataset.dirty !== "true") {
    for (const field of ["export_header_title", "export_header_line_2", "export_header_line_3"]) {
      exportHeaderForm.elements[field].value = payload[field] || "";
    }
  }
  const footerSettingsForm = document.querySelector("#footer-settings-form");
  if (footerSettingsForm && footerSettingsForm.dataset.dirty !== "true") {
    for (const field of ["footer_brand", "footer_area", "footer_location", "footer_map_query"]) {
      footerSettingsForm.elements[field].value = payload[field] || "";
    }
  }
  if (footerSettingsForm && footerSettingsForm.dataset.logoScaleDirty !== "true") {
    const logoSlot = siteIconAvailability[1] ? 1 : siteIconAvailability[2] ? 2 : 1;
    footerSettingsForm.elements.logo_scale_slot.value = String(logoSlot);
    footerSettingsForm.elements.logo_scale.value = settings[`icon_zoom_${logoSlot}`];
  }
  document.querySelector("#footer-brand").textContent = payload.footer_brand || "Data Kifayah";
  const footerArea = payload.footer_area || "";
  document.querySelector("#footer-area").textContent = footerArea;
  document.querySelector("#brand-area").textContent = footerArea;
  const footerLocation = document.querySelector("#footer-location");
  footerLocation.textContent = payload.footer_location || "Lokasi belum diatur";
  footerLocation.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(payload.footer_map_query || payload.footer_location || "")}`;
  for (const field of ["donation_title", "donation_description", "donation_recipient", "donation_dana", "donation_ovo", "donation_bank_name", "donation_bank_account", "donation_bank_holder", "donation_dana_link", "donation_ovo_link", "donation_bank_link"]) {
    donationSettings[field] = payload[field] || "";
  }
  const donationForm = document.querySelector("#donation-settings-form");
  if (donationForm && donationForm.dataset.dirty !== "true") {
    for (const field of Object.keys(donationSettings)) donationForm.elements[field].value = donationSettings[field];
  }
  const maintenanceForm = document.querySelector("#maintenance-form");
  if (maintenanceForm && maintenanceForm.dataset.dirty !== "true") {
    maintenanceForm.elements.enabled.checked = Boolean(payload.maintenance_enabled);
    maintenanceForm.elements.starts_at.value = utcToLocalDateTime(payload.maintenance_starts_at);
    maintenanceForm.elements.ends_at.value = utcToLocalDateTime(payload.maintenance_ends_at);
    maintenanceForm.elements.message.value = payload.maintenance_message || "";
    updateMaintenanceStatus(payload);
  }
  for (const slot of [1, 2]) {
    const status = document.querySelector(`#export-logo-${slot}-status`);
    if (status) status.textContent = payload[`export_logo_${slot}_ready`] ? "Logo kop tersimpan." : "Belum ada logo kop.";
  }
  const signatureForm = document.querySelector("#signature-settings-form");
  if (signatureForm) {
    signatureRtCommonName = payload.signature_rt_name || "";
    signatureRtCommonImage = Boolean(payload.signature_rt_ready);
    signatureRtNames = payload.signature_rt_names || {};
    signatureRtImages = payload.signature_rt_images || {};
  }
  if (signatureForm && signatureForm.dataset.dirty !== "true") {
    for (const field of ["signature_date", "signature_maker_name", "signature_lmk_name", "signature_rw_name", "signature_bsk_name", "signature_place", "signature_note", "signature_label_maker", "signature_label_rt", "signature_label_lmk", "signature_label_rw", "signature_label_bsk"]) {
      signatureForm.elements[field].value = payload[field] || "";
    }
    for (const role of ["bsk", "rw", "lmk", "rt", "maker"]) {
      const checkbox = signatureForm.elements[`signature_show_${role}`];
      if (checkbox) checkbox.checked = payload.signature_show?.[role] !== false;
    }
    fillSignatureRtUnits();
    loadSignatureRtUnit();
  }
  for (const role of ["maker", "lmk", "rw", "bsk"]) {
    const status = document.querySelector(`#signature-${role}-status`);
    if (status) status.textContent = payload[`signature_${role}_ready`] ? "Gambar tanda tangan tersimpan." : "Belum ada gambar tanda tangan.";
  }
  for (const slot of [1, 2]) {
    const zoom = settings[`icon_zoom_${slot}`];
    applyIconZoom(slot, zoom);
  }
  applyHeroBackgroundScale(settings.hero_background_scale);
  applyHeroImagePosition(settings.hero_image_position);
  const backgroundScaleSlider = document.querySelector("#hero-background-scale");
  if (document.activeElement !== backgroundScaleSlider) backgroundScaleSlider.value = settings.hero_background_scale;
  document.querySelector("#hero-background-scale-value").value = `${settings.hero_background_scale}%`;
  const heroImagePosition = document.querySelector("#hero-image-position");
  if (document.activeElement !== heroImagePosition) heroImagePosition.value = settings.hero_image_position;
  fillLocationSelect(document.querySelector("#rt-select"), "RT", settings.rt_count);
  fillLocationSelect(document.querySelector("#rw-select"), "RW", settings.rw_count);
  fillLocationSelect(document.querySelector("#edit-rt-select"), "RT", settings.rt_count);
  fillLocationSelect(document.querySelector("#edit-rw-select"), "RW", settings.rw_count);
  fillContributionLocationSelect(document.querySelector("#contribution-rt"), "RT", settings.rt_count);
  fillContributionLocationSelect(document.querySelector("#contribution-rw"), "RW", settings.rw_count);
  fillContactUnitSelect();
  if (document.activeElement !== settingsForm.elements.rt_count) settingsForm.elements.rt_count.value = settings.rt_count;
  if (document.activeElement !== settingsForm.elements.rw_count) settingsForm.elements.rw_count.value = settings.rw_count;
  const favicon = document.querySelector("#dynamic-favicon");
  const iconUrl = payload.site_icon_ready ? "/media/site-icon" : "/favicon.ico";
  if (new URL(favicon.href).pathname !== iconUrl) favicon.href = iconUrl;
  updateBrandLogoDisplay();
  updateThemeSensitiveLogos();
  updateHeroLogoContrast();
  updateFooterLogoScalePreview();
  updateSiteIconControls();
  updateThemeLogoControls();
  document.querySelector("#hero-image-status").textContent = payload.hero_image_ready ? "Gambar utama tersimpan." : "Belum ada gambar utama.";
  document.querySelector("#delete-hero-image-button").hidden = !payload.hero_image_ready;
  for (const slot of [1, 2]) {
    document.querySelector(`#delete-export-logo-${slot}-button`).hidden = !payload[`export_logo_${slot}_ready`];
  }
  const heroVisual = document.querySelector("#hero-visual");
  updateHeroPlaylist(payload.hero_playlist || [], payload.hero_image_ready);
  renderHeroPlaylistItems(payload.hero_playlist || []);
  updateThemeSensitiveLogos();
  updateThemeLogoLocationControls();
  return true;
}

function renderHeroPlaylistItems(items) {
  const list = document.querySelector("#hero-playlist-items");
  if (!list) return;
  const signature = JSON.stringify(items);
  if (signature === heroPlaylistItemsSignature) return;
  heroPlaylistItemsSignature = signature;
  list.replaceChildren();
  items.forEach((item, index) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${item.name || (item.type === "video" ? "Video" : "Foto")} · ${item.type === "video" ? "Video" : "Foto"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Hapus";
    remove.setAttribute("aria-label", `Hapus ${item.name || "media"} dari slideshow`);
    remove.addEventListener("click", async () => {
      const errorElement = document.querySelector("#hero-playlist-error");
      errorElement.textContent = "";
      remove.disabled = true;
      try {
        const result = await request(`/api/admin/hero-playlist/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        updateHeroPlaylist(result.items || []);
        renderHeroPlaylistItems(result.items || []);
      } catch (error) {
        errorElement.textContent = error.message;
        remove.disabled = false;
      }
    });
    row.append(label, remove);
    list.append(row);
  });
}

function updateHeroPlaylist(items, hasFallbackImage) {
  const visual = document.querySelector("#hero-visual");
  const image = document.querySelector("#hero-image");
  const slideshow = document.querySelector("#hero-slideshow");
  if (typeof hasFallbackImage === "boolean") heroHasFallbackImage = hasFallbackImage;
  heroPlaylistSourceItems = items;
  const theme = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
  const themedSlideUrl = themedBskLogoUrl("slideshow", theme);
  const themedHeroUrl = themeLogoAvailability.hero[theme] ? themedBskLogoUrl("hero", theme) : "";
  const displayItems = themedSlideUrl
    ? [{ id: `theme-logo-${theme}`, name: "Logo sesuai tema", type: "image", url: themedSlideUrl }, ...items]
    : items;
  const hasThemedHeroLogo = Boolean(themedHeroUrl);
  const signature = `${heroHasFallbackImage ? "fallback" : "no-fallback"}|${themedHeroUrl}|${themedSlideUrl}|${displayItems.map((item) => `${item.id}:${item.url}`).join("|")}`;
  visual.hidden = displayItems.length === 0 && !heroHasFallbackImage && !hasThemedHeroLogo;
  if (signature === heroPlaylistSignature) return;
  heroPlaylistSignature = signature;
  heroPlaylist = displayItems;
  heroFailedMedia.clear();
  window.clearTimeout(heroSlideTimer);
  heroSlideTimer = null;
  if (heroVideo) heroVideo.pause();
  heroVideo = null;
  slideshow.replaceChildren();
  slideshow.hidden = true;
  visual.classList.remove("is-video");
  image.hidden = false;
  if (!displayItems.length) {
    if (themedHeroUrl && !heroHasFallbackImage) {
      setHeroImageSource(image, themedHeroUrl);
      visual.classList.add("uses-theme-bsk-logo");
    } else setHeroImageSource(image, heroHasFallbackImage ? "/media/hero" : "");
    return;
  }
  showHeroSlide(0);
}

function showHeroSlide(index) {
  if (!heroPlaylist.length) return;
  const image = document.querySelector("#hero-image");
  const slideshow = document.querySelector("#hero-slideshow");
  const visual = document.querySelector("#hero-visual");
  // Lewati media yang sudah gagal agar tidak berputar tanpa henti.
  const usable = heroPlaylist.filter((entry) => !heroFailedMedia.has(entry.id));
  if (!usable.length) {
    heroFailedMedia.clear();
    showHeroFallback();
    return;
  }
  const item = usable[index % usable.length];
  window.clearTimeout(heroSlideTimer);
  if (heroVideo) {
    heroVideo.pause();
    heroVideo.removeAttribute("src");
    heroVideo.load();
  }
  heroVideo = null;
  slideshow.replaceChildren();
  slideshow.hidden = true;
  visual.classList.remove("is-video");
  image.hidden = false;
  image.onerror = () => showHeroSlide(index + 1);
  if (item.type === "video") {
    image.hidden = true;
    image.onerror = null;
    visual.classList.add("is-video");
    // Video full-bleed tidak boleh memakai gaya logo persegi milik tema.
    visual.classList.remove("uses-theme-bsk-logo");
    slideshow.hidden = false;
    const video = document.createElement("video");
    video.src = item.url;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("aria-label", item.name || "Video dokumentasi");
    heroVideo = video;
    slideshow.append(video);
    const singleItem = usable.length < 2;
    if (singleItem) video.loop = true;
    let settled = false;
    const settle = (broken) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(heroSlideTimer);
      if (broken) heroFailedMedia.add(item.id);
      showHeroSlide(index + 1);
    };
    // MP4 fragmented tanpa metadata durasi dibaca browser sebagai 0 detik.
    // Video seperti itu langsung "selesai" dan memutar ulang tanpa henti,
    // jadi harus ditandai rusak sebelum sempat mengulang.
    video.addEventListener("loadedmetadata", () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        settle(true);
        return;
      }
      video.play().catch(() => settle(true));
    }, { once: true });
    if (!singleItem) {
      video.addEventListener("ended", () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          settle(true);
          return;
        }
        settle(false);
      }, { once: true });
    }
    video.addEventListener("error", () => settle(true), { once: true });
    return;
  }
  setHeroImageSource(image, item.url);
  heroSlideTimer = window.setTimeout(() => showHeroSlide(index + 1), 6000);
}
// Tampilkan gambar utama sebagai cadangan saat semua media slideshow gagal.
function showHeroFallback() {
  const image = document.querySelector("#hero-image");
  const visual = document.querySelector("#hero-visual");
  window.clearTimeout(heroSlideTimer);
  heroSlideTimer = null;
  document.querySelector("#hero-slideshow").replaceChildren();
  document.querySelector("#hero-slideshow").hidden = true;
  visual.classList.remove("is-video");
  visual.hidden = !heroHasFallbackImage;
  image.hidden = false;
  image.onerror = null;
  setHeroImageSource(image, heroHasFallbackImage ? "/media/hero" : "");
}

async function refreshRecords(forceRender = false) {
  try {
    await loadSettings();
    const payload = await request(isAdmin ? "/api/admin/records" : "/api/records");
    const recordsChanged = forceRender || JSON.stringify(records) !== JSON.stringify(payload.records);
    if (recordsChanged) {
      records.splice(0, records.length, ...payload.records);
      render();
    }
    await loadNews();
    await loadContacts();
    const contributionView = document.querySelector("#admin-view-contributions");
    if (isAdmin && contributionView && !contributionView.hidden) await loadContributionResidents();
    if (isAdmin && recordsChanged) renderManageList();
  } catch {
    // Polling gagal diam-diam; data lama tetap ditampilkan sampai koneksi kembali.
  }
}

function renderManageList() {
  const list = document.querySelector("#manage-list");
  list.replaceChildren();
  const query = adminRecordSearchInput.value.trim().toLocaleLowerCase("id-ID");
  const filteredRecords = records.filter((record) => {
    const dateValue = record.date_of_death ? new Date(`${record.date_of_death}T00:00:00`) : null;
    const numericDate = dateValue ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }).format(dateValue) : "";
    const searchable = [record.full_name, record.area, ...rtRwSearchVariants(record.area), record.date_of_death, record.date_of_death ? formatDate(record.date_of_death) : "", numericDate]
      .filter(Boolean).join(" ").toLocaleLowerCase("id-ID");
    return searchable.includes(query);
  });
  document.querySelector("#managed-count").textContent = query
    ? `${filteredRecords.length} dari ${records.length} entri`
    : `${records.length} entri`;
  const sortMode = adminRecordSortSelect.value;
  filteredRecords.sort((left, right) => {
    if (sortMode === "name") return (left.full_name || "").localeCompare(right.full_name || "", "id");
    const leftDate = left.date_of_death || "";
    const rightDate = right.date_of_death || "";
    if (!leftDate) return rightDate ? 1 : 0;
    if (!rightDate) return -1;
    return sortMode === "oldest" ? leftDate.localeCompare(rightDate) : rightDate.localeCompare(leftDate);
  });
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / ADMIN_RECORDS_PAGE_SIZE));
  adminRecordsPage = Math.min(adminRecordsPage, pageCount - 1);
  const pageStart = adminRecordsPage * ADMIN_RECORDS_PAGE_SIZE;
  filteredRecords.slice(pageStart, pageStart + ADMIN_RECORDS_PAGE_SIZE).forEach((record) => {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = record.full_name || `Nama belum dilengkapi (ID ${record.id})`;
    const detail = document.createElement("small");
    detail.textContent = [formatAreaLabel(record.area), record.date_of_death ? `Wafat ${formatDate(record.date_of_death)}` : "Tanggal wafat belum dilengkapi", record.publish_address ? "Alamat tampil untuk publik" : "Alamat hanya untuk pengelola"].join(" · ");
    if (record.issue_count) {
      const flag = document.createElement("span");
      flag.className = "manage-item-issue";
      flag.textContent = `${record.issue_count} field bermasalah`;
      flag.title = "Buka Impor Data lalu Tinjauan Data untuk melihat file dan baris asalnya.";
      text.append(flag);
    }
    const audit = document.createElement("small");
    audit.className = "manage-item-audit";
    audit.textContent = record.updated_at
      ? `Terakhir diubah ${formatAuditTimestamp(record.updated_at)}${record.updated_by ? ` oleh ${record.updated_by}` : ""}`
      : "Belum ada catatan perubahan";
    text.append(audit);
    text.append(detail);
    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditRecord(record));
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus data ${record.full_name}?`)) return;
      try {
        await request(`/api/records/${record.id}`, { method: "DELETE" });
        await refreshRecords();
      } catch (error) {
        window.alert(error.message);
      }
    });
    if (currentUser?.role === "Staff") actions.hidden = true;
    actions.append(edit, remove);
    item.append(text, actions);
    list.append(item);
  });
  if (!filteredRecords.length) {
    const item = document.createElement("li");
    item.textContent = records.length ? "Tidak ada entri yang sesuai dengan pencarian." : "Belum ada entri tersimpan.";
    list.append(item);
  }
  const pageNumbers = document.querySelector("#admin-records-page-numbers");
  pageNumbers.replaceChildren();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageButton = document.createElement("button");
    pageButton.className = "record-page-number";
    pageButton.type = "button";
    pageButton.textContent = String(pageIndex + 1);
    pageButton.setAttribute("aria-current", String(pageIndex === adminRecordsPage));
    pageButton.addEventListener("click", () => {
      adminRecordsPage = pageIndex;
      renderManageList();
    });
    pageNumbers.append(pageButton);
  }
  document.querySelector("#admin-records-previous").disabled = adminRecordsPage === 0;
  document.querySelector("#admin-records-next").disabled = adminRecordsPage >= pageCount - 1;
  const printBody = document.querySelector("#print-records-body");
  if (printBody) {
    printBody.replaceChildren();
    const printNote = document.querySelector("#print-preview-note");
    if (printNote) {
      printNote.textContent = query
        ? `Menampilkan ${filteredRecords.length} entri sesuai pencarian "${adminRecordSearchInput.value.trim()}".`
        : `Menampilkan semua ${filteredRecords.length} entri.`;
    }
    filteredRecords.forEach((record, index) => {
      const row = document.createElement("tr");
      const values = [
        String(index + 1), formatWords(record.full_name), formatGenderLabel(record.gender), formatAreaLabel(record.area),
        record.date_of_death ? formatDate(record.date_of_death) : "", formatWords(record.address),
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      printBody.append(row);
    });
  }
  const select = document.querySelector("#detail-record-select");
  const selectedId = select.value;
  select.replaceChildren(new Option("Pilih Entri", ""));
  records.forEach((record) => select.add(new Option(record.full_name, String(record.id))));
  if (records.some((record) => String(record.id) === selectedId)) select.value = selectedId;
  showSelectedPrivateData();
}

function showEditPortraitPreview(record, file = null) {
  const image = document.querySelector("#edit-record-portrait-preview-image");
  const status = document.querySelector("#edit-record-portrait-status");
  if (image.dataset.previewObjectUrl) {
    URL.revokeObjectURL(image.dataset.previewObjectUrl);
    delete image.dataset.previewObjectUrl;
  }
  if (file instanceof File && file.size > 0) {
    const previewUrl = URL.createObjectURL(file);
    image.src = previewUrl;
    image.dataset.previewObjectUrl = previewUrl;
    image.hidden = false;
    status.textContent = "Pratinjau foto pengganti.";
    return;
  }
  if (record?.portrait_url) {
    image.src = record.portrait_url;
    image.hidden = false;
    status.textContent = "Foto saat ini. Pilih file untuk menggantinya.";
    return;
  }
  image.removeAttribute("src");
  image.hidden = true;
  status.textContent = "Belum ada foto tersimpan.";
}

function updateEditPortraitFilename(file = null) {
  document.querySelector("#edit-record-portrait-filename").textContent = file?.name || "Tidak ada foto baru dipilih";
}

function openEditRecord(record) {
  const form = document.querySelector("#edit-record-form");
  const area = String(record.area || "");
  const rt = area.match(/RT\s*0*(\d+)/i);
  const rw = area.match(/RW\s*0*(\d+)/i);
  form.dataset.recordId = String(record.id);
  form.elements.full_name.value = record.full_name || "";
  form.elements.gender.value = record.gender || "";
  form.elements.rt.value = rt?.[1] || "";
  form.elements.rw.value = rw?.[1] || "";
  form.elements.date_of_death.value = record.date_of_death || "";
  form.elements.address.value = record.address || "";
  form.elements.publish_address.checked = Boolean(record.publish_address);
  for (const field of ["family_card_number", "national_id_number", "birthplace", "birth_date", "religion"]) {
    form.elements[field].value = record[field] || "";
  }
  form.elements.portrait.value = "";
  updateEditPortraitFilename();
  const portraitField = document.querySelector("#edit-record-portrait-field");
  if (!portraitField.hidden) {
    form.elements.publish_portrait.checked = Boolean(record.publish_portrait);
    showEditPortraitPreview(record);
  }
  document.querySelector("#edit-record-error").textContent = "";
  form.hidden = false;
  focusAdminTask("edit-record-form", "Edit Data Warga");
  form.elements.full_name.focus({ preventScroll: true });
}

function showSelectedPrivateData() {
  const selectedId = Number(document.querySelector("#detail-record-select").value);
  const record = records.find((item) => item.id === selectedId);
  const permissions = new Set(currentUser?.permissions || rolePermissionDefaults[currentUser?.role] || []);
  const canSeePrivate = permissions.has("family") && currentUser?.role !== "Staff";
  const identityForm = document.querySelector("#identity-form");
  const familyForm = document.querySelector("#family-form");
  const portraitForm = document.querySelector("#portrait-form");
  const portraitDeleteButton = document.querySelector("#delete-portrait-button");
  identityForm.hidden = !record || !canSeePrivate;
  familyForm.hidden = !record || !canSeePrivate;
  portraitForm.hidden = !record || !canSeePrivate;
  portraitDeleteButton.hidden = !record?.portrait_url || !canSeePrivate;
  if (!record || !canSeePrivate) return;
  document.querySelector("#portrait-status").textContent = record.portrait_url ? "Foto warga tersimpan." : "Belum ada foto warga.";
  if (typeof record.publish_portrait === "boolean") portraitForm.elements.publish_portrait.checked = record.publish_portrait;
  if (identityForm.dataset.recordId !== String(record.id)) {
    for (const field of ["gender", "address", "family_card_number", "national_id_number", "birthplace", "birth_date", "religion"]) {
      identityForm.elements[field].value = record[field] || "";
    }
    identityForm.elements.publish_address.checked = Boolean(record.publish_address);
    document.querySelector("#family-address-hint").textContent = record.publish_address
      ? "Alamat akan ditampilkan secara publik."
      : "Alamat hanya dapat dilihat oleh pengelola.";
    identityForm.dataset.recordId = String(record.id);
  }
  const familyList = document.querySelector("#family-list");
  familyList.replaceChildren();
  for (const relative of record.family || []) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${relative.full_name || "Nama belum diisi"} · ${relative.relationship || "Hubungan belum diisi"}`;
    const actions = document.createElement("div");
    actions.className = "manage-item-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    const editForm = document.createElement("form");
    editForm.className = "family-inline-edit";
    editForm.hidden = true;
    const nameInput = document.createElement("input");
    nameInput.name = "full_name";
    nameInput.maxLength = 120;
    nameInput.value = relative.full_name;
    nameInput.setAttribute("aria-label", "Nama anggota keluarga");
    const relationshipInput = document.createElement("input");
    relationshipInput.name = "relationship";
    relationshipInput.maxLength = 60;
    relationshipInput.value = relative.relationship;
    relationshipInput.setAttribute("aria-label", "Hubungan keluarga");
    const save = document.createElement("button");
    save.className = "edit-button";
    save.type = "submit";
    save.textContent = "Simpan";
    const cancel = document.createElement("button");
    cancel.className = "text-button";
    cancel.type = "button";
    cancel.textContent = "Batal";
    edit.addEventListener("click", () => {
      label.hidden = true;
      actions.hidden = true;
      editForm.hidden = false;
      nameInput.focus();
    });
    cancel.addEventListener("click", () => {
      editForm.hidden = true;
      label.hidden = false;
      actions.hidden = false;
    });
    editForm.append(nameInput, relationshipInput, save, cancel);
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await request("/api/admin/family/update", {
          method: "POST",
          body: JSON.stringify({
            family_id: relative.id,
            full_name: nameInput.value,
            relationship: relationshipInput.value,
          }),
        });
        await refreshRecords();
      } catch (error) {
        window.alert(error.message);
      }
    });
    actions.append(edit);
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      try {
        await request(`/api/admin/family/${relative.id}`, { method: "DELETE" });
        await refreshRecords();
      } catch (error) {
        window.alert(error.message);
      }
    });
    actions.append(remove);
    item.append(label, actions, editForm);
    familyList.append(item);
  }
}

async function imageBase64(file, message = "Menyiapkan file...") {
  return withProcessing(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }, message);
}

async function uploadImage(file, kind, extra = {}) {
  return request("/api/admin/media", {
    method: "POST",
    body: JSON.stringify({ kind, content_type: file.type, content_base64: await imageBase64(file, "Menyiapkan gambar..."), ...extra }),
  });
}

async function deleteAdminMedia(kind, extra, confirmation) {
  if (!window.confirm(confirmation)) return false;
  await request("/api/admin/media", {
    method: "DELETE",
    body: JSON.stringify({ kind, ...extra }),
  });
  return true;
}

async function uploadNewsImage(articleId, file) {
  return withProcessing(async () => {
    const response = await fetch(`/api/admin/news/${articleId}/image`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    return readApiResponse(response, "Foto berita tidak dapat diunggah.");
  }, "Mengunggah foto berita...");
}

// PANEL PENGELOLA: navigasi dan kontrol sesuai jabatan.
function setAdminMode(enabled, user = null, forcePasswordChange = false) {
  isAdmin = enabled;
  currentUser = enabled ? (user || currentUser) : null;
  const profileName = currentUser?.display_name?.trim() || currentUser?.username || "Pengguna";
  document.querySelector("#admin-profile-name").textContent = profileName;
  document.querySelector("#admin-profile-role").textContent = currentUser?.role || "Pengelola";
  document.querySelector("#admin-profile-menu-name").textContent = profileName;
  document.querySelector("#admin-profile-menu-role").textContent = currentUser?.role || "Pengelola";
  document.querySelector("#admin-profile-initials").textContent = profileName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  document.querySelector("#admin-header-account").hidden = !enabled;
  document.querySelector(".close-button").hidden = enabled;
  document.querySelector("#admin-profile-menu").hidden = true;
  document.querySelector("#admin-profile-toggle").setAttribute("aria-expanded", "false");
  const mustChangePassword = Boolean(enabled && (forcePasswordChange || currentUser?.force_password_change));
  const isResident = Boolean(enabled && currentUser?.role === "Warga" && !mustChangePassword);
  document.body.classList.toggle("admin-authenticated", enabled && !mustChangePassword);
  loginForm.hidden = enabled;
  document.querySelector("#resident-register-form").hidden = enabled || isAdminPage;
  document.querySelector("#change-password-form").hidden = !mustChangePassword;
  managerPanel.hidden = !enabled || mustChangePassword || isResident;
  document.querySelector("#resident-dashboard").hidden = !isResident;
  document.querySelector("#resident-dashboard-name").textContent = profileName;
  document.querySelector("#resident-dashboard-username").textContent = currentUser?.username || "";
  if (isResident) window.loadResidentRegistrations?.();
  document.querySelector("#dialog-title").textContent = mustChangePassword
    ? "Ganti Kata Sandi Awal"
    : isResident ? "Dashboard Warga" : enabled ? "Kelola Daftar Warga" : "Masuk Pengelola";
  if (!enabled || mustChangePassword) return;
  const role = currentUser?.role || "Staff";
  const isSuperAdmin = role === "Super Admin";
  const permissions = new Set(currentUser?.permissions || rolePermissionDefaults[role] || []);
  const contributionImportOption = importDestinationSelect.querySelector('option[value="contributions"]');
  contributionImportOption.hidden = !permissions.has("payments");
  if (!permissions.has("payments") && importDestinationSelect.value === "contributions") {
    importDestinationSelect.value = "records";
    importDestination = "records";
    updateImportDestinationControls();
  }
  const canManageRecords = permissions.has("records");
  document.querySelector('#record-form input[name="publish_address"]').closest("label").hidden = role === "Staff";
  document.querySelector("#staff-address-hint").hidden = role !== "Staff";
  document.querySelector('[data-admin-group="registrations"]').hidden = !permissions.has("registration");
  document.querySelector('[data-admin-group="import"]').hidden = !permissions.has("import");
  document.querySelector('[data-admin-group="news"]').hidden = !permissions.has("news");
  document.querySelector('[data-admin-group="contacts"]').hidden = !permissions.has("contacts");
  document.querySelector('[data-admin-group="media"]').hidden = !permissions.has("media") && !permissions.has("typography") && !permissions.has("maintenance");
  document.querySelector('[data-admin-group="program"]').hidden = !permissions.has("program");
  document.querySelector('[data-admin-group="finance"]').hidden = !permissions.has("finance") && !permissions.has("payments");
  const canManagePortraits = permissions.has("family") && role !== "Staff";
  document.querySelector("#family-task-panel").hidden = !canManagePortraits;
  const editPortraitField = document.querySelector("#edit-record-portrait-field");
  editPortraitField.hidden = !canManagePortraits;
  editPortraitField.disabled = !canManagePortraits;
  document.querySelector("#record-portrait-label").hidden = !canManagePortraits;
  document.querySelector("#record-publish-portrait-label").hidden = !canManagePortraits;
  document.querySelector("#record-portrait-hint").hidden = !canManagePortraits;
  document.querySelector('[data-admin-group="users"]').hidden = !permissions.has("users");
  document.querySelector("#permissions-task-panel").hidden = !isSuperAdmin;
  document.querySelector("#edit-record-form").hidden = true;
  document.querySelector(".export-warning").hidden = !permissions.has("export");
  document.querySelector(".export-button").hidden = !permissions.has("export");
  if (permissions.has("users")) loadAdminUsers();
  const activeTab = document.querySelector(".admin-tab.active");
  const activeGroup = activeTab?.closest(".admin-nav-group");
  setAdminTab(activeGroup?.hidden ? "records" : activeTab?.dataset.adminTab || "records", false, false);
}

// AKUN: daftar dan aksi khusus Super Admin.
async function loadAdminUsers() {
  const error = document.querySelector("#users-error");
  error.textContent = "";
  try {
    const payload = await request("/api/admin/users");
    adminUsers = payload.users;
    renderAdminUsers(payload.users);
    renderPermissionEditorUsers();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
}

function renderPermissionEditorUsers() {
  const select = document.querySelector("#permission-user-select");
  if (!select) return;
  const selected = select.value;
  select.replaceChildren(new Option("Pilih Pengguna", ""));
  adminUsers.forEach((user) => select.add(new Option(`${user.display_name} · ${user.role}`, String(user.id))));
  if (adminUsers.some((user) => String(user.id) === selected)) select.value = selected;
  showPermissionEditor();
}

function showPermissionEditor() {
  const user = adminUsers.find((item) => String(item.id) === document.querySelector("#permission-user-select")?.value);
  const editor = document.querySelector("#permission-editor");
  if (!editor) return;
  editor.hidden = !user;
  if (!user) return;
  const permissions = new Set(user.permissions || rolePermissionDefaults[user.role] || []);
  document.querySelectorAll("[data-admin-permission]").forEach((checkbox) => {
    checkbox.checked = permissions.has(checkbox.dataset.adminPermission);
  });
  document.querySelector("#permission-editor-error").textContent = "";
}

function renderAdminUsers(users) {
  const list = document.querySelector("#admin-user-list");
  list.replaceChildren();
  users.forEach((user, index) => {
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = String(index + 1).padStart(2, "0");
    const userCell = document.createElement("td");
    const userMain = document.createElement("div");
    userMain.className = "user-main";
    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    if (user.avatar_url) {
      const image = document.createElement("img");
      image.src = user.avatar_url;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => { image.hidden = true; });
      avatar.append(image);
    } else {
      avatar.textContent = user.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    }
    const userCopy = document.createElement("span");
    userCopy.className = "user-main-copy";
    const name = document.createElement("strong");
    name.textContent = user.display_name;
    const username = document.createElement("small");
    username.textContent = `${user.username}${user.force_password_change ? " · Wajib Ganti Sandi" : ""}`;
    userCopy.append(name, username);
    userMain.append(avatar, userCopy);
    userCell.append(userMain);

    const phone = document.createElement("td");
    phone.textContent = user.phone || "—";
    const email = document.createElement("td");
    email.textContent = user.email || "—";
    const levelCell = document.createElement("td");
    const role = document.createElement("select");
    role.className = "user-level-select";
    role.setAttribute("aria-label", `Level ${user.username}`);
    for (const value of ["Staff", "Admin", "Super Admin"]) role.add(new Option(value, value));
    if (!["Staff", "Admin", "Super Admin"].includes(user.role)) role.add(new Option(user.role, user.role));
    role.value = user.role;
    levelCell.append(role);

    const statusCell = document.createElement("td");
    const activeLabel = document.createElement("label");
    activeLabel.className = "user-status";
    const active = document.createElement("input");
    active.type = "checkbox";
    active.checked = Boolean(user.active);
    activeLabel.append(active, document.createTextNode(user.active ? "Aktif" : "Nonaktif"));
    statusCell.append(activeLabel);

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "user-actions";
    const editProfile = document.createElement("button");
    editProfile.className = "edit-button";
    editProfile.type = "button";
    editProfile.textContent = "Edit";
    editProfile.setAttribute("aria-label", `Edit data ${user.username}`);
    editProfile.addEventListener("click", () => openUserDialog(user));
    const save = document.createElement("button");
    save.className = "edit-button";
    save.type = "button";
    save.textContent = "Simpan";
    save.addEventListener("click", async () => {
      try {
        await request("/api/admin/users/update", {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, display_name: user.display_name, role: role.value, active: active.checked }),
        });
        await loadAdminUsers();
      } catch (error) {
        document.querySelector("#users-error").textContent = error.message;
      }
    });
    const newPassword = document.createElement("input");
    newPassword.type = "password";
    newPassword.minLength = 1;
    newPassword.className = "reset-password-input";
    newPassword.placeholder = "Sandi Baru";
    newPassword.autocomplete = "new-password";
    newPassword.setAttribute("aria-label", `Sandi baru ${user.username}`);
    const reset = document.createElement("button");
    reset.className = "text-button";
    reset.type = "button";
    reset.textContent = "Reset";
    reset.disabled = user.id === currentUser?.id;
    reset.addEventListener("click", async () => {
      try {
        await request("/api/admin/users/reset-password", {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, new_password: newPassword.value }),
        });
        await loadAdminUsers();
      } catch (error) {
        document.querySelector("#users-error").textContent = error.message;
      }
    });
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.disabled = user.id === currentUser?.id;
    remove.title = remove.disabled ? "Akun Yang Sedang Digunakan Tidak Dapat Dihapus" : "Hapus Akun Ini Secara Permanen";
    remove.setAttribute("aria-label", `Hapus akun ${user.username}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus akun ${user.display_name} (${user.username}) secara permanen?`)) return;
      try {
        await request(`/api/admin/users/${user.id}`, { method: "DELETE" });
        await loadAdminUsers();
      } catch (error) {
        document.querySelector("#users-error").textContent = error.message;
      }
    });
    actions.append(newPassword, editProfile, save, reset, remove);
    actionsCell.append(actions);
    row.append(number, userCell, phone, email, levelCell, statusCell, actionsCell);
    list.append(row);
  });
}

function localDateTimeInputValue(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const newsForm = document.querySelector("#news-form");
const newsFormTitle = document.querySelector("#news-admin-title");
const newsSubmitButton = document.querySelector("#news-submit");
const newsCancelButton = document.querySelector("#news-cancel-edit");
const newsError = document.querySelector("#news-error");
const newsResult = document.querySelector("#news-result");
const newsImageInput = newsForm.querySelector('input[name="image"]');
const newsImagePreview = document.querySelector("#news-image-preview");
let newsImagePreviewUrl = "";
let editingNewsId = null;
newsForm.elements.uploaded_at.value = localDateTimeInputValue();

function showNewsImagePreview(imageUrl = "", message = "Foto Opsional · PNG, JPG, WebP") {
  const nextObjectUrl = imageUrl.startsWith("blob:") ? imageUrl : "";
  if (newsImagePreviewUrl && newsImagePreviewUrl !== nextObjectUrl) URL.revokeObjectURL(newsImagePreviewUrl);
  newsImagePreviewUrl = nextObjectUrl;
  newsImagePreview.replaceChildren();
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "Pratinjau Foto Berita";
    newsImagePreview.append(image, document.createTextNode(message));
  } else {
    newsImagePreview.textContent = message;
  }
}

newsImageInput.addEventListener("change", () => {
  const file = newsImageInput.files[0];
  if (!file) {
    showNewsImagePreview();
    return;
  }
  showNewsImagePreview(URL.createObjectURL(file), file.name);
});

async function loadAdminPayments() {
  const container = document.querySelector("#admin-payments-list");
  container.replaceChildren(document.createTextNode("Memuat pembayaran…"));
  try {
    const { payments: items } = await request("/api/admin/payments");
    container.replaceChildren();
    if (!items.length) {
      container.textContent = "Belum ada bukti pembayaran yang dikirim warga.";
      return;
    }
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "admin-payment-card";
      const heading = document.createElement("div");
      heading.className = "admin-payment-card-heading";
      const name = document.createElement("strong");
      name.textContent = item.display_name;
      const status = document.createElement("span");
      status.className = `payment-status payment-status-${item.status === "Terverifikasi" ? "verified" : item.status === "Ditolak" ? "rejected" : "pending"}`;
      status.textContent = item.status;
      heading.append(name, status);
      const detail = document.createElement("p");
      detail.textContent = `${item.period} · ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(item.amount)} · ${item.paid_at} · ${item.method}`;
      const proof = document.createElement("a");
      proof.href = item.proof_url;
      proof.target = "_blank";
      proof.rel = "noopener";
      proof.textContent = "Lihat bukti pembayaran";
      card.append(heading, detail, proof);
      if (item.status === "Menunggu Verifikasi") {
        const note = document.createElement("input");
        note.className = "admin-payment-note";
        note.placeholder = "Catatan (opsional; wajib diisi jika menolak)";
        note.maxLength = 500;
        const actions = document.createElement("div");
        actions.className = "admin-payment-actions";
        for (const [decision, label] of [["Terverifikasi", "Setujui"], ["Ditolak", "Tolak"]]) {
          const button = document.createElement("button");
          button.className = decision === "Terverifikasi" ? "primary-button" : "text-button";
          button.type = "button";
          button.textContent = label;
          button.addEventListener("click", async () => {
            if (decision === "Ditolak" && !note.value.trim()) {
              note.setCustomValidity("Isi alasan penolakan agar warga tahu yang perlu diperbaiki.");
              note.reportValidity();
              return;
            }
            note.setCustomValidity("");
            button.disabled = true;
            try {
              await request("/api/admin/payments/review", {
                method: "POST",
                body: JSON.stringify({ payment_id: item.id, decision, note: note.value.trim() }),
              });
              await loadAdminPayments();
            } catch (error) {
              button.disabled = false;
              note.setCustomValidity(error.message);
              note.reportValidity();
            }
          });
          actions.append(button);
        }
        card.append(note, actions);
      } else if (item.admin_note) {
        const note = document.createElement("p");
        note.className = "admin-payment-review-note";
        note.textContent = `Catatan: ${item.admin_note}`;
        card.append(note);
      }
      container.append(card);
    }
  } catch (error) {
    container.textContent = error.message;
  }
}

const contributionMoney = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function contributionValue(label, value) {
  const item = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value || "Belum diisi";
  item.append(term, detail);
  return item;
}

function matchesContributionStatus(resident, status) {
  const gender = String(resident.gender || "").trim().toUpperCase();
  const relationship = String(resident.relationship || "").trim().toUpperCase();
  switch (status) {
    case "paid": return resident.paid_this_month === true;
    case "unpaid": return resident.paid_this_month !== true;
    case "female": return gender === "P" || gender.startsWith("PEREMPUAN") || gender === "WANITA";
    case "male": return gender === "L" || gender.startsWith("LAKI") || gender === "PRIA";
    case "head": return relationship.includes("KEPALA");
    default: return true;
  }
}

function renderContributionResidents() {
  // Hapus filter keluarga sebelumnya jika ada
  const prevSummary = document.querySelector('.family-filter-summary');
  if (prevSummary) prevSummary.remove();

  // Reset to full list, then apply family filter if needed
  contributionResidents = originalContributionResidents;
  // Filter warga berdasarkan hubungan keluarga (dari klik badge)
  const selectedStatus = contributionStatusKey;
  if (familyFilterKK) {
    contributionResidents = contributionResidents.filter(r => r.family_card_number === familyFilterKK);
  }
  // Statistik kartu dihitung dari data sebelum filter status diterapkan
  const maleCount = contributionResidents.filter((r) => matchesContributionStatus(r, "male")).length;
  const femaleCount = contributionResidents.filter((r) => matchesContributionStatus(r, "female")).length;
  const headCount = contributionResidents.filter((r) => matchesContributionStatus(r, "head")).length;
  // Apply status filter
  contributionResidents = contributionResidents.filter((resident) => matchesContributionStatus(resident, selectedStatus));

  const container = document.querySelector("#contribution-resident-list");
  const query = document.querySelector("#contribution-search").value.trim().toLocaleLowerCase("id-ID");
  const filter = contributionStatusKey;
  const paidCount = contributionResidents.filter((resident) => resident.paid_this_month).length;
  const totalAmount = contributionResidents.reduce((total, resident) => total + resident.total_paid, 0);
  document.querySelector("#contribution-resident-count").textContent = new Intl.NumberFormat("id-ID").format(originalContributionResidents.length);
  document.querySelector("#contribution-paid-count").textContent = new Intl.NumberFormat("id-ID").format(paidCount);
  document.querySelector("#contribution-total-amount").textContent = contributionMoney.format(totalAmount);
  document.querySelector("#contribution-male-count").textContent = new Intl.NumberFormat("id-ID").format(maleCount);
  document.querySelector("#contribution-female-count").textContent = new Intl.NumberFormat("id-ID").format(femaleCount);
  document.querySelector("#contribution-head-count").textContent = new Intl.NumberFormat("id-ID").format(headCount);
  [["#contribution-male-card", "male"], ["#contribution-female-card", "female"], ["#contribution-head-card", "head"]].forEach(([selector, key]) => {
    const card = document.querySelector(selector);
    if (card) card.setAttribute("aria-pressed", String(selectedStatus === key));
  });

  const visible = contributionResidents.filter((resident) => {
    const matchesQuery = !query || [resident.full_name, resident.national_id_number, resident.address, resident.rt, resident.rw, ...residentRtRwVariants(resident.rt, resident.rw)]
      .some((value) => String(value || "").toLocaleLowerCase("id-ID").includes(query));
    const matchesStatus = matchesContributionStatus(resident, filter);
    return matchesQuery && matchesStatus;
  });
  container.replaceChildren();
  if (familyFilterKK && contributionResidents.length) {
    const first = contributionResidents[0];
    const summary = document.createElement('div');
    summary.className = 'family-filter-summary';
    summary.innerHTML = `
      <div style="background: var(--surface); border: var(--tp-bw) solid var(--line); padding: 12px; margin-bottom: 12px; border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 600; color: var(--ink);">Keluarga (KK: ${first.family_card_number || '-'} ${first.national_id_number ? '| NIK: ' + first.national_id_number : ''}</span>
          <button style="margin-left: auto; padding: 4px 8px; font-size: calc((11px) * var(--site-font-scale, 1));" onclick="familyFilterKK=null; contributionResidentsPage=0; renderContributionResidents()">×</button>
        </div>
        <table style="width:100%; border-collapse: collapse; margin-top: 8px;">
          <thead>
            <tr style="background: var(--surface-soft);">
              <th style="padding: 4px; border: var(--tp-bw) solid var(--line); text-align: left; font-size: calc((11px) * var(--site-font-scale, 1));">Nama</th>
              <th style="padding: 4px; border: var(--tp-bw) solid var(--line); text-align: left; font-size: calc((11px) * var(--site-font-scale, 1));">Hubungan</th>
              <th style="padding: 4px; border: var(--tp-bw) solid var(--line); text-align: left; font-size: calc((11px) * var(--site-font-scale, 1));">No HP</th>
              <th style="padding: 4px; border: var(--tp-bw) solid var(--line); text-align: left; font-size: calc((11px) * var(--site-font-scale, 1));">RT/RW</th>
            </tr>
          </thead>
          <tbody>
            ${contributionResidents.map(r => `
              <tr>
                <td style="padding: 4px; border: var(--tp-bw) solid var(--line);"><strong>${r.full_name}</strong></td>
                <td style="padding: 4px; border: var(--tp-bw) solid var(--line);"><span class="contribution-relationship-badge${(r.relationship||'').toUpperCase().includes('KEPALA') ? ' is-head' : ''}">${r.relationship||'-'}</span></td>
                <td style="padding: 4px; border: var(--tp-bw) solid var(--line);">${r.phone||'-'}</td>
                <td style="padding: 4px; border: var(--tp-bw) solid var(--line);">${r.rt||'-'} / ${r.rw||'-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    container.appendChild(summary);
  }
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "contribution-empty-state";
    empty.textContent = contributionResidents.length ? "Tidak ada warga yang cocok dengan pencarian ini." : "Belum ada data warga iuran. Tambahkan warga untuk mulai mencatat setoran.";
    container.append(empty);
    return;
  }
  const contributionPageCount = Math.max(1, Math.ceil(visible.length / CONTRIBUTION_PAGE_SIZE));
  contributionResidentsPage = Math.min(contributionResidentsPage, contributionPageCount - 1);
  const contributionPageStart = contributionResidentsPage * CONTRIBUTION_PAGE_SIZE;
  const pagedResidents = visible.slice(contributionPageStart, contributionPageStart + CONTRIBUTION_PAGE_SIZE);
  pagedResidents.forEach((resident, index) => {
    const card = document.createElement("article");
    card.className = "contribution-resident-card";
    card.dataset.residentId = String(resident.id);
    card.style.setProperty("--contribution-delay", `${Math.min(index, 10) * 45}ms`);
    const heading = document.createElement("div");
    heading.className = "contribution-resident-heading";
    const avatar = document.createElement("span");
    avatar.className = "contribution-resident-avatar";
    if (resident.photo_url) {
      const photo = document.createElement("img");
      photo.src = resident.photo_url;
      photo.alt = `Foto ${resident.full_name}`;
      avatar.append(photo);
    } else {
      avatar.textContent = resident.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "W";
    }
    const identity = document.createElement("div");
    identity.className = "contribution-resident-identity";
    const name = document.createElement("h3");
    name.textContent = resident.full_name;
    // Tampilkan hubungan jika ada
    let relationshipBadge = "";
    if (resident.relationship && resident.relationship.trim()) {
      const rel = resident.relationship.trim();
      const isHead = rel.toUpperCase().includes("KEPALA");
      relationshipBadge = `<span class="contribution-relationship-badge${isHead ? " is-head" : ""}" title="${rel}">${isHead ? "Kepala Kel" : rel}</span>`;
    }
    const areaText = `${resident.rt ? `RT ${String(resident.rt).padStart(3, "0")}` : "RT belum diatur"} / ${resident.rw ? `RW ${String(resident.rw).padStart(3, "0")}` : "RW belum diatur"}`;
    identity.innerHTML = `${name.outerHTML}${relationshipBadge}<p class="contribution-resident-area">${areaText}</p><span class="contribution-status ${resident.paid_this_month ? "is-paid" : "is-unpaid"}">${resident.paid_this_month ? "Iuran bulan ini tercatat" : "Belum ada iuran bulan ini"}</span>`;
    const relationshipBadgeSpan = identity.querySelector('.contribution-relationship-badge');
    if (relationshipBadgeSpan) {
      relationshipBadgeSpan.addEventListener('click', async (e) => {
        e.stopPropagation();
        await openFamilyDialog(resident.family_card_number, resident);
      });
    }
    const summary = document.createElement("div");
    summary.className = "contribution-resident-total";
    const totalLabel = document.createElement("span");
    totalLabel.textContent = "Nominal Total";
    const total = document.createElement("strong");
    total.textContent = contributionMoney.format(resident.total_paid);
    const months = document.createElement("small");
    months.textContent = `${resident.paid_months} bulan tercatat`;
    const lastPaid = document.createElement("small");
    lastPaid.textContent = resident.last_paid_at ? `Terakhir ${formatDate(resident.last_paid_at)}` : "Belum ada pembayaran";
    summary.append(totalLabel, total, months, lastPaid);
    heading.append(avatar, identity, summary);

    const actions = document.createElement("div");
    actions.className = "contribution-resident-actions";
    const addPayment = document.createElement("button");
    addPayment.type = "button";
    addPayment.className = "primary-button";
    addPayment.textContent = "Tambah Iuran";
    addPayment.addEventListener("click", () => openContributionPaymentDialog(resident));
    const editResident = document.createElement("button");
    editResident.type = "button";
    editResident.className = "action-button";
    editResident.textContent = "Edit Data";
    editResident.addEventListener("click", () => openContributionResidentDialog(resident));
    const historyButton = document.createElement("button");
    historyButton.type = "button";
    historyButton.className = "action-button";
    historyButton.textContent = "Riwayat Iuran";
    historyButton.addEventListener("click", () => openContributionHistoryDialog(resident));
    const deleteResident = document.createElement("button");
    deleteResident.type = "button";
    deleteResident.className = "action-button delete-resident-btn";
    deleteResident.textContent = "Hapus";
    deleteResident.addEventListener("click", async () => {
      if (confirm(`Yakin menghapus data warga "${resident.full_name}" dari daftar iuran?`)) {
        try {
          await request("/api/admin/contribution-residents", { method: "DELETE", body: JSON.stringify({ resident_id: resident.id }) });
          await loadContributionResidents();
        } catch (error) {
          document.querySelector("#contribution-list-status").textContent = error.message;
        }
      }
    });
    actions.append(addPayment, editResident, historyButton, deleteResident);
    card.append(heading, actions);
    container.append(card);
  });
  const contributionPageNumbers = document.querySelector("#contribution-residents-page-numbers");
  if (contributionPageNumbers) {
    contributionPageNumbers.replaceChildren();
    const maxVisiblePages = 7;
    let startPage = 0;
    if (contributionPageCount > maxVisiblePages) {
      startPage = Math.min(Math.max(contributionResidentsPage - 3, 0), contributionPageCount - maxVisiblePages);
    }
    const endPage = Math.min(startPage + maxVisiblePages, contributionPageCount);
    for (let pageIndex = startPage; pageIndex < endPage; pageIndex += 1) {
      const pageButton = document.createElement("button");
      pageButton.className = "record-page-number";
      pageButton.type = "button";
      pageButton.role = "listitem";
      pageButton.textContent = String(pageIndex + 1);
      pageButton.setAttribute("aria-label", `Buka halaman ${pageIndex + 1}`);
      pageButton.setAttribute("aria-current", String(pageIndex === contributionResidentsPage));
      pageButton.addEventListener("click", () => {
        contributionResidentsPage = pageIndex;
        renderContributionResidents();
      });
      contributionPageNumbers.append(pageButton);
    }
  }
  const contributionPrev = document.querySelector("#contribution-residents-previous");
  const contributionNext = document.querySelector("#contribution-residents-next");
  if (contributionPrev) contributionPrev.disabled = contributionResidentsPage === 0;
  if (contributionNext) contributionNext.disabled = contributionResidentsPage >= contributionPageCount - 1;
}

async function loadContributionResidents() {
  const status = document.querySelector("#contribution-list-status");
  status.textContent = "Memuat data warga dan iuran...";
  try {
    const payload = await request("/api/admin/contribution-residents");
    const nextResidents = payload.residents || [];
    const signature = JSON.stringify(nextResidents);
    if (signature !== contributionResidentsSignature) {
      contributionResidents = nextResidents;
      originalContributionResidents = nextResidents;
      contributionResidentsSignature = signature;
      renderContributionResidents();
    }
    status.textContent = `Data diperbarui ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}.`;
  } catch (error) {
    status.textContent = error.message;
  }
}

function openContributionResidentDialog(resident = null) {
  const dialog = document.querySelector("#contribution-resident-dialog");
  const form = document.querySelector("#contribution-resident-form");
  dialog.scrollTop = 0;
  form.reset();
  document.querySelector("#contribution-resident-error").textContent = "";
  document.querySelector("#contribution-resident-dialog-title").textContent = resident ? "Edit Data Warga" : "Tambah Warga";
  form.elements.resident_id.value = resident?.id || "";
  for (const field of ["full_name", "rt", "rw", "birth_date", "payment_recipient", "address", "family_card_number", "national_id_number", "birthplace", "religion", "gender", "relationship", "phone", "residence_status"]) {
    if (resident) form.elements[field].value = resident[field] || "";
  }
  if (!dialog.open) dialog.showModal();
  form.elements.full_name.focus({ preventScroll: true });
}

function openContributionHistoryDialog(resident) {
  const dialog = document.querySelector("#contribution-history-dialog");
  const body = document.querySelector("#contribution-history-body");
  body.replaceChildren();
  document.querySelector("#contribution-history-title").textContent = `Riwayat Iuran - ${resident.full_name}`;
  if (resident.photo_url) {
    const removePhoto = document.createElement("button");
    removePhoto.type = "button";
    removePhoto.className = "text-button contribution-remove-photo";
    removePhoto.textContent = "Hapus Foto Warga";
    removePhoto.addEventListener("click", async () => {
      try {
        const removed = await deleteAdminMedia("contribution_resident", { resident_id: resident.id }, `Hapus foto ${resident.full_name}?`);
        if (removed) {
          dialog.close();
          await loadContributionResidents();
        }
      } catch (error) {
        document.querySelector("#contribution-list-status").textContent = error.message;
      }
    });
    body.append(removePhoto);
  }
  const historyHeading = document.createElement("h4");
  historyHeading.textContent = `Riwayat Setoran (${resident.payments.length})`;
  body.append(historyHeading);
  if (resident.payments.length) {
    const history = document.createElement("ul");
    history.className = "contribution-payment-history";
    for (const payment of resident.payments) {
      const row = document.createElement("li");
      const description = document.createElement("div");
      description.className = "contribution-payment-description";
      const period = document.createElement("strong");
      period.textContent = payment.period;
      const dateLabel = document.createElement("span");
      dateLabel.textContent = payment.paid_at ? formatDate(payment.paid_at) : "Tanggal belum diisi";
      const amount = document.createElement("b");
      amount.textContent = contributionMoney.format(payment.amount);
      const status = document.createElement("span");
      status.className = `payment-status payment-status-${payment.status === "Terverifikasi" ? "verified" : payment.status === "Ditolak" ? "rejected" : "pending"}`;
      status.textContent = payment.status;
      description.append(period, dateLabel, amount, status);
      row.append(description);
      if (payment.note) {
        const note = document.createElement("small");
        note.textContent = payment.note;
        row.append(note);
      }
      if (payment.proof_url) {
        const proof = document.createElement("a");
        proof.href = payment.proof_url;
        proof.target = "_blank";
        proof.rel = "noopener noreferrer";
        proof.textContent = "Lihat bukti";
        row.append(proof);
      }
      if (payment.editable || payment.deletable) {
        const paymentActions = document.createElement("div");
        paymentActions.className = "contribution-payment-actions";
        if (payment.editable) {
          const editPayment = document.createElement("button");
          editPayment.type = "button";
          editPayment.className = "action-button";
          editPayment.textContent = "Edit";
          editPayment.addEventListener("click", () => openContributionPaymentDialog(resident, payment));
          paymentActions.append(editPayment);
        }
        if (payment.deletable) {
          const deletePayment = document.createElement("button");
          deletePayment.type = "button";
          deletePayment.className = "text-button";
          deletePayment.textContent = "Hapus";
          deletePayment.addEventListener("click", async () => {
            if (!window.confirm(`Hapus setoran ${payment.period} untuk ${resident.full_name}?`)) return;
            try {
              await request(`/api/admin/contribution-payments/${payment.id}`, { method: "DELETE" });
              dialog.close();
              await loadContributionResidents();
            } catch (error) {
              document.querySelector("#contribution-list-status").textContent = error.message;
            }
          });
          paymentActions.append(deletePayment);
        }
        row.append(paymentActions);
      }
      history.append(row);
    }
    body.append(history);
  } else {
    const noHistory = document.createElement("p");
    noHistory.className = "form-hint";
    noHistory.textContent = "Belum ada transaksi iuran yang tercatat.";
    body.append(noHistory);
  }
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  document.querySelector("#contribution-history-close").focus({ preventScroll: true });
}

function openFamilyDialog(familyCardNumber, currentResident) {
  const dialog = document.querySelector('#family-dialog');
  const tbody = document.querySelector('#family-table-body');
  tbody.innerHTML = '';
  let familyMembers;
  if (!familyCardNumber) {
    familyMembers = currentResident ? [currentResident] : [];
  } else {
    familyMembers = originalContributionResidents.filter(r => r.family_card_number === familyCardNumber);
  }
  // Jika currentResident bukan bagian dari array (misalnya sudah diedit), tambahkan manual
  if (currentResident && !familyMembers.some(r => r.id === currentResident.id)) {
    familyMembers.push(currentResident);
  }
  familyMembers.sort((a, b) => {
    const relA = (a.relationship || '').toUpperCase();
    const relB = (b.relationship || '').toUpperCase();
    const score = (text) => (text.includes('KEPALA') ? 0 : text.includes('ISTERI') ? 1 : text.includes('ANAK') ? 2 : 3);
    const dateA = a.birth_date || '9999-12-31'; // treat missing as latest
    const dateB = b.birth_date || '9999-12-31';
    return score(relA) - score(relB) || dateA.localeCompare(dateB);
  });
  document.querySelector('#family-dialog-title').textContent = `Keluarga - Nomor KK: ${familyCardNumber || '-'}`;
  familyMembers.forEach((member, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${member.full_name || '-'}</td>
      <td>${member.national_id_number || '-'}</td>
      <td>${member.birthplace || '-'}</td>
      <td>${member.birth_date ? new Intl.DateTimeFormat('id-ID').format(new Date(member.birth_date)) : '-'}</td>
      <td>${member.gender || '-'}</td>
      <td>${member.relationship || '-'}</td>
      <td>${member.residence_status || '-'}</td>
    `;
    tbody.appendChild(row);
  });
  if (!dialog.open) dialog.showModal();
}

function openContributionPaymentDialog(resident, payment = null) {
  const dialog = document.querySelector("#contribution-payment-dialog");
  const form = document.querySelector("#contribution-payment-form");
  form.reset();
  document.querySelector("#contribution-payment-error").textContent = "";
  document.querySelector("#contribution-payment-title").textContent = payment ? "Edit Iuran" : "Tambah Iuran";
  document.querySelector("#contribution-payment-resident").textContent = resident.full_name;
  form.elements.payment_id.value = payment?.id || "";
  form.elements.resident_id.value = resident.id;
  form.elements.payment_source.value = payment?.source || "admin";
  form.elements.note.closest("label").hidden = payment?.source === "account";
  const today = new Date();
  const isoToday = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  form.elements.period.value = payment?.period || isoToday.slice(0, 7);
  form.elements.paid_at.value = payment?.paid_at || isoToday;
  form.elements.amount.value = payment?.amount || "";
  form.elements.note.value = payment?.source === "account" ? "" : payment?.note || "";
  // The month input sits partway down the form. Focusing it normally scrolls
  // the dialog itself and hides its title/close button on smaller screens.
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  document.querySelector("#contribution-payment-close").focus({ preventScroll: true });
}

document.querySelector("#add-contribution-resident").addEventListener("click", () => openContributionResidentDialog());
for (const [dialogId, closeIds] of [
  ["contribution-resident-dialog", ["contribution-resident-close", "contribution-resident-cancel"]],
  ["contribution-payment-dialog", ["contribution-payment-close", "contribution-payment-cancel"]],
]) {
  const dialog = document.querySelector(`#${dialogId}`);
  for (const id of closeIds) document.querySelector(`#${id}`).addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("cancel", () => dialog.close());
}
document.querySelector("#contribution-search").addEventListener("input", () => { contributionResidentsPage = 0; renderContributionResidents(); });
document.querySelector("#contribution-status-filter").addEventListener("change", () => { contributionStatusKey = document.querySelector("#contribution-status-filter").value; contributionResidentsPage = 0; renderContributionResidents(); });
[["#contribution-male-card", "male"], ["#contribution-female-card", "female"], ["#contribution-head-card", "head"]].forEach(([selector, key]) => {
  document.querySelector(selector)?.addEventListener("click", () => {
    contributionStatusKey = contributionStatusKey === key ? "all" : key;
    const select = document.querySelector("#contribution-status-filter");
    if (select) select.value = contributionStatusKey === "all" || contributionStatusKey === "paid" || contributionStatusKey === "unpaid" ? contributionStatusKey : "all";
    contributionResidentsPage = 0;
    renderContributionResidents();
  });
});

document.querySelector("#contribution-residents-previous")?.addEventListener("click", () => { contributionResidentsPage = Math.max(0, contributionResidentsPage - 1); renderContributionResidents(); });
document.querySelector("#contribution-residents-next")?.addEventListener("click", () => { contributionResidentsPage += 1; renderContributionResidents(); });

document.querySelector("#contribution-resident-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#contribution-resident-error");
  error.textContent = "";
  const formData = new FormData(form);
  const photo = formData.get("photo");
  const payload = Object.fromEntries(formData);
  payload.resident_id = payload.resident_id ? Number(payload.resident_id) : null;
  delete payload.photo;
  if (photo instanceof File && photo.size > 5 * 1024 * 1024) {
    error.textContent = "Ukuran foto maksimal 5 MB.";
    return;
  }
  try {
    const saved = await request("/api/admin/contribution-residents", { method: "POST", body: JSON.stringify(payload) });
    let message = payload.resident_id ? "Data warga berhasil diperbarui." : "Data warga berhasil ditambahkan.";
    if (photo instanceof File && photo.size) {
      try {
        await uploadImage(photo, "contribution_resident", { resident_id: saved.id });
      } catch (uploadError) {
        message += ` Foto belum tersimpan: ${uploadError.message}`;
      }
    }
    document.querySelector("#contribution-resident-dialog").close();
    await loadContributionResidents();
    document.querySelector("#contribution-list-status").textContent = message;
  } catch (submitError) {
    error.textContent = submitError.message;
  }
});

document.querySelector("#contribution-payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#contribution-payment-error");
  error.textContent = "";
  const values = Object.fromEntries(new FormData(form));
  values.payment_id = values.payment_id ? Number(values.payment_id) : null;
  values.resident_id = Number(values.resident_id);
  values.amount = Number(values.amount);
  try {
    await request("/api/admin/contribution-payments", { method: "POST", body: JSON.stringify(values) });
    document.querySelector("#contribution-payment-dialog").close();
    await loadContributionResidents();
    document.querySelector("#contribution-list-status").textContent = "Setoran tersimpan; total dan bulan iuran diperbarui.";
  } catch (submitError) {
    error.textContent = submitError.message;
  }
});

async function loadAdminProgramInfo() {
  const form = document.querySelector("#program-info-form");
  try {
    const result = await request("/api/program-info");
    form.elements.title.value = result.title || "";
    form.elements.content.value = result.content || "";
  } catch (error) {
    document.querySelector("#program-info-result").textContent = error.message;
  }
}

document.querySelector("#program-info-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.querySelector("#program-info-result");
  result.textContent = "Menyimpan…";
  try {
    await request("/api/admin/program-info", {
      method: "POST",
      body: JSON.stringify({ title: form.elements.title.value, content: form.elements.content.value }),
    });
    result.textContent = "Informasi program berhasil diperbarui.";
  } catch (error) {
    result.textContent = error.message;
  }
});

async function loadAdminFinance() {
  const container = document.querySelector("#admin-finance-list");
  container.replaceChildren(document.createTextNode("Memuat data keuangan…"));
  try {
    const { entries } = await request("/api/admin/finance");
    container.replaceChildren();
    if (!entries.length) {
      container.textContent = "Belum ada catatan keuangan.";
      return;
    }
    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "admin-payment-card";
      const heading = document.createElement("div");
      heading.className = "admin-payment-card-heading";
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const amount = document.createElement("strong");
      const isIncome = entry.income > 0;
      amount.textContent = `${isIncome ? "+" : "−"}${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(isIncome ? entry.income : entry.expense)}`;
      heading.append(title, amount);
      const detail = document.createElement("p");
      detail.textContent = `${entry.entry_date}${entry.description ? ` · ${entry.description}` : ""}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.textContent = "Hapus catatan";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Hapus catatan keuangan “${entry.title}”?`)) return;
        try {
          await request(`/api/admin/finance/${entry.id}`, { method: "DELETE" });
          await loadAdminFinance();
        } catch (error) { container.textContent = error.message; }
      });
      card.append(heading, detail, remove);
      container.append(card);
    });
  } catch (error) { container.textContent = error.message; }
}

document.querySelector("#finance-entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.querySelector("#finance-entry-result");
  result.textContent = "Menyimpan…";
  try {
    await request("/api/admin/finance", {
      method: "POST",
      body: JSON.stringify({
        entry_date: form.elements.entry_date.value,
        title: form.elements.title.value,
        description: form.elements.description.value,
        entry_type: form.elements.entry_type.value,
        amount: Number(form.elements.amount.value),
      }),
    });
    form.reset();
    form.elements.entry_date.value = new Date().toISOString().slice(0, 10);
    result.textContent = "Catatan keuangan berhasil ditambahkan.";
    await loadAdminFinance();
  } catch (error) { result.textContent = error.message; }
});

document.querySelector('#finance-entry-form [name="entry_date"]').value = new Date().toISOString().slice(0, 10);

async function loadAdminNews() {
  try {
    const payload = await request("/api/admin/news");
    renderAdminNews(payload.articles);
  } catch (error) {
    newsError.textContent = error.message;
  }
}

function renderAdminNews(articles) {
  const list = document.querySelector("#admin-news-list");
  list.replaceChildren();
  articles.forEach((article) => {
    const item = document.createElement("li");
    item.className = "admin-news-item";
    let image = null;
    if (article.image_url) {
      image = document.createElement("img");
      image.className = "admin-news-image";
      image.src = article.image_url;
      image.alt = `Foto Berita: ${article.title}`;
      image.loading = "lazy";
    }
    const copy = document.createElement("div");
    copy.className = "admin-news-copy";
    const title = document.createElement("h4");
    title.textContent = article.title;
    const headline = document.createElement("p");
    headline.className = "admin-news-headline";
    headline.textContent = article.headline;
    const excerpt = document.createElement("p");
    excerpt.className = "admin-news-excerpt";
    excerpt.textContent = article.body.length > 260 ? `${article.body.slice(0, 260)}…` : article.body;
    const metadata = document.createElement("small");
    metadata.className = "admin-news-meta";
    metadata.textContent = `${article.author} · ${formatNewsDate(article.uploaded_at)}`;
    copy.append(title, headline, excerpt, metadata);
    const actions = document.createElement("div");
    actions.className = "admin-news-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingNewsId = article.id;
      newsForm.elements.article_id.value = String(article.id);
      newsForm.elements.title.value = article.title;
      newsForm.elements.headline.value = article.headline;
      newsForm.elements.body.value = article.body;
      newsForm.elements.author.value = article.author;
      newsForm.elements.uploaded_at.value = localDateTimeInputValue(new Date(article.uploaded_at));
      showNewsImagePreview(article.image_url, article.image_url ? "Foto Saat Ini · Pilih Untuk Mengganti" : "Foto Opsional · PNG, JPG, WebP");
      const deleteImageButton = document.querySelector("#delete-news-image-button");
      deleteImageButton.dataset.articleId = String(article.id);
      deleteImageButton.hidden = !article.image_url;
      newsFormTitle.textContent = "Edit Berita";
      newsSubmitButton.textContent = "Simpan Perubahan";
      newsCancelButton.hidden = false;
      focusAdminTask("news-form", "Edit Berita");
    });
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus berita “${article.title}”?`)) return;
      try {
        await request(`/api/admin/news/${article.id}`, { method: "DELETE" });
        await loadAdminNews();
        await loadNews();
      } catch (error) {
        newsError.textContent = error.message;
      }
    });
    actions.append(edit, remove);
    if (image) item.append(image);
    item.append(copy, actions);
    list.append(item);
  });
  if (!articles.length) {
    const empty = document.createElement("li");
    empty.textContent = "Belum ada berita tersimpan.";
    list.append(empty);
  }
}

function resetNewsForm() {
  newsForm.reset();
  showNewsImagePreview();
  const deleteImageButton = document.querySelector("#delete-news-image-button");
  deleteImageButton.hidden = true;
  delete deleteImageButton.dataset.articleId;
  newsForm.elements.article_id.value = "";
  newsForm.elements.uploaded_at.value = localDateTimeInputValue();
  editingNewsId = null;
  newsFormTitle.textContent = "Tambah Berita";
  newsSubmitButton.textContent = "Simpan Berita";
  newsCancelButton.hidden = true;
  newsError.textContent = "";
}

document.querySelector("#delete-news-image-button").addEventListener("click", async () => {
  const button = document.querySelector("#delete-news-image-button");
  const articleId = Number(button.dataset.articleId);
  if (!articleId) return;
  newsError.textContent = "";
  try {
    const deleted = await deleteAdminMedia("news_image", { article_id: articleId }, "Hapus foto berita ini?");
    if (!deleted) return;
    button.hidden = true;
    delete button.dataset.articleId;
    showNewsImagePreview();
    await loadAdminNews();
    await loadNews();
  } catch (error) {
    newsError.textContent = error.message;
  }
});

newsCancelButton.addEventListener("click", () => {
  const wasEditing = editingNewsId !== null;
  resetNewsForm();
  if (wasEditing) focusAdminTask("news-saved-panel", "Berita Tersimpan");
});
newsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  newsError.textContent = "";
  newsResult.hidden = true;
  const payload = Object.fromEntries(new FormData(newsForm));
  const photo = payload.image;
  delete payload.image;
  delete payload.article_id;
  const editing = editingNewsId !== null;
  if (editing) payload.article_id = editingNewsId;
  try {
    const saved = await request(editing ? "/api/admin/news/update" : "/api/admin/news", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const articleId = editing ? editingNewsId : saved.id;
    let photoError = "";
    if (photo instanceof File && photo.size) {
      try {
        await uploadNewsImage(articleId, photo);
      } catch (uploadError) {
        photoError = `Berita tersimpan, tetapi foto gagal diunggah: ${uploadError.message}`;
      }
    }
    resetNewsForm();
    newsResult.textContent = photoError || (editing ? "Perubahan berita tersimpan." : "Berita berhasil ditambahkan.");
    newsResult.hidden = false;
    await loadAdminNews();
    await loadNews();
    if (editing) focusAdminTask("news-saved-panel", "Berita Tersimpan");
  } catch (error) {
    newsError.textContent = error.message;
  }
});

/* STRUKTUR JABATAN: urutan jabatan menentukan peringkat, dari Ketua RW ke Sieba. */
const OTHER_POSITION_LABEL = "Jabatan Lainnya";
let positionTitles = [];
let editingPositionId = null;
const positionForm = document.querySelector("#position-form");
const positionError = document.querySelector("#position-error");
const positionResult = document.querySelector("#position-result");
const positionSubmitButton = document.querySelector("#position-submit");
const positionCancelButton = document.querySelector("#position-cancel-edit");

async function loadPositionTitles() {
  try {
    const payload = await request("/api/admin/position-titles");
    positionTitles = payload.titles || [];
    renderPositionTitles();
  } catch (error) {
    positionError.textContent = error.message;
  }
}

function renderPositionTitles() {
  const list = document.querySelector("#position-list");
  list.replaceChildren();
  positionTitles.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "position-item";
    const order = document.createElement("span");
    order.className = "position-order";
    order.textContent = String(index + 1);
    const name = document.createElement("span");
    name.className = "position-name";
    name.textContent = item.title;
    const actions = document.createElement("div");
    actions.className = "admin-news-actions";
    const moveUp = document.createElement("button");
    moveUp.className = "edit-button";
    moveUp.type = "button";
    moveUp.textContent = "Naik";
    moveUp.disabled = index === 0;
    moveUp.addEventListener("click", () => reorderPositionTitles(index, index - 1));
    const moveDown = document.createElement("button");
    moveDown.className = "edit-button";
    moveDown.type = "button";
    moveDown.textContent = "Turun";
    moveDown.disabled = index === positionTitles.length - 1;
    moveDown.addEventListener("click", () => reorderPositionTitles(index, index + 1));
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingPositionId = item.id;
      positionForm.elements.title_id.value = String(item.id);
      positionForm.elements.title.value = item.title;
      positionSubmitButton.textContent = "Simpan Jabatan";
      positionCancelButton.hidden = false;
      positionResult.hidden = true;
      focusAdminTask("position-structure-panel", "Struktur Jabatan");
    });
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus jabatan “${item.title}”?`)) return;
      try {
        await request(`/api/admin/position-titles/${item.id}`, { method: "DELETE" });
        await loadPositionTitles();
        await loadAdminContacts();
        await loadContacts();
      } catch (error) {
        positionError.textContent = error.message;
      }
    });
    actions.append(moveUp, moveDown, edit, remove);
    row.append(order, name, actions);
    list.append(row);
  });
  if (!positionTitles.length) {
    const empty = document.createElement("li");
    empty.textContent = "Belum ada jabatan tersimpan.";
    list.append(empty);
  }
}

async function reorderPositionTitles(fromIndex, toIndex) {
  const ordered = [...positionTitles];
  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);
  try {
    const payload = await request("/api/admin/position-titles/reorder", {
      method: "POST",
      body: JSON.stringify({ title_ids: ordered.map((item) => item.id) }),
    });
    positionTitles = payload.titles;
    renderPositionTitles();
    await loadAdminContacts();
    await loadContacts();
  } catch (error) {
    positionError.textContent = error.message;
  }
}

function resetPositionForm() {
  positionForm.reset();
  positionForm.elements.title_id.value = "";
  editingPositionId = null;
  positionSubmitButton.textContent = "Tambah Jabatan";
  positionCancelButton.hidden = true;
  positionError.textContent = "";
}

positionCancelButton.addEventListener("click", resetPositionForm);
positionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  positionError.textContent = "";
  positionResult.hidden = true;
  const title = positionForm.elements.title.value.trim();
  const editing = editingPositionId !== null;
  try {
    const payload = await request(editing ? "/api/admin/position-titles/update" : "/api/admin/position-titles", {
      method: "POST",
      body: JSON.stringify(editing ? { title_id: editingPositionId, title } : { title }),
    });
    positionTitles = payload.titles;
    resetPositionForm();
    positionResult.textContent = editing ? "Perubahan jabatan tersimpan." : "Jabatan berhasil ditambahkan.";
    positionResult.hidden = false;
    renderPositionTitles();
    await loadAdminContacts();
    await loadContacts();
  } catch (error) {
    positionError.textContent = error.message;
  }
});

/* KONTAK: daftar nomor pengurus yang dikelola dari panel admin. */
let editingContactId = null;
const contactForm = document.querySelector("#contact-form");
const contactError = document.querySelector("#contact-error");
const contactResult = document.querySelector("#contact-result");
const contactFormTitle = document.querySelector("#contacts-admin-title");
const contactSubmitButton = document.querySelector("#contact-submit");
const contactCancelButton = document.querySelector("#contact-cancel-edit");

let areaContactsAdmin = [];

const contactPositionSelect = contactForm?.elements.position_select;
const contactPositionCustomField = document.querySelector("#contact-position-custom-field");
let contactPositionTitles = [];

function renderContactPositionOptions(selected = "") {
  if (!contactPositionSelect) return;
  contactPositionSelect.replaceChildren();
  contactPositionTitles.forEach((item) => contactPositionSelect.add(new Option(item.title, item.title)));
  if (selected) contactPositionSelect.value = selected;
  updateContactPositionCustomField();
}

function updateContactPositionCustomField() {
  if (!contactPositionSelect || !contactPositionCustomField) return;
  const isOther = contactPositionSelect.value === OTHER_POSITION_LABEL;
  contactPositionCustomField.hidden = !isOther;
  const customInput = contactForm.elements.position_name;
  customInput.required = isOther;
  customInput.disabled = !isOther;
  if (!isOther) customInput.value = "";
}

contactPositionSelect?.addEventListener("change", updateContactPositionCustomField);

async function loadContactPositionTitles(selected = "") {
  try {
    const payload = await request("/api/position-titles");
    contactPositionTitles = payload.titles || [];
    renderContactPositionOptions(selected);
  } catch {
    contactPositionTitles = [{ title: OTHER_POSITION_LABEL }];
    renderContactPositionOptions(selected);
  }
}

async function loadAdminContacts() {
  if (!contactForm) return;
  await loadContactPositionTitles(contactForm.elements.position_select?.value || "");
  try {
    const payload = await request("/api/admin/contacts");
    areaContactsAdmin = payload.contacts || [];
    renderAdminContacts(areaContactsAdmin);
  } catch (error) {
    contactError.textContent = error.message;
  }
}

const CONTACTS_PAGE_SIZE = 10;
let adminContactsPage = 0;

function filterAdminContacts(contacts) {
  const query = document.querySelector("#contact-search")?.value.trim().toLocaleLowerCase("id-ID") || "";
  if (!query) return contacts;
  return contacts.filter((contact) => [
    contact.contact_name, contact.position_name, contact.phone, contactUnitLabel(contact),
  ].some((value) => String(value || "").toLocaleLowerCase("id-ID").includes(query)));
}

function renderAdminContacts(contacts) {
  const list = document.querySelector("#admin-contact-list");
  list.replaceChildren();
  const filtered = filterAdminContacts(contacts);
  const countElement = document.querySelector("#contact-list-count");
  if (countElement) {
    const query = document.querySelector("#contact-search")?.value.trim() || "";
    countElement.textContent = query
      ? `${filtered.length} dari ${contacts.length} kontak`
      : `${contacts.length} kontak`;
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / CONTACTS_PAGE_SIZE));
  adminContactsPage = Math.min(adminContactsPage, pageCount - 1);
  const pageStart = adminContactsPage * CONTACTS_PAGE_SIZE;
  filtered.slice(pageStart, pageStart + CONTACTS_PAGE_SIZE).forEach((contact) => {
    const item = document.createElement("li");
    item.className = "admin-news-item";
    const copy = document.createElement("div");
    copy.className = "admin-news-copy";
    const title = document.createElement("h4");
    title.textContent = `${contactUnitLabel(contact)} · ${contact.contact_name}`;
    const meta = document.createElement("small");
    meta.className = "admin-news-meta";
    meta.textContent = `${contact.position_name || "Pengurus"} · ${contact.phone}${contact.active ? "" : " · disembunyikan"}`;
    copy.append(title, meta);
    if (contact.rank_order && contact.rank_order > 90) {
      const custom = document.createElement("small");
      custom.className = "contact-range-warning";
      custom.textContent = "Jabatan di luar struktur baku.";
      copy.append(custom);
    }
    // Wilayah di luar jumlah RT/RW saat ini tetap disimpan, tetapi ditandai
    // supaya pengelola tahu nomor tersebut perlu disesuaikan.
    const unitLimit = contact.unit_type === "RW" ? settings.rw_count : settings.rt_count;
    if (contact.unit_number > unitLimit) {
      const warning = document.createElement("small");
      warning.className = "contact-range-warning";
      warning.textContent = `Di luar jumlah ${contact.unit_type} saat ini (${unitLimit}).`;
      copy.append(warning);
    }
    const actions = document.createElement("div");
    actions.className = "admin-news-actions";
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingContactId = contact.id;
      contactForm.elements.contact_id.value = String(contact.id);
      contactForm.elements.unit_type.value = contact.unit_type;
      fillContactUnitSelect();
      // Wilayah lama yang sudah tidak ada di daftar pilihan (mis. jumlah RT
      // dikurangi) tetap dapat diedit tanpa kehilangan data.
      if (![...contactUnitSelect.options].some((option) => option.value === String(contact.unit_number))) {
        contactUnitSelect.add(new Option(`${contact.unit_type} ${String(contact.unit_number).padStart(3, "0")}`, String(contact.unit_number)));
      }
      contactUnitSelect.value = String(contact.unit_number);
      contactForm.elements.contact_name.value = contact.contact_name;
      contactForm.elements.phone.value = contact.phone;
      const knownPosition = contactPositionTitles.some((item) => item.title === contact.position_name);
      if (knownPosition) {
        contactForm.elements.position_select.value = contact.position_name;
        contactForm.elements.position_name.value = "";
      } else {
        contactForm.elements.position_select.value = OTHER_POSITION_LABEL;
        contactForm.elements.position_name.value = contact.position_name;
      }
      updateContactPositionCustomField();
      contactForm.elements.active.checked = Boolean(contact.active);
      contactFormTitle.textContent = "Edit Nomor Kontak";
      contactSubmitButton.textContent = "Simpan Perubahan";
      contactCancelButton.hidden = false;
      contactResult.hidden = true;
      focusAdminTask("contact-form", "Edit Nomor Kontak");
    });
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Hapus kontak ${contact.contact_name} (${contactUnitLabel(contact)})?`)) return;
      try {
        await request(`/api/admin/contacts/${contact.id}`, { method: "DELETE" });
        await loadAdminContacts();
        await loadContacts();
      } catch (error) {
        contactError.textContent = error.message;
      }
    });
    actions.append(edit, remove);
    item.append(copy, actions);
    list.append(item);
  });
  if (!filtered.length) {
    const empty = document.createElement("li");
    empty.textContent = contacts.length ? "Tidak ada kontak yang sesuai dengan pencarian." : "Belum ada nomor kontak tersimpan.";
    list.append(empty);
  }
  renderContactPagination(pageCount);
}

let contactSearchTimer = null;
document.querySelector("#contact-search")?.addEventListener("input", () => {
  window.clearTimeout(contactSearchTimer);
  contactSearchTimer = window.setTimeout(() => {
    adminContactsPage = 0;
    renderAdminContacts(areaContactsAdmin);
  }, 200);
});

/* KONTAK: pratinjau cetak dan unduh PDF mengikuti filter pencarian. */
function renderContactPrint() {
  const body = document.querySelector("#contact-print-body");
  if (!body) return;
  body.replaceChildren();
  const filtered = filterAdminContacts(areaContactsAdmin);
  const note = document.querySelector("#contact-print-note");
  if (note) {
    const query = document.querySelector("#contact-search")?.value.trim() || "";
    note.textContent = query
      ? `Menampilkan ${filtered.length} kontak sesuai pencarian "${query}".`
      : `Menampilkan semua ${filtered.length} kontak.`;
  }
  // Dikelompokkan per wilayah: tiap wilayah memulai halaman baru dan
  // penomorannya kembali dari 1.
  const groups = new Map();
  filtered.forEach((contact) => {
    const unit = contactUnitLabel(contact);
    if (!groups.has(unit)) groups.set(unit, []);
    groups.get(unit).push(contact);
  });
  let groupIndex = 0;
  groups.forEach((members, unit) => {
    const headingRow = document.createElement("tr");
    headingRow.className = "contact-print-unit";
    if (groupIndex > 0) headingRow.dataset.pageBreak = "true";
    const headingCell = document.createElement("th");
    headingCell.colSpan = 5;
    headingCell.textContent = unit;
    headingRow.append(headingCell);
    body.append(headingRow);
    members.forEach((contact, index) => {
      const row = document.createElement("tr");
      for (const value of [
        String(index + 1), contact.position_name || "-", contact.contact_name || "-",
        contact.phone || "-", contact.active ? "Tampil" : "Disembunyikan",
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    });
    groupIndex += 1;
  });
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Belum ada kontak tersimpan.";
    row.append(cell);
    body.append(row);
  }
}

document.querySelector("#contact-print-button")?.addEventListener("click", () => {
  renderContactPrint();
  const dialog = document.querySelector("#contact-print-dialog");
  if (dialog && !dialog.open) dialog.showModal();
});
document.querySelector("#contact-print-back")?.addEventListener("click", () => {
  document.querySelector("#contact-print-dialog")?.close();
});
document.querySelector("#contact-print-confirm")?.addEventListener("click", () => window.print());
document.querySelector("#contact-print-pdf")?.addEventListener("click", () => {
  const params = new URLSearchParams({ type: "contacts" });
  params.set("q", document.querySelector("#contact-search")?.value.trim() || "");
  window.open(`/api/admin/export/pdf?${params.toString()}`, "_blank");
});

function renderContactPagination(pageCount) {
  const pageNumbers = document.querySelector("#admin-contacts-page-numbers");
  if (!pageNumbers) return;
  pageNumbers.replaceChildren();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageButton = document.createElement("button");
    pageButton.className = "record-page-number";
    pageButton.type = "button";
    pageButton.textContent = String(pageIndex + 1);
    pageButton.setAttribute("aria-current", String(pageIndex === adminContactsPage));
    pageButton.addEventListener("click", () => {
      adminContactsPage = pageIndex;
      renderAdminContacts(areaContactsAdmin);
    });
    pageNumbers.append(pageButton);
  }
  document.querySelector("#admin-contacts-previous").disabled = adminContactsPage === 0;
  document.querySelector("#admin-contacts-next").disabled = adminContactsPage >= pageCount - 1;
}

document.querySelector("#admin-contacts-previous")?.addEventListener("click", () => {
  adminContactsPage = Math.max(0, adminContactsPage - 1);
  renderAdminContacts(areaContactsAdmin);
});
document.querySelector("#admin-contacts-next")?.addEventListener("click", () => {
  const pageCount = Math.max(1, Math.ceil(areaContactsAdmin.length / CONTACTS_PAGE_SIZE));
  adminContactsPage = Math.min(pageCount - 1, adminContactsPage + 1);
  renderAdminContacts(areaContactsAdmin);
});

function resetContactForm() {
  contactForm.reset();
  contactForm.elements.contact_id.value = "";
  contactForm.elements.active.checked = true;
  contactForm.elements.position_name.value = "";
  contactForm.elements.position_name.disabled = true;
  renderContactPositionOptions();
  editingContactId = null;
  contactFormTitle.textContent = "Tambah Nomor Kontak";
  contactSubmitButton.textContent = "Simpan Kontak";
  contactCancelButton.hidden = true;
  contactError.textContent = "";
}

contactCancelButton.addEventListener("click", () => {
  const wasEditing = editingContactId !== null;
  resetContactForm();
  if (wasEditing) focusAdminTask("contacts-saved-panel", "Kontak Tersimpan");
});

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  contactError.textContent = "";
  contactResult.hidden = true;
  const payload = Object.fromEntries(new FormData(contactForm));
  payload.unit_number = Number(payload.unit_number);
  payload.active = contactForm.elements.active.checked;
  if (contactForm.elements.position_select.value === OTHER_POSITION_LABEL) {
    payload.position_name = contactForm.elements.position_name.value.trim();
  } else {
    payload.position_name = contactForm.elements.position_select.value;
  }
  delete payload.contact_id;
  delete payload.position_select;
  const editing = editingContactId !== null;
  if (editing) payload.contact_id = editingContactId;
  try {
    await request(editing ? "/api/admin/contacts/update" : "/api/admin/contacts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    resetContactForm();
    contactResult.textContent = editing ? "Perubahan kontak tersimpan." : "Nomor kontak berhasil ditambahkan.";
    contactResult.hidden = false;
    await loadAdminContacts();
    await loadContacts();
    if (editing) focusAdminTask("contacts-saved-panel", "Kontak Tersimpan");
  } catch (error) {
    contactError.textContent = error.message;
  }
});

function renderAdminTaskNavigation(name) {
  const taskNavigation = document.querySelector("#admin-task-nav");
  const menus = {
    records: [
      { label: "Tambah Warga", target: "record-form" },
      { label: "Data Tersimpan", target: "records-list-panel" },
      { label: "Atur Jumlah RT dan RW", target: "settings-form", permission: "area" },
    ],
    registrations: [
      { label: "Antrean Formulir", target: "registrations-panel", permission: "registration" },
    ],
    import: [
      { label: "Pilih File dan Pratinjau", target: "import-task-panel" },
      { label: "Tinjauan Data", target: "issues-panel" },
    ],
    news: [
      { label: "Tambah Berita", target: "news-form" },
      { label: "Berita Tersimpan", target: "news-saved-panel" },
    ],
    contacts: [
      { label: "Tambah Nomor Kontak", target: "contact-form" },
      { label: "Kontak Tersimpan", target: "contacts-saved-panel" },
      { label: "Struktur Jabatan", target: "position-structure-panel" },
    ],
    media: [
      { label: "Logo Dan Gambar Utama", target: "site-images-panel", permission: "media" },
      { label: "Atur Footer dan Skala Logo", target: "footer-settings-form", permission: "media" },
      { label: "Atur Dana Apresiasi", target: "donation-settings-form", permission: "media" },
      { label: "Kop Ekspor dan Tanda Tangan", target: "export-letterhead-section", permission: "media" },
      { label: "Font Dan Tipografi", target: "typography-form", permission: "typography" },
      { label: "Atur Jadwal Maintenance", target: "maintenance-form", permission: "maintenance" },
    ],
    
    users: [{ label: "Daftar Pengguna", target: "users-list-panel" }],
    payments: [{ label: "Periksa Bukti Pembayaran", target: "admin-payments-section" }],
    program: [{ label: "Edit Informasi Program", target: "admin-program-section" }],
    finance: [
      { label: "Daftar Warga", target: "contribution-residents-panel", permission: "payments" },
      { label: "Periksa Bukti Pembayaran", target: "admin-payments-section", permission: "payments" },
      { label: "Tambah dan Lihat Catatan", target: "admin-finance-section", permission: "finance" },
    ],
  };
  if (name === "users" && currentUser?.role === "Super Admin") {
    menus.users.push({ label: "Hak Akses", target: "permissions-task-panel" });
  }
  taskNavigation.replaceChildren();
  const permissions = new Set(currentUser?.permissions || rolePermissionDefaults[currentUser?.role] || []);
  const menuItems = (menus[name] || []).filter((item) => !item.permission || permissions.has(item.permission));
  for (const item of menuItems) {
    if (item.children) {
      const group = document.createElement("details");
      group.className = "admin-task-group";
      group.open = false;
      const summary = document.createElement("summary");
      summary.textContent = item.label;
      const links = document.createElement("div");
      links.className = "admin-task-links";
      for (const child of item.children) links.append(createAdminTaskLink(child));
      group.append(summary, links);
      taskNavigation.append(group);
    } else {
      taskNavigation.append(createAdminTaskLink(item));
    }
  }
  taskNavigation.hidden = !taskNavigation.childElementCount;
  const activeTab = document.querySelector(`.admin-tab[data-admin-tab="${name}"]`);
  const activeGroup = activeTab?.closest(".admin-nav-group");
  if (activeGroup) activeGroup.append(taskNavigation);
}

function createAdminTaskLink(item) {
  if (item.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-task-link admin-task-link-button";
    button.textContent = item.label;
    button.addEventListener("click", () => document.querySelector(`#${item.action}`)?.click());
    return button;
  }
  const link = document.createElement("a");
  link.className = "admin-task-link";
  link.dataset.taskTarget = item.target;
  link.href = "/admin";
  link.textContent = item.label;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    focusAdminTask(item.target, item.label);
  });
  return link;
}

let adminTaskFocusNodes = [];
let adminTaskFocusBranches = [];
let adminTaskFocusTarget = null;

function clearAdminTaskFocus() {
  document.querySelectorAll(".admin-task-link.is-active").forEach((link) => {
    link.classList.remove("is-active");
    link.removeAttribute("aria-current");
  });
  for (const { element, hidden } of adminTaskFocusNodes) element.hidden = hidden;
  adminTaskFocusNodes = [];
  for (const branch of adminTaskFocusBranches) branch.classList.remove("admin-task-focus-branch");
  adminTaskFocusBranches = [];
  adminTaskFocusTarget?.classList.remove("admin-task-focus-target");
  adminTaskFocusTarget = null;
  const focusHeading = document.querySelector("#admin-task-focus");
  focusHeading.hidden = true;
  focusHeading.removeAttribute("data-task-target");
  focusHeading.removeAttribute("data-task-view");
}

function focusAdminTask(targetId, label) {
  if (mobileTaskDialog.open && mobileTaskTarget) restoreMobileTaskTarget();
  if (targetId === "contribution-residents-panel") loadContributionResidents();
  if (targetId === "issues-panel") loadDataIssues();
  clearAdminTaskFocus();
  const target = document.getElementById(targetId);
  const view = target?.closest(".admin-view");
  if (!target || !view) return;
  document.querySelectorAll(".admin-task-link[data-task-target]").forEach((link) => {
    const active = link.dataset.taskTarget === targetId;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  const focusHeading = document.querySelector("#admin-task-focus");
  focusHeading.dataset.taskTarget = targetId;
  focusHeading.dataset.taskView = view.dataset.adminPanel;
  target.classList.add("admin-task-focus-target");
  adminTaskFocusTarget = target;
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== view) {
    ancestor.classList.add("admin-task-focus-branch");
    adminTaskFocusBranches.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  document.querySelectorAll(".admin-view").forEach((panel) => { panel.hidden = true; });
  document.querySelector(".admin-views").classList.remove("is-idle");
  view.hidden = false;
  target.hidden = false;
  let branch = target;
  while (branch !== view) {
    const parent = branch.parentElement;
    for (const sibling of parent.children) {
      if (sibling === branch) continue;
      adminTaskFocusNodes.push({ element: sibling, hidden: sibling.hidden });
      sibling.hidden = true;
    }
    branch = parent;
  }
  document.querySelector("#admin-task-focus-title").textContent = label;
  document.querySelector("#admin-task-focus").hidden = false;
  clearAdminTaskFragment();
  if (window.matchMedia("(max-width: 760px)").matches) {
    mobileTaskTarget = target;
    mobileTaskPlaceholder = document.createComment(`${label} kembali ke posisi asal`);
    target.before(mobileTaskPlaceholder);
    document.querySelector("#mobile-task-title").textContent = label;
    document.querySelector("#mobile-task-content").append(target);
    mobileTaskReturnTab = document.querySelector(".admin-tab.active")?.dataset.adminTab || "records";
    if (!mobileTaskDialog.open) mobileTaskDialog.showModal();
    target.querySelector('input:not([type="hidden"]), select, textarea, button, a[href]')?.focus({ preventScroll: true });
    return;
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  if (!reduceMotion && typeof target.animate === "function") {
    target.animate(
      [{ opacity: 0, transform: "translateY(9px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 300, easing: "cubic-bezier(.2, .8, .2, 1)" },
    );
  }
}

function restoreMobileTaskTarget() {
  if (mobileTaskPlaceholder?.parentNode && mobileTaskTarget) {
    mobileTaskPlaceholder.before(mobileTaskTarget);
    mobileTaskPlaceholder.remove();
  }
  mobileTaskPlaceholder = null;
  mobileTaskTarget = null;
}

function restoreMobileTask() {
  restoreMobileTaskTarget();
  if (isAdminPage && isAdmin) {
    setAdminTab(mobileTaskReturnTab);
    clearAdminTaskFragment();
    document.querySelector(`.admin-tab[data-admin-tab="${mobileTaskReturnTab}"]`)?.focus();
  }
}

document.querySelector("#mobile-task-close").addEventListener("click", () => mobileTaskDialog.close());
mobileTaskDialog.addEventListener("close", restoreMobileTask);
window.matchMedia("(max-width: 760px)").addEventListener("change", (event) => {
  if (!event.matches && mobileTaskDialog.open) mobileTaskDialog.close();
});

document.querySelector("#admin-task-return").addEventListener("click", () => {
  const activeTab = document.querySelector(".admin-tab.active");
  setAdminTab(activeTab?.dataset.adminTab || "records");
  clearAdminTaskFragment();
  activeTab?.focus();
});

function setAdminTab(name, focus = false, openGroup = true) {
  clearAdminTaskFragment();
  clearAdminTaskFocus();
  document.querySelector("#admin-profile-menu").hidden = true;
  document.querySelector("#admin-profile-toggle").setAttribute("aria-expanded", "false");
  const userPanel = document.querySelector("#user-create-dialog");
  if (userPanel && !userPanel.hidden) {
    userPanel.hidden = true;
    document.querySelector("#users-list-panel").hidden = false;
    createUserForm.reset();
    resetUserPhotoPreview();
    editingUser = null;
    document.querySelector("#add-user-button").setAttribute("aria-expanded", "false");
  }
  const tabs = [...document.querySelectorAll(".admin-tab")];
  for (const tab of tabs) {
    const active = tab.dataset.adminTab === name;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
    if (active && focus) tab.focus();
    if (active && tab.dataset.adminTab === "news") loadAdminNews();
    if (active && tab.dataset.adminTab === "contacts") {
      loadPositionTitles();
      loadAdminContacts();
    }
    if (active && tab.dataset.adminTab === "program") loadAdminProgramInfo();
    if (active && tab.dataset.adminTab === "registrations") window.loadRegistrations?.();
    if (active && tab.dataset.adminTab === "import") loadDataIssues();
    if (active && tab.dataset.adminTab === "finance") {
      if (currentUser?.permissions?.includes("finance") || rolePermissionDefaults[currentUser?.role]?.includes("finance")) loadAdminFinance();
      if (currentUser?.permissions?.includes("payments") || rolePermissionDefaults[currentUser?.role]?.includes("payments")) loadAdminPayments();
    }
  }
  document.querySelectorAll(".admin-view").forEach((panel) => { panel.hidden = true; });
  document.querySelector(".admin-views").classList.add("is-idle");
  document.querySelectorAll(".admin-nav-group").forEach((group) => {
    setAdminGroupOpen(group, openGroup && group.dataset.adminGroup === name);
  });
  renderAdminTaskNavigation(name);
}

// TINJAUAN DATA: daftar field bermasalah hasil impor.
const ISSUE_FIELD_LABELS = {
  gender: "Jenis Kelamin", rt: "RT", rw: "RW",
  birth_date: "Tanggal Lahir", date_of_death: "Tanggal Wafat",
  paid_at: "Tanggal Pembayaran", payment_period: "Bulan Iuran",
  amount: "Nominal Setoran", family_card_number: "Nomor KK",
  national_id_number: "NIK",
};
let dataIssues = [];
let issueSearchTimer = null;

function formatIssueTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function updateIssueTabBadge(openTotal) {
  const badge = document.querySelector("#issue-tab-badge");
  if (!badge) return;
  badge.textContent = String(openTotal);
  badge.hidden = !openTotal;
  const tab = document.querySelector("#admin-tab-import");
  if (tab) tab.setAttribute("title", openTotal ? `${openTotal} field bermasalah belum diperbaiki` : "Tidak ada field bermasalah");
}

async function loadDataIssues() {
  const errorElement = document.querySelector("#issue-error");
  if (!errorElement) return;
  errorElement.textContent = "";
  const search = document.querySelector("#issue-search").value.trim();
  const status = document.querySelector("#issue-status").value;
  const field = document.querySelector("#issue-field").value;
  const parameters = new URLSearchParams({ status, q: search, field });
  try {
    const payload = await request(`/api/admin/data-issues?${parameters}`);
    dataIssues = payload.issues || [];
    renderDataIssues(payload);
    updateIssueTabBadge(payload.open_total || 0);
  } catch (error) {
    errorElement.textContent = error.message;
  }
}

function renderDataIssues(payload) {
  const list = document.querySelector("#issue-list");
  const summary = document.querySelector("#issue-summary");
  list.replaceChildren();
  summary.textContent = `${dataIssues.length} catatan ditampilkan. Total belum diperbaiki: ${payload.open_total || 0} dari ${payload.total || 0}.`;
  if (!dataIssues.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "Tidak ada catatan untuk pencarian ini.";
    row.append(cell);
    list.append(row);
    return;
  }
  for (const issue of dataIssues) {
    const row = document.createElement("tr");
    if (issue.resolved) row.className = "is-resolved";
    const values = [
      issue.full_name || "(tanpa nama)",
      issue.source_file || "-",
      issue.row_index || "-",
      ISSUE_FIELD_LABELS[issue.field] || issue.field || "-",
      issue.raw_value || "-",
      issue.message || "-",
      issue.resolved
        ? `Selesai${issue.resolved_by ? ` oleh ${issue.resolved_by}` : ""} · ${formatIssueTimestamp(issue.resolved_at)}`
        : `Menunggu · ${formatIssueTimestamp(issue.created_at)}`,
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    const actionCell = document.createElement("td");
    if (!issue.resolved) {
      const button = document.createElement("button");
      button.className = "text-button";
      button.type = "button";
      button.textContent = "Tandai Selesai";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await request("/api/admin/data-issues/resolve", {
            method: "POST",
            body: JSON.stringify({ issue_id: issue.id }),
          });
          await loadDataIssues();
          await refreshRecords();
        } catch (error) {
          document.querySelector("#issue-error").textContent = error.message;
          button.disabled = false;
        }
      });
      actionCell.append(button);
    }
    row.append(actionCell);
    list.append(row);
  }
}

document.querySelector("#issue-search")?.addEventListener("input", () => {
  clearTimeout(issueSearchTimer);
  issueSearchTimer = setTimeout(loadDataIssues, 250);
});
document.querySelector("#issue-status")?.addEventListener("change", loadDataIssues);
document.querySelector("#issue-field")?.addEventListener("change", loadDataIssues);
document.querySelector("#issue-resolve-all")?.addEventListener("click", async () => {
  if (!window.confirm("Tandai semua catatan yang belum diperbaiki sebagai selesai?")) return;
  try {
    await request("/api/admin/data-issues/resolve", { method: "POST", body: JSON.stringify({ all: true }) });
    await loadDataIssues();
    await refreshRecords();
  } catch (error) {
    document.querySelector("#issue-error").textContent = error.message;
  }
});

function setAdminGroupOpen(group, open) {
  group.open = open;
  group.querySelector(".admin-tab")?.setAttribute("aria-expanded", String(open));
}

document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    const group = tab.closest(".admin-nav-group");
    const wasOpen = group.open;
    setAdminTab(tab.dataset.adminTab, false, false);
    setAdminGroupOpen(group, !wasOpen);
  });
});

document.querySelector(".close-button").addEventListener("click", async () => {
  const wasAuthenticated = isAdmin;
  const wasResident = currentUser?.role === "Warga";
  if (wasAuthenticated) await request("/api/logout", { method: "POST" }).catch(() => {});
  if (!isAdminPage) {
    dialog.close();
    if (wasAuthenticated) {
      setAdminMode(false);
      if (!wasResident) await refreshRecords().catch(() => {});
    }
    return;
  }
  window.location.href = "/";
});
const adminProfile = document.querySelector(".admin-header-account");
const adminProfileToggle = document.querySelector("#admin-profile-toggle");
const adminProfileMenu = document.querySelector("#admin-profile-menu");
adminProfileToggle.addEventListener("click", () => {
  adminProfileMenu.hidden = !adminProfileMenu.hidden;
  adminProfileToggle.setAttribute("aria-expanded", String(!adminProfileMenu.hidden));
});
document.addEventListener("click", (event) => {
  if (adminProfileMenu.hidden || adminProfile.contains(event.target)) return;
  adminProfileMenu.hidden = true;
  adminProfileToggle.setAttribute("aria-expanded", "false");
});
document.querySelector("#admin-profile-logout").addEventListener("click", async () => {
  const wasResident = currentUser?.role === "Warga";
  await request("/api/logout", { method: "POST" }).catch(() => {});
  setAdminMode(false);
  if (isAdminPage) window.location.href = "/";
  else if (!wasResident) await refreshRecords().catch(() => {});
});
/* POPUP: klik area di luar popup (backdrop) menutupnya.
   Daftar ini berisi popup yang tidak boleh ditutup sembarangan karena
   isinya sedang berjalan atau berisi tombol yang belum selesai. */
const dialogsNeedingExplicitClose = new Set([
  "admin-dialog",
  "processing-dialog",
  "import-done-dialog",
  "import-report-dialog",
  "contribution-print-dialog",
]);
for (const popup of document.querySelectorAll("dialog")) {
  if (dialogsNeedingExplicitClose.has(popup.id)) continue;
  popup.addEventListener("click", (event) => {
    // event.target === popup hanya terjadi saat klik pada latar di
    // luar kotak popup, karena isi popup targeting-nya anak-anaknya.
    if (event.target !== popup) return;
    // Jangan tutup saat klik dimulai di dalam popup lalu ditarik ke luar.
    if (popup.dataset.draggedOut === "true") {
      popup.dataset.draggedOut = "";
      return;
    }
    popup.close();
  });
  popup.addEventListener("pointerdown", (event) => {
    if (event.target === popup) popup.dataset.draggedOut = "false";
  });
  popup.addEventListener("pointerup", (event) => {
    if (event.target === popup && popup.dataset.draggedOut === "false") popup.dataset.draggedOut = "";
  });
}
function showResidentAuthForm(register = false) {
  loginForm.hidden = register;
  document.querySelector("#resident-register-form").hidden = !register;
  document.querySelector("#change-password-form").hidden = true;
  document.querySelector("#resident-dashboard").hidden = true;
  document.querySelector("#forgot-password-message").hidden = true;
  document.querySelector("#dialog-title").textContent = register ? "Daftar Akun Warga" : "Masuk Warga";
  document.querySelector(register ? '#resident-register-form input[name="full_name"]' : '#login-form input[name="username"]').focus();
}
for (const [selector, register] of [["#show-register-form", true], ["#show-login-form", false]]) {
  document.querySelector(selector)?.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    showResidentAuthForm(register);
  });
}
if (isAdminPage) {
  document.querySelector("#show-register-form").hidden = true;
  document.querySelector("#resident-login-open").hidden = true;
}
document.querySelector("#login-password-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const password = document.querySelector("#login-password");
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
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
document.querySelector("#forgot-password-button").addEventListener("click", () => {
  const message = document.querySelector("#forgot-password-message");
  message.hidden = !message.hidden;
});
document.querySelector("#resident-register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const errorElement = document.querySelector("#register-error");
  errorElement.textContent = "";
  if (values.get("password") !== values.get("confirm_password")) {
    errorElement.textContent = "Password yang dimasukkan belum sama.";
    return;
  }
  try {
    const payload = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({ full_name: values.get("full_name"), password: values.get("password") }),
    });
    form.reset();
    setAdminMode(true, payload.user, false);
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#login-error");
  errorElement.textContent = "";
  try {
    const formData = new FormData(loginForm);
    const payload = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
    });
    loginForm.reset();
    setAdminMode(true, payload.user, payload.force_password_change);
    if (!payload.force_password_change && payload.user?.role !== "Warga") await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#change-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#change-password-error");
  errorElement.textContent = "";
  const values = new FormData(form);
  if (values.get("new_password") !== values.get("confirm_password")) {
    errorElement.textContent = "Kata sandi baru tidak sama.";
    return;
  }
  try {
    await request("/api/admin/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: values.get("current_password"), new_password: values.get("new_password") }),
    });
    form.reset();
    currentUser.force_password_change = 0;
    setAdminMode(true, currentUser, false);
    if (currentUser.role !== "Warga") await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
// FORMULIR AKUN: pendaftaran user dengan foto profil opsional.
const userCreatePanel = document.querySelector("#user-create-dialog");
const createUserForm = document.querySelector("#create-user-form");
const photoInput = createUserForm.elements.photo;
let userPhotoPreviewUrl = "";
let editingUser = null;
let editingUserPermissions = [];

function resetUserPhotoPreview() {
  if (userPhotoPreviewUrl) URL.revokeObjectURL(userPhotoPreviewUrl);
  userPhotoPreviewUrl = "";
  const preview = document.querySelector("#user-photo-preview");
  preview.replaceChildren(document.createTextNode("Foto opsional · PNG, JPG, WebP · maks. 5 MB"));
  document.querySelector("#delete-user-photo-button").hidden = true;
  delete document.querySelector("#delete-user-photo-button").dataset.userId;
}

function openUserDialog(user = null) {
  setAdminTab("users");
  editingUser = user;
  createUserForm.reset();
  resetUserPhotoPreview();
  document.querySelector("#create-user-error").textContent = "";
  const fullName = user?.display_name.trim().split(/\s+/) || [];
  createUserForm.elements.first_name.value = user?.first_name || fullName[0] || "";
  createUserForm.elements.last_name.value = user?.last_name || fullName.slice(1).join(" ");
  createUserForm.elements.phone.value = user?.phone || "";
  createUserForm.elements.email.value = user?.email || "";
  createUserForm.elements.username.value = user?.username || "";
  const builtInRoles = ["Warga", "Staff", "Admin", "Super Admin"];
  createUserForm.elements.role.value = builtInRoles.includes(user?.role) ? user.role : user ? "__custom__" : "Staff";
  createUserForm.elements.username.readOnly = Boolean(user) || createUserForm.elements.role.value === "Warga";
  if (!user && createUserForm.elements.role.value === "Warga") makeResidentUsername();
  createUserForm.elements.custom_role.value = user && !builtInRoles.includes(user.role) ? user.role : "";
  const passwordField = document.querySelector("#user-edit-password-field");
  passwordField.hidden = !user;
  createUserForm.elements.password.value = "";
  editingUserPermissions = user?.permissions || rolePermissionDefaults[createUserForm.elements.role.value] || [];
  document.querySelector("#user-create-title").textContent = user ? "Edit pengguna" : "Tambah pengguna";
  document.querySelector("#user-create-submit").textContent = user ? "Simpan perubahan" : "Simpan pengguna";
  if (user?.avatar_url) {
    const preview = document.querySelector("#user-photo-preview");
    preview.replaceChildren();
    const image = document.createElement("img");
    image.src = user.avatar_url;
    image.alt = "Foto pengguna saat ini";
    const label = document.createElement("span");
    label.textContent = "Foto saat ini · pilih file untuk mengganti";
    preview.append(image, label);
  }
  const deletePhotoButton = document.querySelector("#delete-user-photo-button");
  deletePhotoButton.hidden = !user?.avatar_url;
  if (user?.avatar_url) deletePhotoButton.dataset.userId = String(user.id);
  userCreatePanel.hidden = false;
  document.querySelector("#users-list-panel").hidden = true;
  document.querySelector("#add-user-button").setAttribute("aria-expanded", "true");
  focusAdminTask("user-create-dialog", user ? "Edit Pengguna" : "Tambah Pengguna");
  userCreatePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  createUserForm.elements.first_name.focus({ preventScroll: true });
}

function makeResidentUsername() {
  const fullName = `${createUserForm.elements.first_name.value} ${createUserForm.elements.last_name.value}`;
  const base = fullName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 34);
  const slug = base.length >= 3 ? base : `${base}warga`.slice(0, 34);
  let username = slug;
  let suffix = 2;
  while (adminUsers.some((user) => user.username.toLowerCase() === username.toLowerCase())) username = `${slug}.${suffix++}`.slice(0, 40);
  createUserForm.elements.username.value = username;
}
createUserForm.elements.role.addEventListener("change", () => {
  const resident = createUserForm.elements.role.value === "Warga";
  createUserForm.elements.username.readOnly = Boolean(editingUser) || resident;
  if (resident && !editingUser) makeResidentUsername();
});
for (const field of [createUserForm.elements.first_name, createUserForm.elements.last_name]) {
  field.addEventListener("input", () => {
    if (!editingUser && createUserForm.elements.role.value === "Warga") makeResidentUsername();
  });
}

document.querySelector("#add-user-button").addEventListener("click", () => openUserDialog());
document.querySelector("#delete-user-photo-button").addEventListener("click", async () => {
  const button = document.querySelector("#delete-user-photo-button");
  const userId = Number(button.dataset.userId);
  if (!userId) return;
  const errorElement = document.querySelector("#create-user-error");
  errorElement.textContent = "";
  try {
    const deleted = await deleteAdminMedia("user_avatar", { user_id: userId }, "Hapus foto profil akun ini?");
    if (!deleted) return;
    button.hidden = true;
    delete button.dataset.userId;
    resetUserPhotoPreview();
    await loadAdminUsers();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
function closeUserDialog() {
  clearAdminTaskFocus();
  userCreatePanel.hidden = true;
  document.querySelector("#users-list-panel").hidden = false;
  createUserForm.reset();
  resetUserPhotoPreview();
  editingUser = null;
  document.querySelector("#add-user-button").setAttribute("aria-expanded", "false");
  setAdminTab("users");
  clearAdminTaskFragment();
  document.querySelector("#admin-tab-users").focus();
}
document.querySelector("#permission-user-select").addEventListener("change", showPermissionEditor);
document.querySelector("#permission-editor-save").addEventListener("click", async () => {
  const errorElement = document.querySelector("#permission-editor-error");
  errorElement.textContent = "";
  const user = adminUsers.find((item) => String(item.id) === document.querySelector("#permission-user-select").value);
  if (!user) return;
  const permissions = [...document.querySelectorAll("[data-admin-permission]:checked")].map((checkbox) => checkbox.dataset.adminPermission);
  try {
    await request("/api/admin/users/update", {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        display_name: user.display_name,
        role: user.role,
        active: Boolean(user.active),
        permissions,
      }),
    });
    await loadAdminUsers();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
for (const button of [document.querySelector("#user-create-close"), document.querySelector("#user-create-cancel")]) {
  button.addEventListener("click", closeUserDialog);
}
photoInput.addEventListener("change", () => {
  resetUserPhotoPreview();
  const file = photoInput.files[0];
  if (!file) return;
  userPhotoPreviewUrl = URL.createObjectURL(file);
  const preview = document.querySelector("#user-photo-preview");
  preview.replaceChildren();
  const image = document.createElement("img");
  image.src = userPhotoPreviewUrl;
  image.alt = "Pratinjau foto pengguna";
  const filename = document.createElement("span");
  filename.textContent = file.name;
  preview.append(image, filename);
});

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#create-user-error");
  errorElement.textContent = "";
  const values = Object.fromEntries(new FormData(createUserForm));
  if (!editingUser) values.password = "user";
  else if (!values.password) delete values.password;
  if (values.role === "__custom__") values.role = values.custom_role.trim();
  delete values.custom_role;
  values.permissions = editingUser ? editingUserPermissions : rolePermissionDefaults[values.role] || [];
  const photo = values.photo;
  delete values.photo;
  if (photo instanceof File && photo.size > 5 * 1024 * 1024) {
    errorElement.textContent = "Ukuran foto maksimal 5 MB.";
    return;
  }
  try {
    const editing = Boolean(editingUser);
    if (editing) {
      values.user_id = editingUser.id;
      values.display_name = `${values.first_name} ${values.last_name}`.trim();
      values.active = Boolean(editingUser.active);
    }
    const saved = await request(editing ? "/api/admin/users/update" : "/api/admin/users", {
      method: "POST",
      body: JSON.stringify(values),
    });
    let photoError = "";
    if (photo instanceof File && photo.size) {
      try {
        await uploadImage(photo, "user_avatar", { user_id: editing ? editingUser.id : saved.id });
      } catch (uploadError) {
        photoError = `Akun tersimpan, tetapi foto gagal diunggah: ${uploadError.message}`;
      }
    }
    closeUserDialog();
    document.querySelector("#users-error").textContent = photoError;
    await loadAdminUsers();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
recordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#record-error");
  const resultElement = document.querySelector("#record-result");
  errorElement.textContent = "";
  resultElement.hidden = true;
  const formData = new FormData(recordForm);
  const portrait = formData.get("portrait");
  if (portrait instanceof File && portrait.size > 5 * 1024 * 1024) {
    errorElement.textContent = "Ukuran foto maksimal 5 MB.";
    return;
  }
  try {
    const saved = await request("/api/records", {
      method: "POST",
      body: JSON.stringify({
        full_name: formData.get("full_name"),
        gender: formData.get("gender"),
        address: formData.get("address"),
        rt: Number(formData.get("rt")),
        rw: Number(formData.get("rw")),
        date_of_death: formData.get("date_of_death"),
        publish_address: formData.has("publish_address"),
      }),
    });
    let resultMessage = "Data warga berhasil disimpan.";
    if (portrait instanceof File && portrait.size > 0) {
      try {
        await uploadImage(portrait, "portrait", {
          record_id: saved.id,
          publish_portrait: formData.has("publish_portrait"),
        });
        resultMessage = "Data warga dan foto berhasil disimpan.";
      } catch (uploadError) {
        resultMessage = `Data warga tersimpan, tetapi foto gagal diunggah: ${uploadError.message}`;
      }
    }
    recordForm.reset();
    resultElement.textContent = resultMessage;
    resultElement.hidden = false;
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const editRecordForm = document.querySelector("#edit-record-form");
editRecordForm.elements.portrait.addEventListener("change", () => {
  const record = records.find((item) => item.id === Number(editRecordForm.dataset.recordId));
  const file = editRecordForm.elements.portrait.files[0] || null;
  updateEditPortraitFilename(file);
  showEditPortraitPreview(record, file);
});
document.querySelector("#cancel-edit-record").addEventListener("click", () => {
  editRecordForm.reset();
  updateEditPortraitFilename();
  showEditPortraitPreview(null);
  editRecordForm.hidden = true;
  focusAdminTask("records-list-panel", "Data Tersimpan");
});
editRecordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#edit-record-error");
  errorElement.textContent = "";
  const formData = new FormData(editRecordForm);
  const portrait = formData.get("portrait");
  if (portrait instanceof File && portrait.size > 5 * 1024 * 1024) {
    errorElement.textContent = "Ukuran foto maksimal 5 MB.";
    return;
  }
  try {
    const recordId = Number(editRecordForm.dataset.recordId);
    await request("/api/admin/record-update", {
      method: "POST",
      body: JSON.stringify({
        record_id: recordId,
        full_name: formData.get("full_name"),
        gender: formData.get("gender"),
        rt: Number(formData.get("rt")),
        rw: Number(formData.get("rw")),
        date_of_death: formData.get("date_of_death"),
        address: formData.get("address"),
        publish_address: formData.has("publish_address"),
        family_card_number: formData.get("family_card_number"),
        national_id_number: formData.get("national_id_number"),
        birthplace: formData.get("birthplace"),
        birth_date: formData.get("birth_date"),
        religion: formData.get("religion"),
      }),
    });
    const portraitChanged = portrait instanceof File && portrait.size > 0;
    if (portraitChanged) {
      try {
        await uploadImage(portrait, "portrait", {
          record_id: recordId,
          publish_portrait: formData.has("publish_portrait"),
        });
      } catch (uploadError) {
        errorElement.textContent = `Data warga sudah diperbarui, tetapi foto gagal diganti: ${uploadError.message}`;
        await refreshRecords();
        return;
      }
    }
    editRecordForm.reset();
    updateEditPortraitFilename();
    showEditPortraitPreview(null);
    editRecordForm.hidden = true;
    await refreshRecords(portraitChanged);
    focusAdminTask("records-list-panel", "Data Tersimpan");
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
function updateImportDestinationControls() {
  const contributions = importDestinationSelect.value === "contributions";
  importTemplateLink.href = contributions
    ? "/api/admin/import/template-contributions.xlsx"
    : "/api/admin/import/template.xlsx";
  const formatNote = document.querySelector("#import-file-format-hint");
  if (formatNote) {
    formatNote.textContent = contributions
      ? "Gunakan template khusus. Bulan iuran, tanggal pembayaran, dan nominal setoran diisi bersama-sama bila ingin mengimpor transaksi; foto warga diunggah melalui Edit Data warga."
      : "Format: XLSX, XLS, CSV, DOCX, PDF, PNG, JPG, WebP. Gambar/PDF scan perlu diperiksa ulang.";
  }
}
importDestinationSelect.addEventListener("change", updateImportDestinationControls);
updateImportDestinationControls();

const importFileInput = document.querySelector("#import-file");
const importFileList = document.querySelector("#import-file-list");
const MAX_IMPORT_FILE_BYTES = 60 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;
// Batas total satu permintaan. Nginx bawaan hanya menerima 1 MB dan akan
// membalas 413 lebih dulu sebelum aplikasi sempat memproses data. Base64
// menambah ukuran sekitar 4/3, jadi total file dinilai dalam ukuran terkirim.
const MAX_IMPORT_BODY_BYTES = 72 * 1024 * 1024;
// File dikumpulkan di sini, bukan langsung dari input, agar file yang sudah dipilih
// tidak hilang saat input dibuka lagi untuk menambahkan file berikutnya.
let pendingImportFiles = [];

function importFileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function renderImportFileList() {
  if (!importFileList) return;
  importFileList.replaceChildren();
  importFileList.hidden = pendingImportFiles.length === 0;
  pendingImportFiles.forEach((file, index) => {
    const item = document.createElement("li");
    const size = (file.size / 1024).toFixed(0);
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${file.name} (${size} KB)`;
    if (file.size > MAX_IMPORT_FILE_BYTES) item.classList.add("is-warning");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "import-file-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Hapus ${file.name}`);
    remove.addEventListener("click", () => {
      pendingImportFiles.splice(index, 1);
      renderImportFileList();
    });
    item.append(label, remove);
    importFileList.append(item);
  });
  const totalRowsHint = document.querySelector("#import-file-count");
  if (totalRowsHint) {
    totalRowsHint.textContent = pendingImportFiles.length
      ? `${pendingImportFiles.length} file dipilih untuk diimpor.`
      : "";
  }
}

function collectImportFiles(fileList) {
  const known = new Set(pendingImportFiles.map(importFileKey));
  Array.from(fileList || []).forEach((file) => {
    if (known.has(importFileKey(file))) return;
    if (pendingImportFiles.length >= MAX_IMPORT_FILES) return;
    pendingImportFiles.push(file);
    known.add(importFileKey(file));
  });
  renderImportFileList();
}

if (importFileInput) {
  importFileInput.addEventListener("change", () => {
    collectImportFiles(importFileInput.files);
    importFileInput.value = "";
  });
}
document.querySelector("#import-add-more")?.addEventListener("click", () => importFileInput?.click());

document.querySelector("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#import-error");
  const resultElement = document.querySelector("#import-result");
  const previewPanel = document.querySelector("#import-preview-panel");
  errorElement.textContent = "";
  resultElement.hidden = true;
  previewPanel.hidden = true;
  const files = pendingImportFiles.slice();
  if (!files.length) {
    errorElement.textContent = "Pilih minimal satu file terlebih dahulu.";
    return;
  }
  if (files.length > MAX_IMPORT_FILES) {
    errorElement.textContent = `Maksimal ${MAX_IMPORT_FILES} file sekaligus per impor.`;
    return;
  }
  importPreviewPage = 0;
  const oversize = files.filter((file) => file.size > MAX_IMPORT_FILE_BYTES);
  if (oversize.length) {
    errorElement.textContent = `Ukuran file maksimal 60 MB. Periksa: ${oversize.map((f) => f.name).join(", ")}`;
    return;
  }
  // Total file dibatasi juga karena dikirim dalam satu permintaan. Base64
  // menambah sekitar 4/3 dari ukuran asli.
  const totalFileBytes = files.reduce((sum, file) => sum + file.size, 0);
  const estimatedBodyBytes = totalFileBytes * 1.37 + 64 * 1024;
  if (estimatedBodyBytes > MAX_IMPORT_BODY_BYTES) {
    const megabytes = (totalFileBytes / 1024 / 1024).toFixed(1);
    const limitMegabytes = (MAX_IMPORT_BODY_BYTES / 1024 / 1024).toFixed(0);
    errorElement.textContent = `Total file terlalu besar (${megabytes} MB, batas ${limitMegabytes} MB). Kurangi jumlah file lalu ulangi.`;
    return;
  }
  importDestination = importDestinationSelect.value;
  importDestinationSelect.disabled = true;
  try {
    const encodedFiles = [];
    for (const [index, file] of files.entries()) {
      encodedFiles.push({
        filename: file.name,
        content_base64: await imageBase64(file, `Menyiapkan file ${index + 1} dari ${files.length}...`),
      });
    }
    const payload = await request("/api/admin/import/preview", {
      method: "POST",
      body: JSON.stringify({ destination: importDestination, files: encodedFiles }),
    });
    importRows = payload.rows;
    const notice = document.querySelector("#import-notice");
    const noticeSummary = document.querySelector("#import-notice-summary");
    const warningList = document.querySelector("#import-warnings");
    const details = document.querySelector("#import-details");
    const detailsSummary = document.querySelector("#import-details-summary");
    warningList.replaceChildren();
    details.open = false;
    const fileEntries = Array.isArray(payload.files) ? payload.files : [];
    const fileFailed = fileEntries.filter((entry) => entry.status !== "ok");
    const detailCount = fileEntries.length + payload.warnings.length;
    noticeSummary.textContent = fileFailed.length
      ? `${fileEntries.length} file diproses, total ${payload.rows.length} baris. ${fileFailed.length} file bermasalah, buka rincian.`
      : `${fileEntries.length} file diproses, total ${payload.rows.length} baris.`;
    notice.classList.toggle("has-error", fileFailed.length > 0);
    details.hidden = detailCount === 0;
    // Detail dibuka langsung saat tidak ada baris sama sekali, supaya alasan
    // kegagalannya terlihat tanpa perlu diklik.
    details.open = payload.rows.length === 0 && detailCount > 0;
    detailsSummary.textContent = detailCount
      ? `Rincian file dan catatan (${detailCount})`
      : "Rincian file dan catatan";
    fileEntries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = entry.status === "ok" ? "is-ok" : "is-error";
      item.textContent = `${entry.filename}: ${entry.status === "ok" ? entry.rows + " baris" : entry.status}`;
      warningList.append(item);
    });
    const MAX_DETAIL_ITEMS = 200;
    const shownWarnings = payload.warnings.slice(0, MAX_DETAIL_ITEMS);
    shownWarnings.forEach((warning) => {
      const item = document.createElement("li");
      item.textContent = warning;
      warningList.append(item);
    });
    if (payload.warnings.length > shownWarnings.length) {
      const item = document.createElement("li");
      item.className = "is-more";
      item.textContent = `…dan ${payload.warnings.length - shownWarnings.length} catatan lain.`;
      warningList.append(item);
    }
    notice.hidden = false;
    previewPanel.hidden = false;
    renderImportRows();
    if (!payload.rows.length) {
      // Tidak ada error HTTP lagi: alasannya tampil di panel rincian.
      errorElement.textContent = "";
    }
  } catch (error) {
    errorElement.textContent = error.message;
    importDestinationSelect.disabled = false;
  }
});
// Terapkan pilihan ke seluruh baris, bukan hanya halaman pratinjau yang tampil.
function setAllImportRowsSelected(selected) {
  importRows.forEach((row) => { row.selected = selected; });
  syncVisibleImportCheckboxes();
}

function syncVisibleImportCheckboxes() {
  document.querySelectorAll("#import-preview-list .import-row").forEach((card) => {
    const row = importRows[Number(card.dataset.rowIndex)];
    if (!row) return;
    const checkbox = card.querySelector(".import-row-select input");
    if (checkbox) checkbox.checked = Boolean(row.selected);
  });
}

document.querySelector("#import-select-all").addEventListener("change", (event) => {
  setAllImportRowsSelected(event.currentTarget.checked);
  updateImportSummary();
});
document.querySelector("#import-cancel").addEventListener("click", () => {
  importRows = [];
  pendingImportFiles = [];
  renderImportFileList();
  document.querySelector("#import-preview-panel").hidden = true;
  document.querySelector("#import-form").reset();
  importDestinationSelect.disabled = false;
});
// "Salin Semua Langsung" mencentang semua baris lalu memakai alur commit
// yang sama, supaya hasilnya persis seperti impor manual.
document.querySelector("#import-commit-all")?.addEventListener("click", () => {
  setAllImportRowsSelected(true);
  updateImportSummary();
  document.querySelector("#import-commit").click();
});

document.querySelector("#import-commit").addEventListener("click", async () => {
  const errorElement = document.querySelector("#import-commit-error");
  const resultElement = document.querySelector("#import-result");
  errorElement.textContent = "";
  const selectedImportRows = importRows.filter((row) => row.selected);
  const problemCounts = new Map();
  for (const row of selectedImportRows) {
    for (const problem of importRowProblems(row)) {
      problemCounts.set(problem, (problemCounts.get(problem) || 0) + 1);
    }
  }
  const invalidCount = selectedImportRows.filter((row) => !importRowIsValid(row)).length;
  // Semua baris terpilih dikirim apa adanya. Server membersihkan field yang
  // tak terbaca dan mencatat sisanya di Tinjauan Data, jadi tidak ada data
  // warga yang hilang karena satu kolom bermasalah.
  const selectedRows = selectedImportRows.filter(importRowIsValid).map((row) => {
    const cleanRow = {};
    for (const [field] of currentImportFields()) cleanRow[field] = row[field] ?? "";
    if (row.source_file) cleanRow.source_file = row.source_file;
    cleanRow.rt = cleanRow.rt === "" ? "" : Number(cleanRow.rt);
    cleanRow.rw = cleanRow.rw === "" ? "" : Number(cleanRow.rw);
    return cleanRow;
  });
  if (!selectedRows.length) {
    errorElement.textContent = "Pilih minimal satu baris yang punya nama untuk diimpor.";
    return;
  }
  const duplicateAction =
    document.querySelector('input[name="import_duplicate_action"]:checked')?.value === "replace"
      ? "replace"
      : "skip";
  try {
    const result = await request("/api/admin/import/commit", {
      method: "POST",
      body: JSON.stringify({ destination: importDestination, duplicate_action: duplicateAction, rows: selectedRows }),
    });
    const destinationLabel = importDestination === "contributions" ? "warga iuran" : "data warga wafat";
    const summaryParts = [`${result.created} ${destinationLabel} ditambahkan`];
    if (result.updated) summaryParts.push(`${result.updated} data diperbarui`);
    if (result.payments_created) summaryParts.push(`${result.payments_created} setoran dicatat`);
    if (result.payments_updated) summaryParts.push(`${result.payments_updated} setoran diperbarui`);
    if (result.skipped_duplicates) summaryParts.push(`${result.skipped_duplicates} duplikat dilewati`);
    if (invalidCount) summaryParts.push(`${invalidCount} baris tanpa nama dilewati`);
    resultElement.textContent = `Impor selesai: ${summaryParts.join("; ")}.`;
    resultElement.hidden = false;
    importRows = [];
    document.querySelector("#import-preview-list").replaceChildren();
    document.querySelector("#import-warnings").replaceChildren();
    document.querySelector("#import-notice").hidden = true;
    document.querySelector("#import-preview-panel").hidden = true;
    document.querySelector("#import-duplicate-choice").hidden = true;
    const skipRadio = document.querySelector('input[name="import_duplicate_action"][value="skip"]');
    if (skipRadio) skipRadio.checked = true;
    updateImportSummary();
    importDestinationSelect.disabled = false;
    if (importDestination === "contributions") await loadContributionResidents();
    else await refreshRecords();
    showImportDone(
      result,
      destinationLabel,
      duplicateAction,
      invalidCount,
      [...problemCounts.entries()].sort((left, right) => right[1] - left[1]),
    );
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#import-duplicate-choice")?.addEventListener("change", (event) => {
  if (!event.target.matches('input[name="import_duplicate_action"]')) return;
  const useReplace = event.target.value === "replace";
  importRows.forEach((row) => {
    if (row.duplicate) row.selected = useReplace;
  });
  syncVisibleImportCheckboxes();
  updateImportSummary();
});
const IMPORT_OUTCOME_LABELS = {
  created: "Ditambahkan",
  updated: "Diperbarui",
  skipped: "Dilewati",
  invalid: "Tidak valid",
  payment_created: "Setoran baru",
  payment_updated: "Setoran diperbarui",
};

const IMPORT_OUTCOME_FIELDS = {
  created: ["created"],
  updated: ["updated"],
  payment_created: ["payments_created"],
  payment_updated: ["payments_updated"],
};

// Setiap butir statistik menyimpan daftar baris yang membentuknya.
let importReportGroups = [];

function buildImportReportGroups(result, problemCounts) {
  const outcomes = Array.isArray(result.outcomes) ? result.outcomes : [];
  const byOutcome = new Map();
  for (const item of outcomes) {
    const key = item.outcome || "skipped";
    if (!byOutcome.has(key)) byOutcome.set(key, []);
    byOutcome.get(key).push({
      row: item.row_index || 0,
      file: item.source_file || "-",
      name: item.full_name || "(tanpa nama)",
      reason: item.reason || "",
      detail: Boolean(item.detail),
    });
  }
  // Nomor baris harus sama dengan yang dikirim ke server, yaitu urutan baris
  // yang DIPILIH saja. importRows.indexOf() tidak bisa dipakai karena O(n^2).
  const clientProblems = new Map();
  const clientProblemRows = new Map();
  const selectedRows = importRows.filter((row) => row.selected);
  selectedRows.forEach((row, position) => {
    const entry = {
      row: position + 1,
      file: row.source_file || "-",
      name: row.full_name || "(tanpa nama)",
      reason: "",
    };
    for (const problem of importRowProblems(row)) {
      if (!clientProblems.has(problem)) clientProblems.set(problem, []);
      clientProblems.get(problem).push(entry);
      if (!clientProblemRows.has(problem)) clientProblemRows.set(problem, new Map());
      clientProblemRows.get(problem).set(`${entry.file}|${entry.row}`, entry);
    }
  });
  const groups = [];
  for (const [outcome, items] of byOutcome) {
    groups.push({
      id: outcome,
      label: IMPORT_OUTCOME_LABELS[outcome] || outcome,
      count: items.length,
      items,
      // Satu baris bisa punya beberapa status (warga dibuat + setoran dicatat).
      // onlyRows dipakai agar jumlah pada tombol sama dengan jumlah baris.
      onlyRows: items.filter((item) => !item.detail),
      source: "server",
    });
  }
  for (const [problem, items] of clientProblems) {
    const unique = [...(clientProblemRows.get(problem) || new Map()).values()];
    groups.push({
      id: `problem:${problem}`,
      label: problem,
      count: items.length,
      items: unique,
      source: "klien",
    });
  }
  return groups;
}

function importReportToCsv(groups) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [["File", "Baris", "Nama", "Kategori", "Keterangan"].map(escape).join(",")];
  for (const group of groups) {
    for (const rawItem of group.items) {
      const entries = rawItem && Array.isArray(rawItem.rows)
        ? rawItem.rows.map((item) => ({ ...item, reason: rawItem.label }))
        : [rawItem];
      for (const item of entries) {
        lines.push([item.file, item.row, item.name, group.label, item.reason || ""].map(escape).join(","));
      }
    }
  }
  return lines.join("\n");
}

function openImportReport(groupId) {
  const group = importReportGroups.find((item) => item.id === groupId);
  if (!group) return;
  const title = document.querySelector("#import-report-title");
  const note = document.querySelector("#import-report-note");
  const body = document.querySelector("#import-report-body");
  const download = document.querySelector("#import-report-download");
  title.textContent = `${group.label} - ${group.count} baris`;
  note.textContent = group.source === "server"
    ? "Daftar baris yang dilaporkan server saat impor."
    : "Daftar baris yang ditolak pemeriksaan pratinjau di peramban.";
  body.replaceChildren();
  for (const rawItem of group.items) {
    // Grup "alasan" menyimpan daftar {alasan, baris}; grup lain satu baris biasa.
    const entries = rawItem && Array.isArray(rawItem.rows)
      ? rawItem.rows.map((item) => ({ ...item, reason: rawItem.label }))
      : [rawItem];
    for (const item of entries) {
      const row = document.createElement("tr");
      for (const value of [item.file ?? "-", item.row ?? "-", item.name ?? "-", item.reason || "-"]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
  }
  download.onclick = () => {
    const blob = new Blob(["\ufeff" + importReportToCsv([group])], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `impor-${group.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const dialog = document.querySelector("#import-report-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function showImportDone(result, destinationLabel, duplicateAction, invalidCount, problemCounts = []) {
  const groups = buildImportReportGroups(result, problemCounts);
  importReportGroups = groups;
  const items = [];
  const addGroup = (group, text, className) => {
    if (!group) return;
    const count = group.onlyRows ? group.onlyRows.length : group.count;
    if (!count) return;
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = `${text} - klik untuk rincian`;
    button.addEventListener("click", () => openImportReport(group.id));
    row.append(button);
    items.push(row);
  };
  addGroup(groups.find((group) => group.id === "created"), `${result.created} ${destinationLabel} ditambahkan`, "is-added");
  addGroup(groups.find((group) => group.id === "updated"), `${result.updated} data diperbarui`, "is-updated");
  addGroup(groups.find((group) => group.id === "payment_created"), `${result.payments_created} setoran dicatat`, "is-added");
  addGroup(groups.find((group) => group.id === "payment_updated"), `${result.payments_updated} setoran diperbarui`, "is-updated");
  if (result.skipped_duplicates) {
    addGroup(
      groups.find((group) => group.id === "skipped"),
      `${result.skipped_duplicates} data duplikat dilewati`,
      duplicateAction === "replace" ? "is-more" : "is-error",
    );
  }
  // Baris yang benar-benar tidak bisa disimpan: gabungan temuan server dan
  // pemeriksaan peramban, dikunci per file+baris supaya tidak terhitung ganda.
  const invalidRows = [];
  const seenInvalid = new Set();
  for (const group of groups) {
    if (group.id !== "invalid" && group.source !== "klien") continue;
    for (const item of group.items) {
      const key = `${item.file}|${item.row}`;
      if (seenInvalid.has(key)) continue;
      seenInvalid.add(key);
      invalidRows.push(item);
    }
  }
  const invalidGroup = {
    id: "__invalid",
    count: invalidRows.length,
    items: invalidRows,
    label: "tidak valid",
    source: "klien",
  };
  addGroup(invalidGroup, `${invalidCount} baris tanpa nama dilewati`, "is-more");
  const stats = document.querySelector("#import-done-stats");
  stats.replaceChildren();
  items.forEach((row) => stats.append(row));
  // Tabel "alasan" menampilkan satu baris per alasan, jadi jumlahnya sama
  // dengan jumlah alasan, bukan jumlah baris bermasalah.
  const problemGroup = {
    id: "__problems",
    count: problemCounts.length,
    label: "catatan",
    source: "klien",
    items: problemCounts.map(([problem]) => {
      const group = groups.find((item) => item.id === `problem:${problem}`);
      return { label: problem, rows: group ? group.items : [{ file: "-", row: 0, name: "-" }] };
    }),
  };
  importReportGroups = [...groups, invalidGroup, problemGroup].filter((group) => group.count > 0);
  if (problemGroup.count) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "is-more";
    button.textContent = `${problemCounts.length} catatan - klik untuk rincian`;
    button.addEventListener("click", () => openImportReport("__problems"));
    row.append(button);
    stats.append(row);
  }
  const totalChanges =
    result.created + (result.updated || 0) + (result.payments_created || 0) + (result.payments_updated || 0);
  document.querySelector("#import-done-note").textContent = totalChanges
    ? duplicateAction === "replace"
      ? "Mode replace dipakai: data lama dengan identitas sama ditimpa oleh isi file."
      : "Mode lewati dipakai: data lama dipertahankan dan baris duplikat tidak diimpor."
    : "Tidak ada perubahan data.";
  const dialog = document.querySelector("#import-done-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}
document.querySelector("#import-done-confirm")?.addEventListener("click", () => {
  document.querySelector("#import-done-dialog").close();
});

// Dialog rincian: tutup lewat tombol, Escape, atau klik di luar isi.
function closeImportReport() {
  document.querySelector("#import-report-dialog")?.close();
}
for (const selector of ["#import-report-close", "#import-report-done"]) {
  document.querySelector(selector)?.addEventListener("click", closeImportReport);
}
document.querySelector("#import-report-dialog")?.addEventListener("click", (event) => {
  if (event.target.closest(".import-report-scroll, .dialog-top, .import-actions")) return;
  closeImportReport();
});
document.querySelector("#detail-record-select").addEventListener("change", () => {
  document.querySelector("#identity-form").dataset.recordId = "";
  showSelectedPrivateData();
});
document.querySelector('#identity-form input[name="publish_address"]').addEventListener("change", (event) => {
  document.querySelector("#family-address-hint").textContent = event.currentTarget.checked
    ? "Alamat akan ditampilkan secara publik."
    : "Alamat hanya dapat dilihat oleh pengelola.";
});
document.querySelector("#identity-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#identity-error");
  errorElement.textContent = "";
  const fields = Object.fromEntries(new FormData(form));
  fields.address = form.elements.address.value;
  fields.publish_address = form.elements.publish_address.checked;
  try {
    await request("/api/admin/record-details", {
      method: "POST",
      body: JSON.stringify({ record_id: Number(document.querySelector("#detail-record-select").value), ...fields }),
    });
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#family-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#family-error");
  errorElement.textContent = "";
  try {
    const payload = Object.fromEntries(new FormData(form));
    const recordId = document.querySelector("#detail-record-select").value;
    await request(`/api/admin/records/${recordId}/family`, { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#portrait-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#portrait-error");
  errorElement.textContent = "";
  const file = new FormData(form).get("image");
  try {
    await uploadImage(file, "portrait", {
      record_id: Number(document.querySelector("#detail-record-select").value),
      publish_portrait: form.elements.publish_portrait.checked,
    });
    form.reset();
    await refreshRecords(true);
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#delete-portrait-button").addEventListener("click", async () => {
  const errorElement = document.querySelector("#portrait-error");
  errorElement.textContent = "";
  try {
    const deleted = await deleteAdminMedia("portrait", {
      record_id: Number(document.querySelector("#detail-record-select").value),
    }, "Hapus foto warga ini?");
    if (!deleted) return;
    document.querySelector("#portrait-status").textContent = "Foto warga telah dihapus.";
    await refreshRecords();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const siteIconForm = document.querySelector("#site-icon-form");
siteIconForm.elements.slot.addEventListener("change", updateSiteIconControls);
siteIconForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = document.querySelector("#site-icon-error");
  errorElement.textContent = "";
  const file = form.elements.image.files[0];
  if (!file) {
    errorElement.textContent = "Pilih file gambar untuk logo.";
    return;
  }
  try {
    const slot = Number(form.elements.slot.value);
    await uploadImage(file, "site_icon", { slot });
    form.reset();
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#delete-site-icon-button").addEventListener("click", async () => {
  const errorElement = document.querySelector("#site-icon-error");
  errorElement.textContent = "";
  const slot = Number(siteIconForm.elements.slot.value);
  try {
    const deleted = await deleteAdminMedia("site_icon", { slot }, `Hapus Logo ${slot}?`);
    if (!deleted) return;
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const themeLogoForm = document.querySelector("#theme-logo-form");
document.querySelector("#media-target-select").addEventListener("change", updateThemeLogoLocationControls);
themeLogoForm.elements.slot.addEventListener("change", updateThemeLogoControls);
themeLogoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#theme-logo-error");
  errorElement.textContent = "";
  const file = themeLogoForm.elements.image.files[0];
  if (!file) {
    errorElement.textContent = "Pilih file logo untuk mode yang dipilih.";
    return;
  }
  try {
    const slot = Number(themeLogoForm.elements.slot.value);
    const target = selectedMediaTarget();
    await uploadImage(file, "theme_logo", { slot, target });
    themeLogoForm.elements.image.value = "";
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#delete-theme-logo-button").addEventListener("click", async () => {
  const errorElement = document.querySelector("#theme-logo-error");
  errorElement.textContent = "";
  const slot = Number(themeLogoForm.elements.slot.value);
  const target = selectedMediaTarget();
  const themeLabel = slot === 1 ? "terang" : "gelap";
  const targetLabel = mediaTargetLabel(target);
  try {
    const deleted = await deleteAdminMedia("theme_logo", { slot, target }, `Hapus logo mode ${themeLabel} untuk ${targetLabel}?`);
    if (!deleted) return;
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
for (const slot of [1, 2]) {
  const form = document.querySelector(`#export-logo-${slot}-form`);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector(`#export-logo-${slot}-error`);
    errorElement.textContent = "";
    const file = form.elements.image.files[0];
    if (!file) {
      errorElement.textContent = "Pilih gambar logo kop terlebih dahulu.";
      return;
    }
    try {
      await uploadImage(file, "export_logo", { slot });
      form.reset();
      await loadSettings();
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
  document.querySelector(`#delete-export-logo-${slot}-button`).addEventListener("click", async () => {
    const errorElement = document.querySelector(`#export-logo-${slot}-error`);
    errorElement.textContent = "";
    try {
      const deleted = await deleteAdminMedia("export_logo", { slot }, `Hapus Logo Ekspor ${slot}?`);
      if (deleted) await loadSettings();
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
}
const exportHeaderForm = document.querySelector("#export-header-form");
async function clearTextSettings(form, fields, errorElement, confirmation) {
  errorElement.textContent = "";
  if (!window.confirm(confirmation)) return;
  const values = Object.fromEntries(fields.map((field) => [field, ""]));
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, ...values }),
    });
    delete form.dataset.dirty;
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
}
exportHeaderForm.addEventListener("input", () => {
  exportHeaderForm.dataset.dirty = "true";
});
exportHeaderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#export-header-error");
  errorElement.textContent = "";
  const payload = {
    rt_count: settings.rt_count,
    rw_count: settings.rw_count,
    export_header_title: exportHeaderForm.elements.export_header_title.value,
    export_header_line_2: exportHeaderForm.elements.export_header_line_2.value,
    export_header_line_3: exportHeaderForm.elements.export_header_line_3.value,
  };
  try {
    await request("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    delete exportHeaderForm.dataset.dirty;
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#clear-export-header-button").addEventListener("click", () => {
  clearTextSettings(exportHeaderForm,
    ["export_header_title", "export_header_line_2", "export_header_line_3"],
    document.querySelector("#export-header-error"), "Hapus seluruh teks Kop Ekspor?");
});
const signatureSettingsForm = document.querySelector("#signature-settings-form");
const signatureRtUnitSelect = document.querySelector("#signature-rt-unit-select");
const signatureRtStatus = document.querySelector("#signature-rt-status");
let signatureRtNames = {};
let signatureRtImages = {};
let signatureRtCommonName = "";
let signatureRtCommonImage = false;

/* DROPDOWN RT: setiap wilayah bisa punya tanda tangan Ketua RT sendiri. */
function fillSignatureRtUnits() {
  if (!signatureRtUnitSelect) return;
  const selected = signatureRtUnitSelect.value;
  signatureRtUnitSelect.replaceChildren();
  signatureRtUnitSelect.add(new Option("Semua RT (umum)", ""));
  const count = Number(settings.rt_count) || 1;
  for (let unit = 1; unit <= count; unit += 1) {
    signatureRtUnitSelect.add(new Option(`RT ${String(unit).padStart(3, "0")}`, String(unit)));
  }
  signatureRtUnitSelect.value = [...signatureRtUnitSelect.options].some((option) => option.value === selected)
    ? selected
    : "";
}

function loadSignatureRtUnit() {
  if (!signatureRtUnitSelect) return;
  const unit = signatureRtUnitSelect.value;
  if (unit) {
    signatureSettingsForm.elements.signature_rt_name.value = signatureRtNames[unit] || "";
    signatureRtStatus.textContent = signatureRtImages[unit]
      ? `Gambar tanda tangan RT ${String(unit).padStart(3, "0")} tersimpan.`
      : `Belum ada gambar tanda tangan khusus RT ${String(unit).padStart(3, "0")}.`;
  } else {
    signatureSettingsForm.elements.signature_rt_name.value = signatureRtCommonName;
    signatureRtStatus.textContent = signatureRtCommonImage
      ? "Gambar tanda tangan umum tersimpan."
      : "Belum ada gambar tanda tangan umum.";
  }
}

signatureRtUnitSelect?.addEventListener("change", () => {
  loadSignatureRtUnit();
});
signatureSettingsForm.addEventListener("input", () => { signatureSettingsForm.dataset.dirty = "true"; });
signatureSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#signature-error");
  errorElement.textContent = "";
  const form = event.currentTarget;
  const selectedRtUnit = signatureRtUnitSelect ? signatureRtUnitSelect.value : "";
  const signaturePayload = {
    signature_date: form.elements.signature_date.value,
    signature_show_bsk: form.elements.signature_show_bsk.checked,
    signature_show_rw: form.elements.signature_show_rw.checked,
    signature_show_lmk: form.elements.signature_show_lmk.checked,
    signature_show_rt: form.elements.signature_show_rt.checked,
    signature_show_maker: form.elements.signature_show_maker.checked,
    signature_maker_name: form.elements.signature_maker_name.value,
    signature_lmk_name: form.elements.signature_lmk_name.value,
    signature_rw_name: form.elements.signature_rw_name.value,
    signature_bsk_name: form.elements.signature_bsk_name.value,
    signature_place: form.elements.signature_place.value,
    signature_note: form.elements.signature_note.value,
    signature_label_maker: form.elements.signature_label_maker.value,
    signature_label_rt: form.elements.signature_label_rt.value,
    signature_label_lmk: form.elements.signature_label_lmk.value,
    signature_label_rw: form.elements.signature_label_rw.value,
    signature_label_bsk: form.elements.signature_label_bsk.value,
  };
  // Nama Ketua RT disimpan ke wilayah yang dipilih pada dropdown, jadi
  // mengetik di RT 002 tidak menimpa RT 001.
  if (selectedRtUnit) {
    signaturePayload[`signature_rt_name_${String(selectedRtUnit).padStart(3, "0")}`] = form.elements.signature_rt_name.value;
  } else {
    signaturePayload.signature_rt_name = form.elements.signature_rt_name.value;
  }
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, ...signaturePayload }),
    });
    const signatureInputs = [
      ["maker", form.elements.signature_maker],
      ["rt", form.elements.signature_rt],
      ["lmk", form.elements.signature_lmk],
      ["rw", form.elements.signature_rw],
      ["bsk", form.elements.signature_bsk],
    ];
    for (const [, input] of signatureInputs) {
      const file = input.files && input.files[0];
      if (file && file.size > 5 * 1024 * 1024) throw new Error("Setiap gambar tanda tangan maksimal 5 MB.");
    }
    for (const [role, input] of signatureInputs) {
      const file = input.files && input.files[0];
      if (!file) continue;
      if (role === "rt" && selectedRtUnit) {
        await uploadImage(file, "signature", { role, unit_number: Number(selectedRtUnit) });
      } else {
        await uploadImage(file, "signature", { role });
      }
    }
    delete signatureSettingsForm.dataset.dirty;
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const signaturePadDialog = document.querySelector("#signature-pad-dialog");
const signaturePadCanvas = document.querySelector("#signature-pad-canvas");
const signaturePadRole = document.querySelector("#signature-pad-role");
let signaturePadRoleName = "";
const signaturePadCtx = signaturePadCanvas.getContext("2d");
let signatureDrawing = false;
signaturePadCtx.lineWidth = 3.5;
signaturePadCtx.lineCap = "round";
signaturePadCtx.lineJoin = "round";
signaturePadCtx.strokeStyle = "#111111";

function clearSignaturePad() {
  signaturePadCtx.clearRect(0, 0, signaturePadCanvas.width, signaturePadCanvas.height);
  signaturePadCtx.fillStyle = "#ffffff";
  signaturePadCtx.fillRect(0, 0, signaturePadCanvas.width, signaturePadCanvas.height);
}
clearSignaturePad();

function signaturePadPoint(event) {
  const rect = signaturePadCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * signaturePadCanvas.width / rect.width, y: (event.clientY - rect.top) * signaturePadCanvas.height / rect.height };
}
signaturePadCanvas.addEventListener("pointerdown", (event) => {
  signatureDrawing = true;
  const p = signaturePadPoint(event);
  signaturePadCtx.beginPath();
  signaturePadCtx.moveTo(p.x, p.y);
  event.preventDefault();
});
signaturePadCanvas.addEventListener("pointermove", (event) => {
  if (!signatureDrawing) return;
  const p = signaturePadPoint(event);
  signaturePadCtx.lineTo(p.x, p.y);
  signaturePadCtx.stroke();
  event.preventDefault();
});
for (const end of ["pointerup", "pointerleave", "pointercancel"]) {
  signaturePadCanvas.addEventListener(end, () => { signatureDrawing = false; });
}
document.querySelector("#signature-pad-clear").addEventListener("click", clearSignaturePad);
document.querySelector("#signature-pad-close").addEventListener("click", () => signaturePadDialog.close());
signaturePadDialog.addEventListener("click", (event) => { if (event.target === signaturePadDialog) signaturePadDialog.close(); });
signaturePadDialog.addEventListener("cancel", () => signaturePadDialog.close());
// Tutup panel tanda tangan selalu mengembalikan dropdown jabatan dan
// membersihkan sisa konteks formulir pendaftaran.
signaturePadDialog.addEventListener("close", () => {
  delete signaturePadCanvas.dataset.registrationRole;
  delete signaturePadCanvas.dataset.registrationId;
  delete signaturePadCanvas.dataset.registrationName;
  const roleSelect = document.querySelector("#signature-pad-role-select");
  if (roleSelect) {
    roleSelect.disabled = false;
    const wrapper = roleSelect.closest("label");
    if (wrapper) wrapper.style.display = "";
  }
});

// Close button for family dialog
const familyDialog = document.querySelector("#family-dialog");
if (familyDialog) {
  document.querySelector("#family-dialog-close")?.addEventListener("click", () => familyDialog.close());
  familyDialog.addEventListener("click", (event) => { if (event.target === familyDialog) familyDialog.close(); });
  familyDialog.addEventListener("cancel", () => familyDialog.close());
}

// Close button for contribution history dialog
const contributionHistoryDialog = document.querySelector("#contribution-history-dialog");
if (contributionHistoryDialog) {
  document.querySelector("#contribution-history-close")?.addEventListener("click", () => contributionHistoryDialog.close());
  contributionHistoryDialog.addEventListener("click", (event) => { if (event.target === contributionHistoryDialog) contributionHistoryDialog.close(); });
  contributionHistoryDialog.addEventListener("cancel", () => contributionHistoryDialog.close());
}
document.querySelector("#signature-pad-save").addEventListener("click", async () => {
  const error = document.querySelector("#signature-error");
  error.textContent = "";
  signaturePadCanvas.toBlob(async (blob) => {
    if (!blob) return;
    if (blob.size < 500) {
      error.textContent = "Tulis atau gambar tanda tangan dulu sebelum disimpan.";
      return;
    }
    const saveRole = document.querySelector("#signature-pad-role-select").value;
    const file = new File([blob], `signature-${saveRole}.png`, { type: "image/png" });
    // Panel tanda tangan pada formulir pendaftaran menyimpan gambar ke
    // formulir itu sendiri, bukan ke tanda tangan global per jabatan.
    const registrationRole = signaturePadCanvas.dataset.registrationRole;
    if (registrationRole) {
      const registrationName = signaturePadCanvas.dataset.registrationName || "";
      try {
        const result = await request("/api/admin/registration-signature", {
          method: "POST",
          body: JSON.stringify({
            registration_id: Number(signaturePadCanvas.dataset.registrationId),
            role: registrationRole,
            name: registrationName,
            content_type: file.type,
            content_base64: await imageBase64(file, "Menyiapkan tanda tangan..."),
          }),
        });
        signaturePadDialog.close();
        window.onRegistrationSignatureSaved?.(result.registration);
      } catch (uploadError) {
        error.textContent = uploadError.message;
      }
      return;
    }
    // Gambar yang digambar langsung mengikuti wilayah yang dipilih pada dropdown,
    // supaya tidak menimpa tanda tangan RT lain.
    const selectedRtUnit = signaturePadRoleName === "rt" && signatureRtUnitSelect ? signatureRtUnitSelect.value : "";
    try {
      if (selectedRtUnit) {
        await uploadImage(file, "signature", { role: saveRole, unit_number: Number(selectedRtUnit) });
      } else {
        await uploadImage(file, "signature", { role: saveRole });
      }
      signaturePadDialog.close();
      await loadSettings();
    } catch (uploadError) {
      error.textContent = uploadError.message;
    }
  }, "image/png");
});
document.querySelectorAll(".signature-draw-button").forEach((button) => {
  button.addEventListener("click", () => {
    signaturePadRoleName = button.dataset.role;
    document.querySelector("#signature-pad-role-select").value = signaturePadRoleName;
    const roleLabels = { maker: "Yang membuat", rt: "Ketua RT", lmk: "LMK RW", rw: "Ketua RW", bsk: "Ketua BSK" };
    signaturePadRole.textContent = `Menggambar tanda tangan untuk: ${roleLabels[signaturePadRoleName] || signaturePadRoleName}`;
    clearSignaturePad();
    signaturePadDialog.showModal();
  });
});
document.querySelector("#contribution-signature-pad-button").addEventListener("click", () => {
  signaturePadRoleName = "maker";
  document.querySelector("#signature-pad-role-select").value = "maker";
  signaturePadRole.textContent = "Menggambar tanda tangan untuk: Yang membuat / pengisi data";
  clearSignaturePad();
  signaturePadDialog.showModal();
});
const footerSettingsForm = document.querySelector("#footer-settings-form");
const footerLogoScaleSlot = footerSettingsForm.elements.logo_scale_slot;
const footerLogoScaleSlider = footerSettingsForm.elements.logo_scale;
footerLogoScaleSlot.addEventListener("change", () => {
  const slot = Number(footerLogoScaleSlot.value);
  footerLogoScaleSlider.value = settings[`icon_zoom_${slot}`];
  updateFooterLogoScalePreview();
  footerSettingsForm.dataset.logoScaleDirty = "true";
  document.querySelector("#footer-logo-scale-status").textContent = "Perubahan ukuran logo belum disimpan.";
  document.querySelector("#footer-logo-scale-error").textContent = "";
});
footerLogoScaleSlider.addEventListener("input", () => {
  updateFooterLogoScalePreview();
  footerSettingsForm.dataset.logoScaleDirty = "true";
  document.querySelector("#footer-logo-scale-status").textContent = "Pratinjau berubah. Simpan ukuran logo untuk menerapkan ke website.";
  document.querySelector("#footer-logo-scale-error").textContent = "";
});
footerSettingsForm.addEventListener("input", (event) => {
  if (["logo_scale", "logo_scale_slot"].includes(event.target.name)) return;
  footerSettingsForm.dataset.dirty = "true";
  document.querySelector("#footer-settings-result").hidden = true;
});
document.querySelector("#save-footer-logo-scale").addEventListener("click", async () => {
  const status = document.querySelector("#footer-logo-scale-status");
  const error = document.querySelector("#footer-logo-scale-error");
  const slot = Number(footerLogoScaleSlot.value);
  const scale = Number(footerLogoScaleSlider.value);
  status.textContent = "";
  error.textContent = "";
  if (!siteIconAvailability[slot]) {
    error.textContent = `Logo ${slot} belum dipasang.`;
    return;
  }
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, [`icon_zoom_${slot}`]: scale }),
    });
    settings[`icon_zoom_${slot}`] = scale;
    delete footerSettingsForm.dataset.logoScaleDirty;
    status.textContent = `Ukuran Logo ${slot} tersimpan.`;
    await loadSettings();
    footerLogoScaleSlot.value = String(slot);
    footerLogoScaleSlider.value = String(scale);
    updateFooterLogoScalePreview();
  } catch (saveError) {
    error.textContent = saveError.message;
  }
});
footerSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#footer-settings-error");
  const resultElement = document.querySelector("#footer-settings-result");
  errorElement.textContent = "";
  resultElement.hidden = true;
  const values = Object.fromEntries(new FormData(footerSettingsForm));
  const logoSlot = Number(values.logo_scale_slot);
  const logoScale = Number(values.logo_scale);
  delete values.logo_scale_slot;
  delete values.logo_scale;
  if (![1, 2].includes(logoSlot) || !Number.isInteger(logoScale) || logoScale < 0 || logoScale > 300) {
    errorElement.textContent = "Pilih slot dan skala logo yang valid.";
    return;
  }
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, ...values, [`icon_zoom_${logoSlot}`]: logoScale }),
    });
    settings[`icon_zoom_${logoSlot}`] = logoScale;
    delete footerSettingsForm.dataset.dirty;
    delete footerSettingsForm.dataset.logoScaleDirty;
    await loadSettings();
    footerLogoScaleSlot.value = String(logoSlot);
    footerLogoScaleSlider.value = String(logoScale);
    updateFooterLogoScalePreview();
    resultElement.textContent = "Footer dan skala logo berhasil disimpan.";
    resultElement.hidden = false;
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#clear-footer-settings-button").addEventListener("click", () => {
  clearTextSettings(footerSettingsForm,
    ["footer_brand", "footer_area", "footer_location", "footer_map_query"],
    document.querySelector("#footer-settings-error"), "Hapus seluruh teks Footer dan Lokasi?");
});
const donationSettingsForm = document.querySelector("#donation-settings-form");
donationSettingsForm.addEventListener("input", () => {
  donationSettingsForm.dataset.dirty = "true";
});
donationSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#donation-settings-error");
  errorElement.textContent = "";
  const values = Object.fromEntries(new FormData(donationSettingsForm));
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, ...values }),
    });
    delete donationSettingsForm.dataset.dirty;
    await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#clear-donation-settings-button").addEventListener("click", () => {
  clearTextSettings(donationSettingsForm,
    ["donation_title", "donation_description", "donation_recipient", "donation_dana", "donation_ovo", "donation_bank_name", "donation_bank_account", "donation_bank_holder", "donation_dana_link", "donation_ovo_link", "donation_bank_link"],
    document.querySelector("#donation-settings-error"), "Hapus seluruh teks dan informasi Dana Apresiasi?");
});
for (const [formId, kind, errorId] of [
  ["hero-image-form", "hero_image", "hero-image-error"],
]) {
  document.querySelector(`#${formId}`).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorElement = document.querySelector(`#${errorId}`);
    errorElement.textContent = "";
    const file = new FormData(form).get("image");
    try {
      await uploadImage(file, kind);
      form.reset();
      await loadSettings();
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
}
document.querySelector("#delete-hero-image-button").addEventListener("click", async () => {
  const errorElement = document.querySelector("#hero-image-error");
  errorElement.textContent = "";
  try {
    const deleted = await deleteAdminMedia("hero_image", {}, "Hapus Gambar Tampilan Utama?");
    if (deleted) await loadSettings();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const heroPlaylistForm = document.querySelector("#hero-playlist-form");
heroPlaylistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...heroPlaylistForm.elements.media.files];
  const errorElement = document.querySelector("#hero-playlist-error");
  const statusElement = document.querySelector("#hero-playlist-status");
  const submitButton = heroPlaylistForm.querySelector("button[type='submit']");
  errorElement.textContent = "";
  statusElement.textContent = "";
  if (!files.length) {
    errorElement.textContent = "Pilih minimal satu foto atau video.";
    return;
  }
  submitButton.disabled = true;
  let uploaded = 0;
  try {
    for (const file of files) {
      statusElement.textContent = `Mengunggah ${uploaded + 1} dari ${files.length}: ${file.name}`;
      const result = await withProcessing(async () => {
        const mediaType = file.type || (/\.mp4$/i.test(file.name) ? "video/mp4" : /\.webm$/i.test(file.name) ? "video/webm" : "application/octet-stream");
        const response = await fetch("/api/admin/hero-playlist", {
          method: "POST",
          headers: { "Content-Type": mediaType, "X-Media-Name": encodeURIComponent(file.name) },
          body: file,
        });
        const payload = await readApiResponse(response, "Media slideshow tidak dapat diunggah.");
        return payload;
      }, "Mengunggah media slideshow...");
      uploaded += 1;
      renderHeroPlaylistItems(result.items || []);
      updateHeroPlaylist(result.items || []);
    }
    heroPlaylistForm.reset();
    statusElement.textContent = `${uploaded} media berhasil ditambahkan.`;
  } catch (error) {
    errorElement.textContent = error.message;
    statusElement.textContent = uploaded ? `${uploaded} media berhasil ditambahkan sebelum proses berhenti.` : "";
  } finally {
    submitButton.disabled = false;
  }
});
const heroBackgroundScaleForm = document.querySelector("#hero-background-scale-form");
const heroBackgroundScaleSlider = heroBackgroundScaleForm.elements.hero_background_scale;
heroBackgroundScaleSlider.addEventListener("input", () => {
  const scale = Number(heroBackgroundScaleSlider.value);
  applyHeroBackgroundScale(scale);
  document.querySelector("#hero-background-scale-value").value = `${scale}%`;
});
const heroImagePositionSelect = document.querySelector("#hero-image-position");
heroImagePositionSelect.addEventListener("change", () => applyHeroImagePosition(heroImagePositionSelect.value));
heroBackgroundScaleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#hero-background-scale-error");
  errorElement.textContent = "";
  const scale = Number(heroBackgroundScaleSlider.value);
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({ rt_count: settings.rt_count, rw_count: settings.rw_count, hero_background_scale: scale, hero_image_position: heroImagePositionSelect.value }),
    });
    settings.hero_background_scale = scale;
    settings.hero_image_position = heroImagePositionSelect.value;
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#settings-error");
  errorElement.textContent = "";
  const formData = new FormData(settingsForm);
  try {
    await request("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        rt_count: Number(formData.get("rt_count")),
        rw_count: Number(formData.get("rw_count")),
      }),
    });
    await loadSettings();
    // Penandaan wilayah di luar jumlah RT/RW mengikuti jumlah terbaru.
    if (contactForm && !document.querySelector("#admin-view-contacts").hidden) renderAdminContacts(areaContactsAdmin);
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const maintenanceForm = document.querySelector("#maintenance-form");
maintenanceForm.addEventListener("input", () => {
  maintenanceForm.dataset.dirty = "true";
  document.querySelector("#maintenance-status").textContent = "Perubahan belum disimpan.";
  document.querySelector("#maintenance-result").hidden = true;
});
maintenanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#maintenance-error");
  const resultElement = document.querySelector("#maintenance-result");
  const enabled = maintenanceForm.elements.enabled.checked;
  const startLocal = maintenanceForm.elements.starts_at.value;
  const endLocal = maintenanceForm.elements.ends_at.value;
  const startDate = startLocal ? new Date(startLocal) : null;
  const endDate = endLocal ? new Date(endLocal) : null;
  errorElement.textContent = "";
  resultElement.hidden = true;
  if (enabled && (!startDate || !endDate)) {
    errorElement.textContent = "Isi waktu mulai dan selesai terlebih dahulu.";
    return;
  }
  if ((startDate && Number.isNaN(startDate.valueOf())) || (endDate && Number.isNaN(endDate.valueOf()))) {
    errorElement.textContent = "Periksa kembali tanggal dan jam maintenance.";
    return;
  }
  if (startDate && endDate && endDate <= startDate) {
    errorElement.textContent = "Waktu selesai harus setelah waktu mulai.";
    return;
  }
  try {
    await request("/api/admin/maintenance", {
      method: "POST",
      body: JSON.stringify({
        enabled,
        starts_at: startDate ? startDate.toISOString() : "",
        ends_at: endDate ? endDate.toISOString() : "",
        message: maintenanceForm.elements.message.value,
      }),
    });
    delete maintenanceForm.dataset.dirty;
    await loadSettings();
    resultElement.textContent = enabled
      ? "Jadwal tersimpan. Halaman maintenance tampil hanya selama rentang waktu yang dipilih."
      : "Maintenance dinonaktifkan.";
    resultElement.hidden = false;
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
const typographyForm = document.querySelector("#typography-form");
function previewTypographySettings() {
  const values = {
    font_preset: typographyForm.elements.font_preset.value,
    font_scale: Number(typographyForm.elements.font_scale.value),
    font_style: typographyForm.elements.font_style.value,
    font_style_target: typographyForm.elements.font_style_target.value,
    intro_text_alignment: typographyForm.elements.intro_text_alignment.value,
    news_text_alignment: typographyForm.elements.news_text_alignment.value,
    directory_text_alignment: typographyForm.elements.directory_text_alignment.value,
  };
  typographyForm.dataset.dirty = "true";
  document.querySelector("#site-font-scale-value").value = `${values.font_scale}%`;
  document.querySelector("#typography-result").hidden = true;
  document.querySelector("#typography-error").textContent = "";
  applySiteTypography(values);
}
typographyForm.addEventListener("input", previewTypographySettings);
typographyForm.addEventListener("change", previewTypographySettings);
typographyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = document.querySelector("#typography-error");
  const resultElement = document.querySelector("#typography-result");
  errorElement.textContent = "";
  resultElement.hidden = true;
  const values = {
    font_preset: typographyForm.elements.font_preset.value,
    font_scale: Number(typographyForm.elements.font_scale.value),
    font_style: typographyForm.elements.font_style.value,
    font_style_target: typographyForm.elements.font_style_target.value,
    intro_text_alignment: typographyForm.elements.intro_text_alignment.value,
    news_text_alignment: typographyForm.elements.news_text_alignment.value,
    directory_text_alignment: typographyForm.elements.directory_text_alignment.value,
  };
  try {
    await request("/api/admin/typography", { method: "POST", body: JSON.stringify(values) });
    settings.site_font_preset = values.font_preset;
    settings.site_font_scale = values.font_scale;
    settings.site_font_style = values.font_style;
    settings.site_font_style_target = values.font_style_target;
    settings.intro_text_alignment = values.intro_text_alignment;
    settings.news_text_alignment = values.news_text_alignment;
    settings.directory_text_alignment = values.directory_text_alignment;
    delete typographyForm.dataset.dirty;
    await loadSettings();
    resultElement.textContent = "Pengaturan tipografi tersimpan.";
    resultElement.hidden = false;
  } catch (error) {
    errorElement.textContent = error.message;
  }
});
document.querySelector("#print-records-button")?.addEventListener("click", () => {
  const preview = document.querySelector("#print-preview-panel");
  preview.hidden = false;
  preview.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#print-preview-back")?.addEventListener("click", () => {
  document.querySelector("#print-preview-panel").hidden = true;
});
document.querySelector("#print-preview-confirm")?.addEventListener("click", () => window.print());
document.querySelector("#print-pdf-button")?.addEventListener("click", () => {
  const params = new URLSearchParams({ type: "records" });
  params.set("q", adminRecordSearchInput.value.trim());
  params.set("sort", adminRecordSortSelect.value);
  window.open(`/api/admin/export/pdf?${params.toString()}`, "_blank");
});

// Contribution print preview handling
function renderContributionPrint() {
  const tbody = document.querySelector("#contribution-print-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  contributionResidents = originalContributionResidents;
  const selectedStatus = contributionStatusKey;
  let displayResidents = originalContributionResidents;
  if (familyFilterKK) {
    displayResidents = displayResidents.filter(r => r.family_card_number === familyFilterKK);
  }
  displayResidents = displayResidents.filter((resident) => matchesContributionStatus(resident, selectedStatus));
  const query = document.querySelector("#contribution-search")?.value.trim().toLocaleLowerCase("id-ID") || "";
  if (query) {
    displayResidents = displayResidents.filter((resident) => [resident.full_name, resident.national_id_number, resident.address, resident.rt, resident.rw, ...residentRtRwVariants(resident.rt, resident.rw)]
      .some((value) => String(value || "").toLocaleLowerCase("id-ID").includes(query)));
  }
  if (displayResidents.length) {
    displayResidents.forEach((resident, idx) => {
      const tr = document.createElement("tr");
      const rtLabel = resident.rt ? `RT ${String(resident.rt).padStart(3, "0")}` : "-";
      const rwLabel = resident.rw ? `RW ${String(resident.rw).padStart(3, "0")}` : "-";
      tr.innerHTML = `<td>${idx + 1}</td><td>${formatWords(resident.full_name)}</td><td>${resident.family_card_number || ''}</td><td>${resident.national_id_number || ''}</td><td>${rtLabel}</td><td>${rwLabel}</td><td>${formatGenderLabel(resident.gender)}</td><td>${formatWords(resident.birthplace)}</td><td>${resident.birth_date ? formatDate(resident.birth_date) : ''}</td><td>${formatWords(resident.religion)}</td><td>${formatWords(resident.relationship)}</td><td>${resident.phone || ''}</td><td>${formatWords(resident.residence_status)}</td>`;
      tbody.appendChild(tr);
    });
  } else {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="13" style="text-align:center;color:var(--muted);">Belum ada data warga iuran.</td>';
    tbody.appendChild(tr);
  }
}

document.querySelector("#contribution-print-button")?.addEventListener("click", () => {
  renderContributionPrint();
  const dialog = document.querySelector("#contribution-print-dialog");
  if (dialog) {
    if (!dialog.open) {
      dialog.showModal();
    }
  }
});

document.querySelector("#contribution-print-back")?.addEventListener("click", () => {
  const dialog = document.querySelector("#contribution-print-dialog");
  if (dialog) dialog.close();
});

document.querySelector("#contribution-print-confirm")?.addEventListener("click", () => window.print());
document.querySelector("#contribution-print-pdf")?.addEventListener("click", () => {
  const params = new URLSearchParams({ type: "contributions" });
  params.set("q", document.querySelector("#contribution-search")?.value.trim() || "");
  params.set("status", contributionStatusKey);
  if (familyFilterKK) params.set("family", familyFilterKK);
  window.open(`/api/admin/export/pdf?${params.toString()}`, "_blank");
});

// Fill contribution print table if panel is open
if (document.querySelector("#contribution-print-dialog") && document.querySelector("#contribution-print-dialog").open) {
  renderContributionPrint();
}

document.querySelector("#total-data")?.addEventListener("click", () => {
  selectedGenderFilter = "";
  recordsPage = 0;
  render();
});
for (const [selector, gender] of [["#total-l", "L"], ["#total-p", "P"]]) {
  document.querySelector(selector)?.addEventListener("click", () => {
    selectedGenderFilter = selectedGenderFilter === gender ? "" : gender;
    recordsPage = 0;
    render();
  });
}
searchInput?.addEventListener("input", () => { recordsPage = 0; render(); });
sortSelect?.addEventListener("change", () => { recordsPage = 0; render(); });
document.querySelectorAll("[data-record-sort]").forEach((header) => {
  header.tabIndex = 0;
  header.setAttribute("role", "button");
  const sort = () => {
    const key = header.dataset.recordSort;
    if (tableSortKey === key) tableSortDirection = tableSortDirection === "asc" ? "desc" : "asc";
    else { tableSortKey = key; tableSortDirection = "asc"; }
    recordsPage = 0;
    document.querySelectorAll("[data-record-sort]").forEach((item) => item.setAttribute("aria-sort", item === header ? tableSortDirection : "none"));
    render();
  };
  header.addEventListener("click", sort);
  header.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sort(); } });
});
const recordsPrevBtn = document.querySelector("#records-previous");
if (recordsPrevBtn) {
recordsPrevBtn.addEventListener("click", () => {
  recordsPage = Math.max(0, recordsPage - 1);
  render();
});
recordsPrevBtn.textContent = "‹";
recordsPrevBtn.setAttribute("aria-label", "Halaman sebelumnya");
recordsPrevBtn.title = "Halaman sebelumnya";
}
const recordsNextBtn = document.querySelector("#records-next");
if (recordsNextBtn) {
recordsNextBtn.addEventListener("click", () => {
  recordsPage += 1;
  render();
});
recordsNextBtn.textContent = "›";
recordsNextBtn.setAttribute("aria-label", "Halaman berikutnya");
recordsNextBtn.title = "Halaman berikutnya";
}
document.querySelector("#admin-records-previous").addEventListener("click", () => {
  adminRecordsPage = Math.max(0, adminRecordsPage - 1);
  renderManageList();
});
document.querySelector("#admin-records-next").addEventListener("click", () => {
  adminRecordsPage += 1;
  renderManageList();
});
adminRecordSearchInput.addEventListener("input", () => { adminRecordsPage = 0; renderManageList(); });
adminRecordSortSelect.addEventListener("change", () => { adminRecordsPage = 0; renderManageList(); });
document.querySelector("#admin-records-previous").textContent = "‹";
document.querySelector("#admin-records-previous").setAttribute("aria-label", "Halaman entri sebelumnya");
document.querySelector("#admin-records-previous").title = "Halaman entri sebelumnya";
document.querySelector("#admin-records-next").textContent = "›";
document.querySelector("#admin-records-next").setAttribute("aria-label", "Halaman entri berikutnya");
document.querySelector("#admin-records-next").title = "Halaman entri berikutnya";
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    (isAdminPage ? adminRecordSearchInput : searchInput)?.focus();
  }
});

if (isAdminPage) {
  dialog.setAttribute("open", "");
  request("/api/session").then(({ admin, user, force_password_change }) => {
    setAdminMode(admin, user, force_password_change);
    if (admin && !force_password_change && user?.role !== "Warga") return refreshRecords();
  }).catch(() => setAdminMode(false));
} else {
  isAdmin = false;
  refreshRecords();
}
window.setInterval(refreshRecords, 15_000);

// Handler untuk filter keluarga saat badge hubung diklik
document.querySelector("#contribution-resident-list")?.addEventListener("click", (e) => {
  const badge = e.target.closest(".contribution-relationship-badge");
  if (!badge) return;
  const card = badge.closest(".contribution-resident-card");
  if (!card) return;
  const residentId = card.dataset.residentId;
  const resident = contributionResidents.find(r => String(r.id) === residentId);
  if (!resident) return;
  familyFilterKK = resident.family_card_number;
  contributionResidentsPage = 0;
  renderContributionResidents();
});
