const STORAGE_KEY = "book-of-mey-library";
const ACTIVE_BOOK_KEY = "book-of-mey-active-book";
const READING_PROGRESS_KEY = "book-of-mey-reading-progress";
const READER_PREFS_KEY = "book-of-mey-reader-prefs";
const EDITOR_DRAFT_KEY = "book-of-mey-editor-draft";
const CUSTOM_AMBIANCE_TRACKS_KEY = "book-of-mey-custom-ambiance-tracks";
const COVER_BUCKET = "covers";
const AMBIANCE_BUCKET = "ambiance-sounds";
const PAGE_FLIP_SOUND = "asset/sound/page-flip.mp3";
const AMBIANCE_VOLUME = 0.35;
const AMBIANCE_FADE_MS = 1400;
const AUDIO_ANCHOR_VOLUME = 0.8;
const AUDIO_ANCHOR_FADE_IN_MS = 900;
const AUDIO_ANCHOR_FADE_OUT_MS = 1200;
const SUPABASE_SDK_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const DB_CONFIG = window.BOOK_OF_MEY_SUPABASE || {};

// Ajoute ici une entrée par fichier d'ambiance placé dans asset/sound/.
const DEFAULT_AMBIANCE_TRACKS = [
  {
    id: "ambiance",
    label: "Ambiance douce",
    src: "asset/sound/ambiance.mp3",
    volume: AMBIANCE_VOLUME,
  },
];

const densityMap = {
  comfortable: 980,
  classic: 1250,
  dense: 1550,
};

const coverUpload = {
  dataUrl: "",
};

const richInlineTags = new Set(["B", "STRONG", "I", "EM", "U", "S", "DEL", "MARK", "BR"]);
const richBlockTags = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);
const skippedRichTags = new Set(["STYLE", "SCRIPT", "META", "LINK", "TITLE", "HEAD", "XML", "NOSCRIPT"]);

const state = {
  books: [],
  activeBookId: null,
  currentPage: 0,
  currentArtbookPage: 0,
  editingBookId: null,
  editingChapterId: null,
  editingArtbookItemId: null,
  editorChapters: [],
  editorArtbookItems: [],
  editorDirty: false,
  readerPrefs: {
    fontSize: 18,
    lineHeight: 1.58,
    pageWidth: 1020,
    theme: "paper",
    soundEffects: true,
    infiniteScroll: false,
    sidebarCollapsed: false,
    ambianceTrack: "ambiance",
    autoAmbiance: true,
  },
  touchStartX: 0,
  touchStartY: 0,
  pages: [],
  artbookPages: [],
  isAnimating: false,
  isBusy: false,
  busyDepth: 0,
  lastWheelTurnAt: 0,
  suppressContinuousProgressUntil: 0,
  readerSearchResults: [],
  readerSearchIndex: -1,
  readerSearchQuery: "",
  pageFlipAudio: null,
  ambianceAudio: null,
  ambianceFadeFrame: 0,
  audioAnchorAudio: null,
  audioAnchorFadeFrame: 0,
  audioAnchorFadeOutStarted: false,
  audioAnchorQueue: [],
  playedAudioAnchors: new Set(),
  suspendedAmbiance: null,
  resumeAmbianceAfterAnchor: false,
  activeAmbianceTrackId: null,
  effectiveAmbianceTrackId: null,
  isAmbianceEnabled: false,
  storageMode: "local",
  hasArtbookTable: true,
  hasAmbianceTracksTable: true,
  db: null,
  ambianceTracks: [],
};

let chapterSourceRichHtml = "";
let editorMaintenanceTimer = 0;
let chapterSaveFeedbackTimer = 0;
let readerToastTimer = 0;
let editorDraftTimer = 0;
let isFillingEditor = false;
let supabaseSdkPromise = null;
let chapterEditorRange = null;

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function getReadingProgress(bookId) {
  const progress = readJsonStorage(READING_PROGRESS_KEY, {});
  return Number.isInteger(progress[bookId]) ? progress[bookId] : null;
}

function setReadingProgress(bookId, page) {
  const progress = readJsonStorage(READING_PROGRESS_KEY, {});
  progress[bookId] = page;
  localStorage.setItem(READING_PROGRESS_KEY, JSON.stringify(progress));
}

function showReaderToast(message) {
  const toast = byId("reader-toast");
  if (!toast) return;

  window.clearTimeout(readerToastTimer);
  toast.textContent = message;
  toast.hidden = false;
  readerToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function showActionToast(message, actionLabel, onAction, duration = 6500) {
  const toast = byId("reader-toast");
  if (!toast) return;

  window.clearTimeout(readerToastTimer);
  toast.innerHTML = "";
  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  if (actionLabel && onAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = actionLabel;
    button.addEventListener("click", () => {
      window.clearTimeout(readerToastTimer);
      toast.hidden = true;
      onAction();
    }, { once: true });
    toast.appendChild(button);
  }

  toast.hidden = false;
  readerToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

function getResumePage(book) {
  const bookmarkPage = Number.isInteger(book?.bookmarkPage) ? book.bookmarkPage : null;
  return bookmarkPage ?? getReadingProgress(book.id) ?? 0;
}

function loadReaderPrefs() {
  state.readerPrefs = {
    ...state.readerPrefs,
    ...readJsonStorage(READER_PREFS_KEY, {}),
  };
  state.readerPrefs.infiniteScroll = Boolean(state.readerPrefs.infiniteScroll);
  state.readerPrefs.sidebarCollapsed = Boolean(state.readerPrefs.sidebarCollapsed);
  state.readerPrefs.autoAmbiance = state.readerPrefs.autoAmbiance !== false;
  state.readerPrefs.pageWidth = Number(state.readerPrefs.pageWidth) || 1020;
  state.readerPrefs.ambianceTrack = state.readerPrefs.ambianceTrack || DEFAULT_AMBIANCE_TRACKS[0].id;
}

function saveReaderPrefs() {
  localStorage.setItem(READER_PREFS_KEY, JSON.stringify(state.readerPrefs));
}

function syncReaderPrefsControls() {
  byId("reader-font-size").value = state.readerPrefs.fontSize;
  byId("reader-line-height").value = Math.round(state.readerPrefs.lineHeight * 100);
  byId("reader-page-width").value = state.readerPrefs.pageWidth;
  byId("reader-theme").value = state.readerPrefs.theme;
  renderAmbianceTrackOptions();
  renderChapterAmbianceOptions();
  updateAutoAmbianceControl();
  updateSoundEffectsButton();
  updateInfiniteScrollButton();
  updateNightModeButton();
}

function applyReaderPrefs() {
  const reader = byId("book-reader");
  const artbookReader = byId("artbook-reader");
  const view = byId("reader-view");
  const artbookView = byId("artbook-view");
  if (!reader || !view) return;
  [reader, artbookReader].filter(Boolean).forEach((surface) => {
    surface.style.setProperty("--reader-font-size", `${state.readerPrefs.fontSize}px`);
    surface.style.setProperty("--reader-line-height", state.readerPrefs.lineHeight);
    surface.style.setProperty("--book-max-width", `${state.readerPrefs.pageWidth || 1020}px`);
  });
  [view, artbookView].filter(Boolean).forEach((surfaceView) => {
    surfaceView.dataset.theme = state.readerPrefs.theme;
  });
  if (!state.effectiveAmbianceTrackId) {
    state.effectiveAmbianceTrackId = state.readerPrefs.ambianceTrack;
  }
  document.body.classList.toggle("reader-night-theme", state.readerPrefs.theme === "night");
  updateNightModeButton();
}

const sampleText = `Prologue

Je ne me souviens pas exactement du moment où tout a commencé. Il reste seulement des images, des silences, et cette impression que la route avait été tracée avant même que je comprenne où poser les pieds.

La nuit était tombée quand on m'a annoncé ton départ. Personne n'avait l'air inquiet. Moi, je comptais les heures.

Chapitre 1 - Le contrat

La journée s'annonçait longue. Deux missions, un détour chez Ignis, et cette sensation désagréable qu'une pièce du décor avait changé pendant mon sommeil.

Je suis parti vers la vieille ville avant l'aube. Les rues étaient encore humides, presque vides, et ma moto faisait trop de bruit dans le silence.

Chapitre 2 - Le retour

Quand je suis rentré, les lumières de la maison étaient allumées. Ce détail aurait dû me rassurer. Au lieu de ça, il m'a glacé.

Il y avait des voix dans le grand salon, des voix basses, trop contrôlées. J'ai compris avant même d'ouvrir la porte que rien ne serait simple.`;

function createSeedBook() {
  const chapters = parseChapters(sampleText);
  return {
    id: crypto.randomUUID(),
    title: "Takumi's Adventure",
    author: "Meygan Quillet",
    summary: "Un ancien manuscrit remis en forme pour devenir une vraie expérience de lecture.",
    cover: "asset/image/akira.jpg",
    fontSize: 18,
    density: "classic",
    chapters,
    artbookItems: [
      {
        id: crypto.randomUUID(),
        title: "Couverture",
        description: "Première planche d'artbook rattachée au livre.",
        image: "asset/image/akira.jpg",
      },
    ],
    bookmarkPage: 0,
    updatedAt: new Date().toISOString(),
  };
}

function hasSupabaseConfig() {
  return Boolean(DB_CONFIG.url && DB_CONFIG.anonKey);
}

function loadSupabaseSdk() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (supabaseSdkPromise) return supabaseSdkPromise;

  supabaseSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SUPABASE_SDK_SRC;
    script.async = true;
    script.onload = () => resolve(window.supabase);
    script.onerror = () => reject(new Error("Impossible de charger le client Supabase."));
    document.head.appendChild(script);
  });

  return supabaseSdkPromise;
}

async function initDatabase() {
  if (!hasSupabaseConfig()) return false;

  await loadSupabaseSdk();
  if (!window.supabase?.createClient) return false;

  state.db = window.supabase.createClient(DB_CONFIG.url, DB_CONFIG.anonKey);
  state.storageMode = "supabase";
  return true;
}

function getChapterTitleNumber(title) {
  return Number(String(title || "").match(/^chapitre\s+(\d+)\b/i)?.[1] || NaN);
}

function sortChapterRows(chapters) {
  const rows = [...chapters];
  const positions = rows.map((chapter) => Number(chapter.position)).filter(Number.isFinite);
  const allPositionsAreNegative = positions.length === rows.length && positions.every((position) => position < 0);
  const looksLikeLegacyTemporaryOrder =
    allPositionsAreNegative &&
    Math.max(...positions) === -1 &&
    Math.min(...positions) >= -positions.length;

  rows.sort((a, b) => looksLikeLegacyTemporaryOrder ? b.position - a.position : a.position - b.position);

  const titleNumbers = rows.map((chapter) => getChapterTitleNumber(chapter.title));
  const allTitlesAreNumbered = titleNumbers.length >= 3 && titleNumbers.every(Number.isFinite);
  const titleOrderIsDescending = allTitlesAreNumbered && titleNumbers.every((number, index) => index === 0 || number < titleNumbers[index - 1]);

  return titleOrderIsDescending ? rows.reverse() : rows;
}

function sortPositionRows(rows) {
  return [...rows].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function mapBookRow(row, chapters, artbookItems = []) {
  return {
    id: row.id,
    title: row.title,
    author: row.author || "",
    summary: row.summary || "",
    cover: row.cover || "",
    fontSize: row.font_size || 18,
    density: row.density || "classic",
    bookmarkPage: row.bookmark_page || 0,
    updatedAt: row.updated_at,
    chapters: sortChapterRows(chapters.filter((chapter) => chapter.book_id === row.id))
      .map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        content: chapter.content || "",
        illustration: chapter.illustration || "",
        ambianceTrackId: chapter.ambiance_track_id || "",
      })),
    artbookItems: sortPositionRows(artbookItems.filter((item) => item.book_id === row.id))
      .map((item) => ({
        id: item.id,
        title: item.title || "",
        description: item.description || "",
        image: item.image || "",
      })),
  };
}

function normalizeBook(book) {
  return {
    ...book,
    author: book.author || "",
    summary: book.summary || "",
    cover: book.cover || "",
    fontSize: book.fontSize || 18,
    density: book.density || "classic",
    bookmarkPage: book.bookmarkPage || 0,
    chapters: (book.chapters || []).map(cloneChapter),
    artbookItems: (book.artbookItems || []).map(cloneArtbookItem),
  };
}

async function loadBooksFromDatabase() {
  const { data: books, error: booksError } = await state.db
    .from("books")
    .select("*")
    .order("updated_at", { ascending: false });

  if (booksError) throw booksError;

  if (!books.length) {
    state.books = [];
    return;
  }

  const bookIds = books.map((book) => book.id);
  const [chaptersResult, artbookResult] = await Promise.all([
    state.db
      .from("chapters")
      .select("*")
      .in("book_id", bookIds)
      .order("position", { ascending: true }),
    state.db
      .from("artbook_items")
      .select("*")
      .in("book_id", bookIds)
      .order("position", { ascending: true }),
  ]);
  const { data: chapters, error: chaptersError } = chaptersResult;

  if (chaptersError) throw chaptersError;

  let artbookItems = [];
  const { data: artbookRows, error: artbookError } = artbookResult;

  if (artbookError) {
    state.hasArtbookTable = false;
    console.warn("Table artbook_items indisponible. Les artbooks seront vides jusqu'à la migration.", artbookError);
  } else {
    state.hasArtbookTable = true;
    artbookItems = artbookRows || [];
  }

  state.books = books.map((book) => mapBookRow(book, chapters || [], artbookItems));
}

function loadBooksFromLocalStorage(options = {}) {
  const createSeed = options.createSeed !== false;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.books = createSeed ? [createSeedBook()] : [];
    if (createSeed) saveBooks();
    return;
  }

  try {
    state.books = JSON.parse(raw).map(normalizeBook);
  } catch {
    state.books = createSeed ? [createSeedBook()] : [];
    if (createSeed) saveBooks();
  }
}

function saveBooks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.books));
}

async function refreshRemoteLibrary() {
  if (state.storageMode !== "supabase" || !state.db) return;

  try {
    await Promise.all([
      loadBooksFromDatabase(),
      loadAmbianceTracksFromDatabase(),
    ]);
    try {
      saveBooks();
    } catch (cacheError) {
      console.warn("Cache local des livres saturé, synchronisation distante conservée.", cacheError);
    }
    try {
      saveLocalAmbianceTracks();
    } catch (cacheError) {
      console.warn("Cache local des sons saturé, synchronisation distante conservée.", cacheError);
    }

    const rememberedBookId = localStorage.getItem(ACTIVE_BOOK_KEY);
    state.activeBookId = state.books.some((book) => book.id === state.activeBookId)
      ? state.activeBookId
      : (state.books.some((book) => book.id === rememberedBookId) ? rememberedBookId : state.books[0]?.id || null);

    renderBookGrid();
    renderAmbianceTrackOptions();
  } catch (error) {
    console.warn("Supabase indisponible, utilisation du cache local.", error);
    state.storageMode = "local";
    state.db = null;
    if (!state.books.length) {
      state.books = [createSeedBook()];
      saveBooks();
      state.activeBookId = state.books[0].id;
      renderBookGrid();
    }
  }
}

async function initializeRemoteLibrary() {
  try {
    if (await initDatabase()) {
      await refreshRemoteLibrary();
      return;
    }
  } catch (error) {
    console.warn("Connexion distante indisponible, utilisation du cache local.", error);
  }

  state.storageMode = "local";
  state.db = null;
  if (!state.books.length) {
    state.books = [createSeedBook()];
    saveBooks();
    state.activeBookId = state.books[0].id;
    renderBookGrid();
  }
}

function normalizeAmbianceTrack(track = {}, fallbackIndex = 0) {
  return {
    id: track.id || `custom-${crypto.randomUUID()}`,
    label: String(track.label || `Ambiance ${fallbackIndex + 1}`).trim(),
    src: String(track.src || "").trim(),
    volume: Number.isFinite(Number(track.volume)) ? Number(track.volume) : AMBIANCE_VOLUME,
    custom: track.custom !== false,
  };
}

function getAllAmbianceTracks() {
  return [...DEFAULT_AMBIANCE_TRACKS, ...state.ambianceTracks].filter((track) => track.src);
}

function saveLocalAmbianceTracks() {
  localStorage.setItem(CUSTOM_AMBIANCE_TRACKS_KEY, JSON.stringify(state.ambianceTracks));
}

function loadLocalAmbianceTracks() {
  state.ambianceTracks = readJsonStorage(CUSTOM_AMBIANCE_TRACKS_KEY, [])
    .map(normalizeAmbianceTrack)
    .filter((track) => track.label && track.src);
}

async function loadAmbianceTracksFromDatabase() {
  const { data, error } = await state.db
    .from("ambiance_tracks")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    state.hasAmbianceTracksTable = false;
    console.warn("Table ambiance_tracks indisponible. Fallback localStorage.", error);
    loadLocalAmbianceTracks();
    return;
  }

  state.hasAmbianceTracksTable = true;
  state.ambianceTracks = (data || []).map((track, index) => normalizeAmbianceTrack({
    id: track.id,
    label: track.label,
    src: track.src,
    custom: true,
  }, index));
}

async function loadAmbianceTracks() {
  if (state.storageMode === "supabase" && state.db) {
    await loadAmbianceTracksFromDatabase();
    return;
  }

  loadLocalAmbianceTracks();
}

function createLibraryBackup() {
  return {
    app: "Book of Mey",
    version: 1,
    exportedAt: new Date().toISOString(),
    books: state.books.map(normalizeBook),
    readerPrefs: state.readerPrefs,
  };
}

function exportLibraryBackup() {
  const backup = createLibraryBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `book-of-mey-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showReaderToast("Sauvegarde exportée.");
}

function normalizeImportedBooks(value) {
  const books = Array.isArray(value) ? value : value?.books;
  if (!Array.isArray(books)) return [];
  return books.map(normalizeBook).filter((book) => book.title && book.chapters.length);
}

async function importLibraryBackup(event) {
  if (state.isBusy) return;
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    const importedBooks = normalizeImportedBooks(backup);
    if (!importedBooks.length) {
      alert("Aucun livre valide n'a été trouvé dans cette sauvegarde.");
      return;
    }

    if (!confirm(`Importer ${importedBooks.length} livre${importedBooks.length > 1 ? "s" : ""} ? Les livres avec le même identifiant seront remplacés.`)) {
      return;
    }

    await withAppBusy("Import de la sauvegarde…", async () => {
      if (state.storageMode === "supabase") {
        for (const book of importedBooks) {
          await restoreBookToDatabase(book);
        }
        await loadBooksFromDatabase();
      } else {
        const importedIds = new Set(importedBooks.map((book) => book.id));
        state.books = [...importedBooks, ...state.books.filter((book) => !importedIds.has(book.id))];
        saveBooks();
      }
      renderBookGrid();
      showReaderToast("Sauvegarde importée.");
    });
  } catch (error) {
    console.error(error);
    alert("Impossible d'importer cette sauvegarde JSON.");
  }
}

function byId(id) {
  return document.getElementById(id);
}

function setAppBusy(isBusy, message = "Merci de patienter.") {
  const overlay = byId("app-busy");
  const messageNode = byId("app-busy-message");
  const appShell = document.querySelector(".app-shell");

  state.isBusy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);
  document.body.setAttribute("aria-busy", isBusy ? "true" : "false");

  if (overlay) {
    overlay.hidden = !isBusy;
  }

  if (messageNode) {
    messageNode.textContent = message;
  }

  if (appShell) {
    appShell.toggleAttribute("aria-busy", isBusy);
    appShell.inert = isBusy;
  }
}

async function nextFrame() {
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

async function withAppBusy(message, callback) {
  state.busyDepth += 1;
  setAppBusy(true, message);

  try {
    await nextFrame();
    return await callback();
  } finally {
    state.busyDepth = Math.max(0, state.busyDepth - 1);
    if (!state.busyDepth) {
      setAppBusy(false);
    }
  }
}

function showView(viewName) {
  syncArtbookNavButton();

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${viewName}-view`);
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
  });

  if (viewName !== "reader") {
    stopAmbiance();
  }
}

function switchEditorTab(tabName) {
  const nextTab = tabName === "artbook" ? "artbook" : "book";

  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    const isActive = button.dataset.editorTab === nextTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-editor-panel]").forEach((panel) => {
    const isActive = panel.dataset.editorPanel === nextTab;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function getBook(id) {
  return state.books.find((book) => book.id === id);
}

