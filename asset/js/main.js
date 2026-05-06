const STORAGE_KEY = "book-of-mey-library";
const ACTIVE_BOOK_KEY = "book-of-mey-active-book";
const DB_CONFIG = window.BOOK_OF_MEY_SUPABASE || {};

const densityMap = {
  comfortable: 980,
  classic: 1250,
  dense: 1550,
};

const coverUpload = {
  dataUrl: "",
};

const state = {
  books: [],
  activeBookId: null,
  currentPage: 0,
  editingBookId: null,
  pages: [],
  isAnimating: false,
  lastWheelTurnAt: 0,
  storageMode: "local",
  db: null,
};

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

function mapBookRow(row, chapters) {
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
    chapters: chapters
      .filter((chapter) => chapter.book_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        content: chapter.content || "",
      })),
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

  state.books = books.map((book) => mapBookRow(book, chapters || []));
}

function loadBooksFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.books = [createSeedBook()];
    saveBooks();
    return;
  }

  try {
    state.books = JSON.parse(raw);
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

function showView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${viewName}-view`);
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
  });
}

function getBook(id) {
  return state.books.find((book) => book.id === id);
}

function normalizeTitle(line) {
  return line.replace(/^#+\s*/, "").trim();
}

function isChapterHeading(line) {
  const text = line.trim();
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

function paragraphsFromContent(content) {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean);
}

function paginateBook(book) {
  const baseChars = densityMap[book.density] || densityMap.classic;
  const fontScale = Math.pow(18 / (book.fontSize || 18), 1.35);
  const maxChars = Math.round(baseChars * fontScale);
  const pages = [];

  book.chapters.forEach((chapter, chapterIndex) => {
    const paragraphs = paragraphsFromContent(chapter.content);
    let page = {
      chapterId: chapter.id,
      chapterIndex,
      chapterTitle: chapter.title,
      startsChapter: true,
      paragraphs: [],
      charCount: chapter.title.length + 120,
    };

    paragraphs.forEach((paragraph) => {
      const weight = paragraph.length + 90;
      if (page.paragraphs.length && page.charCount + weight > maxChars) {
        pages.push(page);
        page = {
          chapterId: chapter.id,
          chapterIndex,
          chapterTitle: chapter.title,
          startsChapter: false,
          paragraphs: [],
          charCount: 0,
        };
      }

      if (paragraph.length > maxChars) {
        const chunks = paragraph.match(new RegExp(`.{1,${Math.max(420, maxChars - 160)}}(\\s|$)`, "g")) || [paragraph];
        chunks.forEach((chunk, chunkIndex) => {
          if (page.paragraphs.length && page.charCount + chunk.length > maxChars) {
            pages.push(page);
            page = {
              chapterId: chapter.id,
              chapterIndex,
              chapterTitle: chapter.title,
              startsChapter: false,
              paragraphs: [],
              charCount: 0,
            };
          }
          page.paragraphs.push(chunk.trim());
          page.charCount += chunk.length + 90;
          if (chunkIndex < chunks.length - 1) {
            pages.push(page);
            page = {
              chapterId: chapter.id,
              chapterIndex,
              chapterTitle: chapter.title,
              startsChapter: false,
              paragraphs: [],
              charCount: 0,
            };
          }
        });
        return;
      }

      page.paragraphs.push(paragraph);
      page.charCount += weight;
    });

    pages.push(page);
  });

  return pages.length ? pages : [{ chapterTitle: book.title, startsChapter: true, paragraphs: ["Aucun texte ajouté pour le moment."] }];
}

function findChapterStartPage(pages, chapterId) {
  return Math.max(0, pages.findIndex((page) => page.chapterId === chapterId));
}

function renderBookGrid() {
  const grid = byId("book-grid");
  const template = byId("book-card-template");
  const query = byId("search-input").value.trim().toLowerCase();
  const sort = byId("sort-select").value;

  grid.innerHTML = "";

  let books = [...state.books].filter((book) => {
    const haystack = [book.title, book.author, book.summary, ...book.chapters.map((chapter) => chapter.title)]
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
    const pageCount = paginateBook(book).length;
    const cover = node.querySelector(".cover-button");
    cover.style.backgroundImage = coverBackground(book);
    cover.addEventListener("click", () => openReader(book.id));
    node.querySelector(".book-author").textContent = book.author || "Auteur inconnu";
    node.querySelector(".book-title").textContent = book.title;
    node.querySelector(".book-summary").textContent = book.summary || "Aucun résumé pour le moment.";
    node.querySelector(".book-stats").textContent = `${book.chapters.length} chapitre${book.chapters.length > 1 ? "s" : ""} · ${pageCount} page${pageCount > 1 ? "s" : ""}`;
    node.querySelector(".read-book").addEventListener("click", () => openReader(book.id));
    node.querySelector(".edit-book").addEventListener("click", () => editBook(book.id));
    grid.appendChild(node);
  });
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

async function compressCoverImage(file) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = objectUrl;
  });

  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(objectUrl);

  return canvas.toDataURL("image/jpeg", 0.82);
}

async function handleCoverFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Choisis un fichier image pour la couverture.");
    event.target.value = "";
    return;
  }

  try {
    coverUpload.dataUrl = await compressCoverImage(file);
    byId("book-cover").value = "";
    setCoverPreview(coverUpload.dataUrl);
  } catch (error) {
    console.error(error);
    alert("Impossible de lire cette image.");
  }
}

function updateImportPreview() {
  const chapters = parseChapters(byId("chapter-source").value);
  const words = chapters.reduce((total, chapter) => total + chapter.content.split(/\s+/).filter(Boolean).length, 0);
  const previewBook = {
    chapters,
    fontSize: Number(byId("font-size").value),
    density: byId("page-density").value,
    title: byId("book-title").value || "Aperçu",
  };
  const pages = chapters.length ? paginateBook(previewBook).length : 0;
  byId("import-preview").textContent = `${chapters.length} chapitre${chapters.length > 1 ? "s" : ""} détecté${chapters.length > 1 ? "s" : ""} · environ ${words} mots · ${pages} page${pages > 1 ? "s" : ""} estimée${pages > 1 ? "s" : ""}`;
}

function readForm() {
  return {
    title: byId("book-title").value.trim(),
    author: byId("book-author").value.trim(),
    summary: byId("book-summary").value.trim(),
    cover: coverUpload.dataUrl || byId("book-cover").value.trim(),
    fontSize: Number(byId("font-size").value),
    density: byId("page-density").value,
    chapters: parseChapters(byId("chapter-source").value),
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
    book_id: bookId,
    position: index + 1,
    title: chapter.title,
    content: chapter.content,
  }));
}

async function saveBookToDatabase(payload, existingBook = null) {
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

    const { error: deleteError } = await state.db
      .from("chapters")
      .delete()
      .eq("book_id", existingBook.id);

    if (deleteError) throw deleteError;
  } else {
    const { data, error } = await state.db
      .from("books")
      .insert(bookRow)
      .select()
      .single();

    if (error) throw error;
    savedBook = data;
  }

  const chapterRows = toChapterRows(savedBook.id, payload.chapters);
  if (chapterRows.length) {
    const { error } = await state.db.from("chapters").insert(chapterRows);
    if (error) throw error;
  }

  await loadBooksFromDatabase();
  return savedBook.id;
}

function fillForm(book) {
  state.editingBookId = book?.id || null;
  byId("book-title").value = book?.title || "";
  byId("book-author").value = book?.author || "";
  byId("book-summary").value = book?.summary || "";
  byId("book-cover").value = book?.cover || "";
  byId("book-cover-file").value = "";
  coverUpload.dataUrl = "";
  setCoverPreview(book?.cover || "");
  byId("font-size").value = book?.fontSize || 18;
  byId("page-density").value = book?.density || "classic";
  byId("chapter-source").value = book ? book.chapters.map((chapter) => `${chapter.title}\n\n${chapter.content}`).join("\n\n") : "";
  byId("delete-book").hidden = !book;
  updateImportPreview();
}

async function saveForm(event) {
  event.preventDefault();
  const payload = readForm();

  if (!payload.chapters.length) {
    alert("Ajoute au moins un chapitre ou un bloc de texte.");
    return;
  }

  const submitButton = event.submitter || byId("book-form").querySelector('button[type="submit"]');
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
    openReader(state.activeBookId);
  } catch (error) {
    console.error(error);
    alert("Impossible d'enregistrer le livre dans la base de données.");
  } finally {
    submitButton.disabled = false;
  }
}

function editBook(bookId) {
  const book = getBook(bookId);
  if (!book) return;
  fillForm(book);
  showView("editor");
}

async function deleteCurrentBook() {
  if (!state.editingBookId) return;
  const book = getBook(state.editingBookId);
  if (!book || !confirm(`Supprimer "${book.title}" ?`)) return;

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
}

function openReader(bookId, page = null) {
  const book = getBook(bookId);
  if (!book) return;

  state.activeBookId = bookId;
  localStorage.setItem(ACTIVE_BOOK_KEY, bookId);
  state.pages = paginateBook(book);
  state.currentPage = Math.min(Math.max(page ?? book.bookmarkPage ?? 0, 0), state.pages.length - 1);

  renderReader();
  showView("reader");
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
  byId("reader-book-title").textContent = book.title;
  byId("reader-book-meta").textContent = `${book.author || "Auteur inconnu"} · ${state.pages.length} pages`;
  byId("reader-mini-cover").style.backgroundImage = coverBackground(book);
  byId("book-reader").style.setProperty("--reader-font-size", `${book.fontSize || 18}px`);

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
  byId("prev-page").disabled = isMobile ? state.currentPage <= 0 : leftIndex <= 0;
  byId("next-page").disabled = isMobile ? state.currentPage >= state.pages.length - 1 : leftIndex + 2 >= state.pages.length;

  renderToc(book);
}

function renderPage(container, page, index, book) {
  if (!page) {
    container.innerHTML = "";
    return;
  }

  const bookmark = book.bookmarkPage === index ? '<span class="bookmark-ribbon" aria-label="Marque-page"></span>' : "";
  const title = page.startsChapter ? `<h2>${escapeHtml(page.chapterTitle)}</h2>` : "";
  const paragraphs = page.paragraphs
    .map((paragraph) => {
      const className = isDialogueParagraph(paragraph) ? ' class="dialogue-line"' : "";
      return `<p${className}>${escapeHtml(paragraph)}</p>`;
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
  const text = paragraph.trim();
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

function goToPage(pageIndex) {
  const nextPage = Math.min(Math.max(pageIndex, 0), state.pages.length - 1);
  if (nextPage === state.currentPage || state.isAnimating) return;

  const previousPage = state.currentPage;
  if (isSameVisibleSpread(previousPage, nextPage)) {
    state.currentPage = nextPage;
    renderReader();
    return;
  }

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
  const book = getBook(state.activeBookId);
  if (!book) return;

  book.bookmarkPage = state.currentPage;
  book.updatedAt = new Date().toISOString();

  if (state.storageMode === "supabase") {
    const { error } = await state.db
      .from("books")
      .update({ bookmark_page: state.currentPage })
      .eq("id", book.id);

    if (error) {
      console.error(error);
      alert("Impossible d'enregistrer le marque-page dans la base de données.");
      return;
    }
  } else {
    saveBooks();
  }

  renderReader();
  renderBookGrid();
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
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.viewTarget;
      if (target === "reader" && !state.activeBookId) {
        showView("library");
        return;
      }
      showView(target);
    });
  });

  byId("search-input").addEventListener("input", renderBookGrid);
  byId("sort-select").addEventListener("change", renderBookGrid);
  byId("book-form").addEventListener("submit", saveForm);
  byId("chapter-source").addEventListener("input", updateImportPreview);
  byId("font-size").addEventListener("input", updateImportPreview);
  byId("page-density").addEventListener("change", updateImportPreview);
  byId("book-cover").addEventListener("input", (event) => {
    coverUpload.dataUrl = "";
    setCoverPreview(event.target.value.trim());
  });
  byId("book-cover-file").addEventListener("change", handleCoverFileChange);
  byId("reset-editor").addEventListener("click", () => fillForm(null));
  byId("load-example").addEventListener("click", () => {
    byId("chapter-source").value = sampleText;
    updateImportPreview();
  });
  byId("delete-book").addEventListener("click", deleteCurrentBook);
  byId("prev-page").addEventListener("click", () => changePageByDirection("backward"));
  byId("next-page").addEventListener("click", () => changePageByDirection("forward"));
  byId("left-page").addEventListener("click", () => changePageFromPaper("left"));
  byId("right-page").addEventListener("click", () => changePageFromPaper("right"));
  byId("book-reader").addEventListener("wheel", changePageFromWheel, { passive: false });
  byId("bookmark-button").addEventListener("click", setBookmark);
  byId("resume-button").addEventListener("click", () => {
    const book = getBook(state.activeBookId);
    if (book) goToPage(book.bookmarkPage || 0);
  });
  byId("page-jump").addEventListener("change", (event) => {
    goToPage(Number(event.target.value) - 1);
  });

  document.addEventListener("keydown", (event) => {
    if (!state.activeBookId || !byId("reader-view").classList.contains("is-active")) return;
    if (event.key === "ArrowRight") changePageByDirection("forward");
    if (event.key === "ArrowLeft") changePageByDirection("backward");
  });

  window.addEventListener("resize", () => {
    if (state.activeBookId) renderReader();
  });
}

async function init() {
  await loadBooks();
  state.activeBookId = localStorage.getItem(ACTIVE_BOOK_KEY) || state.books[0]?.id || null;
  fillForm(null);
  bindEvents();
  renderBookGrid();
  if (state.activeBookId) openReader(state.activeBookId, 0);
  showView("library");
}

init();
