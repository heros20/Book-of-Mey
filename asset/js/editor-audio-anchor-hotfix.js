(() => {
  if (typeof goToEditorAudioAnchor === "function" || typeof byId !== "function") return;

  let audioAnchorNavigationIndex = -1;

  function ensureAudioAnchorJumpStyles() {
    if (document.getElementById("editor-audio-anchor-hotfix-style")) return;

    const style = document.createElement("style");
    style.id = "editor-audio-anchor-hotfix-style";
    style.textContent = `
      .audio-anchor-control .audio-anchor-jump {
        grid-column: 1 / -1;
        justify-self: start;
      }

      .rich-text-editor .audio-anchor.is-current-anchor {
        border-color: var(--accent);
        background: rgba(95, 111, 82, 0.22);
        box-shadow: 0 0 0 3px rgba(95, 111, 82, 0.18);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureAudioAnchorJumpButton() {
    let button = byId("go-to-audio-anchor");
    if (button) return button;

    const insertButton = byId("insert-audio-anchor");
    if (!insertButton) return null;

    button = document.createElement("button");
    button.className = "secondary-action audio-anchor-jump";
    button.id = "go-to-audio-anchor";
    button.type = "button";
    button.textContent = "Aller \u00e0 l'ancre pos\u00e9e";
    insertButton.insertAdjacentElement("afterend", button);
    return button;
  }

  function getAudioAnchors() {
    return Array.from(byId("chapter-content")?.querySelectorAll("[data-audio-anchor]") || []);
  }

  function clearAudioAnchorHighlight() {
    getAudioAnchors().forEach((anchor) => anchor.classList.remove("is-current-anchor"));
  }

  function updateAudioAnchorJumpButton() {
    const button = ensureAudioAnchorJumpButton();
    if (!button) return;

    const anchorCount = getAudioAnchors().length;
    button.disabled = anchorCount <= 0;
    button.textContent = anchorCount > 1
      ? `Aller aux ancres (${anchorCount})`
      : "Aller \u00e0 l'ancre pos\u00e9e";
    button.setAttribute("aria-label", anchorCount > 1
      ? `Aller \u00e0 la prochaine ancre sonore parmi ${anchorCount}`
      : "Aller \u00e0 l'ancre sonore pos\u00e9e");
  }

  function goToAudioAnchor() {
    const editor = byId("chapter-content");
    const anchors = getAudioAnchors();
    if (!editor || !anchors.length) {
      updateAudioAnchorJumpButton();
      showReaderToast?.("Aucune ancre sonore dans ce chapitre.");
      return;
    }

    audioAnchorNavigationIndex = (audioAnchorNavigationIndex + 1) % anchors.length;
    const anchor = anchors[audioAnchorNavigationIndex];
    clearAudioAnchorHighlight();
    anchor.classList.add("is-current-anchor");
    anchor.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });

    const range = document.createRange();
    range.setStartAfter(anchor);
    range.collapse(true);
    editor.focus({ preventScroll: true });

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (typeof chapterEditorRange !== "undefined") chapterEditorRange = range.cloneRange();

    window.setTimeout(() => anchor.classList.remove("is-current-anchor"), 1800);
    showReaderToast?.(anchors.length > 1
      ? `Ancre sonore ${audioAnchorNavigationIndex + 1} / ${anchors.length}`
      : "Ancre sonore trouv\u00e9e.");
  }

  ensureAudioAnchorJumpStyles();
  const button = ensureAudioAnchorJumpButton();
  button?.addEventListener("click", goToAudioAnchor);
  byId("chapter-content")?.addEventListener("input", updateAudioAnchorJumpButton);
  byId("insert-audio-anchor")?.addEventListener("click", () => window.setTimeout(updateAudioAnchorJumpButton, 0));

  if (typeof renderChapterControl === "function") {
    const renderChapterControlBeforeHotfix = renderChapterControl;
    renderChapterControl = function (...args) {
      const result = renderChapterControlBeforeHotfix.apply(this, args);
      audioAnchorNavigationIndex = -1;
      ensureAudioAnchorJumpButton();
      updateAudioAnchorJumpButton();
      return result;
    };
  }

  updateAudioAnchorJumpButton();
})();