function setEditorStatus(message, tone = "neutral") {
  const status = byId("editor-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function markEditorDirty(message = "Modifications non enregistrées.") {
  state.editorDirty = true;
  setEditorStatus(message, "dirty");
  scheduleEditorDraftSave();
}

function markEditorSaved(message = "Aucune modification en attente.") {
  state.editorDirty = false;
  setEditorStatus(message, "saved");
  if (!isFillingEditor) clearEditorDraft();
}

function getEditorDraftPayload() {
  if (!byId("book-title")) return null;
  flushEditorMaintenance();
  return {
    savedAt: new Date().toISOString(),
    editingBookId: state.editingBookId,
    editingChapterId: state.editingChapterId,
    editingArtbookItemId: state.editingArtbookItemId,
    book: readForm(),
  };
}

function saveEditorDraftNow() {
  if (isFillingEditor || !state.editorDirty) return;
  const draft = getEditorDraftPayload();
  if (!draft) return;
  try {
    localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    console.warn("Brouillon non enregistré.", error);
  }
}

function scheduleEditorDraftSave() {
  if (isFillingEditor) return;
  window.clearTimeout(editorDraftTimer);
  editorDraftTimer = window.setTimeout(saveEditorDraftNow, 1800);
}

function clearEditorDraft() {
  window.clearTimeout(editorDraftTimer);
  localStorage.removeItem(EDITOR_DRAFT_KEY);
}

function showChapterSaveFeedback() {
  const button = byId("save-chapter");
  if (!button) return;

  window.clearTimeout(chapterSaveFeedbackTimer);
  button.classList.add("is-confirmed");
  button.textContent = "Chapitre validé";
  setEditorStatus("Chapitre validé localement. Pense à enregistrer le livre.", "chapter-saved");

  chapterSaveFeedbackTimer = window.setTimeout(() => {
    button.classList.remove("is-confirmed");
    button.textContent = "Enregistrer le chapitre";
    setEditorStatus("Chapitre validé localement. Livre non enregistré.", "dirty");
  }, 1800);
}

function hasHtmlMarkup(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function plainTextToHtml(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, "<br>").trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/&lt;br&gt;/g, "<br>")}</p>`)
    .join("");
}

function collectClassStyles(root) {
  const classStyles = new Map();
  root.querySelectorAll?.("style").forEach((styleNode) => {
    const css = (styleNode.textContent || "")
      .replace(/<!--|-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    const rulePattern = /([^{}@][^{}]*)\{([^{}]*)\}/g;
    let rule;

    while ((rule = rulePattern.exec(css))) {
      const selectors = rule[1].split(",");
      const declarations = rule[2].trim();
      selectors.forEach((selector) => {
        const classMatches = selector.matchAll(/\.([_a-zA-Z][\w-]*)/g);
        Array.from(classMatches).forEach((match) => {
          const className = match[1];
          classStyles.set(className, `${classStyles.get(className) || ""};${declarations}`);
        });
      });
    }
  });
  return classStyles;
}

function decodeEscapedHtml(value) {
  const container = document.createElement("textarea");
  container.innerHTML = String(value || "");
  return container.value;
}

function restoreEscapedHtml(value) {
  const source = String(value || "");
  if (hasHtmlMarkup(source) || !/&lt;\/?[a-z][\s\S]*?&gt;/i.test(source)) return source;

  const decoded = decodeEscapedHtml(source);
  return hasHtmlMarkup(decoded) ? decoded : source;
}

function isOfficeCssText(value) {
  const text = String(value || "").replace(/\u00a0/g, " ").trim();
  return (
    /^\/\*\s*(Font|Style|List) Definitions/i.test(text) ||
    /^@font-face\b/i.test(text) ||
    /^(p|li|div|span)\.Mso/i.test(text) ||
    /^@list\b/i.test(text) ||
    /^(font-family|font-size|font-style|font-weight|margin|text-indent|tab-stops|mso-[\w-]+)\s*:/i.test(text)
  );
}

function isStandaloneListMarkerText(value) {
  return /^[-\u2013\u2014\u2022\u00b7\u25aa\u25e6o]$/i.test(String(value || "").replace(/\u00a0/g, " ").trim());
}

function startsWithListMarker(value) {
  return /^[-\u2013\u2014]\s+\S/.test(String(value || "").replace(/\u00a0/g, " ").trim());
}

function stripLeadingListMarker(value) {
  return String(value || "").replace(
    /^[\s\u00a0]*(?:[-\u2013\u2014\u2022\u00b7\u25aa\u25e6](?:[\s\u00a0]+|$)|o(?=[\s\u00a0]+|$))[\s\u00a0]*/i,
    ""
  );
}

function sanitizeRichHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = restoreEscapedHtml(html);
  const output = document.createElement("div");
  const classStyles = collectClassStyles(template.content);

  const getCombinedStyle = (source) => {
    const className = source.getAttribute("class") || "";
    const classStyle = className
      .split(/\s+/)
      .map((name) => classStyles.get(name))
      .filter(Boolean)
      .join(";");
    return `${classStyle};${source.getAttribute("style") || ""}`;
  };

  const isHiddenOfficeNode = (source) => {
    const style = getCombinedStyle(source);
    return /display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style) || /mso-hide\s*:\s*all/i.test(style);
  };

  const isListSource = (source, tagName) => {
    const style = getCombinedStyle(source);
    const className = source.getAttribute("class") || "";
    return tagName === "LI" || /mso-list\s*:/i.test(style) || /\bMsoListParagraph/i.test(className);
  };

  const findFirstTextNode = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if ((node.nodeValue || "").replace(/\u00a0/g, " ").trim()) return node;
      node = walker.nextNode();
    }
    return null;
  };

  const normalizeListParagraph = (paragraph, source, tagName) => {
    if (!isListSource(source, tagName)) return;

    const text = paragraph.textContent.replace(/\u00a0/g, " ").trim();
    if (!text) return;
    if (/^[-\u2013\u2014]\s+\S/.test(text)) return;

    const firstTextNode = findFirstTextNode(paragraph);
    if (firstTextNode) {
      firstTextNode.nodeValue = stripLeadingListMarker(firstTextNode.nodeValue);
    }
    paragraph.insertBefore(document.createTextNode("- "), paragraph.firstChild);
  };

  const mergeOrphanListMarkers = (container) => {
    Array.from(container.children).forEach((child) => {
      if (child.tagName?.toUpperCase() !== "P" || !isStandaloneListMarkerText(child.textContent)) return;

      const next = child.nextElementSibling;
      if (!next || next.tagName.toUpperCase() !== "P") return;

      const nextText = next.textContent.replace(/\u00a0/g, " ").trim();
      if (!nextText || startsWithListMarker(nextText)) return;

      next.insertBefore(document.createTextNode("- "), next.firstChild);
      child.remove();
    });
  };

  const wrapStyledChildren = (element, source) => {
    const style = getCombinedStyle(source);
    const fontWeight = style.match(/font-weight\s*:\s*([^;]+)/i)?.[1]?.trim() || "";
    const isBold = /^(bold|bolder)$/i.test(fontWeight) || Number(fontWeight) >= 600;
    const isItalic = /(?:font-style|mso-bidi-font-style)\s*:\s*(italic|oblique)/i.test(style);
    const isUnderline = /text-decoration(?:-line)?\s*:[^;]*underline/i.test(style);
    const isStrike = /text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style);

    [
      [isStrike, "s"],
      [isUnderline, "u"],
      [isItalic, "em"],
      [isBold, "strong"],
    ].forEach(([shouldWrap, tagName]) => {
      if (!shouldWrap || !element.childNodes.length) return;
      const wrapper = document.createElement(tagName);
      while (element.firstChild) wrapper.appendChild(element.firstChild);
      element.appendChild(wrapper);
    });
  };

  const appendCleanChildren = (source, target) => {
    source.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        if (isOfficeCssText(child.textContent)) return;
        target.appendChild(document.createTextNode(child.textContent || ""));
        return;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const tagName = child.tagName.toUpperCase();
      if (tagName === "SPAN" && child.hasAttribute("data-audio-anchor")) {
        const trackId = String(child.getAttribute("data-audio-anchor") || "").trim();
        if (/^[a-z0-9_-]{1,100}$/i.test(trackId)) {
          const cleanAnchor = document.createElement("span");
          const label = String(child.getAttribute("data-audio-label") || "").trim().slice(0, 120);
          const anchorId = String(child.getAttribute("data-audio-anchor-id") || "").trim();
          cleanAnchor.className = "audio-anchor";
          cleanAnchor.dataset.audioAnchor = trackId;
          if (/^[a-z0-9_-]{1,100}$/i.test(anchorId)) cleanAnchor.dataset.audioAnchorId = anchorId;
          if (label) cleanAnchor.dataset.audioLabel = label;
          cleanAnchor.contentEditable = "false";
          cleanAnchor.setAttribute("aria-label", label ? `Ancre sonore : ${label}` : "Ancre sonore");
          target.appendChild(cleanAnchor);
        }
        return;
      }

      if (skippedRichTags.has(tagName) || /^[OVWM]:/i.test(tagName) || isHiddenOfficeNode(child)) {
        return;
      }

      if (richInlineTags.has(tagName)) {
        const normalizedTag = tagName === "B" ? "strong" : tagName === "I" ? "em" : tagName.toLowerCase();
        const cleanInline = document.createElement(normalizedTag);
        appendCleanChildren(child, cleanInline);
        wrapStyledChildren(cleanInline, child);
        target.appendChild(cleanInline);
        return;
      }

      if (richBlockTags.has(tagName)) {
        const paragraph = document.createElement("p");
        appendCleanChildren(child, paragraph);
        normalizeListParagraph(paragraph, child, tagName);
        wrapStyledChildren(paragraph, child);
        if (paragraph.textContent.trim() || paragraph.querySelector("br")) {
          target.appendChild(paragraph);
        }
        return;
      }

      const styledInline = document.createElement("span");
      appendCleanChildren(child, styledInline);
      wrapStyledChildren(styledInline, child);
      while (styledInline.firstChild) target.appendChild(styledInline.firstChild);
    });
  };

  appendCleanChildren(template.content, output);
  mergeOrphanListMarkers(output);
  return output.innerHTML.trim();
}

function normalizeRichContent(content) {
  if (!content) return "";
  return sanitizeRichHtml(hasHtmlMarkup(content) ? content : plainTextToHtml(content));
}

function richContentToPlainText(content) {
  const container = document.createElement("div");
  container.innerHTML = normalizeRichContent(content);
  container.querySelectorAll("p, div, li, blockquote, h1, h2, h3, h4, h5, h6").forEach((block) => {
    block.appendChild(document.createTextNode("\n\n"));
  });
  container.querySelectorAll("br").forEach((breakNode) => {
    breakNode.replaceWith(document.createTextNode("\n"));
  });
  return container.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

function readRichEditorContent() {
  const editor = byId("chapter-content");
  return normalizeRichContent(editor.innerHTML);
}

function clipboardToRichHtml(html, text) {
  if (html) return sanitizeRichHtml(html);
  if (hasHtmlMarkup(text)) return sanitizeRichHtml(text);
  return plainTextToHtml(text);
}

function insertRichHtmlAtSelection(html) {
  document.execCommand("insertHTML", false, sanitizeRichHtml(html));
}

function rememberChapterEditorSelection() {
  const editor = byId("chapter-content");
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rangeContainer = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (rangeContainer && editor.contains(rangeContainer)) {
    chapterEditorRange = range.cloneRange();
  }
}

function insertAudioAnchor() {
  const editor = byId("chapter-content");
  const select = byId("chapter-audio-anchor-track");
  const track = getAmbianceTrack(select?.value);
  if (!editor || !getEditingChapter() || !track) return;

  editor.focus();
  const range = chapterEditorRange?.startContainer?.isConnected ? chapterEditorRange : document.createRange();
  const rangeContainer = range.commonAncestorContainer?.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (!rangeContainer || !editor.contains(rangeContainer)) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  const anchor = document.createElement("span");
  anchor.className = "audio-anchor";
  anchor.dataset.audioAnchor = track.id;
  anchor.dataset.audioAnchorId = crypto.randomUUID();
  anchor.dataset.audioLabel = track.label;
  anchor.contentEditable = "false";
  anchor.setAttribute("aria-label", `Ancre sonore : ${track.label}`);

  const spacer = document.createTextNode("\u00a0");
  const fragment = document.createDocumentFragment();
  fragment.append(anchor, spacer);
  range.deleteContents();
  range.insertNode(fragment);
  range.setStartAfter(spacer);
  range.collapse(true);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  chapterEditorRange = range.cloneRange();
  updateCurrentChapterDraft();
  showReaderToast(`Ancre « ${track.label} » insérée.`);
}

function handleRichEditorPaste(event) {
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain");

  if (!html && !text) return;

  event.preventDefault();
  insertRichHtmlAtSelection(clipboardToRichHtml(html, text));
  updateCurrentChapterDraft();
}

function handleChapterSourcePaste(event) {
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain");

  const richHtml = html || (hasHtmlMarkup(text) ? text : "");

  if (!richHtml) {
    chapterSourceRichHtml = "";
    return;
  }

  event.preventDefault();
  chapterSourceRichHtml = sanitizeRichHtml(richHtml);
  byId("chapter-source").value = richContentToPlainText(chapterSourceRichHtml) || text || "";
  updateImportPreview();
}

function normalizeTitle(line) {
  return line.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
}

function isChapterHeading(line) {
  const text = line.replace(/\s+/g, " ").trim();
  return (
    /^#{1,3}\s+\S+/.test(text) ||
    /^prologue$/i.test(text) ||
    /^épilogue$/i.test(text) ||
    /^epilogue$/i.test(text) ||
    /^chapitre\s+(premier|\d+|[ivxlcdm]+)\b/i.test(text) ||
    /^chapter\s+\d+\b/i.test(text) ||
    /^tome\s+\d+\b/i.test(text)
  );
}

function parseChapters(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const chapters = [];
  let current = null;
  let buffer = [];

  const pushCurrent = () => {
    if (!current && buffer.join("").trim()) {
      current = { title: "Texte", content: "" };
    }

    if (!current) return;

    const content = buffer.join("\n").trim();
    chapters.push({
      id: crypto.randomUUID(),
      title: current.title,
      content,
    });
    buffer = [];
  };

  lines.forEach((line) => {
    if (isChapterHeading(line)) {
      pushCurrent();
      current = { title: normalizeTitle(line), content: "" };
      return;
    }

    buffer.push(line);
  });

  pushCurrent();
  return chapters.filter((chapter) => chapter.title || chapter.content);
}

function htmlFragmentToText(html) {
  const fragment = document.createElement("div");
  fragment.innerHTML = html;
  return fragment.textContent || "";
}

function getRichImportBlocks(html) {
  return paragraphsFromContent(sanitizeRichHtml(html)).map((block) => ({
    html: block,
    text: htmlFragmentToText(block).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(),
  })).filter((block) => block.text);
}

function isStandaloneChapterLabel(text) {
  return /^(chapitre|chapter)$/i.test(text.trim());
}

function isChapterNumber(text) {
  return /^(\d+|[ivxlcdm]+|premier)$/i.test(text.trim());
}

function parseRichChapters(sourceHtml) {
  const blocks = getRichImportBlocks(sourceHtml);
  const chapters = [];
  let current = null;
  let buffer = [];

  const pushCurrent = () => {
    if (!current && buffer.length) {
      current = { title: "Texte" };
    }

    if (!current) return;

    chapters.push({
      id: crypto.randomUUID(),
      title: current.title,
      content: buffer.map((block) => `<p>${block.html}</p>`).join(""),
    });
    buffer = [];
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const nextBlock = blocks[index + 1];
    const headingText = isStandaloneChapterLabel(block.text) && nextBlock && isChapterNumber(nextBlock.text)
      ? `${block.text} ${nextBlock.text}`
      : block.text;

    if (isChapterHeading(headingText)) {
      pushCurrent();
      current = { title: normalizeTitle(headingText) };
      if (headingText !== block.text) index += 1;
      continue;
    }

    buffer.push(block);
  }

  pushCurrent();
  return chapters.filter((chapter) => chapter.title || richContentToPlainText(chapter.content));
}

function getChaptersFromSource() {
  if (chapterSourceRichHtml) {
    return parseRichChapters(chapterSourceRichHtml);
  }

  return parseChapters(byId("chapter-source").value);
}

function cloneChapter(chapter, fallbackIndex = 0) {
  return {
    id: chapter.id || crypto.randomUUID(),
    title: (chapter.title || `Chapitre ${fallbackIndex + 1}`).trim(),
    content: chapter.content || "",
    illustration: chapter.illustration || "",
    ambianceTrackId: chapter.ambianceTrackId || chapter.ambiance_track_id || "",
  };
}

function cloneArtbookItem(item = {}, fallbackIndex = 0) {
  return {
    id: item.id || crypto.randomUUID(),
    title: (item.title || "").trim(),
    description: item.description || "",
    image: item.image || "",
  };
}

function setEditorChapters(chapters, selectedId = null, options = {}) {
  state.editorChapters = chapters.map(cloneChapter);
  state.editingChapterId = selectedId || state.editorChapters[0]?.id || null;
  syncChapterSource();
  renderChapterControl();
  updateImportPreview();
  if (options.dirty) {
    markEditorDirty();
  }
}

function getEditingChapterIndex() {
  return state.editorChapters.findIndex((chapter) => chapter.id === state.editingChapterId);
}

function getEditingChapter() {
  return state.editorChapters[getEditingChapterIndex()] || null;
}

function syncChapterSource() {
  const source = byId("chapter-source");
  if (!source) return;
  source.value = state.editorChapters.map((chapter) => `${chapter.title}\n\n${richContentToPlainText(chapter.content)}`.trim()).join("\n\n");
}

function runDeferredEditorMaintenance() {
  editorMaintenanceTimer = 0;
  syncChapterSource();
  updateImportPreview();
}

function scheduleEditorMaintenance() {
  window.clearTimeout(editorMaintenanceTimer);
  editorMaintenanceTimer = window.setTimeout(runDeferredEditorMaintenance, 420);
}

function flushEditorMaintenance() {
  if (!editorMaintenanceTimer) return;
  window.clearTimeout(editorMaintenanceTimer);
  runDeferredEditorMaintenance();
}

function chapterWordCount(chapter) {
  return richContentToPlainText(chapter.content).split(/\s+/).filter(Boolean).length;
}

function setChapterIllustrationPreview(value) {
  const preview = byId("chapter-illustration-preview");
  if (!preview) return;
  preview.style.backgroundImage = value ? `url(${JSON.stringify(value)})` : "";
}

function chapterMetaText(chapter) {
  const words = chapterWordCount(chapter);
  const extras = [];
  if (chapter.illustration) extras.push("illustration");
  if (chapter.ambianceTrackId) extras.push(getAmbianceTrackLabel(chapter.ambianceTrackId));
  const suffix = extras.length ? ` - ${extras.join(" - ")}` : "";
  return `${words} mot${words > 1 ? "s" : ""}${suffix}`;
}

function selectChapter(chapterId) {
  state.editingChapterId = chapterId;
  renderChapterControl();
}

function renderChapterControl() {
  const list = byId("chapter-list");
  if (!list) return;

  const count = byId("chapter-count");
  const titleInput = byId("chapter-title");
  const contentInput = byId("chapter-content");
  const ambianceSelect = byId("chapter-ambiance-track");
  const audioAnchorSelect = byId("chapter-audio-anchor-track");
  const insertAudioAnchorButton = byId("insert-audio-anchor");
  const illustrationFileInput = byId("chapter-illustration-file");
  const removeIllustrationButton = byId("remove-chapter-illustration");
  const deleteButton = byId("delete-chapter");
  const moveUpButton = byId("move-chapter-up");
  const moveDownButton = byId("move-chapter-down");
  const index = getEditingChapterIndex();
  const chapter = getEditingChapter();

  list.innerHTML = "";
  count.textContent = `${state.editorChapters.length}`;

  if (!state.editorChapters.length) {
    list.innerHTML = '<div class="chapter-empty">Aucun chapitre. Crée un chapitre ou importe un texte complet.</div>';
  } else {
    state.editorChapters.forEach((item, itemIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-list-item";
      button.classList.toggle("is-active", item.id === state.editingChapterId);
      button.innerHTML = `
        <span>${itemIndex + 1}</span>
        <strong>${escapeHtml(item.title || `Chapitre ${itemIndex + 1}`)}</strong>
        <small>${escapeHtml(chapterMetaText(item))}</small>
      `;
      button.addEventListener("click", () => selectChapter(item.id));
      list.appendChild(button);
    });
  }

  titleInput.value = chapter?.title || "";
  contentInput.innerHTML = normalizeRichContent(chapter?.content || "");
  chapterEditorRange = null;
  renderChapterAmbianceOptions();
  renderAudioAnchorOptions();
  if (illustrationFileInput) illustrationFileInput.value = "";
  setChapterIllustrationPreview(chapter?.illustration || "");
  titleInput.disabled = !chapter;
  contentInput.contentEditable = chapter ? "true" : "false";
  contentInput.setAttribute("aria-disabled", chapter ? "false" : "true");
  if (ambianceSelect) ambianceSelect.disabled = !chapter;
  if (audioAnchorSelect) audioAnchorSelect.disabled = !chapter;
  if (insertAudioAnchorButton) insertAudioAnchorButton.disabled = !chapter;
  if (illustrationFileInput) illustrationFileInput.disabled = !chapter;
  if (removeIllustrationButton) removeIllustrationButton.disabled = !chapter || !chapter.illustration;
  deleteButton.disabled = !chapter;
  moveUpButton.disabled = !chapter || index <= 0;
  moveDownButton.disabled = !chapter || index < 0 || index >= state.editorChapters.length - 1;
}

function addEmptyChapter() {
  const chapter = {
    id: crypto.randomUUID(),
    title: `Chapitre ${state.editorChapters.length + 1}`,
    content: "",
    illustration: "",
    ambianceTrackId: "",
  };
  state.editorChapters.push(chapter);
  state.editingChapterId = chapter.id;
  syncChapterSource();
  renderChapterControl();
  updateImportPreview();
  markEditorDirty("Nouveau chapitre non enregistré.");
  byId("chapter-title").focus();
}

function saveCurrentChapter() {
  const index = getEditingChapterIndex();
  if (index < 0) return true;

  const title = byId("chapter-title").value.trim();
  const content = readRichEditorContent();
  const ambianceTrackId = byId("chapter-ambiance-track").value;

  if (!title) {
    alert("Ajoute un titre pour ce chapitre.");
    return false;
  }

  state.editorChapters[index] = {
    ...state.editorChapters[index],
    title,
    content,
    ambianceTrackId,
  };
  syncChapterSource();
  renderChapterControl();
  updateImportPreview();
  markEditorDirty("Chapitre modifié, livre non enregistré.");
  showChapterSaveFeedback();
  return true;
}

function updateCurrentChapterDraft() {
  const index = getEditingChapterIndex();
  if (index < 0) return;

  state.editorChapters[index] = {
    ...state.editorChapters[index],
    title: byId("chapter-title").value.trim(),
    content: readRichEditorContent(),
    ambianceTrackId: byId("chapter-ambiance-track").value,
  };
  scheduleEditorMaintenance();
  markEditorDirty("Chapitre modifié, livre non enregistré.");
}

function deleteCurrentChapter() {
  const index = getEditingChapterIndex();
  if (index < 0) return;

  const chapter = state.editorChapters[index];
  if (!confirm(`Supprimer le chapitre « ${chapter.title} » ?`)) return;

  state.editorChapters.splice(index, 1);
  state.editingChapterId = state.editorChapters[Math.min(index, state.editorChapters.length - 1)]?.id || null;
  syncChapterSource();
  renderChapterControl();
  updateImportPreview();
  markEditorDirty("Chapitre supprimé, livre non enregistré.");
  showActionToast("Chapitre supprimé.", "Annuler", () => {
    state.editorChapters.splice(index, 0, chapter);
    state.editingChapterId = chapter.id;
    syncChapterSource();
    renderChapterControl();
    updateImportPreview();
    markEditorDirty("Suppression du chapitre annulée.");
  });
}

function moveCurrentChapter(direction) {
  const index = getEditingChapterIndex();
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.editorChapters.length) return;

  const [chapter] = state.editorChapters.splice(index, 1);
  state.editorChapters.splice(nextIndex, 0, chapter);
  syncChapterSource();
  renderChapterControl();
  updateImportPreview();
  markEditorDirty("Ordre des chapitres modifié, livre non enregistré.");
}

function importChaptersFromSource(mode) {
  const chapters = getChaptersFromSource();
  if (!chapters.length) {
    alert("Aucun chapitre n'a été détecté dans le texte importé.");
    return;
  }

  if (mode === "replace" && state.editorChapters.length && !confirm("Remplacer tous les chapitres actuels par l'import ?")) {
    return;
  }

  if (mode === "append") {
    setEditorChapters([...state.editorChapters, ...chapters], chapters[0].id, { dirty: true });
    return;
  }

  setEditorChapters(chapters, chapters[0].id, { dirty: true });
}

function artbookItemTitle(item, index = 0) {
  return item?.title || `Planche ${index + 1}`;
}

function setEditorArtbookItems(items, selectedId = null, options = {}) {
  state.editorArtbookItems = (items || []).map(cloneArtbookItem);
  state.editingArtbookItemId = selectedId || state.editorArtbookItems[0]?.id || null;
  renderArtbookControl();
  if (options.dirty) {
    markEditorDirty();
  }
}

function getEditingArtbookItemIndex() {
  return state.editorArtbookItems.findIndex((item) => item.id === state.editingArtbookItemId);
}

function getEditingArtbookItem() {
  return state.editorArtbookItems[getEditingArtbookItemIndex()] || null;
}

function artbookDescriptionWordCount(item) {
  return String(item.description || "").split(/\s+/).filter(Boolean).length;
}

function artbookMetaText(item) {
  const words = artbookDescriptionWordCount(item);
  const imageState = item.image ? "image" : "sans image";
  return `${imageState} - ${words} mot${words > 1 ? "s" : ""}`;
}

function setArtbookImagePreview(value) {
  const preview = byId("artbook-image-preview");
  if (!preview) return;
  preview.style.backgroundImage = value ? `url(${JSON.stringify(value)})` : "";
}

function selectArtbookItem(itemId) {
  state.editingArtbookItemId = itemId;
  renderArtbookControl();
}

function renderArtbookControl() {
  const list = byId("artbook-list");
  if (!list) return;

  const count = byId("artbook-count");
  const titleInput = byId("artbook-title");
  const descriptionInput = byId("artbook-description");
  const imageFileInput = byId("artbook-image-file");
  const imageUrlInput = byId("artbook-image-url");
  const removeImageButton = byId("remove-artbook-image");
  const deleteButton = byId("delete-artbook-item");
  const moveUpButton = byId("move-artbook-item-up");
  const moveDownButton = byId("move-artbook-item-down");
  const saveButton = byId("save-artbook-item");
  const index = getEditingArtbookItemIndex();
  const item = getEditingArtbookItem();

  list.innerHTML = "";
  count.textContent = `${state.editorArtbookItems.length}`;

  if (!state.editorArtbookItems.length) {
    list.innerHTML = "<div class=\"chapter-empty\">Aucune planche. Ajoute une image pour commencer l'artbook.</div>";
  } else {
    state.editorArtbookItems.forEach((artbookItem, itemIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "artbook-list-item";
      button.classList.toggle("is-active", artbookItem.id === state.editingArtbookItemId);
      button.innerHTML = `
        <span>${itemIndex + 1}</span>
        <strong>${escapeHtml(artbookItemTitle(artbookItem, itemIndex))}</strong>
        <small>${escapeHtml(artbookMetaText(artbookItem))}</small>
      `;
      button.addEventListener("click", () => selectArtbookItem(artbookItem.id));
      list.appendChild(button);
    });
  }

  titleInput.value = item?.title || "";
  descriptionInput.value = item?.description || "";
  if (imageFileInput) imageFileInput.value = "";
  imageUrlInput.value = item?.image && !item.image.startsWith("data:image/") ? item.image : "";
  setArtbookImagePreview(item?.image || "");
  titleInput.disabled = !item;
  descriptionInput.disabled = !item;
  if (imageFileInput) imageFileInput.disabled = !item;
  imageUrlInput.disabled = !item;
  if (removeImageButton) removeImageButton.disabled = !item || !item.image;
  if (saveButton) saveButton.disabled = !item;
  deleteButton.disabled = !item;
  moveUpButton.disabled = !item || index <= 0;
  moveDownButton.disabled = !item || index < 0 || index >= state.editorArtbookItems.length - 1;
}

function readArtbookImageDraft(existingItem) {
  const url = byId("artbook-image-url").value.trim();
  if (url) return url;
  return existingItem?.image?.startsWith("data:image/") ? existingItem.image : "";
}

function readArtbookItemDraft(existingItem) {
  return {
    ...existingItem,
    title: byId("artbook-title").value.trim(),
    description: byId("artbook-description").value.trim(),
    image: readArtbookImageDraft(existingItem),
  };
}

function addEmptyArtbookItem() {
  const item = {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    image: "",
  };
  state.editorArtbookItems.push(item);
  state.editingArtbookItemId = item.id;
  switchEditorTab("artbook");
  renderArtbookControl();
  markEditorDirty("Nouvelle planche non enregistrée.");
  byId("artbook-title").focus();
}

function updateCurrentArtbookDraft() {
  const index = getEditingArtbookItemIndex();
  if (index < 0) return;

  state.editorArtbookItems[index] = readArtbookItemDraft(state.editorArtbookItems[index]);
  setArtbookImagePreview(state.editorArtbookItems[index].image);
  byId("remove-artbook-image").disabled = !state.editorArtbookItems[index].image;
  markEditorDirty("Artbook modifié, livre non enregistré.");
}

function saveCurrentArtbookItem(options = {}) {
  const index = getEditingArtbookItemIndex();
  if (index < 0) return true;

  state.editorArtbookItems[index] = readArtbookItemDraft(state.editorArtbookItems[index]);
  const item = state.editorArtbookItems[index];
  const hasContent = item.title || item.description || item.image;

  if (hasContent && !item.image && !options.silent) {
    alert("Ajoute une image pour cette planche d'artbook.");
    return false;
  }

  renderArtbookControl();
  markEditorDirty("Planche modifiée, livre non enregistré.");
  return true;
}

function deleteCurrentArtbookItem() {
  const index = getEditingArtbookItemIndex();
  if (index < 0) return;

  const item = state.editorArtbookItems[index];
  if (!confirm(`Supprimer la planche "${artbookItemTitle(item, index)}" ?`)) return;

  state.editorArtbookItems.splice(index, 1);
  state.editingArtbookItemId = state.editorArtbookItems[Math.min(index, state.editorArtbookItems.length - 1)]?.id || null;
  renderArtbookControl();
  markEditorDirty("Planche supprimée, livre non enregistré.");
  showActionToast("Planche supprimée.", "Annuler", () => {
    state.editorArtbookItems.splice(index, 0, item);
    state.editingArtbookItemId = item.id;
    renderArtbookControl();
    markEditorDirty("Suppression de la planche annulée.");
  });
}

function moveCurrentArtbookItem(direction) {
  const index = getEditingArtbookItemIndex();
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.editorArtbookItems.length) return;

  const [item] = state.editorArtbookItems.splice(index, 1);
  state.editorArtbookItems.splice(nextIndex, 0, item);
  renderArtbookControl();
  markEditorDirty("Ordre de l'artbook modifié, livre non enregistré.");
}

function shouldStartNewParagraph(previousLine, nextLine, currentText) {
  const previous = previousLine.trim();
  const next = nextLine.trim();
  const nextStartsDialogue = /^[-"'\u00ab\u201c\u2013\u2014]/.test(next);
  const nextStartsSpeechLabel = /^[^\d\s][^.!?]{0,80}\s*:\s*[-\u2013\u2014]?\s*\S/.test(next);
  const previousEndsSentence = /[.!?\u2026\u00bb\u201d")\]]$/.test(previous);
  const nextStartsSentence = /^[\p{L}0-9"'\u00ab\u201c\u2014-]/u.test(next);

  return nextStartsDialogue || nextStartsSpeechLabel || (previousEndsSentence && nextStartsSentence);
}

function splitSoftLineBreaks(block) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [block.replace(/\n/g, " ").trim()].filter(Boolean);
  }

  const paragraphs = [];
  let currentLines = [];

  lines.forEach((line) => {
    if (!currentLines.length) {
      currentLines.push(line);
      return;
    }

    const currentText = currentLines.join(" ");
    const previousLine = currentLines[currentLines.length - 1];
    if (shouldStartNewParagraph(previousLine, line, currentText)) {
      paragraphs.push(currentText);
      currentLines = [line];
      return;
    }

    currentLines.push(line);
  });

  if (currentLines.length) {
    paragraphs.push(currentLines.join(" "));
  }

  return paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
}

function paragraphsFromContent(content) {
  if (hasHtmlMarkup(content)) {
    const container = document.createElement("div");
    container.innerHTML = normalizeRichContent(content);
    const blocks = [];
    let inlineParts = [];

    const flushInlineParts = () => {
      const inlineContent = inlineParts.join("").trim();
      if (inlineContent) blocks.push(inlineContent);
      inlineParts = [];
    };

    container.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) inlineParts.push(escapeHtml(text));
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (node.tagName.toUpperCase() === "P") {
        flushInlineParts();
        const paragraph = node.innerHTML.trim();
        if (paragraph) {
          const paragraphParts = paragraph
            .split(/<br\s*\/?>/i)
            .map((part) => part.trim())
            .filter(Boolean);
          blocks.push(...(paragraphParts.length > 1 ? paragraphParts : [paragraph]));
        }
        return;
      }

      inlineParts.push(node.outerHTML);
    });

    flushInlineParts();
    return blocks;
  }

  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .flatMap(splitSoftLineBreaks)
    .map((paragraph) => escapeHtml(paragraph))
    .filter(Boolean);
}

function paragraphPlainText(paragraph) {
  return richContentToPlainText(paragraph);
}

function paginationTextFromParagraph(paragraph) {
  const container = document.createElement("div");
  container.innerHTML = normalizeRichContent(paragraph);
  container.querySelectorAll("[data-audio-anchor]").forEach((anchor) => {
    const trackId = String(anchor.dataset.audioAnchor || "").trim();
    const anchorId = String(anchor.dataset.audioAnchorId || "").trim();
    const suffix = anchorId ? `:${anchorId}` : "";
    anchor.replaceWith(document.createTextNode(trackId ? ` [[audio-anchor:${trackId}${suffix}]] ` : ""));
  });
  return container.textContent.replace(/\s+/g, " ").trim();
}

function paginationChunkHtml(chunk) {
  return escapeHtml(chunk).replace(/\[\[audio-anchor:([a-z0-9_-]{1,100})(?::([a-z0-9_-]{1,100}))?\]\]/gi, (match, trackId, anchorId) => {
    const track = getAllAmbianceTracks().find((item) => item.id === trackId);
    const label = track?.label || "Son";
    const anchorIdAttribute = anchorId ? ` data-audio-anchor-id="${escapeHtml(anchorId)}"` : "";
    return `<span class="audio-anchor" data-audio-anchor="${escapeHtml(trackId)}"${anchorIdAttribute} data-audio-label="${escapeHtml(label)}" contenteditable="false" aria-label="Ancre sonore : ${escapeHtml(label)}"></span>`;
  });
}

function createPage(chapter, chapterIndex, startsChapter, startParagraphIndex = 0) {
  return {
    chapterId: chapter.id,
    chapterIndex,
    chapterTitle: chapter.title,
    startsChapter,
    paragraphs: [],
    paragraphStart: startParagraphIndex,
    charCount: startsChapter ? chapter.title.length + 120 : 0,
  };
}

function createIllustrationPage(chapter, chapterIndex) {
  return {
    chapterId: chapter.id,
    chapterIndex,
    chapterTitle: chapter.title,
    startsChapter: false,
    paragraphs: [],
    paragraphStart: Number.MAX_SAFE_INTEGER,
    charCount: 0,
    illustration: chapter.illustration || "",
  };
}

function appendChapterIllustrationPage(pages, chapter, chapterIndex) {
  if (!chapter.illustration) return;
  pages.push(createIllustrationPage(chapter, chapterIndex));
}

function estimatePaginateBook(book) {
  const baseChars = densityMap[book.density] || densityMap.classic;
  const fontScale = Math.pow(18 / (book.fontSize || 18), 1.35);
  const maxChars = Math.round(baseChars * fontScale);
  const pages = [];

  book.chapters.forEach((chapter, chapterIndex) => {
    const paragraphs = paragraphsFromContent(chapter.content);
    let page = createPage(chapter, chapterIndex, true, 0);

    paragraphs.forEach((paragraph, paragraphIndex) => {
      const plainParagraph = paragraphPlainText(paragraph);
      const weight = plainParagraph.length + 90;
      if (page.paragraphs.length && page.charCount + weight > maxChars) {
        pages.push(page);
        page = createPage(chapter, chapterIndex, false, paragraphIndex);
      }

      if (plainParagraph.length > maxChars) {
        const chunks = plainParagraph.match(new RegExp(`.{1,${Math.max(420, maxChars - 160)}}(\\s|$)`, "g")) || [plainParagraph];
        chunks.forEach((chunk, chunkIndex) => {
          if (page.paragraphs.length && page.charCount + chunk.length > maxChars) {
            pages.push(page);
            page = createPage(chapter, chapterIndex, false, paragraphIndex);
          }
          page.paragraphs.push(escapeHtml(chunk.trim()));
          page.charCount += chunk.length + 90;
          if (chunkIndex < chunks.length - 1) {
            pages.push(page);
            page = createPage(chapter, chapterIndex, false, paragraphIndex);
          }
        });
        return;
      }

      page.paragraphs.push(paragraph);
      page.charCount += weight;
    });

    pages.push(page);
    appendChapterIllustrationPage(pages, chapter, chapterIndex);
  });

  return pages.length ? pages : [{ chapterTitle: book.title, startsChapter: true, paragraphs: ["Aucun texte ajouté pour le moment."] }];
}

function pageHtml(page) {
  if (page.illustration) {
    return `
      <figure class="chapter-illustration-page">
        <img src="${escapeHtml(page.illustration)}" alt="${escapeHtml(`Illustration - ${page.chapterTitle || ""}`)}" />
      </figure>
      <span class="page-number">0</span>
    `;
  }

  const title = page.startsChapter ? `<h2>${escapeHtml(page.chapterTitle)}</h2>` : "";
  const paragraphs = page.paragraphs
    .map((paragraph) => `<p${isDialogueParagraph(paragraph) ? ' class="dialogue-line"' : ""}>${sanitizeRichHtml(paragraph)}</p>`)
    .join("");

  return `
    <div class="page-kicker">${escapeHtml(page.chapterTitle || "")}</div>
    ${title}
    ${paragraphs}
    <span class="page-number">0</span>
  `;
}

function createPaginationMeasurer(book) {
  const samplePage = byId("right-page") || byId("left-page");
  const bounds = samplePage?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 1020;
  const shellWidth = Math.min(1440, Math.max(320, viewportWidth - 32));
  const stageWidth = viewportWidth <= 1080 ? shellWidth : Math.max(320, shellWidth - 360);
  const fallbackWidth = viewportWidth <= 760 ? Math.min(620, Math.max(320, viewportWidth - 20)) : Math.min(1020, stageWidth) / 2;
  const width = bounds?.width || fallbackWidth;
  const height = bounds?.height || (viewportWidth <= 760 ? 620 : 680);

  const measurer = document.createElement("article");
  measurer.className = "paper-page pagination-measurer";
  measurer.style.width = `${width}px`;
  measurer.style.minHeight = `${height}px`;
  measurer.style.height = `${height}px`;
  measurer.style.setProperty("--reader-font-size", `${state.readerPrefs.fontSize || book.fontSize || 18}px`);
  measurer.style.setProperty("--reader-line-height", state.readerPrefs.lineHeight || 1.58);
  document.body.appendChild(measurer);
  return measurer;
}

function overflowsPage(measurer) {
  return measurer.scrollHeight > measurer.clientHeight + 2;
}

function splitOverflowingParagraph(paragraph, chapter, chapterIndex, paragraphIndex, measurer, startsChapter) {
  const plainParagraph = paginationTextFromParagraph(paragraph);
  const tokens = plainParagraph.match(/\S+\s*/g) || [];
  const pages = [];
  let tokenIndex = 0;
  let firstChunk = true;

  while (tokenIndex < tokens.length) {
    let low = 1;
    let high = tokens.length - tokenIndex;
    let best = 1;

    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const chunk = tokens.slice(tokenIndex, tokenIndex + count).join("").trim();
      const testPage = createPage(chapter, chapterIndex, startsChapter && firstChunk, paragraphIndex);
      testPage.paragraphs.push(paginationChunkHtml(chunk));
      measurer.innerHTML = pageHtml(testPage);

      if (!overflowsPage(measurer) || count === 1) {
        best = count;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }

    const chunk = tokens.slice(tokenIndex, tokenIndex + best).join("").trim();
    if (chunk) {
      const chunkPage = createPage(chapter, chapterIndex, startsChapter && firstChunk, paragraphIndex);
      chunkPage.paragraphs.push(paginationChunkHtml(chunk));
      pages.push(chunkPage);
    }
    tokenIndex += best;
    firstChunk = false;
  }

  return pages;
}

function measuredPaginateBook(book) {
  const measurer = createPaginationMeasurer(book);
  if (!measurer) return estimatePaginateBook(book);

  const pages = [];

  book.chapters.forEach((chapter, chapterIndex) => {
    const paragraphs = paragraphsFromContent(chapter.content);
    let page = createPage(chapter, chapterIndex, true, 0);

    paragraphs.forEach((paragraph, paragraphIndex) => {
      page.paragraphs.push(paragraph);
      measurer.innerHTML = pageHtml(page);

      if (page.paragraphs.length > 1 && overflowsPage(measurer)) {
        page.paragraphs.pop();
        pages.push(page);
        page = createPage(chapter, chapterIndex, false, paragraphIndex);
        page.paragraphs.push(paragraph);
        measurer.innerHTML = pageHtml(page);
      }

      if (overflowsPage(measurer)) {
        const splitStartsChapter = page.startsChapter && page.paragraphs.length === 1;
        page.paragraphs.pop();
        if (page.paragraphs.length) pages.push(page);
        pages.push(...splitOverflowingParagraph(paragraph, chapter, chapterIndex, paragraphIndex, measurer, splitStartsChapter));
        page = createPage(chapter, chapterIndex, false, paragraphIndex + 1);
      }
    });

    if (page.paragraphs.length || !paragraphs.length) {
      pages.push(page);
    }
    appendChapterIllustrationPage(pages, chapter, chapterIndex);
  });

  measurer.remove();
  return pages.length ? pages : estimatePaginateBook(book);
}

function paginateBook(book, options = {}) {
  return options.measured ? measuredPaginateBook(book) : estimatePaginateBook(book);
}

function getBookVersion(book) {
  return [
    book.updatedAt || "",
    book.fontSize || "",
    book.density || "",
    state.readerPrefs.fontSize,
    state.readerPrefs.lineHeight,
    book.chapters.map((chapter) => `${chapter.id}:${chapter.title}:${chapter.content.length}:${chapter.illustration?.length || 0}`).join("|"),
    (book.artbookItems || []).map((item) => `${item.id}:${item.title}:${item.description?.length || 0}:${item.image?.length || 0}`).join("|"),
  ].join("::");
}

function findChapterStartPage(pages, chapterId) {
  return Math.max(0, pages.findIndex((page) => page.chapterId === chapterId));
}

function isSpecialBookSection(chapter) {
  const title = (chapter.title || "").trim();
  return /^prologue$/i.test(title) || /^epilogue$/i.test(title) || /^epilogue$/i.test(title.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function getArtbookItems(book) {
  return (book?.artbookItems || []).filter((item) => item.image);
}

function hasArtbook(book) {
  return getArtbookItems(book).length > 0;
}

function bookWordCount(book) {
  return (book?.chapters || []).reduce((total, chapter) => total + chapterWordCount(chapter), 0);
}

function formatReadingTime(words) {
  const minutes = Math.max(1, Math.round(words / 230));
  return `${minutes} min`;
}

function syncArtbookNavButton() {
  const button = document.querySelector('[data-view-target="artbook"]');
  if (!button) return;
  button.hidden = !hasArtbook(getBook(state.activeBookId));
}

function formatBookSectionStats(book) {
  const hasPrologue = book.chapters.some((chapter) => /^prologue$/i.test((chapter.title || "").trim()));
  const hasEpilogue = book.chapters.some((chapter) => /^epilogue$/i.test((chapter.title || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  const extraSpecialCount = book.chapters.filter((chapter) => isSpecialBookSection(chapter)).length - Number(hasPrologue) - Number(hasEpilogue);
  const chapterCount = Math.max(0, book.chapters.length - book.chapters.filter(isSpecialBookSection).length);
  const parts = [];

  if (hasPrologue) {
    parts.push("Prologue");
  }

  if (chapterCount) {
    parts.push(`${chapterCount} chapitre${chapterCount > 1 ? "s" : ""}`);
  }

  if (hasEpilogue) {
    parts.push("Épilogue");
  }

  if (extraSpecialCount > 0) {
    parts.push(`${extraSpecialCount} section${extraSpecialCount > 1 ? "s" : ""}`);
  }

  const chapterStats = parts.length ? parts.join(" + ") : "Aucun chapitre";
  const artbookCount = getArtbookItems(book).length;
  const words = bookWordCount(book);
  const readingStats = words ? `${words.toLocaleString("fr-FR")} mots - ${formatReadingTime(words)}` : "";
  const artbookStats = artbookCount ? `${artbookCount} planche${artbookCount > 1 ? "s" : ""}` : "";
  return [chapterStats, readingStats, artbookStats].filter(Boolean).join(" - ");
}

function renderBookGrid() {
  const grid = byId("book-grid");
  const template = byId("book-card-template");
  const query = byId("search-input").value.trim().toLowerCase();
  const sort = byId("sort-select").value;

  grid.innerHTML = "";

  let books = [...state.books].filter((book) => {
    const haystack = [
      book.title,
      book.author,
      book.summary,
      ...book.chapters.map((chapter) => chapter.title),
      ...(book.artbookItems || []).flatMap((item) => [item.title, item.description]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  books.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "author") return (a.author || "").localeCompare(b.author || "");
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  if (!books.length) {
    grid.innerHTML = '<div class="empty-state"><h2>Aucun livre trouvé</h2><p>Ajoute un livre ou modifie ta recherche.</p></div>';
    return;
  }

  books.forEach((book) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const cover = node.querySelector(".cover-button");
    cover.style.backgroundImage = coverBackground(book);
    cover.setAttribute("aria-label", `Ouvrir ${book.title}`);
    cover.addEventListener("click", () => openReaderWithBusy(book.id));
    node.querySelector(".book-author").textContent = book.author || "Auteur inconnu";
    node.querySelector(".book-title").textContent = book.title;
    node.querySelector(".book-summary").textContent = book.summary || "Aucun résumé pour le moment.";
    node.querySelector(".book-stats").textContent = formatBookSectionStats(book);
    const readButton = node.querySelector(".read-book");
    readButton.setAttribute("aria-label", `Lire ${book.title}`);
    readButton.addEventListener("click", () => openReaderWithBusy(book.id));
    const artbookButton = node.querySelector(".open-artbook");
    artbookButton.hidden = !hasArtbook(book);
    if (hasArtbook(book)) {
      artbookButton.setAttribute("aria-label", `Ouvrir l'artbook de ${book.title}`);
      artbookButton.addEventListener("click", () => openArtbookWithBusy(book.id));
    }
    const editButton = node.querySelector(".edit-book");
    editButton.setAttribute("aria-label", `Modifier ${book.title}`);
    editButton.addEventListener("click", () => editBook(book.id));
    grid.appendChild(node);
  });

  syncArtbookNavButton();
}

