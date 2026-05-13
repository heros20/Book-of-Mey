const STORAGE_KEY = "book-of-mey-library";
const ACTIVE_BOOK_KEY = "book-of-mey-active-book";
const READING_PROGRESS_KEY = "book-of-mey-reading-progress";
const READER_PREFS_KEY = "book-of-mey-reader-prefs";
const COVER_BUCKET = "covers";
const PAGE_FLIP_SOUND = "asset/sound/page-flip.mp3";
const AMBIANCE_VOLUME = 0.35;
const AMBIANCE_FADE_MS = 1400;
const DB_CONFIG = window.BOOK_OF_MEY_SUPABASE || {};

// Ajoute ici une entrée par fichier d’ambiance placé dans asset/sound/.
const AMBIANCE_TRACKS = [
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
    theme: "paper",
    soundEffects: true,
    ambianceTrack: "ambiance",
  },
  touchStartX: 0,
  touchStartY: 0,
  pages: [],
  artbookPages: [],
  isAnimating: false,
  isBusy: false,
  busyDepth: 0,
  lastWheelTurnAt: 0,
  pageFlipAudio: null,
  ambianceAudio: null,
  ambianceFadeFrame: 0,
  activeAmbianceTrackId: null,
  isAmbianceEnabled: false,
  storageMode: "local",
  hasArtbookTable: true,
  db: null,
};

let chapterSourceRichHtml = "";
let editorMaintenanceTimer = 0;
let chapterSaveFeedbackTimer = 0;

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

function loadReaderPrefs() {
  state.readerPrefs = {
    ...state.readerPrefs,
    ...readJsonStorage(READER_PREFS_KEY, {}),
  };
  state.readerPrefs.ambianceTrack = getAmbianceTrack(state.readerPrefs.ambianceTrack).id;
}

function saveReaderPrefs() {
  localStorage.setItem(READER_PREFS_KEY, JSON.stringify(state.readerPrefs));
}

function syncReaderPrefsControls() {
  byId("reader-font-size").value = state.readerPrefs.fontSize;
  byId("reader-line-height").value = Math.round(state.readerPrefs.lineHeight * 100);
  byId("reader-theme").value = state.readerPrefs.theme;
  renderAmbianceTrackOptions();
  updateSoundEffectsButton();
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
  });
  [view, artbookView].filter(Boolean).forEach((surfaceView) => {
    surfaceView.dataset.theme = state.readerPrefs.theme;
  });
}

const sampleText = `Prologue

Je ne me souviens pas exactement du moment où tout a commencé. Il reste seulement des images, des silences, et cette impression que la route avait été tracée avant même que je comprenne où poser les pieds.

La nuit était tombée quand on m’a annoncé ton départ. Personne n’avait l’air inquiet. Moi, je comptais les heures.

Chapitre 1 - Le contrat

La journée s’annonçait longue. Deux missions, un détour chez Ignis, et cette sensation désagréable qu’une pièce du décor avait changé pendant mon sommeil.

Je suis parti vers la vieille ville avant l’aube. Les rues étaient encore humides, presque vides, et ma moto faisait trop de bruit dans le silence.

Chapitre 2 - Le retour

Quand je suis rentré, les lumières de la maison étaient allumées. Ce détail aurait dû me rassurer. Au lieu de ça, il m’a glacé.

Il y avait des voix dans le grand salon, des voix basses, trop contrôlées. J’ai compris avant même d’ouvrir la porte que rien ne serait simple.`;

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
  return Boolean(DB_CONFIG.url && DB_CONFIG.anonKey && window.supabase?.createClient);
}

