(() => {
  const AUDIO_ANCHOR_INTERRUPT_FADE_MS_HOTFIX = 420;

  if (
    typeof state === "undefined" ||
    typeof getBook !== "function" ||
    typeof getVisibleAudioAnchorPages !== "function"
  ) {
    return;
  }

  state.audioAnchorInterrupting = false;

  discardAudioAnchorsOutsidePages = function (visiblePages) {
    state.audioAnchorQueue = state.audioAnchorQueue.filter((item) => {
      if (visiblePages.has(item.pageIndex)) return true;
      state.pendingAudioAnchors.delete(item.key);
      return false;
    });
  };

  function interruptCurrentAudioAnchorForNext() {
    const audio = state.audioAnchorAudio;
    if (!audio || !state.audioAnchorQueue.length || state.audioAnchorInterrupting) return;

    state.audioAnchorInterrupting = true;
    state.audioAnchorFadeOutStarted = true;
    fadeAudioAnchorVolume(audio, 0, AUDIO_ANCHOR_INTERRUPT_FADE_MS_HOTFIX, () => finishAudioAnchor(audio));
  }

  syncPageAudioAnchors = function () {
    if (!state.readerPrefs.soundEffects || state.isAnimating) return false;

    const book = getBook(state.activeBookId);
    if (!book) return false;

    const visiblePageIndices = getVisibleAudioAnchorPages();
    const visiblePages = new Set(visiblePageIndices);
    discardAudioAnchorsOutsidePages(visiblePages);

    let queuedAnAnchor = false;
    visiblePageIndices.forEach((pageIndex) => {
      getPageAudioAnchors(state.pages[pageIndex]).forEach(({ trackId, trackLabel, anchorId }, anchorIndex) => {
        const key = anchorId
          ? `${book.id}:${anchorId}`
          : `${book.id}:${pageIndex}:${anchorIndex}:${trackId}`;
        if (state.playedAudioAnchors.has(key) || state.pendingAudioAnchors.has(key)) return;

        const track = resolveAudioAnchorTrack(trackId, trackLabel);
        if (!track) return;

        state.pendingAudioAnchors.add(key);
        state.audioAnchorQueue.push({ key, pageIndex, track });
        queuedAnAnchor = true;
      });
    });

    if (queuedAnAnchor && state.audioAnchorAudio) {
      interruptCurrentAudioAnchorForNext();
    } else if (queuedAnAnchor || (!state.audioAnchorAudio && state.audioAnchorQueue.length)) {
      playNextAudioAnchor();
    }
    if (!state.audioAnchorAudio && !state.audioAnchorQueue.length && state.suspendedAmbiance) resumeSuspendedAmbiance();
    return queuedAnAnchor || Boolean(state.audioAnchorAudio) || state.audioAnchorQueue.length > 0;
  };

  finishAudioAnchor = function (audio) {
    if (state.audioAnchorAudio !== audio) return;

    const item = state.activeAudioAnchorItem;
    cancelAudioAnchorFade();
    clearAudioAnchorElement(audio);
    if (item) state.pendingAudioAnchors.delete(item.key);
    state.audioAnchorAudio = null;
    state.activeAudioAnchorItem = null;
    state.audioAnchorFadeOutStarted = false;
    state.audioAnchorInterrupting = false;

    if (state.audioAnchorQueue.length) {
      playNextAudioAnchor();
      return;
    }

    resumeSuspendedAmbiance();
    if (byId("reader-view")?.classList.contains("is-active")) syncChapterAmbiance();
  };

  beginAudioAnchor = function (item) {
    const audio = new Audio(item.track.src);
    audio.loop = false;
    audio.preload = "auto";
    audio.volume = 0;
    state.audioAnchorAudio = audio;
    state.activeAudioAnchorItem = item;
    state.audioAnchorFadeOutStarted = false;
    state.audioAnchorInterrupting = false;

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
      if (state.audioAnchorAudio !== audio || state.activeAudioAnchorItem !== item || state.audioAnchorInterrupting) return;
      state.pendingAudioAnchors.delete(item.key);
      state.playedAudioAnchors.add(item.key);
      const duration = Number.isFinite(audio.duration) ? audio.duration * 250 : AUDIO_ANCHOR_FADE_IN_MS;
      fadeAudioAnchorVolume(audio, AUDIO_ANCHOR_VOLUME, Math.min(AUDIO_ANCHOR_FADE_IN_MS, duration));
      showReaderToast(`Son : ${item.track.label}`);
    };

    const handlePlayFailure = (error) => {
      if (state.audioAnchorAudio !== audio) return;
      state.pendingAudioAnchors.delete(item.key);
      finishAudioAnchor(audio);
      if (error?.name === "NotAllowedError") {
        showReaderToast("Le navigateur a bloque le son. Touchez la page puis reessayez.");
      }
    };

    if (playPromise?.then) {
      playPromise.then(fadeIn).catch(handlePlayFailure);
    } else {
      fadeIn();
    }
  };

  cancelAudioAnchorPlayback = function (resumeAmbiance = false) {
    const audio = state.audioAnchorAudio;
    cancelAudioAnchorFade();
    state.audioAnchorQueue = [];
    state.pendingAudioAnchors.clear();
    state.audioAnchorAudio = null;
    state.activeAudioAnchorItem = null;
    state.audioAnchorFadeOutStarted = false;
    state.audioAnchorInterrupting = false;
    clearAudioAnchorElement(audio);

    if (resumeAmbiance) {
      resumeSuspendedAmbiance();
      return;
    }

    state.suspendedAmbiance = null;
    state.resumeAmbianceAfterAnchor = false;
  };

  showView = function (viewName) {
    syncArtbookNavButton();

    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("is-active", view.id === `${viewName}-view`);
    });

    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
    });

    if (viewName !== "reader") {
      cancelAudioAnchorPlayback(false);
      stopAmbiance();
    }
  };

  goToPage = function (pageIndex) {
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
  };
})();