function coverBackground(book) {
  if (book.cover) {
    return `linear-gradient(rgba(28, 24, 21, 0.08), rgba(28, 24, 21, 0.42)), url(${JSON.stringify(book.cover)})`;
  }
  return "linear-gradient(145deg, #35442d, #8e7f65)";
}

function setCoverPreview(value) {
  const preview = byId("cover-preview");
  if (!preview) return;
  preview.style.backgroundImage = value ? `url(${JSON.stringify(value)})` : "";
}

async function compressImageFile(file, maxWidth = 900, quality = 0.82) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = objectUrl;
  });

  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(objectUrl);

  return canvas.toDataURL("image/jpeg", quality);
}

function compressCoverImage(file) {
  return compressImageFile(file, 900, 0.82);
}

function compressChapterIllustration(file) {
  return compressImageFile(file, 1600, 0.86);
}

function compressArtbookImage(file) {
  return compressImageFile(file, 1800, 0.88);
}

async function handleCoverFileChange(event) {
  if (state.isBusy) return;

  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Choisis un fichier image pour la couverture.");
    event.target.value = "";
    return;
  }

  await withAppBusy("Préparation de la couverture…", async () => {
    try {
      coverUpload.dataUrl = await compressCoverImage(file);
      byId("book-cover").value = "";
      setCoverPreview(coverUpload.dataUrl);
    } catch (error) {
      console.error(error);
      alert("Impossible de lire cette image.");
    }
  });
}