function initDatabase() {
  if (!hasSupabaseConfig()) return;

  state.db = window.supabase.createClient(DB_CONFIG.url, DB_CONFIG.anonKey);
  state.storageMode = "supabase";
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

  const { data: chapters, error: chaptersError } = await state.db
    .from("chapters")
    .select("*")
    .in("book_id", books.map((book) => book.id))
    .order("position", { ascending: true });

  if (chaptersError) throw chaptersError;

  let artbookItems = [];
  const { data: artbookRows, error: artbookError } = await state.db
    .from("artbook_items")
    .select("*")
    .in("book_id", books.map((book) => book.id))
    .order("position", { ascending: true });

  if (artbookError) {
    state.hasArtbookTable = false;
    console.warn("Table artbook_items indisponible. Les artbooks seront vides jusqu'à la migration.", artbookError);
  } else {
    state.hasArtbookTable = true;
    artbookItems = artbookRows || [];
  }

  state.books = books.map((book) => mapBookRow(book, chapters || [], artbookItems));
}

function loadBooksFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.books = [createSeedBook()];
    saveBooks();
    return;
  }

  try {
    state.books = JSON.parse(raw).map(normalizeBook);
  } catch {
    state.books = [createSeedBook()];
    saveBooks();
  }
}

async function loadBooks() {
  initDatabase();

  if (state.storageMode === "supabase") {
    try {
      await loadBooksFromDatabase();
      return;
    } catch (error) {
      console.warn("Supabase indisponible, fallback localStorage.", error);
      state.storageMode = "local";
      state.db = null;
    }
  }

  loadBooksFromLocalStorage();
}

function saveBooks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.books));
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
}