async function handleChapterIllustrationFileChange(event) {
  if (state.isBusy) return;

  const index = getEditingChapterIndex();
  if (index < 0) return;

  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Choisis un fichier image pour l'illustration.");
    event.target.value = "";
    return;
  }

  await withAppBusy("Préparation de l'illustration…", async () => {
    try {
      const illustration = await compressChapterIllustration(file);
      state.editorChapters[index] = {
        ...state.editorChapters[index],
        title: byId("chapter-title").value.trim(),
        content: readRichEditorContent(),
        ambianceTrackId: byId("chapter-ambiance-track").value,
        illustration,
      };
      setChapterIllustrationPreview(illustration);
      renderChapterControl();
      updateImportPreview();
      markEditorDirty("Illustration ajoutée, livre non enregistré.");
    } catch (error) {
      console.error(error);
      alert("Impossible de lire cette image.");
    } finally {
      event.target.value = "";
    }
  });
}

function removeChapterIllustration() {
  const index = getEditingChapterIndex();
  if (index < 0 || !state.editorChapters[index].illustration) return;

  state.editorChapters[index] = {
    ...state.editorChapters[index],
    title: byId("chapter-title").value.trim(),
    content: readRichEditorContent(),
    ambianceTrackId: byId("chapter-ambiance-track").value,
    illustration: "",
  };
  setChapterIllustrationPreview("");
  renderChapterControl();
  updateImportPreview();
  markEditorDirty("Illustration retirée, livre non enregistré.");
}

async function handleArtbookImageFileChange(event) {
  if (state.isBusy) return;

  const index = getEditingArtbookItemIndex();
  if (index < 0) return;

  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Choisis un fichier image pour la planche.");
    event.target.value = "";
    return;
  }

  await withAppBusy("Préparation de l'image d'artbook...", async () => {
    try {
      const image = await compressArtbookImage(file);
      state.editorArtbookItems[index] = {
        ...state.editorArtbookItems[index],
        title: byId("artbook-title").value.trim(),
        description: byId("artbook-description").value.trim(),
        image,
      };
      byId("artbook-image-url").value = "";
      setArtbookImagePreview(image);
      renderArtbookControl();
      markEditorDirty("Image d'artbook ajoutée, livre non enregistré.");
    } catch (error) {
      console.error(error);
      alert("Impossible de lire cette image.");
    } finally {
      event.target.value = "";
    }
  });
}

function removeArtbookImage() {
  const index = getEditingArtbookItemIndex();
  if (index < 0 || !state.editorArtbookItems[index].image) return;

  state.editorArtbookItems[index] = {
    ...state.editorArtbookItems[index],
    title: byId("artbook-title").value.trim(),
    description: byId("artbook-description").value.trim(),
    image: "",
  };
  byId("artbook-image-url").value = "";
  setArtbookImagePreview("");
  renderArtbookControl();
  markEditorDirty("Image d'artbook retirée, livre non enregistré.");
}

function updateImportPreview() {
  const importedChapters = getChaptersFromSource();
  const chapters = state.editorChapters;
  const words = chapters.reduce((total, chapter) => total + chapterWordCount(chapter), 0);
  const importPreview = byId("import-chapter-preview");
  const previewBook = {
    chapters,
    fontSize: Number(byId("font-size").value),
    density: byId("page-density").value,
    title: byId("book-title").value || "Aperçu",
  };
  const pages = chapters.length ? paginateBook(previewBook).length : 0;
  byId("import-preview").textContent = `${chapters.length} chapitre${chapters.length > 1 ? "s" : ""} dans le livre · environ ${words} mots · ${pages} page${pages > 1 ? "s" : ""} estimée${pages > 1 ? "s" : ""} · ${importedChapters.length} chapitre${importedChapters.length > 1 ? "s" : ""} détecté${importedChapters.length > 1 ? "s" : ""} dans l'import`;
  if (!importPreview) return;

  if (!byId("chapter-source").value.trim()) {
    importPreview.innerHTML = "";
    return;
  }

  if (!importedChapters.length) {
    importPreview.innerHTML = '<p class="import-warning">Aucun chapitre détecté. Vérifie que les titres commencent par Chapitre, Prologue, Épilogue ou #.</p>';
    return;
  }

  importPreview.innerHTML = importedChapters
    .map((chapter, index) => `
      <div class="import-preview-item">
        <strong>${index + 1}. ${escapeHtml(chapter.title || `Chapitre ${index + 1}`)}</strong>
        <span>${chapterWordCount(chapter)} mot${chapterWordCount(chapter) > 1 ? "s" : ""}</span>
      </div>
    `)
    .join("");
}

function validateChapters(chapters) {
  if (!chapters.length) {
    return "Ajoute au moins un chapitre ou un bloc de texte.";
  }

  const titleCounts = new Map();
  chapters.forEach((chapter) => {
    const key = (chapter.title || "").trim().toLowerCase();
    if (key) titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });
  const duplicateTitle = chapters.find((chapter) => titleCounts.get((chapter.title || "").trim().toLowerCase()) > 1);
  if (duplicateTitle) {
    return `Le titre de chapitre "${duplicateTitle.title}" est utilisé plusieurs fois. Renomme-le pour garder un sommaire clair.`;
  }

  const emptyChapter = chapters.find((chapter) => !richContentToPlainText(chapter.content).trim() && !chapter.illustration);
  if (emptyChapter) {
    return `Le chapitre « ${emptyChapter.title} » est vide. Ajoute du contenu ou supprime-le.`;
  }

  return "";
}

function validateArtbookItems(items) {
  const titleCounts = new Map();
  items.forEach((item) => {
    const key = (item.title || "").trim().toLowerCase();
    if (key) titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });
  const duplicateTitle = items.find((item) => item.title && titleCounts.get(item.title.trim().toLowerCase()) > 1);
  if (duplicateTitle) {
    return `La planche "${duplicateTitle.title}" existe déjà. Renomme-la pour faciliter la navigation.`;
  }

  const incompleteItem = items.find((item) => !item.image && (item.title || item.description));
  if (incompleteItem) {
    return `La planche "${incompleteItem.title || "sans titre"}" doit avoir une image.`;
  }

  return "";
}

function isValidOptionalUrl(value) {
  if (!value || value.startsWith("data:image/") || value.startsWith("asset/")) return true;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateBookPayload(payload) {
  if (!payload.title.trim()) return "Ajoute un titre au livre.";
  if (!Number.isFinite(payload.fontSize) || payload.fontSize < 16 || payload.fontSize > 22) {
    return "La taille du texte doit rester entre 16 et 22.";
  }
  if (!isValidOptionalUrl(payload.cover)) {
    return "L'URL de couverture doit commencer par http:// ou https://.";
  }
  const invalidChapterImage = payload.chapters.find((chapter) => !isValidOptionalUrl(chapter.illustration));
  if (invalidChapterImage) {
    return `L'illustration du chapitre "${invalidChapterImage.title}" doit être une URL valide.`;
  }
  const invalidArtbookImage = payload.artbookItems.find((item) => !isValidOptionalUrl(item.image));
  if (invalidArtbookImage) {
    return `L'image de la planche "${invalidArtbookImage.title || "sans titre"}" doit être une URL valide.`;
  }
  return "";
}

function getBookSaveErrorMessage(error) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");

  if (/illustration/i.test(errorText) && /(column|schema|PGRST204|cache)/i.test(errorText)) {
    return "La base Supabase n'est pas à jour : applique la migration des illustrations, puis recharge la page.";
  }

  if (/artbook_items/i.test(errorText) || (/artbook/i.test(errorText) && /(relation|schema|cache|PGRST204)/i.test(errorText))) {
    return "La base Supabase n'est pas à jour : applique la migration des artbooks, puis recharge la page.";
  }

  if (/bucket/i.test(errorText) && /not found/i.test(errorText)) {
    return "Le bucket Supabase Storage « covers » n'existe pas encore : applique la migration des illustrations.";
  }

  return "Impossible d'enregistrer le livre dans la base de données.";
}

function readForm() {
  const artbookItems = state.editorArtbookItems
    .map(cloneArtbookItem)
    .filter((item) => item.title || item.description || item.image);

  return {
    title: byId("book-title").value.trim(),
    author: byId("book-author").value.trim(),
    summary: byId("book-summary").value.trim(),
    cover: coverUpload.dataUrl || byId("book-cover").value.trim(),
    fontSize: Number(byId("font-size").value),
    density: byId("page-density").value,
    chapters: state.editorChapters.map(cloneChapter),
    artbookItems,
  };
}

function toBookRow(payload, bookmarkPage = 0) {
  return {
    title: payload.title,
    author: payload.author || null,
    summary: payload.summary || null,
    cover: payload.cover || null,
    font_size: payload.fontSize,
    density: payload.density,
    bookmark_page: bookmarkPage,
  };
}

function toChapterRows(bookId, chapters) {
  return chapters.map((chapter, index) => ({
    id: chapter.id,
    book_id: bookId,
    position: index + 1,
    title: chapter.title,
    content: chapter.content,
    illustration: chapter.illustration || "",
    ambiance_track_id: chapter.ambianceTrackId || "",
  }));
}

function toArtbookItemRows(bookId, items) {
  return items.map((item, index) => ({
    id: item.id,
    book_id: bookId,
    position: index + 1,
    title: item.title || null,
    description: item.description || "",
    image: item.image || "",
  }));
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

async function uploadImageToDatabase(bookId, image, prefix) {
  if (!image?.startsWith("data:image/") || !state.db?.storage) {
    return image;
  }

  try {
    const blob = dataUrlToBlob(image);
    const extension = blob.type.split("/")[1] || "jpg";
    const path = `${bookId}/${prefix}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error } = await state.db.storage
      .from(COVER_BUCKET)
      .upload(path, blob, { contentType: blob.type, upsert: true });

    if (error) throw error;

    const { data } = state.db.storage.from(COVER_BUCKET).getPublicUrl(path);
    return data.publicUrl || image;
  } catch (error) {
    console.warn("Impossible d'envoyer l'image vers Supabase Storage, conservation en base64.", error);
    return image;
  }
}

function uploadCoverToDatabase(bookId, cover) {
  return uploadImageToDatabase(bookId, cover, "cover");
}

async function uploadChapterIllustrationsToDatabase(bookId, chapters) {
  const uploadedChapters = [];

  for (const [index, chapter] of chapters.entries()) {
    uploadedChapters.push({
      ...chapter,
      illustration: await uploadImageToDatabase(bookId, chapter.illustration, `chapter-${index + 1}-illustration`),
    });
  }

  return uploadedChapters;
}

async function uploadArtbookImagesToDatabase(bookId, items) {
  const uploadedItems = [];

  for (const [index, item] of items.entries()) {
    uploadedItems.push({
      ...item,
      image: await uploadImageToDatabase(bookId, item.image, `artbook-${index + 1}`),
    });
  }

  return uploadedItems;
}

async function saveChaptersToDatabase(bookId, chapters, existingBook = null) {
  const chapterRows = toChapterRows(bookId, chapters);
  const keepIds = chapterRows.map((chapter) => chapter.id);

  if (existingBook?.chapters?.length) {
    const temporaryPositionStart = -1000000000;

    for (const [index, chapter] of existingBook.chapters.entries()) {
      const { error } = await state.db
        .from("chapters")
        .update({ position: temporaryPositionStart + index })
        .eq("id", chapter.id);

      if (error) throw error;
    }

    const removedIds = existingBook.chapters
      .map((chapter) => chapter.id)
      .filter((id) => !keepIds.includes(id));

    if (removedIds.length) {
      const { error } = await state.db.from("chapters").delete().in("id", removedIds);
      if (error) throw error;
    }
  }

  if (!chapterRows.length) return;

  const { error } = await state.db
    .from("chapters")
    .upsert(chapterRows, { onConflict: "id" });

  if (error) throw error;
}

async function saveArtbookItemsToDatabase(bookId, items, existingBook = null) {
  const itemRows = toArtbookItemRows(bookId, items);
  const keepIds = itemRows.map((item) => item.id);

  if (existingBook?.artbookItems?.length) {
    const temporaryPositionStart = -2000000000;

    for (const [index, item] of existingBook.artbookItems.entries()) {
      const { error } = await state.db
        .from("artbook_items")
        .update({ position: temporaryPositionStart + index })
        .eq("id", item.id);

      if (error) throw error;
    }

    const removedIds = existingBook.artbookItems
      .map((item) => item.id)
      .filter((id) => !keepIds.includes(id));

    if (removedIds.length) {
      const { error } = await state.db.from("artbook_items").delete().in("id", removedIds);
      if (error) throw error;
    }
  }

  if (!itemRows.length) return;

  const { error } = await state.db
    .from("artbook_items")
    .upsert(itemRows, { onConflict: "id" });

  if (error) throw error;
}

async function saveBookToDatabase(payload, existingBook = null) {
  if ((payload.artbookItems || []).length && state.hasArtbookTable === false) {
    throw new Error("artbook_items table missing");
  }

  const bookRow = toBookRow(payload, existingBook?.bookmarkPage || 0);
  let savedBook;

  if (existingBook) {
    const { data, error } = await state.db
      .from("books")
      .update(bookRow)
      .eq("id", existingBook.id)
      .select()
      .single();

    if (error) throw error;
    savedBook = data;
  } else {
    const { data, error } = await state.db
      .from("books")
      .insert(bookRow)
      .select()
      .single();

    if (error) throw error;
    savedBook = data;
  }

  const cover = await uploadCoverToDatabase(savedBook.id, payload.cover);
  if (cover !== savedBook.cover) {
    const { error } = await state.db
      .from("books")
      .update({ cover })
      .eq("id", savedBook.id);

    if (error) throw error;
  }

  const chapters = await uploadChapterIllustrationsToDatabase(savedBook.id, payload.chapters);
  await saveChaptersToDatabase(savedBook.id, chapters, existingBook);
  const artbookItems = await uploadArtbookImagesToDatabase(savedBook.id, payload.artbookItems || []);
  await saveArtbookItemsToDatabase(savedBook.id, artbookItems, existingBook);
  await loadBooksFromDatabase();
  return savedBook.id;
}

async function restoreBookToDatabase(book) {
  const payload = normalizeBook(book);
  const bookRow = {
    id: payload.id,
    ...toBookRow(payload, payload.bookmarkPage || 0),
    updated_at: payload.updatedAt || new Date().toISOString(),
  };
  const { error: bookError } = await state.db
    .from("books")
    .upsert(bookRow, { onConflict: "id" });

  if (bookError) throw bookError;

  const chapters = await uploadChapterIllustrationsToDatabase(payload.id, payload.chapters);
  await saveChaptersToDatabase(payload.id, chapters, getBook(payload.id));
  const artbookItems = await uploadArtbookImagesToDatabase(payload.id, payload.artbookItems || []);
  await saveArtbookItemsToDatabase(payload.id, artbookItems, getBook(payload.id));
}

function fillForm(book) {
  isFillingEditor = true;
  state.editingBookId = book?.id || null;
  switchEditorTab("book");
  byId("book-title").value = book?.title || "";
  byId("book-author").value = book?.author || "";
  byId("book-summary").value = book?.summary || "";
  byId("book-cover").value = book?.cover || "";
  byId("book-cover-file").value = "";
  coverUpload.dataUrl = "";
  setCoverPreview(book?.cover || "");
  byId("font-size").value = book?.fontSize || 18;
  byId("page-density").value = book?.density || "classic";
  setEditorChapters(book?.chapters || []);
  setEditorArtbookItems(book?.artbookItems || []);
  byId("delete-book").hidden = !book;
  markEditorSaved(book ? "Livre chargé. Aucune modification en attente." : "Nouveau livre prêt.");
  isFillingEditor = false;
}

function applyEditorDraft(draft) {
  if (!draft?.book) return false;
  isFillingEditor = true;
  state.editingBookId = draft.editingBookId || null;
  byId("book-title").value = draft.book.title || "";
  byId("book-author").value = draft.book.author || "";
  byId("book-summary").value = draft.book.summary || "";
  byId("book-cover").value = draft.book.cover || "";
  byId("book-cover-file").value = "";
  coverUpload.dataUrl = "";
  setCoverPreview(draft.book.cover || "");
  byId("font-size").value = draft.book.fontSize || 18;
  byId("page-density").value = draft.book.density || "classic";
  setEditorChapters(draft.book.chapters || [], draft.editingChapterId || null);
  setEditorArtbookItems(draft.book.artbookItems || [], draft.editingArtbookItemId || null);
  byId("delete-book").hidden = !state.editingBookId;
  isFillingEditor = false;
  state.editorDirty = true;
  setEditorStatus(`Brouillon restauré (${new Date(draft.savedAt).toLocaleString("fr-FR")}).`, "dirty");
  showView("editor");
  return true;
}

function offerEditorDraftRestore() {
  const draft = readJsonStorage(EDITOR_DRAFT_KEY, null);
  if (!draft?.book) return;
  showActionToast("Un brouillon non enregistré est disponible.", "Restaurer", () => applyEditorDraft(draft), 12000);
}

async function saveForm(event) {
  event.preventDefault();
  if (state.isBusy) return;
  flushEditorMaintenance();

  if (getEditingChapter() && !saveCurrentChapter()) {
    return;
  }

  if (getEditingArtbookItem() && !saveCurrentArtbookItem({ silent: true })) {
    return;
  }

  const payload = readForm();

  const bookError = validateBookPayload(payload);
  if (bookError) {
    alert(bookError);
    return;
  }

  const chapterError = validateChapters(payload.chapters);
  if (chapterError) {
    alert(chapterError);
    return;
  }

  const artbookError = validateArtbookItems(payload.artbookItems);
  if (artbookError) {
    alert(artbookError);
    return;
  }

  const submitButton = event.submitter || byId("book-form").querySelector('button[type="submit"]');
  await withAppBusy("Enregistrement du livre…", async () => {
  submitButton.disabled = true;

  try {
    if (state.storageMode === "supabase") {
      const existingBook = state.editingBookId ? getBook(state.editingBookId) : null;
      state.activeBookId = await saveBookToDatabase(payload, existingBook);
      state.editingBookId = state.activeBookId;
    } else if (state.editingBookId) {
      const index = state.books.findIndex((book) => book.id === state.editingBookId);
      state.books[index] = {
        ...state.books[index],
        ...payload,
        updatedAt: new Date().toISOString(),
      };
      state.activeBookId = state.editingBookId;
      saveBooks();
    } else {
      const book = {
        id: crypto.randomUUID(),
        ...payload,
        bookmarkPage: 0,
        updatedAt: new Date().toISOString(),
      };
      state.books.unshift(book);
      state.activeBookId = book.id;
      state.editingBookId = book.id;
      saveBooks();
    }

    renderBookGrid();
    markEditorSaved("Livre enregistré.");
    openReader(state.activeBookId);
  } catch (error) {
    console.error(error);
    alert(getBookSaveErrorMessage(error));
  } finally {
    submitButton.disabled = false;
  }
  });
}

function editBook(bookId) {
  const book = getBook(bookId);
  if (!book) return;
  fillForm(book);
  showView("editor");
}

async function deleteCurrentBook() {
  if (state.isBusy) return;
  if (!state.editingBookId) return;
  const book = getBook(state.editingBookId);
  if (!book || !confirm(`Supprimer « ${book.title} » ?`)) return;

  const deletedBook = normalizeBook(book);
  const deletedBookId = state.editingBookId;
  await withAppBusy("Suppression du livre…", async () => {
  if (state.storageMode === "supabase") {
    const { error } = await state.db.from("books").delete().eq("id", deletedBookId);
    if (error) {
      console.error(error);
      alert("Impossible de supprimer le livre dans la base de données.");
      return;
    }
    await loadBooksFromDatabase();
  } else {
    state.books = state.books.filter((item) => item.id !== deletedBookId);
    saveBooks();
  }

  if (state.activeBookId === deletedBookId) {
    state.activeBookId = state.books[0]?.id || null;
    localStorage.removeItem(ACTIVE_BOOK_KEY);
  }
  state.editingBookId = null;
  fillForm(null);
  renderBookGrid();
  showView("library");
  showActionToast("Livre supprimé.", "Annuler", async () => {
    await withAppBusy("Restauration du livre…", async () => {
      if (state.storageMode === "supabase") {
        await restoreBookToDatabase(deletedBook);
        await loadBooksFromDatabase();
      } else {
        state.books.unshift(deletedBook);
        saveBooks();
      }
      state.activeBookId = deletedBook.id;
      renderBookGrid();
      editBook(deletedBook.id);
    });
  });
  });
}

function openReader(bookId, page = null) {
  const book = getBook(bookId);
  if (!book) return;

  cancelAudioAnchorPlayback(true);
  state.playedAudioAnchors = new Set();
  state.activeBookId = bookId;
  localStorage.setItem(ACTIVE_BOOK_KEY, bookId);
  showView("reader");
  byId("reader-layout").hidden = false;
  byId("reader-empty").hidden = true;
  state.pages = paginateBook(book);
  const defaultPage = isInfiniteScrollActive() ? 0 : getReadingProgress(book.id) ?? book.bookmarkPage ?? 0;
  state.currentPage = Math.min(Math.max(page ?? defaultPage, 0), state.pages.length - 1);

  renderReader();
}

async function openReaderWithBusy(bookId, page = null) {
  if (state.isBusy) return;
  await withAppBusy("Ouverture du livre…", async () => openReader(bookId, page));
}

function getCurrentPageAnchor() {
  const page = state.pages[state.currentPage];
  return page ? { chapterId: page.chapterId, paragraphStart: page.paragraphStart || 0 } : null;
}

function findPageByAnchor(anchor) {
  if (!anchor) return state.currentPage;

  const exactIndex = state.pages.findIndex((page) =>
    page.chapterId === anchor.chapterId && (page.paragraphStart || 0) >= anchor.paragraphStart
  );

  if (exactIndex >= 0) return exactIndex;

  const chapterIndex = state.pages.findIndex((page) => page.chapterId === anchor.chapterId);
  return chapterIndex >= 0 ? chapterIndex : Math.min(state.currentPage, state.pages.length - 1);
}

function repaginateActiveBook() {
  const book = getBook(state.activeBookId);
  if (!book) return;

  const anchor = getCurrentPageAnchor();
  state.pages = paginateBook(book);
  state.currentPage = Math.min(Math.max(findPageByAnchor(anchor), 0), state.pages.length - 1);
  setReadingProgress(book.id, state.currentPage);
  renderReader();
}

function isInfiniteScrollAvailable() {
  return window.matchMedia("(max-width: 1080px)").matches;
}

function isInfiniteScrollActive() {
  return state.readerPrefs.infiniteScroll && isInfiniteScrollAvailable();
}

function ensurePagedReaderShell(reader) {
  let leftPage = byId("left-page");
  let rightPage = byId("right-page");

  if (!leftPage) {
    leftPage = document.createElement("article");
    leftPage.className = "paper-page left-page";
    leftPage.id = "left-page";
    leftPage.addEventListener("click", (event) => changePageFromPaperClick(event, "left"));
    reader.prepend(leftPage);
  }

  if (!rightPage) {
    rightPage = document.createElement("article");
    rightPage.className = "paper-page right-page";
    rightPage.id = "right-page";
    rightPage.addEventListener("click", (event) => changePageFromPaperClick(event, "right"));
    reader.append(rightPage);
  }
}

function renderContinuousReader(book) {
  const reader = byId("book-reader");
  ensurePagedReaderShell(reader);
  reader.querySelectorAll(".continuous-page").forEach((page) => page.remove());

  state.pages.forEach((page, index) => {
    const container = document.createElement("article");
    container.className = "paper-page continuous-page";
    container.dataset.pageIndex = index;
    renderPage(container, page, index, book);
    reader.append(container);
  });
}

function scrollToContinuousPage(pageIndex, behavior = "smooth") {
  if (!isInfiniteScrollActive()) return;

  const target = byId("book-reader")?.querySelector(`.continuous-page[data-page-index="${pageIndex}"]`);
  if (!target) return;

  state.suppressContinuousProgressUntil = Date.now() + 650;
  target.scrollIntoView({ block: "start", behavior });
}

function updateReaderProgressUI(book, options = {}) {
  const isBookmarked = book.bookmarkPage === state.currentPage;
  const currentPageLabel = `Page ${state.currentPage + 1} / ${state.pages.length}`;
  const progressValue = state.pages.length <= 1 ? 100 : Math.round((state.currentPage / (state.pages.length - 1)) * 100);
  const resumePage = Math.min(Math.max(getResumePage(book), 0), Math.max(0, state.pages.length - 1));
  const currentChapter = book.chapters.find((chapter) => chapter.id === state.pages[state.currentPage]?.chapterId);
  if (options.updateIndicator !== false) {
    byId("page-indicator").textContent = currentPageLabel;
    byId("progress-bar").value = progressValue;
    byId("page-jump").max = state.pages.length;
    byId("page-jump").value = state.currentPage + 1;
  }
  byId("sidebar-page-indicator").textContent = currentPageLabel;
  byId("sidebar-progress-bar").value = progressValue;
  byId("chapter-indicator").textContent = currentChapter?.title || `${progressValue}% du livre`;
  byId("reader-bookmark-chip").hidden = !Number.isInteger(book.bookmarkPage);
  byId("reader-bookmark-chip").textContent = Number.isInteger(book.bookmarkPage) ? `Marque-page p. ${book.bookmarkPage + 1}` : "";
  byId("floating-bookmark-button").setAttribute("aria-pressed", isBookmarked ? "true" : "false");
  byId("bookmark-button").textContent = isBookmarked ? "Marque-page pos\u00e9" : "Marque-page";
  byId("bookmark-button").setAttribute("aria-pressed", isBookmarked ? "true" : "false");
  byId("bookmark-button").setAttribute("aria-label", isBookmarked ? "Page déjà marquée" : "Marquer cette page");
  byId("bookmark-button").dataset.tooltip = isBookmarked ? "Page marquée" : "Marquer la page";
  byId("resume-button").textContent = `Reprendre page ${resumePage + 1}`;
  byId("resume-button").setAttribute("aria-label", `Reprendre la lecture page ${resumePage + 1}`);
  byId("resume-button").dataset.tooltip = `Reprendre page ${resumePage + 1}`;
  byId("floating-bookmark-button").textContent = isBookmarked ? "Page marqu\u00e9e" : "Marquer cette page";
}

function updateContinuousReadingProgress() {
  if (!isInfiniteScrollActive() || !byId("reader-view").classList.contains("is-active")) return;
  if (Date.now() < state.suppressContinuousProgressUntil) return;

  const pages = Array.from(byId("book-reader").querySelectorAll(".continuous-page"));
  if (!pages.length) return;

  const referenceY = Math.min(window.innerHeight * 0.42, 260);
  const closest = pages.reduce((currentClosest, page) => {
    const distance = Math.abs(page.getBoundingClientRect().top - referenceY);
    return distance < currentClosest.distance ? { page, distance } : currentClosest;
  }, { page: pages[0], distance: Infinity }).page;

  const nextPage = Number(closest.dataset.pageIndex || 0);
  if (nextPage === state.currentPage) return;

  state.currentPage = nextPage;
  const book = getBook(state.activeBookId);
  if (!book) return;

  setReadingProgress(book.id, state.currentPage);
  updateReaderProgressUI(book, { updateIndicator: false });
  renderToc(book);
  renderBookSearchResults();
  if (!syncPageAudioAnchors()) syncChapterAmbiance();
}

function renderReader() {
  const book = getBook(state.activeBookId);
  if (!book) {
    byId("reader-layout").hidden = true;
    byId("reader-empty").hidden = false;
    return;
  }

  byId("reader-layout").hidden = false;
  byId("reader-empty").hidden = true;
  syncReaderSidebarState();
  setReadingProgress(book.id, state.currentPage);
  byId("reader-book-title").textContent = book.title;
  const words = bookWordCount(book);
  byId("reader-book-meta").textContent = `${book.author || "Auteur inconnu"} - ${state.pages.length} pages - ${words.toLocaleString("fr-FR")} mots - ${formatReadingTime(words)}`;
  byId("reader-mini-cover").style.backgroundImage = coverBackground(book);
  applyReaderPrefs();
  updateInfiniteScrollButton();

  const infiniteScrollActive = isInfiniteScrollActive();
  byId("reader-layout").classList.toggle("is-infinite-scroll", infiniteScrollActive);
  byId("book-reader").classList.toggle("is-infinite-scroll", infiniteScrollActive);
  byId("floating-bookmark-button").hidden = !infiniteScrollActive;

  if (infiniteScrollActive) {
    renderContinuousReader(book);
    updateReaderProgressUI(book);
    updateAmbianceButton();
    updateSoundEffectsButton();
    byId("prev-page").disabled = state.currentPage <= 0;
    byId("next-page").disabled = state.currentPage >= state.pages.length - 1;
    byId("page-hotspot-left").disabled = state.currentPage <= 0;
    byId("page-hotspot-right").disabled = state.currentPage >= state.pages.length - 1;
    renderToc(book);
    renderBookSearchResults();
    if (!syncPageAudioAnchors()) syncChapterAmbiance();
    window.requestAnimationFrame(() => scrollToContinuousPage(state.currentPage, "auto"));
    return;
  }

  ensurePagedReaderShell(byId("book-reader"));
  byId("book-reader").querySelectorAll(".continuous-page").forEach((page) => page.remove());
  byId("floating-bookmark-button").hidden = true;

  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const leftIndex = isMobile ? state.currentPage : state.currentPage - (state.currentPage % 2);
  const rightIndex = isMobile ? null : leftIndex + 1;

  renderPage(byId("left-page"), state.pages[leftIndex], leftIndex, book);
  renderPage(byId("right-page"), rightIndex === null ? state.pages[state.currentPage] : state.pages[rightIndex], rightIndex ?? state.currentPage, book);

  byId("left-page").dataset.pageIndex = leftIndex;
  byId("right-page").dataset.pageIndex = rightIndex ?? state.currentPage;

  byId("page-indicator").textContent = isMobile || rightIndex >= state.pages.length
    ? `Page ${state.currentPage + 1} / ${state.pages.length}`
    : `Pages ${leftIndex + 1}-${rightIndex + 1} / ${state.pages.length}`;
  byId("progress-bar").value = state.pages.length <= 1 ? 100 : Math.round((state.currentPage / (state.pages.length - 1)) * 100);
  byId("page-jump").max = state.pages.length;
  byId("page-jump").value = state.currentPage + 1;
  updateReaderProgressUI(book, { updateIndicator: false });
  updateAmbianceButton();
  updateSoundEffectsButton();
  byId("prev-page").disabled = isMobile ? state.currentPage <= 0 : leftIndex <= 0;
  byId("next-page").disabled = isMobile ? state.currentPage >= state.pages.length - 1 : leftIndex + 2 >= state.pages.length;
  byId("page-hotspot-left").disabled = byId("prev-page").disabled;
  byId("page-hotspot-right").disabled = byId("next-page").disabled;

  renderToc(book);
  renderBookSearchResults();
  if (!syncPageAudioAnchors()) syncChapterAmbiance();
}

function toggleReaderSidebar() {
  const layout = byId("reader-layout");
  const button = byId("reader-sidebar-toggle");
  if (!layout || !button) return;

  state.readerPrefs.sidebarCollapsed = !state.readerPrefs.sidebarCollapsed;
  saveReaderPrefs();
  syncReaderSidebarState();
}

function syncReaderSidebarState() {
  const layout = byId("reader-layout");
  const button = byId("reader-sidebar-toggle");
  if (!layout || !button) return;

  const isCollapsed = Boolean(state.readerPrefs.sidebarCollapsed);
  layout.classList.toggle("is-sidebar-collapsed", isCollapsed);
  button.textContent = isCollapsed ? "Afficher le panneau" : "Masquer le panneau";
  button.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
}

function renderPage(container, page, index, book) {
  container.classList.toggle("illustration-page", Boolean(page?.illustration));

  if (!page) {
    container.innerHTML = "";
    return;
  }

  const bookmark = book.bookmarkPage === index ? '<span class="bookmark-ribbon" aria-label="Marque-page"></span>' : "";
  if (page.illustration) {
    container.innerHTML = `
      ${bookmark}
      <figure class="chapter-illustration-page">
        <img src="${escapeHtml(page.illustration)}" alt="${escapeHtml(`Illustration - ${page.chapterTitle || book.title}`)}" />
      </figure>
      <span class="page-number">${index + 1}</span>
    `;
    return;
  }

  const title = page.startsChapter ? `<h2>${escapeHtml(page.chapterTitle)}</h2>` : "";
  const paragraphs = page.paragraphs
    .map((paragraph) => {
      const className = isDialogueParagraph(paragraph) ? ' class="dialogue-line"' : "";
      return `<p${className}>${sanitizeRichHtml(paragraph)}</p>`;
    })
    .join("");

  container.innerHTML = `
    ${bookmark}
    <div class="page-kicker">${escapeHtml(page.chapterTitle || book.title)}</div>
    ${title}
    ${paragraphs}
    <span class="page-number">${index + 1}</span>
  `;
}

function isDialogueParagraph(paragraph) {
  const text = paragraphPlainText(paragraph).trim();
  return (
    /^[-–—]\s+\S/.test(text) ||
    /^["«"]\s*[-–—]?\s*\S/.test(text) ||
    /^[A-ZÉÈÀÂÎÔÛÇ][^.!?]{0,80}\s*:\s*[-–—]?\s*\S/.test(text)
  );
}

function renderToc(book) {
  const list = byId("toc-list");
  list.innerHTML = "";
  const currentChapterId = state.pages[state.currentPage]?.chapterId;
  const currentChapter = book.chapters.find((chapter) => chapter.id === currentChapterId);

  if (currentChapter) {
    const current = document.createElement("div");
    current.className = "toc-current";
    current.innerHTML = `Chapitre en cours <span>${escapeHtml(currentChapter.title)}</span>`;
    list.appendChild(current);
  }

  book.chapters.forEach((chapter) => {
    const pageIndex = findChapterStartPage(state.pages, chapter.id);
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <span class="toc-title">${escapeHtml(chapter.title)}</span>
      <span class="toc-meta">Page ${pageIndex + 1}</span>
    `;
    button.setAttribute("aria-label", `${chapter.title}, commence page ${pageIndex + 1}`);
    button.classList.toggle("is-active", state.pages[state.currentPage]?.chapterId === chapter.id);
    button.addEventListener("click", () => goToPage(pageIndex));
    list.appendChild(button);
  });
}