function markEditorSaved(message = "Aucune modification en attente.") {
  state.editorDirty = false;
  setEditorStatus(message, "saved");
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
  const suffix = chapter.illustration ? " · illustration" : "";
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
  if (illustrationFileInput) illustrationFileInput.value = "";
  setChapterIllustrationPreview(chapter?.illustration || "");
  titleInput.disabled = !chapter;
  contentInput.contentEditable = chapter ? "true" : "false";
  contentInput.setAttribute("aria-disabled", chapter ? "false" : "true");
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

  if (!title) {
    alert("Ajoute un titre pour ce chapitre.");
    return false;
  }

  state.editorChapters[index] = {
    ...state.editorChapters[index],
    title,
    content,
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
    alert("Aucun chapitre n’a été détecté dans le texte importé.");
    return;
  }

  if (mode === "replace" && state.editorChapters.length && !confirm("Remplacer tous les chapitres actuels par l’import ?")) {
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
  const nextStartsDialogue = /^[-–—«"“]/.test(next);
  const nextStartsSpeechLabel = /^[A-ZÉÈÀÂÎÔÛÇ][^.!?]{0,80}\s*:\s*[-–—]?\s*\S/.test(next);
  const previousEndsSentence = /[.!?…»”")\]]$/.test(previous);
  const nextStartsSentence = /^[A-ZÀ-Ý0-9«"“—-]/.test(next);

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
  const plainParagraph = paragraphPlainText(paragraph).replace(/\s+/g, " ").trim();
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
      testPage.paragraphs.push(escapeHtml(chunk));
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
      chunkPage.paragraphs.push(escapeHtml(chunk));
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
  if (!artbookCount) return chapterStats;
  return `${chapterStats} - ${artbookCount} planche${artbookCount > 1 ? "s" : ""}`;
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
    cover.addEventListener("click", () => openReaderWithBusy(book.id));
    node.querySelector(".book-author").textContent = book.author || "Auteur inconnu";
    node.querySelector(".book-title").textContent = book.title;
    node.querySelector(".book-summary").textContent = book.summary || "Aucun résumé pour le moment.";
    node.querySelector(".book-stats").textContent = formatBookSectionStats(book);
    node.querySelector(".read-book").addEventListener("click", () => openReaderWithBusy(book.id));
    const artbookButton = node.querySelector(".open-artbook");
    artbookButton.hidden = !hasArtbook(book);
    if (hasArtbook(book)) {
      artbookButton.addEventListener("click", () => openArtbookWithBusy(book.id));
    }
    node.querySelector(".edit-book").addEventListener("click", () => editBook(book.id));
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
    alert("Choisis un fichier image pour l’illustration.");
    event.target.value = "";
    return;
  }

  await withAppBusy("Préparation de l’illustration…", async () => {
    try {
      const illustration = await compressChapterIllustration(file);
      state.editorChapters[index] = {
        ...state.editorChapters[index],
        title: byId("chapter-title").value.trim(),
        content: readRichEditorContent(),
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
  byId("import-preview").textContent = `${chapters.length} chapitre${chapters.length > 1 ? "s" : ""} dans le livre · environ ${words} mots · ${pages} page${pages > 1 ? "s" : ""} estimée${pages > 1 ? "s" : ""} · ${importedChapters.length} chapitre${importedChapters.length > 1 ? "s" : ""} détecté${importedChapters.length > 1 ? "s" : ""} dans l’import`;
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

  const emptyChapter = chapters.find((chapter) => !richContentToPlainText(chapter.content).trim() && !chapter.illustration);
  if (emptyChapter) {
    return `Le chapitre « ${emptyChapter.title} » est vide. Ajoute du contenu ou supprime-le.`;
  }

  return "";
}

function validateArtbookItems(items) {
  const incompleteItem = items.find((item) => !item.image && (item.title || item.description));
  if (incompleteItem) {
    return `La planche "${incompleteItem.title || "sans titre"}" doit avoir une image.`;
  }

  return "";
}

function getBookSaveErrorMessage(error) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");

  if (/illustration/i.test(errorText) && /(column|schema|PGRST204|cache)/i.test(errorText)) {
    return "La base Supabase n’est pas à jour : applique la migration des illustrations, puis recharge la page.";
  }

  if (/artbook_items/i.test(errorText) || (/artbook/i.test(errorText) && /(relation|schema|cache|PGRST204)/i.test(errorText))) {
    return "La base Supabase n'est pas à jour : applique la migration des artbooks, puis recharge la page.";
  }

  if (/bucket/i.test(errorText) && /not found/i.test(errorText)) {
    return "Le bucket Supabase Storage « covers » n’existe pas encore : applique la migration des illustrations.";
  }

  return "Impossible d’enregistrer le livre dans la base de données.";
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
    console.warn("Impossible d’envoyer l’image vers Supabase Storage, conservation en base64.", error);
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

function fillForm(book) {
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

  await withAppBusy("Suppression du livre…", async () => {
  if (state.storageMode === "supabase") {
    const { error } = await state.db.from("books").delete().eq("id", state.editingBookId);
    if (error) {
      console.error(error);
      alert("Impossible de supprimer le livre dans la base de données.");
      return;
    }
    await loadBooksFromDatabase();
  } else {
    state.books = state.books.filter((item) => item.id !== state.editingBookId);
    saveBooks();
  }

  if (state.activeBookId === state.editingBookId) {
    state.activeBookId = state.books[0]?.id || null;
    localStorage.removeItem(ACTIVE_BOOK_KEY);
  }
  state.editingBookId = null;
  fillForm(null);
  renderBookGrid();
  showView("library");
  });
}

function openReader(bookId, page = null) {
  const book = getBook(bookId);
  if (!book) return;

  state.activeBookId = bookId;
  localStorage.setItem(ACTIVE_BOOK_KEY, bookId);
  showView("reader");
  byId("reader-layout").hidden = false;
  byId("reader-empty").hidden = true;
  state.pages = paginateBook(book);
  state.currentPage = Math.min(Math.max(page ?? getReadingProgress(book.id) ?? book.bookmarkPage ?? 0, 0), state.pages.length - 1);

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

function renderReader() {
  const book = getBook(state.activeBookId);
  if (!book) {
    byId("reader-layout").hidden = true;
    byId("reader-empty").hidden = false;
    return;
  }

  byId("reader-layout").hidden = false;
  byId("reader-empty").hidden = true;
  setReadingProgress(book.id, state.currentPage);
  byId("reader-book-title").textContent = book.title;
  byId("reader-book-meta").textContent = `${book.author || "Auteur inconnu"} · ${state.pages.length} pages`;
  byId("reader-mini-cover").style.backgroundImage = coverBackground(book);
  applyReaderPrefs();

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
  byId("bookmark-button").textContent = book.bookmarkPage === state.currentPage ? "Marque-page posé" : "Marque-page";
  updateAmbianceButton();
  updateSoundEffectsButton();
  byId("prev-page").disabled = isMobile ? state.currentPage <= 0 : leftIndex <= 0;
  byId("next-page").disabled = isMobile ? state.currentPage >= state.pages.length - 1 : leftIndex + 2 >= state.pages.length;

  renderToc(book);
  renderBookSearchResults();
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
    /^["«“]\s*[-–—]?\s*\S/.test(text) ||
    /^[A-ZÉÈÀÂÎÔÛÇ][^.!?]{0,80}\s*:\s*[-–—]?\s*\S/.test(text)
  );
}

function renderToc(book) {
  const list = byId("toc-list");
  list.innerHTML = "";

  book.chapters.forEach((chapter) => {
    const pageIndex = findChapterStartPage(state.pages, chapter.id);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${chapter.title} · p. ${pageIndex + 1}`;
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

function renderBookSearchResults() {
  const book = getBook(state.activeBookId);
  const container = byId("book-search-results");
  const query = byId("book-search").value.trim().toLowerCase();
  container.innerHTML = "";

  if (!book || query.length < 2) return;

  const results = [];
  book.chapters.forEach((chapter) => {
    paragraphsFromContent(chapter.content).forEach((paragraph) => {
      const plainParagraph = paragraphPlainText(paragraph);
      const index = plainParagraph.toLowerCase().indexOf(query);
      if (index < 0 || results.length >= 8) return;
      results.push({
        chapter,
        paragraph: plainParagraph,
        excerpt: plainParagraph.slice(Math.max(0, index - 48), index + query.length + 76),
      });
    });
  });

  if (!results.length) {
    container.innerHTML = '<p class="import-warning">Aucun résultat.</p>';
    return;
  }

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <span class="search-result-title">${escapeHtml(result.chapter.title)}</span>
      <span class="search-result-excerpt">${escapeHtml(result.excerpt)}</span>
    `;
    button.addEventListener("click", () => goToPage(findPageForParagraph(result.chapter.id, result.paragraph)));
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
  }, 660);
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
  }, sheetCount * 42 + 720);
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

function updateFocusButtons() {
  const label = document.body.classList.contains("reader-focus") ? "Quitter" : "Plein écran";
  ["reader-focus-toggle", "artbook-focus-toggle"].forEach((id) => {
    const button = byId(id);
    if (button) button.textContent = label;
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
  button.textContent = isMuted ? "Sons coupés" : "Sons";
  button.setAttribute("aria-pressed", isMuted ? "true" : "false");
  button.setAttribute("aria-label", isMuted ? "Réactiver les effets sonores" : "Couper les effets sonores");
}

function toggleSoundEffects() {
  state.readerPrefs.soundEffects = !state.readerPrefs.soundEffects;
  saveReaderPrefs();
  updateSoundEffectsButton();

  if (!state.readerPrefs.soundEffects && state.pageFlipAudio) {
    state.pageFlipAudio.pause();
    state.pageFlipAudio.currentTime = 0;
  }
}

function getAmbianceTrack(trackId = state.readerPrefs.ambianceTrack) {
  return AMBIANCE_TRACKS.find((track) => track.id === trackId) || AMBIANCE_TRACKS[0];
}

function renderAmbianceTrackOptions() {
  const select = byId("ambiance-track");
  if (!select) return;

  const selectedTrack = getAmbianceTrack();
  select.innerHTML = AMBIANCE_TRACKS
    .map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.label)}</option>`)
    .join("");
  select.value = selectedTrack.id;
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
  button.textContent = state.isAmbianceEnabled ? "Ambiance active" : "Ambiance";
  button.setAttribute("aria-pressed", state.isAmbianceEnabled ? "true" : "false");
  button.setAttribute("aria-expanded", isPanelOpen ? "true" : "false");
  button.setAttribute("aria-label", isPanelOpen ? "Fermer le panneau d’ambiance" : "Ouvrir le panneau d’ambiance");
  updateAmbiancePlayButton();
}

function updateAmbiancePlayButton() {
  const button = byId("ambiance-play-toggle");
  if (!button) return;

  const track = getAmbianceTrack();
  button.textContent = state.isAmbianceEnabled ? "Couper l’ambiance" : "Lancer l’ambiance";
  button.setAttribute("aria-pressed", state.isAmbianceEnabled ? "true" : "false");
  button.setAttribute("aria-label", state.isAmbianceEnabled ? `Couper l’ambiance ${track.label}` : `Lancer l’ambiance ${track.label}`);
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

  const step = (now) => {
    const progress = Math.min((now - startTime) / AMBIANCE_FADE_MS, 1);
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

function startAmbiance() {
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

function updateAmbianceTrack(trackId) {
  const previousTrack = getAmbianceTrack();
  const nextTrack = getAmbianceTrack(trackId);
  state.readerPrefs.ambianceTrack = nextTrack.id;
  saveReaderPrefs();
  renderAmbianceTrackOptions();
  updateAmbianceButton();
  updateAmbiancePlayButton();

  if (nextTrack.id === previousTrack.id) return;

  if (state.isAmbianceEnabled) {
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

  await withAppBusy("Enregistrement du marque-page…", async () => {
  book.bookmarkPage = state.currentPage;
  book.updatedAt = new Date().toISOString();

  if (state.storageMode === "supabase") {
    const { error } = await state.db
      .from("books")
      .update({ bookmark_page: state.currentPage })
      .eq("id", book.id);

    if (error) {
      console.error(error);
      alert("Impossible d’enregistrer le marque-page dans la base de données.");
      return;
    }
  } else {
    saveBooks();
  }

  renderReader();
  renderBookGrid();
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
  byId("load-example").addEventListener("click", () => {
    chapterSourceRichHtml = "";
    byId("chapter-source").value = sampleText;
    importChaptersFromSource("replace");
  });
  byId("delete-book").addEventListener("click", deleteCurrentBook);
  byId("prev-page").addEventListener("click", () => changePageByDirection("backward"));
  byId("next-page").addEventListener("click", () => changePageByDirection("forward"));
  byId("left-page").addEventListener("click", (event) => changePageFromPaperClick(event, "left"));
  byId("right-page").addEventListener("click", (event) => changePageFromPaperClick(event, "right"));
  byId("book-reader").addEventListener("wheel", changePageFromWheel, { passive: false });
  byId("book-reader").addEventListener("touchstart", handleTouchStart, { passive: true });
  byId("book-reader").addEventListener("touchend", handleTouchEnd, { passive: true });
  byId("bookmark-button").addEventListener("click", setBookmark);
  byId("resume-button").addEventListener("click", () => {
    const book = getBook(state.activeBookId);
    if (book) goToPage(book.bookmarkPage ?? getReadingProgress(book.id) ?? 0);
  });
  byId("ambiance-toggle").addEventListener("click", toggleAmbiancePanel);
  byId("ambiance-play-toggle").addEventListener("click", toggleAmbiance);
  byId("sound-effects-toggle").addEventListener("click", toggleSoundEffects);
  byId("reader-settings-toggle").addEventListener("click", () => {
    byId("reader-settings").hidden = !byId("reader-settings").hidden;
  });
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
  byId("reader-theme").addEventListener("change", (event) => updateReaderPreference("theme", event.target.value));
  byId("ambiance-track").addEventListener("change", (event) => updateAmbianceTrack(event.target.value));
  byId("book-search").addEventListener("input", renderBookSearchResults);
  byId("page-jump").addEventListener("change", (event) => {
    goToPage(Number(event.target.value) - 1);
  });

  document.addEventListener("keydown", (event) => {
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
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.editorDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function init() {
  setAppBusy(true, "Chargement de la bibliothèque…");

  try {
    loadReaderPrefs();
    await loadBooks();
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    state.activeBookId = localStorage.getItem(ACTIVE_BOOK_KEY) || state.books[0]?.id || null;
    fillForm(null);
    bindEvents();
    syncReaderPrefsControls();
    updateFocusButtons();
    renderBookGrid();
    showView("library");
  } finally {
    setAppBusy(false);
  }
}

init();