function findPageForParagraph(chapterId, paragraphText) {
  const pageIndex = state.pages.findIndex((page) =>
    page.chapterId === chapterId && page.paragraphs.some((paragraph) => paragraphPlainText(paragraph).includes(paragraphText.slice(0, 80)))
  );
  return Math.max(0, pageIndex);
}

function computeBookSearchResults(book, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!book || normalizedQuery.length < 2) return [];

  const results = [];
  state.pages.forEach((page, pageIndex) => {
    const chapter = book.chapters.find((item) => item.id === page.chapterId);
    const paragraphs = page.paragraphs?.length ? page.paragraphs : [page.chapterTitle || ""];

    for (const paragraph of paragraphs) {
      const plainParagraph = paragraphPlainText(paragraph);
      const lowerParagraph = plainParagraph.toLowerCase();
      const index = lowerParagraph.indexOf(normalizedQuery);
      if (index < 0) continue;

      results.push({
        chapter,
        paragraph: plainParagraph,
        excerpt: plainParagraph.slice(Math.max(0, index - 48), index + query.length + 76),
        pageIndex,
      });

      if (results.length >= 80) {
        return results;
      }
      break;
    }
  });

  return results;
}

function goToSearchResult(index) {
  if (!state.readerSearchResults.length) return;
  state.readerSearchIndex = (index + state.readerSearchResults.length) % state.readerSearchResults.length;
  const result = state.readerSearchResults[state.readerSearchIndex];
  goToPage(result.pageIndex);
  renderBookSearchResults();
}

function goToAdjacentSearchPage(step) {
  const results = state.readerSearchResults;
  if (!results.length) return;

  const startIndex = state.readerSearchIndex >= 0 ? state.readerSearchIndex : 0;
  const startPage = results[startIndex]?.pageIndex;

  for (let offset = 1; offset <= results.length; offset += 1) {
    const nextIndex = (startIndex + step * offset + results.length) % results.length;
    if (results[nextIndex].pageIndex !== startPage || offset === results.length) {
      goToSearchResult(nextIndex);
      return;
    }
  }
}

function highlightSearchMatch(text, query) {
  if (!query) return escapeHtml(text);

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;
  let html = "";

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index < 0) {
      html += escapeHtml(text.slice(cursor));
      break;
    }

    html += escapeHtml(text.slice(cursor, index));
    html += `<mark>${escapeHtml(text.slice(index, index + query.length))}</mark>`;
    cursor = index + query.length;
  }

  return html;
}

function renderBookSearchResults() {
  const book = getBook(state.activeBookId);
  const container = byId("book-search-results");
  const query = byId("book-search").value.trim();
  const previousQuery = state.readerSearchQuery;
  const previousIndex = state.readerSearchIndex;
  container.innerHTML = "";
  state.readerSearchResults = [];
  state.readerSearchIndex = -1;
  state.readerSearchQuery = query;

  if (!book || query.length < 2) return;

  const results = computeBookSearchResults(book, query);
  state.readerSearchResults = results;

  if (!results.length) {
    container.innerHTML = '<p class="import-warning">Aucun résultat.</p>';
    return;
  }

  const preservedIndex = previousQuery === query && previousIndex >= 0 && previousIndex < results.length ? previousIndex : -1;
  const currentPageResultIndex = results.findIndex((result) => result.pageIndex === state.currentPage);
  state.readerSearchIndex = preservedIndex >= 0 ? preservedIndex : currentPageResultIndex >= 0 ? currentPageResultIndex : 0;

  const controls = document.createElement("div");
  controls.className = "search-result-controls";
  controls.innerHTML = `
    <button type="button" data-search-step="-1" aria-label="Résultat précédent">Précédent</button>
    <button type="button" data-search-step="1" aria-label="Résultat suivant">Suivant</button>
  `;
  controls.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => goToAdjacentSearchPage(Number(button.dataset.searchStep)));
  });

  const count = document.createElement("p");
  count.className = "search-result-count";
  count.textContent = `${results.length} page${results.length > 1 ? "s" : ""} trouvée${results.length > 1 ? "s" : ""} - sélection ${state.readerSearchIndex + 1}`;
  container.appendChild(count);
  container.appendChild(controls);

  const visibleStart = Math.min(Math.max(0, state.readerSearchIndex - 5), Math.max(0, results.length - 12));
  results.slice(visibleStart, visibleStart + 12).forEach((result, offset) => {
    const index = visibleStart + offset;
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-active", index === state.readerSearchIndex);
    button.innerHTML = `
      <span class="search-result-title">${escapeHtml(result.chapter?.title || "Page")} - page ${result.pageIndex + 1}</span>
      <span class="search-result-excerpt">${highlightSearchMatch(result.excerpt, query)}</span>
    `;
    button.addEventListener("click", () => goToSearchResult(index));
    container.appendChild(button);
  });
}

function createArtbookPages(book) {
  return getArtbookItems(book)
    .flatMap((item, itemIndex) => {
      const title = artbookItemTitle(item, itemIndex);
      return [
        {
          type: "artbook-image",
          itemId: item.id,
          itemIndex,
          title,
          description: item.description || "",
          image: item.image,
        },
        {
          type: "artbook-description",
          itemId: item.id,
          itemIndex,
          title,
          description: item.description || "",
          image: item.image,
        },
      ];
    });
}

function descriptionParagraphsHtml(description) {
  const paragraphs = String(description || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return '<p class="artbook-muted">Aucune description pour cette planche.</p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function openArtbook(bookId, page = null) {
  const book = getBook(bookId);
  if (!book) return;

  state.activeBookId = bookId;
  localStorage.setItem(ACTIVE_BOOK_KEY, bookId);
  showView("artbook");
  state.artbookPages = createArtbookPages(book);
  state.currentArtbookPage = Math.min(Math.max(page ?? 0, 0), Math.max(0, state.artbookPages.length - 1));
  renderArtbook();
}

async function openArtbookWithBusy(bookId, page = null) {
  if (state.isBusy) return;
  await withAppBusy("Ouverture de l'artbook...", async () => openArtbook(bookId, page));
}

function renderArtbook() {
  const book = getBook(state.activeBookId);
  const empty = byId("artbook-empty");
  const layout = byId("artbook-layout");

  if (!book) {
    layout.hidden = true;
    empty.hidden = false;
    byId("artbook-view-title").textContent = "Aucun artbook sélectionné";
    return;
  }

  if (!state.artbookPages.length) {
    layout.hidden = true;
    empty.hidden = false;
    byId("artbook-view-title").textContent = "Artbook vide";
    return;
  }

  layout.hidden = false;
  empty.hidden = true;
  byId("artbook-view-title").textContent = `${book.title} - Artbook`;
  byId("artbook-book-title").textContent = book.title;
  const artbookItemCount = getArtbookItems(book).length;
  byId("artbook-book-meta").textContent = `${book.author || "Auteur inconnu"} - ${artbookItemCount} planche${artbookItemCount > 1 ? "s" : ""}`;
  byId("artbook-mini-cover").style.backgroundImage = coverBackground(book);
  applyReaderPrefs();

  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const leftIndex = isMobile ? state.currentArtbookPage : state.currentArtbookPage - (state.currentArtbookPage % 2);
  const rightIndex = isMobile ? null : leftIndex + 1;

  renderArtbookPage(byId("artbook-left-page"), state.artbookPages[leftIndex], leftIndex, book);
  renderArtbookPage(
    byId("artbook-right-page"),
    rightIndex === null ? state.artbookPages[state.currentArtbookPage] : state.artbookPages[rightIndex],
    rightIndex ?? state.currentArtbookPage,
    book
  );

  byId("artbook-left-page").dataset.pageIndex = leftIndex;
  byId("artbook-right-page").dataset.pageIndex = rightIndex ?? state.currentArtbookPage;

  byId("artbook-page-indicator").textContent = isMobile || rightIndex >= state.artbookPages.length
    ? `Page ${state.currentArtbookPage + 1} / ${state.artbookPages.length}`
    : `Pages ${leftIndex + 1}-${rightIndex + 1} / ${state.artbookPages.length}`;
  byId("artbook-progress-bar").value = state.artbookPages.length <= 1 ? 100 : Math.round((state.currentArtbookPage / (state.artbookPages.length - 1)) * 100);
  byId("prev-artbook-page").disabled = isMobile ? state.currentArtbookPage <= 0 : leftIndex <= 0;
  byId("next-artbook-page").disabled = isMobile ? state.currentArtbookPage >= state.artbookPages.length - 1 : leftIndex + 2 >= state.artbookPages.length;

  renderArtbookToc(book);
}

function renderArtbookPage(container, page, index, book) {
  container.classList.toggle("illustration-page", page?.type === "artbook-image");
  container.classList.toggle("artbook-image-page", page?.type === "artbook-image");
  container.classList.toggle("artbook-description-page", page?.type === "artbook-description");

  if (!page) {
    container.innerHTML = "";
    return;
  }

  const plateLabel = `Planche ${page.itemIndex + 1}`;
  if (page.type === "artbook-image") {
    container.innerHTML = `
      <figure class="artbook-plate">
        <img src="${escapeHtml(page.image)}" alt="${escapeHtml(`${plateLabel} - ${page.title || book.title}`)}" />
        <figcaption>${escapeHtml(plateLabel)}</figcaption>
      </figure>
      <span class="page-number">${index + 1}</span>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-kicker">Artbook - ${escapeHtml(plateLabel)}</div>
    <h2>${escapeHtml(page.title)}</h2>
    <div class="artbook-description-copy">
      ${descriptionParagraphsHtml(page.description)}
    </div>
    <span class="page-number">${index + 1}</span>
  `;
}

function renderArtbookToc(book) {
  const list = byId("artbook-toc-list");
  list.innerHTML = "";

  getArtbookItems(book).forEach((item, itemIndex) => {
    const pageIndex = itemIndex * 2;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${artbookItemTitle(item, itemIndex)} - p. ${pageIndex + 1}`;
    button.classList.toggle("is-active", state.artbookPages[state.currentArtbookPage]?.itemId === item.id);
    button.addEventListener("click", () => goToArtbookPage(pageIndex));
    list.appendChild(button);
  });
}

function goToArtbookPage(pageIndex) {
  const nextPage = Math.min(Math.max(pageIndex, 0), state.artbookPages.length - 1);
  if (nextPage === state.currentArtbookPage || state.isAnimating) return;

  const previousPage = state.currentArtbookPage;
  if (isSameVisibleSpread(previousPage, nextPage)) {
    state.currentArtbookPage = nextPage;
    renderArtbook();
    return;
  }

  playPageFlipSound();
  animateArtbookPageMove(previousPage, nextPage);
}

function animateArtbookPageMove(fromPage, toPage) {
  const distance = Math.abs(toPage - fromPage);
  state.isAnimating = true;

  if (distance > 4) {
    animateArtbookPageFlutter(fromPage, toPage, distance);
    return;
  }

  animateSingleArtbookPageTurn(fromPage, toPage);
}

function animateSingleArtbookPageTurn(fromPage, toPage) {
  const book = getBook(state.activeBookId);
  if (!book) {
    state.isAnimating = false;
    return;
  }

  const direction = toPage > fromPage ? "forward" : "backward";
  const oldSpread = getVisiblePageIndices(fromPage);
  const sourceIndex = direction === "forward" ? oldSpread.rightIndex : oldSpread.leftIndex;

  if (!state.artbookPages[sourceIndex]) {
    state.currentArtbookPage = toPage;
    renderArtbook();
    state.isAnimating = false;
    return;
  }

  const frontSide = direction === "forward" ? "right-page" : "left-page";
  const front = document.createElement("article");
  const sheet = document.createElement("div");
  sheet.className = `page-turn page-turn-${direction}`;
  front.className = `paper-page page-turn-face ${frontSide}`;
  renderArtbookPage(front, state.artbookPages[sourceIndex], sourceIndex, book);
  sheet.append(front);

  const reader = byId("artbook-reader");

  state.currentArtbookPage = toPage;
  renderArtbook();
  reader.appendChild(sheet);
  reader.classList.add("is-turning");

  window.requestAnimationFrame(() => sheet.classList.add("is-turning-page"));
  window.setTimeout(() => {
    sheet.remove();
    reader.classList.remove("is-turning");
    state.isAnimating = false;
  }, 540);
}

function animateArtbookPageFlutter(fromPage, toPage, distance) {
  const reader = byId("artbook-reader");
  const direction = toPage > fromPage ? "forward" : "backward";
  const sheetCount = Math.min(14, Math.max(6, Math.ceil(distance / 8)));

  state.currentArtbookPage = toPage;
  renderArtbook();
  reader.classList.add("is-fluttering", `flutter-${direction}`);

  for (let index = 0; index < sheetCount; index += 1) {
    const sheet = document.createElement("span");
    sheet.className = `flutter-sheet flutter-sheet-${direction}`;
    sheet.style.setProperty("--delay", `${index * 42}ms`);
    sheet.style.setProperty("--lift", `${index % 4}px`);
    reader.appendChild(sheet);
  }

  window.setTimeout(() => {
    reader.querySelectorAll(".flutter-sheet").forEach((sheet) => sheet.remove());
    reader.classList.remove("is-fluttering", "flutter-forward", "flutter-backward");
    state.isAnimating = false;
  }, sheetCount * 42 + 600);
}

function changeArtbookPageFromPaper(side) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const spread = getVisiblePageIndices(state.currentArtbookPage);

  if (side === "left") {
    goToArtbookPage(isMobile ? state.currentArtbookPage - 1 : spread.leftIndex - 2);
    return;
  }

  if (side === "right") {
    goToArtbookPage(isMobile ? state.currentArtbookPage + 1 : spread.leftIndex + 2);
  }
}

function changeArtbookPageFromPaperClick(event, fallbackSide) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;

  if (!isMobile) {
    changeArtbookPageFromPaper(fallbackSide);
    return;
  }

  const bounds = event.currentTarget.getBoundingClientRect();
  const side = event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
  changeArtbookPageFromPaper(side);
}

function changeArtbookPageByDirection(direction) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const spread = getVisiblePageIndices(state.currentArtbookPage);
  const offset = direction === "forward" ? 1 : -1;

  if (isMobile) {
    goToArtbookPage(state.currentArtbookPage + offset);
    return;
  }

  goToArtbookPage(direction === "forward" ? spread.leftIndex + 2 : spread.leftIndex - 2);
}

function changeArtbookPageFromWheel(event) {
  if (!state.activeBookId || !byId("artbook-view").classList.contains("is-active")) return;

  const reader = byId("artbook-reader");
  const bounds = reader.getBoundingClientRect();
  const isInsideReader =
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom;

  if (!isInsideReader) return;

  event.preventDefault();
  event.stopPropagation();

  if (state.isAnimating || Math.abs(event.deltaY) < 18) return;

  const now = Date.now();
  if (now - state.lastWheelTurnAt < 720) return;

  state.lastWheelTurnAt = now;

  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  if (isMobile) {
    changeArtbookPageByDirection(event.deltaY > 0 ? "forward" : "backward");
    return;
  }

  const side = event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
  changeArtbookPageFromPaper(side);
}

function handleArtbookTouchEnd(event) {
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - state.touchStartX;
  const deltaY = touch.clientY - state.touchStartY;

  if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
  changeArtbookPageByDirection(deltaX < 0 ? "forward" : "backward");
}

function updateReaderPreference(key, value) {
  state.readerPrefs[key] = value;
  saveReaderPrefs();
  if (key === "fontSize" || key === "lineHeight") {
    repaginateActiveBook();
    renderArtbook();
    return;
  }
  applyReaderPrefs();
}

function updateNightModeButton() {
  const button = byId("reader-night-toggle");
  if (!button) return;

  const isNight = state.readerPrefs.theme === "night";
  button.textContent = isNight ? "Jour" : "Nuit";
  button.setAttribute("aria-pressed", isNight ? "true" : "false");
  button.setAttribute("aria-label", isNight ? "Revenir au thème papier" : "Activer le mode nuit");
  button.dataset.tooltip = isNight ? "Mode jour" : "Mode nuit";
}

function toggleNightMode() {
  updateReaderPreference("theme", state.readerPrefs.theme === "night" ? "paper" : "night");
  const themeSelect = byId("reader-theme");
  if (themeSelect) themeSelect.value = state.readerPrefs.theme;
}

function updateFocusButtons() {
  const isFocus = document.body.classList.contains("reader-focus");
  ["reader-focus-toggle", "artbook-focus-toggle"].forEach((id) => {
    const button = byId(id);
    if (!button) return;
    button.textContent = isFocus ? "Quitter" : (id === "reader-focus-toggle" ? "Écran" : "Plein écran");
  });
}

function toggleReaderFocus() {
  document.body.classList.toggle("reader-focus");
  updateFocusButtons();
  window.setTimeout(() => {
    repaginateActiveBook();
    renderArtbook();
  }, 60);
}

function exitReaderFocus() {
  if (!document.body.classList.contains("reader-focus")) return;
  document.body.classList.remove("reader-focus");
  updateFocusButtons();
  window.setTimeout(() => {
    repaginateActiveBook();
    renderArtbook();
  }, 60);
}

function handleTouchStart(event) {
  const touch = event.changedTouches[0];
  state.touchStartX = touch.clientX;
  state.touchStartY = touch.clientY;
}

function handleTouchEnd(event) {
  if (isInfiniteScrollActive()) return;

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - state.touchStartX;
  const deltaY = touch.clientY - state.touchStartY;

  if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
  changePageByDirection(deltaX < 0 ? "forward" : "backward");
}

function playPageFlipSound() {
  if (!state.readerPrefs.soundEffects) return;

  if (!state.pageFlipAudio) {
    state.pageFlipAudio = new Audio(PAGE_FLIP_SOUND);
    state.pageFlipAudio.preload = "auto";
    state.pageFlipAudio.volume = 0.7;
  }

  try {
    state.pageFlipAudio.pause();
    state.pageFlipAudio.currentTime = 0;
  } catch {
  }

  const playPromise = state.pageFlipAudio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {});
  }
}

function updateSoundEffectsButton() {
  const button = byId("sound-effects-toggle");
  if (!button) return;

  const isMuted = !state.readerPrefs.soundEffects;
  button.textContent = isMuted ? "Sons coupés" : "Sons actifs";
  button.setAttribute("aria-pressed", isMuted ? "true" : "false");
  button.setAttribute("aria-label", isMuted ? "Réactiver tous les sons du site" : "Couper tous les sons du site");

  const audioButton = byId("ambiance-toggle");
  if (audioButton) {
    audioButton.setAttribute("aria-pressed", isMuted || state.isAmbianceEnabled ? "true" : "false");
    audioButton.dataset.tooltip = isMuted ? "Audio coupé" : "Réglages audio";
  }

  updateAmbiancePlayButton();
}

function toggleSoundEffects() {
  state.readerPrefs.soundEffects = !state.readerPrefs.soundEffects;
  saveReaderPrefs();

  if (!state.readerPrefs.soundEffects && state.pageFlipAudio) {
    state.pageFlipAudio.pause();
    state.pageFlipAudio.currentTime = 0;
  }

  if (!state.readerPrefs.soundEffects) {
    cancelAudioAnchorPlayback(false);
    updateSoundEffectsButton();
    updateAmbianceButton();
    stopAmbiance();
    return;
  }

  updateSoundEffectsButton();
  if (byId("reader-view")?.classList.contains("is-active")) {
    if (!syncPageAudioAnchors()) syncChapterAmbiance();
  }
}

function updateInfiniteScrollButton() {
  const button = byId("infinite-scroll-toggle");
  if (!button) return;

  const isAvailable = isInfiniteScrollAvailable();
  const isActive = isInfiniteScrollActive();
  button.hidden = !isAvailable;
  button.textContent = isActive ? "Mode pages" : "Scroll infini";
  button.setAttribute("aria-pressed", isActive ? "true" : "false");
  button.setAttribute("aria-label", isActive ? "Revenir au mode pages" : "Activer le scroll infini");
  button.dataset.tooltip = isActive ? "Mode pages" : "Scroll infini";
}

function toggleInfiniteScroll() {
  state.readerPrefs.infiniteScroll = !state.readerPrefs.infiniteScroll;
  saveReaderPrefs();
  renderReader();
}

function getAmbianceTrack(trackId = state.effectiveAmbianceTrackId || state.readerPrefs.ambianceTrack) {
  const tracks = getAllAmbianceTracks();
  return tracks.find((track) => track.id === trackId) || tracks[0] || DEFAULT_AMBIANCE_TRACKS[0];
}

function renderAmbianceTrackOptions() {
  const select = byId("ambiance-track");
  if (!select) return;

  const selectedTrack = getAmbianceTrack(state.readerPrefs.ambianceTrack);
  select.innerHTML = getAllAmbianceTracks()
    .map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.label)}</option>`)
    .join("");
  select.value = selectedTrack.id;
  renderAmbianceTrackList();
  renderChapterAmbianceOptions();
  renderAudioAnchorOptions();
}

function renderChapterAmbianceOptions() {
  const select = byId("chapter-ambiance-track");
  if (!select) return;

  const currentValue = getEditingChapter()?.ambianceTrackId || "";
  const options = [
    '<option value="">Aucune</option>',
    '<option value="__inherit">Garder l’ambiance précédente</option>',
    ...getAllAmbianceTracks().map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.label)}</option>`),
  ];
  select.innerHTML = options.join("");
  select.value = currentValue;
}

function renderAudioAnchorOptions() {
  const select = byId("chapter-audio-anchor-track");
  if (!select) return;

  const currentValue = select.value;
  const tracks = getAllAmbianceTracks();
  select.innerHTML = tracks
    .map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.label)}</option>`)
    .join("");
  select.value = tracks.some((track) => track.id === currentValue)
    ? currentValue
    : (tracks[0]?.id || "");
}

function renderAmbianceTrackList() {
  const list = byId("ambiance-track-list");
  if (!list) return;

  list.innerHTML = "";
  if (!state.ambianceTracks.length) {
    list.innerHTML = '<p class="import-warning">Aucun son ajouté.</p>';
    return;
  }

  state.ambianceTracks.forEach((track) => {
    const row = document.createElement("div");
    row.className = "ambiance-track-item";
    row.innerHTML = `
      <span>${escapeHtml(track.label)}</span>
      <button type="button" data-track-id="${escapeHtml(track.id)}">Retirer</button>
    `;
    row.querySelector("button").addEventListener("click", () => deleteAmbianceTrack(track.id));
    list.appendChild(row);
  });
}

function getAmbianceTrackLabel(trackId) {
  if (!trackId) return "";
  if (trackId === "__inherit") return "ambiance précédente";
  return getAmbianceTrack(trackId)?.label || "";
}

function readAmbianceTrackDraft() {
  return {
    label: byId("ambiance-track-label").value.trim(),
    url: byId("ambiance-track-url").value.trim(),
    file: byId("ambiance-track-file").files?.[0] || null,
  };
}

function clearAmbianceTrackDraft() {
  byId("ambiance-track-label").value = "";
  byId("ambiance-track-url").value = "";
  byId("ambiance-track-file").value = "";
}

function validateAmbianceTrackDraft(draft) {
  if (!draft.label) return "Ajoute un nom pour ce son.";
  if (!draft.file && !draft.url) return "Ajoute un fichier audio ou une URL.";
  if (draft.file && !draft.file.type.startsWith("audio/")) return "Choisis un fichier audio.";
  if (draft.url) {
    try {
      const url = new URL(draft.url, window.location.href);
      if (!["http:", "https:"].includes(url.protocol)) return "L'URL audio doit commencer par http:// ou https://.";
    } catch {
      return "L'URL audio n'est pas valide.";
    }
  }
  return "";
}

async function uploadAmbianceFile(file) {
  if (!state.db?.storage) return "";

  const extension = file.name.split(".").pop() || file.type.split("/")[1] || "audio";
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "audio";
  const path = `${Date.now()}-${crypto.randomUUID()}.${safeExtension}`;
  const { error } = await state.db.storage
    .from(AMBIANCE_BUCKET)
    .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: true });

  if (error) throw error;

  const { data } = state.db.storage.from(AMBIANCE_BUCKET).getPublicUrl(path);
  return data.publicUrl || "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addAmbianceTrack() {
  if (state.isBusy) return;
  const draft = readAmbianceTrackDraft();
  const validationError = validateAmbianceTrackDraft(draft);
  if (validationError) {
    alert(validationError);
    return;
  }

  await withAppBusy("Ajout du son d'ambiance…", async () => {
    let src = draft.url;
    if (draft.file) {
      if (state.storageMode === "supabase" && state.hasAmbianceTracksTable) {
        src = await uploadAmbianceFile(draft.file);
      } else {
        if (draft.file.size > 3_500_000) {
          alert("En local, choisis un fichier audio de moins de 3,5 Mo ou utilise une URL. Avec Supabase, le fichier peut aller jusqu'à 20 Mo.");
          return;
        }
        src = await fileToDataUrl(draft.file);
      }
    }

    const track = normalizeAmbianceTrack({ label: draft.label, src });
    if (state.storageMode === "supabase" && state.hasAmbianceTracksTable) {
      const { data, error } = await state.db
        .from("ambiance_tracks")
        .insert({
          label: track.label,
          src: track.src,
          position: state.ambianceTracks.length + 1,
        })
        .select()
        .single();

      if (error) throw error;
      state.ambianceTracks.push(normalizeAmbianceTrack({ id: data.id, label: data.label, src: data.src }));
    } else {
      state.ambianceTracks.push(track);
      saveLocalAmbianceTracks();
    }

    state.readerPrefs.ambianceTrack = state.ambianceTracks[state.ambianceTracks.length - 1].id;
    state.effectiveAmbianceTrackId = state.readerPrefs.ambianceTrack;
    saveReaderPrefs();
    clearAmbianceTrackDraft();
    renderAmbianceTrackOptions();
    updateAmbianceButton();
    showReaderToast("Son d'ambiance ajouté.");
  });
}

async function deleteAmbianceTrack(trackId) {
  const track = state.ambianceTracks.find((item) => item.id === trackId);
  if (!track || !confirm(`Retirer "${track.label}" des ambiances ?`)) return;

  if (state.isAmbianceEnabled && state.activeAmbianceTrackId === trackId) {
    stopAmbiance();
  }

  if (state.storageMode === "supabase" && state.hasAmbianceTracksTable) {
    const { error } = await state.db.from("ambiance_tracks").delete().eq("id", trackId);
    if (error) {
      console.error(error);
      alert("Impossible de retirer ce son dans Supabase.");
      return;
    }
  }

  state.ambianceTracks = state.ambianceTracks.filter((item) => item.id !== trackId);
  if (state.storageMode !== "supabase") saveLocalAmbianceTracks();
  if (state.readerPrefs.ambianceTrack === trackId) {
    state.readerPrefs.ambianceTrack = DEFAULT_AMBIANCE_TRACKS[0].id;
    state.effectiveAmbianceTrackId = state.readerPrefs.ambianceTrack;
    saveReaderPrefs();
  }
  resetAmbianceAudio();
  renderAmbianceTrackOptions();
  updateAmbianceButton();
}

function resetAmbianceAudio() {
  cancelAmbianceFade();

  if (state.ambianceAudio) {
    state.ambianceAudio.pause();
    state.ambianceAudio.volume = 0;
  }

  state.ambianceAudio = null;
  state.activeAmbianceTrackId = null;
}

function setEffectiveAmbianceTrack(trackId) {
  const track = getAmbianceTrack(trackId);
  state.effectiveAmbianceTrackId = track.id;
  return track;
}

function getAmbianceAudio() {
  const track = getAmbianceTrack();

  if (state.ambianceAudio && state.activeAmbianceTrackId === track.id) {
    return state.ambianceAudio;
  }

  resetAmbianceAudio();
  state.ambianceAudio = new Audio(track.src);
  state.ambianceAudio.loop = true;
  state.ambianceAudio.preload = "none";
  state.ambianceAudio.volume = 0;
  state.activeAmbianceTrackId = track.id;

  return state.ambianceAudio;
}

function updateAmbianceButton() {
  const button = byId("ambiance-toggle");
  if (!button) return;

  const panel = byId("ambiance-panel");
  const isPanelOpen = Boolean(panel && !panel.hidden);
  const isMuted = !state.readerPrefs.soundEffects;
  button.textContent = isMuted ? "Audio coupé" : "Audio";
  button.setAttribute("aria-pressed", isMuted || state.isAmbianceEnabled ? "true" : "false");
  button.setAttribute("aria-expanded", isPanelOpen ? "true" : "false");
  button.setAttribute("aria-label", isPanelOpen ? "Fermer les réglages audio" : "Ouvrir les réglages audio");
  button.dataset.tooltip = isMuted ? "Audio coupé" : "Réglages audio";
  updateAmbiancePlayButton();
}

function updateAmbiancePlayButton() {
  const button = byId("ambiance-play-toggle");
  if (!button) return;

  const track = getAmbianceTrack();
  const isMuted = !state.readerPrefs.soundEffects;
  button.disabled = isMuted;
  button.textContent = isMuted ? "Sons coupés" : (state.isAmbianceEnabled ? "Couper" : "Lancer");
  button.setAttribute("aria-pressed", state.isAmbianceEnabled ? "true" : "false");
  button.setAttribute("aria-label", isMuted ? "Réactive les sons du site pour lancer l'ambiance" : (state.isAmbianceEnabled ? `Couper l'ambiance ${track.label}` : `Lancer l'ambiance ${track.label}`));
}

function updateAutoAmbianceControl() {
  const control = byId("auto-ambiance-toggle");
  if (!control) return;
  control.checked = state.readerPrefs.autoAmbiance !== false;
}

function toggleAutoAmbiance(event) {
  state.readerPrefs.autoAmbiance = event.target.checked;
  saveReaderPrefs();
  updateAutoAmbianceControl();
  syncChapterAmbiance();
}

function getCurrentReaderChapter() {
  const book = getBook(state.activeBookId);
  const chapterId = state.pages[state.currentPage]?.chapterId;
  return book?.chapters.find((chapter) => chapter.id === chapterId) || null;
}

function resolveChapterAmbianceTrackId(chapter) {
  if (!chapter || !state.readerPrefs.autoAmbiance) return state.readerPrefs.ambianceTrack;
  if (chapter.ambianceTrackId === "__inherit") return state.effectiveAmbianceTrackId || state.readerPrefs.ambianceTrack;
  return chapter.ambianceTrackId || state.readerPrefs.ambianceTrack;
}

function syncChapterAmbiance() {
  if (!state.readerPrefs.soundEffects || !state.readerPrefs.autoAmbiance) return;
  const trackId = resolveChapterAmbianceTrackId(getCurrentReaderChapter());
  if (!trackId || trackId === (state.effectiveAmbianceTrackId || state.readerPrefs.ambianceTrack)) return;
  updateAmbianceTrack(trackId, { auto: true });
}

function toggleAmbiancePanel() {
  const panel = byId("ambiance-panel");
  if (!panel) return;

  panel.hidden = !panel.hidden;
  updateAmbianceButton();
}

function cancelAmbianceFade() {
  if (!state.ambianceFadeFrame) return;

  window.cancelAnimationFrame(state.ambianceFadeFrame);
  state.ambianceFadeFrame = 0;
}

function fadeAmbianceVolume(targetVolume, onComplete = null, audio = state.ambianceAudio || getAmbianceAudio()) {
  const startVolume = audio.volume;
  const startTime = performance.now();

  cancelAmbianceFade();

  if (Math.abs(startVolume - targetVolume) < 0.001) {
    audio.volume = targetVolume;
    onComplete?.();
    return;
  }

  const step = (now) => {
    const progress = Math.max(0, Math.min((now - startTime) / AMBIANCE_FADE_MS, 1));
    const easedProgress = 1 - Math.pow(1 - progress, 3);

    audio.volume = startVolume + (targetVolume - startVolume) * easedProgress;

    if (progress < 1) {
      state.ambianceFadeFrame = window.requestAnimationFrame(step);
      return;
    }

    state.ambianceFadeFrame = 0;
    audio.volume = targetVolume;
    onComplete?.();
  };

  state.ambianceFadeFrame = window.requestAnimationFrame(step);
}

function getPageAudioAnchors(page) {
  if (!page?.paragraphs?.length) return [];

  const template = document.createElement("template");
  template.innerHTML = page.paragraphs.join("");
  return Array.from(template.content.querySelectorAll("[data-audio-anchor]"))
    .map((anchor) => ({
      trackId: String(anchor.dataset.audioAnchor || "").trim(),
      anchorId: String(anchor.dataset.audioAnchorId || "").trim(),
    }))
    .filter((anchor) => anchor.trackId);
}

function getVisibleAudioAnchorPages() {
  if (isInfiniteScrollActive()) return [state.currentPage];

  const spread = getVisiblePageIndices(state.currentPage);
  return [spread.leftIndex, spread.rightIndex]
    .filter((pageIndex, index, pages) => pageIndex >= 0 && pageIndex < state.pages.length && pages.indexOf(pageIndex) === index);
}

function syncPageAudioAnchors() {
  if (!state.readerPrefs.soundEffects) return false;

  const book = getBook(state.activeBookId);
  if (!book) return false;

  let queuedAnAnchor = false;
  getVisibleAudioAnchorPages().forEach((pageIndex) => {
    getPageAudioAnchors(state.pages[pageIndex]).forEach(({ trackId, anchorId }, anchorIndex) => {
      const key = anchorId
        ? `${book.id}:${anchorId}`
        : `${book.id}:${pageIndex}:${anchorIndex}:${trackId}`;
      if (state.playedAudioAnchors.has(key)) return;

      const track = getAllAmbianceTracks().find((item) => item.id === trackId);
      state.playedAudioAnchors.add(key);
      if (!track) return;

      state.audioAnchorQueue.push({ key, pageIndex, track });
      queuedAnAnchor = true;
    });
  });

  if (queuedAnAnchor) playNextAudioAnchor();
  return queuedAnAnchor || Boolean(state.audioAnchorAudio) || state.audioAnchorQueue.length > 0;
}

function cancelAudioAnchorFade() {
  if (!state.audioAnchorFadeFrame) return;
  window.cancelAnimationFrame(state.audioAnchorFadeFrame);
  state.audioAnchorFadeFrame = 0;
}

function fadeAudioAnchorVolume(audio, targetVolume, duration, onComplete = null) {
  const startVolume = audio.volume;
  const startTime = performance.now();
  const safeDuration = Math.max(1, duration);
  cancelAudioAnchorFade();

  const step = (now) => {
    if (state.audioAnchorAudio !== audio) return;
    const progress = Math.max(0, Math.min((now - startTime) / safeDuration, 1));
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    audio.volume = startVolume + (targetVolume - startVolume) * easedProgress;

    if (progress < 1) {
      state.audioAnchorFadeFrame = window.requestAnimationFrame(step);
      return;
    }

    state.audioAnchorFadeFrame = 0;
    audio.volume = targetVolume;
    onComplete?.();
  };

  state.audioAnchorFadeFrame = window.requestAnimationFrame(step);
}

function resumeSuspendedAmbiance() {
  const suspended = state.suspendedAmbiance;
  state.suspendedAmbiance = null;

  if (
    suspended?.audio &&
    suspended.shouldResume &&
    state.isAmbianceEnabled &&
    state.readerPrefs.soundEffects &&
    state.ambianceAudio === suspended.audio
  ) {
    const playPromise = suspended.audio.play();
    const fadeIn = () => fadeAmbianceVolume(suspended.targetVolume, null, suspended.audio);
    if (playPromise?.then) {
      playPromise.then(fadeIn).catch(() => stopAmbiance());
    } else {
      fadeIn();
    }
    state.resumeAmbianceAfterAnchor = false;
    return;
  }

  if (state.resumeAmbianceAfterAnchor && state.isAmbianceEnabled && state.readerPrefs.soundEffects) {
    state.resumeAmbianceAfterAnchor = false;
    startAmbiance();
    return;
  }

  state.resumeAmbianceAfterAnchor = false;
}

function finishAudioAnchor(audio) {
  if (state.audioAnchorAudio !== audio) return;

  cancelAudioAnchorFade();
  audio.pause();
  audio.volume = 0;
  audio.onended = null;
  audio.onerror = null;
  audio.ontimeupdate = null;
  state.audioAnchorAudio = null;
  state.audioAnchorFadeOutStarted = false;

  if (state.audioAnchorQueue.length) {
    playNextAudioAnchor();
    return;
  }

  resumeSuspendedAmbiance();
}

function beginAudioAnchor(item) {
  const audio = new Audio(item.track.src);
  audio.loop = false;
  audio.preload = "auto";
  audio.volume = 0;
  state.audioAnchorAudio = audio;
  state.audioAnchorFadeOutStarted = false;

  audio.onended = () => finishAudioAnchor(audio);
  audio.onerror = () => finishAudioAnchor(audio);
  audio.ontimeupdate = () => {
    if (state.audioAnchorFadeOutStarted || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const fadeWindowMs = Math.min(AUDIO_ANCHOR_FADE_OUT_MS, audio.duration * 300);
    const remainingMs = Math.max(0, (audio.duration - audio.currentTime) * 1000);
    if (remainingMs > fadeWindowMs) return;

    state.audioAnchorFadeOutStarted = true;
    fadeAudioAnchorVolume(audio, 0, Math.max(120, remainingMs), () => finishAudioAnchor(audio));
  };

  const playPromise = audio.play();
  const fadeIn = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration * 250 : AUDIO_ANCHOR_FADE_IN_MS;
    fadeAudioAnchorVolume(audio, AUDIO_ANCHOR_VOLUME, Math.min(AUDIO_ANCHOR_FADE_IN_MS, duration));
    showReaderToast(`Son : ${item.track.label}`);
  };

  if (playPromise?.then) {
    playPromise.then(fadeIn).catch(() => finishAudioAnchor(audio));
  } else {
    fadeIn();
  }
}

function playNextAudioAnchor() {
  if (state.audioAnchorAudio) return;

  const next = state.audioAnchorQueue.shift();
  if (!next) {
    resumeSuspendedAmbiance();
    return;
  }

  if (state.suspendedAmbiance) {
    beginAudioAnchor(next);
    return;
  }

  const ambianceAudio = state.ambianceAudio;
  const shouldResumeAmbiance = Boolean(state.isAmbianceEnabled && ambianceAudio && !ambianceAudio.paused);
  if (!shouldResumeAmbiance) {
    beginAudioAnchor(next);
    return;
  }

  const ambianceTrack = getAmbianceTrack(state.activeAmbianceTrackId);
  state.suspendedAmbiance = {
    audio: ambianceAudio,
    shouldResume: true,
    targetVolume: ambianceTrack.volume ?? AMBIANCE_VOLUME,
  };
  cancelAmbianceFade();
  fadeAmbianceVolume(0, () => {
    ambianceAudio.pause();
    beginAudioAnchor(next);
  }, ambianceAudio);
}

function cancelAudioAnchorPlayback(resumeAmbiance = false) {
  const audio = state.audioAnchorAudio;
  cancelAudioAnchorFade();
  state.audioAnchorQueue = [];
  state.audioAnchorAudio = null;
  state.audioAnchorFadeOutStarted = false;
  if (audio) {
    audio.pause();
    audio.volume = 0;
  }

  if (resumeAmbiance) {
    resumeSuspendedAmbiance();
    return;
  }

  state.suspendedAmbiance = null;
  state.resumeAmbianceAfterAnchor = false;
}

function startAmbiance() {
  if (!state.readerPrefs.soundEffects) {
    updateSoundEffectsButton();
    updateAmbianceButton();
    return;
  }

  if (state.audioAnchorAudio || state.audioAnchorQueue.length) {
    state.isAmbianceEnabled = true;
    state.resumeAmbianceAfterAnchor = true;
    updateAmbianceButton();
    updateAmbiancePlayButton();
    return;
  }

  const track = getAmbianceTrack();
  const audio = getAmbianceAudio();
  state.isAmbianceEnabled = true;
  updateAmbianceButton();
  updateAmbiancePlayButton();

  if (audio.paused) {
    audio.volume = 0;
  }

  const playPromise = audio.play();
  const fadeIn = () => {
    if (!state.isAmbianceEnabled) {
      resetAmbianceAudio();
      return;
    }

    fadeAmbianceVolume(track.volume ?? AMBIANCE_VOLUME, null, audio);
  };

  if (playPromise?.then) {
    playPromise.then(fadeIn).catch(() => {
      state.isAmbianceEnabled = false;
      resetAmbianceAudio();
      updateAmbianceButton();
      updateAmbiancePlayButton();
    });
    return;
  }

  fadeIn();
}

function stopAmbiance(onComplete = null) {
  const audio = state.ambianceAudio;
  state.resumeAmbianceAfterAnchor = false;
  if (!state.isAmbianceEnabled && (!audio || audio.paused)) {
    onComplete?.();
    return;
  }

  state.isAmbianceEnabled = false;
  updateAmbianceButton();
  updateAmbiancePlayButton();

  if (!audio) {
    onComplete?.();
    return;
  }

  fadeAmbianceVolume(0, () => {
    audio.pause();
    audio.volume = 0;
    if (state.ambianceAudio === audio) {
      state.ambianceAudio = null;
      state.activeAmbianceTrackId = null;
    }
    onComplete?.();
  }, audio);
}

function updateAmbianceTrack(trackId, options = {}) {
  const previousTrack = getAmbianceTrack();
  const nextTrack = setEffectiveAmbianceTrack(trackId);
  if (!options.auto) {
    state.readerPrefs.ambianceTrack = nextTrack.id;
    saveReaderPrefs();
  }
  renderAmbianceTrackOptions();
  updateAmbianceButton();
  updateAmbiancePlayButton();

  if (nextTrack.id === previousTrack.id) return;

  if (state.audioAnchorAudio || state.audioAnchorQueue.length) {
    state.suspendedAmbiance = null;
    state.resumeAmbianceAfterAnchor = state.isAmbianceEnabled;
    resetAmbianceAudio();
    return;
  }

  if (state.isAmbianceEnabled && state.readerPrefs.soundEffects) {
    stopAmbiance(() => startAmbiance());
    return;
  }

  resetAmbianceAudio();
}

function toggleAmbiance() {
  if (state.isAmbianceEnabled) {
    stopAmbiance();
    return;
  }

  startAmbiance();
}

function goToPage(pageIndex) {
  const nextPage = Math.min(Math.max(pageIndex, 0), state.pages.length - 1);

  if (isInfiniteScrollActive()) {
    state.currentPage = nextPage;
    const book = getBook(state.activeBookId);
    if (book) {
      setReadingProgress(book.id, state.currentPage);
      updateReaderProgressUI(book);
      renderToc(book);
      renderBookSearchResults();
      if (!syncPageAudioAnchors()) syncChapterAmbiance();
    }
    scrollToContinuousPage(nextPage);
    return;
  }

  if (nextPage === state.currentPage || state.isAnimating) return;

  const previousPage = state.currentPage;
  if (isSameVisibleSpread(previousPage, nextPage)) {
    state.currentPage = nextPage;
    renderReader();
    return;
  }

  playPageFlipSound();
  animatePageMove(previousPage, nextPage);
}

function isSameVisibleSpread(fromPage, toPage) {
  const fromSpread = getVisiblePageIndices(fromPage);
  const toSpread = getVisiblePageIndices(toPage);
  return !fromSpread.isMobile && fromSpread.leftIndex === toSpread.leftIndex;
}

function animatePageMove(fromPage, toPage) {
  const distance = Math.abs(toPage - fromPage);
  state.isAnimating = true;

  if (distance > 4) {
    animatePageFlutter(fromPage, toPage, distance);
    return;
  }

  animateSinglePageTurn(fromPage, toPage);
}

function getVisiblePageIndices(pageIndex) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  if (isMobile) {
    return { leftIndex: pageIndex, rightIndex: pageIndex, isMobile };
  }

  const leftIndex = pageIndex - (pageIndex % 2);
  return { leftIndex, rightIndex: leftIndex + 1, isMobile };
}

function animateSinglePageTurn(fromPage, toPage) {
  const book = getBook(state.activeBookId);
  if (!book) {
    state.isAnimating = false;
    return;
  }

  const direction = toPage > fromPage ? "forward" : "backward";
  const oldSpread = getVisiblePageIndices(fromPage);
  const sourceIndex = direction === "forward" ? oldSpread.rightIndex : oldSpread.leftIndex;

  if (!state.pages[sourceIndex]) {
    state.currentPage = toPage;
    renderReader();
    state.isAnimating = false;
    return;
  }

  const frontSide = direction === "forward" ? "right-page" : "left-page";
  const front = document.createElement("article");
  const sheet = document.createElement("div");
  sheet.className = `page-turn page-turn-${direction}`;
  front.className = `paper-page page-turn-face ${frontSide}`;
  renderPage(front, state.pages[sourceIndex], sourceIndex, book);
  sheet.append(front);

  const reader = byId("book-reader");

  state.currentPage = toPage;
  renderReader();
  reader.appendChild(sheet);
  reader.classList.add("is-turning");

  window.requestAnimationFrame(() => sheet.classList.add("is-turning-page"));
  window.setTimeout(() => {
    sheet.remove();
    reader.classList.remove("is-turning");
    state.isAnimating = false;
  }, 660);
}

function animatePageFlutter(fromPage, toPage, distance) {
  const reader = byId("book-reader");
  const direction = toPage > fromPage ? "forward" : "backward";
  const sheetCount = Math.min(14, Math.max(6, Math.ceil(distance / 8)));

  state.currentPage = toPage;
  renderReader();
  reader.classList.add("is-fluttering", `flutter-${direction}`);

  for (let index = 0; index < sheetCount; index += 1) {
    const sheet = document.createElement("span");
    sheet.className = `flutter-sheet flutter-sheet-${direction}`;
    sheet.style.setProperty("--delay", `${index * 42}ms`);
    sheet.style.setProperty("--lift", `${index % 4}px`);
    reader.appendChild(sheet);
  }

  window.setTimeout(() => {
    reader.querySelectorAll(".flutter-sheet").forEach((sheet) => sheet.remove());
    reader.classList.remove("is-fluttering", "flutter-forward", "flutter-backward");
    state.isAnimating = false;
  }, sheetCount * 42 + 720);
}

function changePageFromPaper(side) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const spread = getVisiblePageIndices(state.currentPage);

  if (side === "left") {
    goToPage(isMobile ? state.currentPage - 1 : spread.leftIndex - 2);
    return;
  }

  if (side === "right") {
    goToPage(isMobile ? state.currentPage + 1 : spread.leftIndex + 2);
  }
}

function changePageFromPaperClick(event, fallbackSide) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;

  if (!isMobile) {
    changePageFromPaper(fallbackSide);
    return;
  }

  const bounds = event.currentTarget.getBoundingClientRect();
  const side = event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
  changePageFromPaper(side);
}

function changePageByDirection(direction) {
  if (isInfiniteScrollActive()) {
    goToPage(state.currentPage + (direction === "forward" ? 1 : -1));
    return;
  }

  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const spread = getVisiblePageIndices(state.currentPage);
  const offset = direction === "forward" ? 1 : -1;

  if (isMobile) {
    goToPage(state.currentPage + offset);
    return;
  }

  goToPage(direction === "forward" ? spread.leftIndex + 2 : spread.leftIndex - 2);
}

function changePageFromWheel(event) {
  if (!state.activeBookId || !byId("reader-view").classList.contains("is-active")) return;
  if (isInfiniteScrollActive()) return;

  const reader = byId("book-reader");
  const bounds = reader.getBoundingClientRect();
  const isInsideReader =
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom;

  if (!isInsideReader) return;

  event.preventDefault();
  event.stopPropagation();

  if (state.isAnimating || Math.abs(event.deltaY) < 18) return;

  const now = Date.now();
  if (now - state.lastWheelTurnAt < 720) return;

  state.lastWheelTurnAt = now;

  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  if (isMobile) {
    changePageByDirection(event.deltaY > 0 ? "forward" : "backward");
    return;
  }

  const side = event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
  changePageFromPaper(side);
}

async function setBookmark() {
  if (state.isBusy) return;

  const book = getBook(state.activeBookId);
  if (!book) return;
  const pageToBookmark = state.currentPage;
  state.suppressContinuousProgressUntil = Date.now() + 1200;

  await withAppBusy("Enregistrement du marque-page…", async () => {
  book.bookmarkPage = pageToBookmark;
  book.updatedAt = new Date().toISOString();

  if (state.storageMode === "supabase") {
    const { error } = await state.db
      .from("books")
      .update({ bookmark_page: pageToBookmark })
      .eq("id", book.id);

    if (error) {
      console.error(error);
      alert("Impossible d'enregistrer le marque-page dans la base de données.");
      return;
    }
  } else {
    saveBooks();
  }

  state.currentPage = pageToBookmark;
  if (isInfiniteScrollActive()) {
    state.suppressContinuousProgressUntil = Date.now() + 1200;
    byId("book-reader").querySelectorAll(".continuous-page").forEach((pageNode) => {
      const pageIndex = Number(pageNode.dataset.pageIndex);
      if (pageIndex === pageToBookmark) {
        renderPage(pageNode, state.pages[pageIndex], pageIndex, book);
        return;
      }
      pageNode.querySelector(".bookmark-ribbon")?.remove();
    });
    updateReaderProgressUI(book);
  } else {
    renderReader();
  }
  renderBookGrid();
  showReaderToast(`Page ${pageToBookmark + 1} marquée`);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    if (!state.isBusy) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("submit", (event) => {
    if (!state.isBusy) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      exitReaderFocus();
      const target = button.dataset.viewTarget;
      if (target === "reader" && !state.activeBookId) {
        showView("library");
        return;
      }
      if (target === "artbook" && (!state.activeBookId || !hasArtbook(getBook(state.activeBookId)))) {
        showView("library");
        return;
      }
      if (target === "reader" && !state.pages.length) {
        openReaderWithBusy(state.activeBookId);
        return;
      }
      if (target === "artbook") {
        openArtbookWithBusy(state.activeBookId);
        return;
      }
      showView(target);
    });
  });

  byId("search-input").addEventListener("input", renderBookGrid);
  byId("sort-select").addEventListener("change", renderBookGrid);
  byId("export-library").addEventListener("click", exportLibraryBackup);
  byId("import-library-file").addEventListener("change", importLibraryBackup);
  byId("book-form").addEventListener("submit", saveForm);
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => switchEditorTab(button.dataset.editorTab));
  });
  ["book-title", "book-author", "book-summary", "book-cover", "font-size", "page-density"].forEach((id) => {
    byId(id).addEventListener("input", () => markEditorDirty());
    byId(id).addEventListener("change", () => markEditorDirty());
  });
  byId("chapter-source").addEventListener("input", () => {
    chapterSourceRichHtml = "";
    updateImportPreview();
  });
  byId("chapter-source").addEventListener("paste", handleChapterSourcePaste);
  byId("add-empty-chapter").addEventListener("click", addEmptyChapter);
  byId("chapter-title").addEventListener("input", updateCurrentChapterDraft);
  byId("chapter-content").addEventListener("input", updateCurrentChapterDraft);
  byId("chapter-content").addEventListener("paste", handleRichEditorPaste);
  byId("chapter-content").addEventListener("keyup", rememberChapterEditorSelection);
  byId("chapter-content").addEventListener("mouseup", rememberChapterEditorSelection);
  document.addEventListener("selectionchange", rememberChapterEditorSelection);
  byId("insert-audio-anchor").addEventListener("click", insertAudioAnchor);
  byId("chapter-illustration-file").addEventListener("change", handleChapterIllustrationFileChange);
  byId("remove-chapter-illustration").addEventListener("click", removeChapterIllustration);
  byId("save-chapter").addEventListener("click", saveCurrentChapter);
  byId("delete-chapter").addEventListener("click", deleteCurrentChapter);
  byId("move-chapter-up").addEventListener("click", () => moveCurrentChapter(-1));
  byId("move-chapter-down").addEventListener("click", () => moveCurrentChapter(1));
  byId("add-artbook-item").addEventListener("click", addEmptyArtbookItem);
  byId("artbook-title").addEventListener("input", updateCurrentArtbookDraft);
  byId("artbook-description").addEventListener("input", updateCurrentArtbookDraft);
  byId("artbook-image-url").addEventListener("input", updateCurrentArtbookDraft);
  byId("artbook-image-file").addEventListener("change", handleArtbookImageFileChange);
  byId("remove-artbook-image").addEventListener("click", removeArtbookImage);
  byId("save-artbook-item").addEventListener("click", saveCurrentArtbookItem);
  byId("delete-artbook-item").addEventListener("click", deleteCurrentArtbookItem);
  byId("move-artbook-item-up").addEventListener("click", () => moveCurrentArtbookItem(-1));
  byId("move-artbook-item-down").addEventListener("click", () => moveCurrentArtbookItem(1));
  byId("append-import").addEventListener("click", () => importChaptersFromSource("append"));
  byId("replace-import").addEventListener("click", () => importChaptersFromSource("replace"));
  byId("font-size").addEventListener("input", updateImportPreview);
  byId("page-density").addEventListener("change", updateImportPreview);
  byId("book-cover").addEventListener("input", (event) => {
    coverUpload.dataUrl = "";
    setCoverPreview(event.target.value.trim());
  });
  byId("book-cover-file").addEventListener("change", handleCoverFileChange);
  byId("reset-editor").addEventListener("click", () => fillForm(null));
  byId("delete-book").addEventListener("click", deleteCurrentBook);
  byId("prev-page").addEventListener("click", () => changePageByDirection("backward"));
  byId("next-page").addEventListener("click", () => changePageByDirection("forward"));
  byId("page-hotspot-left").addEventListener("click", () => changePageByDirection("backward"));
  byId("page-hotspot-right").addEventListener("click", () => changePageByDirection("forward"));
  byId("scroll-top-button").addEventListener("click", () => {
    if (isInfiniteScrollActive()) {
      goToPage(0);
      return;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  byId("left-page").addEventListener("click", (event) => changePageFromPaperClick(event, "left"));
  byId("right-page").addEventListener("click", (event) => changePageFromPaperClick(event, "right"));
  byId("book-reader").addEventListener("wheel", changePageFromWheel, { passive: false });
  byId("book-reader").addEventListener("touchstart", handleTouchStart, { passive: true });
  byId("book-reader").addEventListener("touchend", handleTouchEnd, { passive: true });
  byId("reader-sidebar-toggle").addEventListener("click", toggleReaderSidebar);
  byId("bookmark-button").addEventListener("click", setBookmark);
  byId("floating-bookmark-button").addEventListener("click", setBookmark);
  byId("resume-button").addEventListener("click", () => {
    const book = getBook(state.activeBookId);
    if (book) goToPage(getResumePage(book));
  });
  byId("ambiance-toggle").addEventListener("click", toggleAmbiancePanel);
  byId("ambiance-play-toggle").addEventListener("click", toggleAmbiance);
  byId("sound-effects-toggle").addEventListener("click", toggleSoundEffects);
  byId("auto-ambiance-toggle").addEventListener("change", toggleAutoAmbiance);
  byId("add-ambiance-track").addEventListener("click", addAmbianceTrack);
  byId("infinite-scroll-toggle").addEventListener("click", toggleInfiniteScroll);
  byId("reader-settings-toggle").addEventListener("click", () => {
    byId("reader-settings").hidden = !byId("reader-settings").hidden;
  });
  byId("reader-night-toggle").addEventListener("click", toggleNightMode);
  byId("reader-focus-toggle").addEventListener("click", toggleReaderFocus);
  byId("focus-exit").addEventListener("click", exitReaderFocus);
  byId("artbook-empty-edit").addEventListener("click", () => {
    const book = getBook(state.activeBookId);
    if (book) {
      editBook(book.id);
      switchEditorTab("artbook");
      return;
    }
    showView("editor");
    switchEditorTab("artbook");
  });
  byId("artbook-open-reader").addEventListener("click", () => {
    if (state.activeBookId) openReaderWithBusy(state.activeBookId);
  });
  byId("artbook-edit-book").addEventListener("click", () => {
    if (state.activeBookId) editBook(state.activeBookId);
  });
  byId("artbook-focus-toggle").addEventListener("click", toggleReaderFocus);
  byId("artbook-focus-exit").addEventListener("click", exitReaderFocus);
  byId("prev-artbook-page").addEventListener("click", () => changeArtbookPageByDirection("backward"));
  byId("next-artbook-page").addEventListener("click", () => changeArtbookPageByDirection("forward"));
  byId("artbook-left-page").addEventListener("click", (event) => changeArtbookPageFromPaperClick(event, "left"));
  byId("artbook-right-page").addEventListener("click", (event) => changeArtbookPageFromPaperClick(event, "right"));
  byId("artbook-reader").addEventListener("wheel", changeArtbookPageFromWheel, { passive: false });
  byId("artbook-reader").addEventListener("touchstart", handleTouchStart, { passive: true });
  byId("artbook-reader").addEventListener("touchend", handleArtbookTouchEnd, { passive: true });
  byId("reader-font-size").addEventListener("input", (event) => updateReaderPreference("fontSize", Number(event.target.value)));
  byId("reader-line-height").addEventListener("input", (event) => updateReaderPreference("lineHeight", Number(event.target.value) / 100));
  byId("reader-page-width").addEventListener("input", (event) => updateReaderPreference("pageWidth", Number(event.target.value)));
  byId("reader-theme").addEventListener("change", (event) => updateReaderPreference("theme", event.target.value));
  byId("ambiance-track").addEventListener("change", (event) => updateAmbianceTrack(event.target.value));
  byId("chapter-ambiance-track").addEventListener("change", updateCurrentChapterDraft);
  byId("book-search").addEventListener("input", renderBookSearchResults);
  byId("page-jump").addEventListener("change", (event) => {
    goToPage(Number(event.target.value) - 1);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && byId("editor-view").classList.contains("is-active")) {
      event.preventDefault();
      byId("book-form").requestSubmit();
      return;
    }
    if (event.key === "/" && byId("reader-view").classList.contains("is-active") && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      byId("book-search").focus();
      return;
    }
    if (event.key === "Escape") {
      exitReaderFocus();
      return;
    }
    if (!state.activeBookId) return;
    if (byId("artbook-view").classList.contains("is-active")) {
      if (event.key === "ArrowRight") changeArtbookPageByDirection("forward");
      if (event.key === "ArrowLeft") changeArtbookPageByDirection("backward");
      return;
    }
    if (!byId("reader-view").classList.contains("is-active")) return;
    if (event.key === "ArrowRight") changePageByDirection("forward");
    if (event.key === "ArrowLeft") changePageByDirection("backward");
  });

  window.addEventListener("resize", () => {
    if (state.activeBookId) repaginateActiveBook();
    if (state.activeBookId && byId("artbook-view").classList.contains("is-active")) renderArtbook();
    updateInfiniteScrollButton();
  });

  window.addEventListener("scroll", updateContinuousReadingProgress, { passive: true });

  window.addEventListener("beforeunload", (event) => {
    if (!state.editorDirty) return;
    saveEditorDraftNow();
    event.preventDefault();
    event.returnValue = "";
  });
}

function init() {
  loadReaderPrefs();
  loadBooksFromLocalStorage({ createSeed: !hasSupabaseConfig() });
  loadLocalAmbianceTracks();
  state.activeBookId = localStorage.getItem(ACTIVE_BOOK_KEY) || state.books[0]?.id || null;
  fillForm(null);
  bindEvents();
  syncReaderPrefsControls();
  updateFocusButtons();
  renderBookGrid();
  showView("library");
  offerEditorDraftRestore();

  void initializeRemoteLibrary();
}

init();
