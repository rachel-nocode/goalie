const state = {
  category: "all",
  intensity: 18,
  provider: "claude",
  providers: {},
  currentRequest: null,
  ideaRevealTimer: null,
  feedbackTimeout: null,
  defaultFeedback: "Pulling trend signals…",
  activeBuildId: "",
  activeBuildJob: null,
  buildPoller: null,
  buildModalVisible: false,
  lastPayload: null,
  activeTab: "goals",
  savedCount: 0,
  savedItems: [],
};

const modeSettings = [
  {
    min: 0,
    max: 24,
    label: "Normal",
    copy: "Practical goals that still feel current and sharp.",
  },
  {
    min: 25,
    max: 49,
    label: "Fresh",
    copy: "Still realistic, but more distinct and more opinionated.",
  },
  {
    min: 50,
    max: 74,
    label: "Bold",
    copy: "Stronger mixes, stranger angles, and more memorable hooks.",
  },
  {
    min: 75,
    max: 100,
    label: "Crazy",
    copy: "Big swings, odd combinations, and ideas meant to stand out.",
  },
];

const elements = {
  generatedDate: document.querySelector("#generatedDate"),
  feedbackMessage: document.querySelector("#feedbackMessage"),
  ideasGrid: document.querySelector("#ideasGrid"),
  signalCountChip: document.querySelector("#signalCountChip"),
  sourceCountChip: document.querySelector("#sourceCountChip"),
  modelChip: document.querySelector("#modelChip"),
  projectRootChip: document.querySelector("#projectRootChip"),
  sectionTitle: document.querySelector("#sectionTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  pageTabs: [...document.querySelectorAll(".page-tab")],
  savedCount: document.querySelector("#savedCount"),
  intensityRange: document.querySelector("#intensityRange"),
  modeChip: document.querySelector("#modeChip"),
  modeCopy: document.querySelector("#modeCopy"),
  providerCopy: document.querySelector("#providerCopy"),
  categoryButtons: [...document.querySelectorAll("[data-category]")],
  providerButtons: [...document.querySelectorAll("[data-provider]")],
  buildModalBackdrop: document.querySelector("#buildModalBackdrop"),
  buildModalTitle: document.querySelector("#buildModalTitle"),
  buildModalCopy: document.querySelector("#buildModalCopy"),
  buildModalPill: document.querySelector("#buildModalPill"),
  buildModalMark: document.querySelector("#buildModalMark"),
  buildModalMarkCore: document.querySelector("#buildModalMarkCore"),
  buildModalSteps: document.querySelector("#buildModalSteps"),
  buildModalPath: document.querySelector("#buildModalPath"),
  buildModalLog: document.querySelector("#buildModalLogModal"),
  buildModalCloseButton: document.querySelector("#buildModalCloseButton"),
  buildModalOpenButton: document.querySelector("#buildModalOpenButton"),
  desktopBanner: document.querySelector("#desktopBanner"),
  desktopBannerTitle: document.querySelector("#desktopBannerTitle"),
  desktopBannerDetail: document.querySelector("#desktopBannerDetail"),
  desktopBannerDismiss: document.querySelector("#desktopBannerDismiss"),
};

void bootstrap();

async function bootstrap() {
  bindEvents();
  updateModeUI();
  renderBuildIdle();
  renderLoadingState();

  await loadHealth();
  await refreshSavedCount();
  await fetchIdeas();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    if (state.activeTab === "saved") {
      fetchSavedGoals();
      return;
    }

    fetchIdeas({ refresh: true });
  });

  elements.pageTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.dataset.view || "goals";
      if (nextTab === state.activeTab) {
        return;
      }

      switchTab(nextTab);
    });
  });

  elements.categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextCategory = button.dataset.category || "all";
      if (nextCategory === state.category) {
        return;
      }

      state.category = nextCategory;
      syncCategoryButtons();
      ensureGoalsTab();
      renderLoadingState();
      fetchIdeas();
    });
  });

  let sliderTimeout = null;
  elements.intensityRange.addEventListener("input", () => {
    state.intensity = Number(elements.intensityRange.value);
    updateModeUI();

    window.clearTimeout(sliderTimeout);
    sliderTimeout = window.setTimeout(() => {
      ensureGoalsTab();
      renderLoadingState();
      fetchIdeas();
    }, 250);
  });

  elements.providerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextProvider = button.dataset.provider || "claude";
      const providerMeta = state.providers[nextProvider];
      if (!providerMeta?.available || nextProvider === state.provider) {
        return;
      }

      state.provider = nextProvider;
      syncProviderButtons();
      ensureGoalsTab();
      renderLoadingState();
      fetchIdeas();
    });
  });

  elements.buildModalOpenButton.addEventListener("click", async () => {
    await openActiveProjectFolder();
  });

  elements.buildModalCloseButton.addEventListener("click", () => {
    if (!isBuildTerminal(state.activeBuildJob?.status)) {
      return;
    }

    setBuildModalVisible(false);
  });

  elements.buildModalBackdrop.addEventListener("click", (event) => {
    if (event.target !== elements.buildModalBackdrop || !isBuildTerminal(state.activeBuildJob?.status)) {
      return;
    }

    setBuildModalVisible(false);
  });

  elements.desktopBannerDismiss?.addEventListener("click", () => {
    hideDesktopBanner(true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.buildModalVisible || !isBuildTerminal(state.activeBuildJob?.status)) {
      return;
    }

    setBuildModalVisible(false);
  });
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    applyHealthPayload(payload);
  } catch {
    elements.providerCopy.textContent = "Local CLI status could not be checked yet.";
  }
}

function applyHealthPayload(payload) {
  state.providers = payload.providers || {};

  if (!state.providers[state.provider]?.available) {
    state.provider = payload.preferredProvider || firstAvailableProvider() || "claude";
  }

  syncProviderButtons();
  updateDesktopBanner(payload);

  const providerNotes = [];
  for (const providerKey of ["claude", "codex"]) {
    const provider = state.providers[providerKey];
    if (!provider) {
      continue;
    }
    providerNotes.push(provider.available ? `${provider.label} ready.` : provider.detail);
  }

  elements.providerCopy.textContent =
    providerNotes.join(" ") || "Goalie uses your local Claude Code or Codex install.";
  elements.projectRootChip.textContent = payload.projectRoot
    ? `Builds in ${shortenPath(payload.projectRoot)}`
    : "Build root unavailable";

  if (payload.latestBuildJob?.id) {
    state.activeBuildId = payload.latestBuildJob.id;
    state.activeBuildJob = payload.latestBuildJob;
    renderBuildJob(payload.latestBuildJob);
    if (!isBuildTerminal(payload.latestBuildJob.status)) {
      setBuildModalVisible(true);
    }
    startBuildPolling(payload.latestBuildJob.id);
  }
}

async function fetchIdeas({ refresh = false } = {}) {
  const requestId = Symbol("ideas");
  state.currentRequest = requestId;
  clearIdeaLoadingTimers();

  setFeedback(refresh ? "Refreshing today’s goals…" : "Pulling trend signals…", { persist: true });
  renderLoadingState(2);

  try {
    const previewPayload = await requestIdeas({ refresh, limit: 2 });
    if (state.currentRequest !== requestId) {
      return;
    }

    applyPayloadMeta(previewPayload);

    if (previewPayload.providers) {
      state.providers = previewPayload.providers;
      syncProviderButtons();
    }

    const previewCount = previewPayload.ideas?.length || 0;
    renderIdeas(previewPayload.ideas || [], previewPayload);

    if (previewPayload.partial && previewCount < (previewPayload.totalIdeas || 12)) {
      appendLoadingPlaceholders(2);
      setFeedback("First goals ready. Loading more…", { persist: true });
      void loadRemainingIdeas(requestId, { refresh, startIndex: previewCount });
      return;
    }

    if (previewCount < (previewPayload.totalIdeas || previewPayload.ideas?.length || previewCount)) {
      appendLoadingPlaceholders(2);
      revealRemainingIdeas(previewPayload, previewCount);
      return;
    }

    setFeedback("Fresh goals loaded.", { persist: true });
  } catch (error) {
    if (state.currentRequest !== requestId) {
      return;
    }

    renderError(error instanceof Error ? error.message : "The idea feed could not load.");
  }
}

function buildIdeasUrl({ refresh = false, limit = 12 } = {}) {
  const url = new URL("/api/ideas", window.location.origin);
  url.searchParams.set("category", state.category);
  url.searchParams.set("intensity", String(state.intensity));
  url.searchParams.set("provider", state.provider);
  url.searchParams.set("limit", String(limit));
  if (refresh) {
    url.searchParams.set("refresh", "1");
  }
  return url;
}

async function requestIdeas({ refresh = false, limit = 12 } = {}) {
  const response = await fetch(buildIdeasUrl({ refresh, limit }));

  if (!response.ok) {
    throw new Error("The idea feed could not load.");
  }

  return await response.json();
}

async function loadRemainingIdeas(requestId, { refresh = false, startIndex = 2 } = {}) {
  const maxAttempts = 90;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (state.currentRequest !== requestId) {
      return;
    }

    await sleep(attempt === 0 ? 1200 : 2000);

    try {
      const payload = await requestIdeas({ refresh: attempt === 0 ? refresh : false, limit: 12 });
      if (state.currentRequest !== requestId) {
        return;
      }

      applyPayloadMeta(payload);

      if (payload.providers) {
        state.providers = payload.providers;
        syncProviderButtons();
      }

      const totalIdeas = payload.totalIdeas || payload.ideas?.length || 0;
      const isComplete = !payload.partial && totalIdeas > startIndex;

      if (!isComplete) {
        if (payload.ideas?.length > startIndex) {
          replaceVisibleIdeas(payload.ideas.slice(0, payload.ideas.length), payload);
          startIndex = payload.ideas.length;
          setFeedback(`Loaded ${startIndex} of ${totalIdeas || 12} goals…`, { persist: true });
        }
        continue;
      }

      removeLoadingPlaceholders();
      revealRemainingIdeas(payload, startIndex);
      return;
    } catch {
      continue;
    }
  }

  if (state.currentRequest === requestId) {
    removeLoadingPlaceholders();
    setFeedback("Some goals are still loading. Try refresh.", { persist: true });
  }
}

function applyPayloadMeta(payload) {
  state.lastPayload = payload;
  elements.generatedDate.textContent = payload.generatedDateLabel || "Today";

  if (state.activeTab !== "goals") {
    return;
  }

  updateGoalsSectionTitle(payload);
  elements.signalCountChip.textContent = `${payload.signalSummary.totalSignals} live signals`;
  elements.sourceCountChip.textContent = `${payload.signalSummary.topSources.length} active sources`;
  elements.modelChip.textContent = payload.providerLabel || "Backup goals";
  if (payload.projectRoot) {
    elements.projectRootChip.textContent = `Builds in ${shortenPath(payload.projectRoot)}`;
  }
}

function revealRemainingIdeas(payload, startIndex = 2) {
  clearIdeaLoadingTimers();
  state.lastPayload = payload;
  applyPayloadMeta(payload);

  const ideas = payload.ideas || [];
  const initial = ideas.slice(0, startIndex);
  const remaining = ideas.slice(startIndex);

  renderIdeas(initial, payload);

  if (!remaining.length) {
    setFeedback("Fresh goals loaded.", { persist: true });
    return;
  }

  setFeedback(`Showing ${startIndex} of ${ideas.length} goals…`, { persist: true });
  appendLoadingPlaceholders(Math.min(2, remaining.length));

  let index = 0;
  const batchSize = 2;

  state.ideaRevealTimer = window.setInterval(() => {
    removeLoadingPlaceholders();

    const batch = remaining.slice(index, index + batchSize);
    if (!batch.length) {
      clearIdeaLoadingTimers();
      setFeedback("Fresh goals loaded.", { persist: true });
      return;
    }

    batch.forEach((idea, batchIndex) => {
      elements.ideasGrid.append(buildIdeaCard(idea, payload, startIndex + index + batchIndex));
    });

    index += batchSize;

    if (index < remaining.length) {
      appendLoadingPlaceholders(Math.min(2, remaining.length - index));
      setFeedback(`Showing ${startIndex + index} of ${ideas.length} goals…`, { persist: true });
    } else {
      clearIdeaLoadingTimers();
      setFeedback("Fresh goals loaded.", { persist: true });
    }
  }, 400);
}

function replaceVisibleIdeas(ideas, payload) {
  removeLoadingPlaceholders();
  renderIdeas(ideas, payload);
  appendLoadingPlaceholders(2);
}

function appendLoadingPlaceholders(count = 2) {
  removeLoadingPlaceholders();

  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("article");
    card.className = "idea-card skeleton-card is-loading-more";
    card.innerHTML = `
      <div class="skeleton-line short"></div>
      <div class="skeleton-line tall"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line medium"></div>
    `;
    elements.ideasGrid.append(card);
  }
}

function removeLoadingPlaceholders() {
  elements.ideasGrid.querySelectorAll(".is-loading-more").forEach((node) => node.remove());
}

function clearIdeaLoadingTimers() {
  if (state.ideaRevealTimer) {
    window.clearInterval(state.ideaRevealTimer);
    state.ideaRevealTimer = null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function renderPayload(payload) {
  applyPayloadMeta(payload);
  setFeedback("Fresh goals loaded.", { persist: true });
  renderIdeas(payload.ideas || [], payload);
}

function updateGoalsSectionTitle(payload) {
  const sectionPrefix = payload.category === "all" ? "Top trending goals" : `${payload.categoryLabel} goals`;
  elements.sectionTitle.textContent = `${sectionPrefix} for ${payload.intensityBand.toLowerCase()} mode`;
}

function switchTab(nextTab) {
  state.activeTab = nextTab;
  syncPageTabs();

  if (nextTab === "saved") {
    elements.sectionTitle.textContent = "Saved goals";
    setFeedback("Loading saved goals…", { persist: true });
    fetchSavedGoals();
    return;
  }

  if (state.lastPayload) {
    updateGoalsSectionTitle(state.lastPayload);
    setFeedback("Showing today’s goals.", { persist: true });
    renderIdeas(state.lastPayload.ideas || [], state.lastPayload);
    return;
  }

  renderLoadingState();
  fetchIdeas();
}

function ensureGoalsTab() {
  if (state.activeTab === "goals") {
    return;
  }

  state.activeTab = "goals";
  syncPageTabs();
}

function syncPageTabs() {
  elements.pageTabs.forEach((button) => {
    const isActive = button.dataset.view === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

async function refreshSavedCount() {
  try {
    const response = await fetch("/api/saved");
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    updateSavedCount(payload.items?.length || 0);
  } catch {
    updateSavedCount(0);
  }
}

function updateSavedCount(count) {
  state.savedCount = count;
  if (elements.savedCount) {
    elements.savedCount.textContent = String(count);
  }
}

async function fetchSavedGoals() {
  try {
    const response = await fetch("/api/saved");
    if (!response.ok) {
      throw new Error("Saved goals could not load.");
    }

    const payload = await response.json();
    state.savedItems = payload.items || [];
    updateSavedCount(state.savedItems.length);
    renderSavedGoals(state.savedItems);
    setFeedback(
      state.savedItems.length
        ? `${state.savedItems.length} saved goal${state.savedItems.length === 1 ? "" : "s"} ready.`
        : "No saved goals yet.",
      { persist: true },
    );
  } catch (error) {
    renderSavedError(error instanceof Error ? error.message : "Saved goals could not load.");
  }
}

function renderSavedGoals(items) {
  elements.ideasGrid.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent =
      "No saved goals yet. Browse today’s goals and tap the bookmark to save one for later.";
    elements.ideasGrid.append(empty);
    return;
  }

  items.forEach((entry, index) => {
    const payload = {
      categoryLabel: entry.context?.categoryLabel || "General",
      intensityBand: entry.context?.intensityBand || "Normal",
    };
    const idea = {
      ...entry.idea,
      saved: true,
    };

    elements.ideasGrid.append(buildIdeaCard(idea, payload, index, { fromSaved: true }));
  });
}

function renderSavedError(message) {
  elements.ideasGrid.replaceChildren();
  const empty = document.createElement("article");
  empty.className = "empty-state";
  empty.textContent = message;
  elements.ideasGrid.append(empty);
  setFeedback(message, { persist: true });
}

async function setGoalSaved(idea, payload, saved) {
  try {
    const response = await fetch("/api/saved", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ideaId: idea.id,
        saved,
        idea: {
          id: idea.id,
          title: idea.title,
          idea: idea.idea,
          why: idea.why,
          starterPrompt: idea.starterPrompt,
          sourceMix: idea.sourceMix || [],
          sourceTitles: idea.sourceTitles || [],
          trendScore: idea.trendScore,
        },
        context: {
          categoryLabel: payload.categoryLabel,
          intensityBand: payload.intensityBand,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    idea.saved = saved;
    updateSavedCount(result.count ?? state.savedCount);

    if (state.activeTab === "saved" && !saved) {
      state.savedItems = state.savedItems.filter((entry) => entry.idea?.id !== idea.id);
      renderSavedGoals(state.savedItems);
    }

    return result;
  } catch {
    return null;
  }
}

function renderIdeas(ideas, payload) {
  elements.ideasGrid.replaceChildren();

  if (!ideas.length) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "No goals showed up yet. Try another category or hit refresh.";
    elements.ideasGrid.append(empty);
    return;
  }

  ideas.forEach((idea, index) => {
    elements.ideasGrid.append(buildIdeaCard(idea, payload, index));
  });
}

function buildIdeaCard(idea, payload, index, { fromSaved = false } = {}) {
  const card = document.createElement("article");
  card.className = "idea-card";
  card.dataset.ideaId = idea.id;
  if (idea.completed) {
    card.classList.add("is-completed");
  }
  card.style.setProperty("--rotation", `${index % 2 === 0 ? "-1.2deg" : "1.3deg"}`);

  const cardTop = document.createElement("div");
  cardTop.className = "idea-top";

  const sourceRow = document.createElement("div");
  sourceRow.className = "source-row";
  (idea.sourceMix || []).forEach((source) => {
    const badge = document.createElement("span");
    badge.className = "source-badge";
    badge.textContent = source;
    sourceRow.append(badge);
  });

  const score = document.createElement("span");
  score.className = "score-pill";
  score.textContent = `${idea.trendScore || 0}/100`;

  cardTop.append(sourceRow, score);

  const title = document.createElement("h3");
  title.textContent = idea.title;

  const ideaBlock = createCardSection("The goal", idea.idea);
  const whyBlock = createCardSection("Why now", idea.why);
  const promptBlock = createCardSection("Starter prompt", idea.starterPrompt, { prompt: true });

  const footer = document.createElement("div");
  footer.className = "idea-footer";
  footer.append(createGoalActions(idea, payload, { fromSaved }));

  card.append(cardTop, title, ideaBlock, whyBlock, promptBlock, footer);
  return card;
}

function createCardSection(labelText, bodyText, { prompt = false } = {}) {
  const block = document.createElement("div");
  block.className = "idea-section";

  const label = document.createElement("p");
  label.className = "idea-section-label";
  label.textContent = labelText;

  const body = document.createElement("p");
  body.className = prompt ? "idea-prompt" : "idea-section-body";
  body.textContent = bodyText;

  block.append(label, body);
  return block;
}

function createGoalActions(idea, payload, { fromSaved = false } = {}) {
  const fragment = document.createDocumentFragment();

  if (idea.completed) {
    const actions = document.createElement("div");
    actions.className = "goal-actions";

    const builtPill = document.createElement("span");
    builtPill.className = "completed-pill";
    builtPill.textContent = idea.completed.source === "build" ? "Built ✓" : "Done ✓";

    const undoButton = document.createElement("button");
    undoButton.className = "ghost-button";
    undoButton.type = "button";
    undoButton.textContent = "Undo";
    undoButton.addEventListener("click", async () => {
      undoButton.disabled = true;
      const restored = await setGoalCompletion(idea.id, false);
      if (restored !== null) {
        idea.completed = null;
        refreshIdeaCard(idea, payload, { fromSaved });
        flashFeedback("Goal moved back to the board.");
      } else {
        undoButton.disabled = false;
        flashFeedback("Could not undo completion.");
      }
    });

    actions.append(builtPill, undoButton);
    fragment.append(actions);
    return fragment;
  }

  const actions = document.createElement("div");
  actions.className = "goal-actions";

  const startButton = document.createElement("button");
  startButton.className = "goal-start-button";
  startButton.type = "button";
  startButton.textContent = "Start goal";

  const saveButton = createSaveButton(idea, payload, { fromSaved });

  const secondary = document.createElement("div");
  secondary.className = "goal-secondary-actions";

  const markDoneButton = document.createElement("button");
  markDoneButton.className = "ghost-button";
  markDoneButton.type = "button";
  markDoneButton.textContent = "Mark done";
  markDoneButton.addEventListener("click", async () => {
    markDoneButton.disabled = true;
    startButton.disabled = true;
    saveButton.disabled = true;
    const marked = await setGoalCompletion(idea.id, true, { source: "manual" });
    if (marked?.completed) {
      idea.completed = marked.completed;
      refreshIdeaCard(idea, payload, { fromSaved });
      flashFeedback("Goal checked off.");
    } else {
      markDoneButton.disabled = false;
      startButton.disabled = false;
      saveButton.disabled = false;
      flashFeedback("Could not mark goal done.");
    }
  });

  const currentProvider = state.providers[state.provider];
  if (!currentProvider?.available) {
    startButton.disabled = true;
    startButton.textContent = "Agent offline";
  }

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    markDoneButton.disabled = true;
    saveButton.disabled = true;
    startButton.textContent = "Starting…";
    setFeedback("Starting goal in your local agent…");

    try {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: state.provider,
          ideaId: idea.id,
          categoryLabel: payload.categoryLabel,
          intensityLabel: payload.intensityBand,
          idea: {
            title: idea.title,
            idea: idea.idea,
            why: idea.why,
            starterPrompt: idea.starterPrompt,
            sourceTitles: idea.sourceTitles || [],
          },
        }),
      });

      const jobPayload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(jobPayload.error || "The build could not be started.");
      }

      const job = jobPayload;
      state.activeBuildId = job.id;
      state.activeBuildJob = job;
      startButton.textContent = "Building…";
      setBuildModalVisible(true);
      renderBuildJob(job);
      startBuildPolling(job.id, idea, payload, startButton, markDoneButton, saveButton, { fromSaved });
    } catch (error) {
      flashFeedback(error instanceof Error ? error.message : "The goal could not be started.");
      startButton.disabled = false;
      markDoneButton.disabled = false;
      saveButton.disabled = false;
      startButton.textContent = "Start goal";
    }
  });

  actions.append(startButton, saveButton);
  secondary.append(markDoneButton);
  fragment.append(actions, secondary);
  return fragment;
}

function createSaveButton(idea, payload, { fromSaved = false } = {}) {
  const saveButton = document.createElement("button");
  saveButton.className = "goal-save-button";
  saveButton.type = "button";
  saveButton.setAttribute("aria-label", idea.saved ? "Remove saved goal" : "Save goal for later");
  saveButton.setAttribute("aria-pressed", String(Boolean(idea.saved)));
  saveButton.innerHTML = bookmarkIcon(Boolean(idea.saved));
  saveButton.classList.toggle("is-saved", Boolean(idea.saved));

  saveButton.addEventListener("click", async () => {
    const nextSaved = !idea.saved;
    saveButton.disabled = true;
    const result = await setGoalSaved(idea, payload, nextSaved);

    if (result) {
      saveButton.classList.toggle("is-saved", nextSaved);
      saveButton.setAttribute("aria-label", nextSaved ? "Remove saved goal" : "Save goal for later");
      saveButton.setAttribute("aria-pressed", String(nextSaved));
      saveButton.innerHTML = bookmarkIcon(nextSaved);
      flashFeedback(nextSaved ? "Goal saved for later." : "Removed from saved goals.");
    } else {
      flashFeedback("Could not update saved goal.");
    }

    saveButton.disabled = false;
  });

  return saveButton;
}

function bookmarkIcon(filled) {
  if (filled) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 2h12a2 2 0 0 1 2 2v18l-8-5-8 5V4a2 2 0 0 1 2-2z"/></svg>`;
  }

  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M6 3h12a2 2 0 0 1 2 2v16l-8-5-8 5V5a2 2 0 0 1 2-2z"/></svg>`;
}

function refreshIdeaCard(idea, payload, { fromSaved = false } = {}) {
  const card = elements.ideasGrid.querySelector(`[data-idea-id="${CSS.escape(idea.id)}"]`);
  if (!card) {
    return;
  }

  card.classList.toggle("is-completed", Boolean(idea.completed));

  const footer = card.querySelector(".idea-footer");
  if (!footer) {
    return;
  }

  footer.replaceChildren(createGoalActions(idea, payload, { fromSaved }));
}

async function setGoalCompletion(ideaId, completed, { source = "manual", projectDir = "" } = {}) {
  try {
    const response = await fetch("/api/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ideaId,
        completed,
        source,
        projectDir,
      }),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

function renderLoadingState(count = 2) {
  clearIdeaLoadingTimers();
  elements.ideasGrid.innerHTML = "";

  for (let index = 0; index < count; index += 1) {
    const card = document.createElement("article");
    card.className = "idea-card skeleton-card";
    card.innerHTML = `
      <div class="skeleton-line short"></div>
      <div class="skeleton-line tall"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line medium"></div>
    `;
    elements.ideasGrid.append(card);
  }
}

function renderError(message) {
  elements.generatedDate.textContent = "Unavailable";
  elements.signalCountChip.textContent = "Signal error";
  elements.sourceCountChip.textContent = "Try refresh";
  elements.modelChip.textContent = "Feed offline";
  setFeedback(message, { persist: true });

  elements.ideasGrid.replaceChildren();
  const card = document.createElement("article");
  card.className = "empty-state";
  card.textContent = `${message} Try the refresh button in a second.`;
  elements.ideasGrid.append(card);
}

function renderBuildIdle() {
  elements.buildModalTitle.textContent = "Starting goal…";
  elements.buildModalCopy.textContent = "Creating a new project folder and waking up your local agent.";
  elements.buildModalPill.textContent = "Starting…";
  elements.buildModalPath.textContent = "Waiting for the first build path.";
  elements.buildModalLog.textContent = "No build logs yet.";
  elements.buildModalSteps.replaceChildren();
  setBuildModalMark("running");
  elements.buildModalCloseButton.disabled = true;
  elements.buildModalCloseButton.textContent = "Working…";
  elements.buildModalOpenButton.disabled = true;
}

function renderBuildJob(job) {
  state.activeBuildJob = job;
  renderBuildModal(job);

  if (!isBuildTerminal(job.status)) {
    setBuildModalVisible(true);
  }
}

function startBuildPolling(
  jobId,
  idea = null,
  payload = null,
  startButton = null,
  markDoneButton = null,
  saveButton = null,
  { fromSaved = false } = {},
) {
  if (!jobId) {
    return;
  }

  state.activeBuildId = jobId;
  window.clearInterval(state.buildPoller);
  state.buildPoller = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/build-status?id=${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        return;
      }

      const job = await response.json();
      renderBuildJob(job);

      if (job.status === "completed" || job.status === "failed") {
        window.clearInterval(state.buildPoller);
        state.buildPoller = null;

        if (job.status === "completed") {
          flashFeedback("Goal finished.");

          const targetIdeaId = job.ideaId || idea?.id;
          if (targetIdeaId && state.lastPayload) {
            const marked = await setGoalCompletion(targetIdeaId, true, {
              source: "build",
              projectDir: job.projectDir || "",
            });

            if (marked?.completed) {
              const boardIdea =
                idea ||
                state.lastPayload.ideas?.find((entry) => entry.id === targetIdeaId) ||
                { id: targetIdeaId, completed: marked.completed };

              boardIdea.completed = marked.completed;
              refreshIdeaCard(boardIdea, payload || state.lastPayload || {}, { fromSaved });
            }
          }
        } else {
          flashFeedback("Goal stopped with an error.");
          if (startButton) {
            startButton.disabled = false;
            startButton.textContent = "Start goal";
          }
          if (markDoneButton) {
            markDoneButton.disabled = false;
          }
          if (saveButton) {
            saveButton.disabled = false;
          }
        }
      }
    } catch {
      return;
    }
  }, 2500);
}

function renderBuildModal(job) {
  const modalView = describeBuildJob(job);

  elements.buildModalPill.textContent = modalView.pill;
  elements.buildModalTitle.textContent = modalView.title;
  elements.buildModalCopy.textContent = modalView.copy;
  elements.buildModalPath.textContent = job.projectDir || "Project path unavailable.";
  elements.buildModalLog.textContent = formatBuildLogs(job.logs);
  renderBuildSteps(modalView.steps);
  setBuildModalMark(modalView.markState, modalView.markGlyph);

  const canClose = isBuildTerminal(job.status);
  const canOpenProject = Boolean(job.projectDir) && canClose;

  elements.buildModalCloseButton.disabled = !canClose;
  elements.buildModalCloseButton.textContent = canClose ? "Close" : "Working…";
  elements.buildModalOpenButton.disabled = !canOpenProject;
}

function renderBuildSteps(steps) {
  elements.buildModalSteps.replaceChildren();

  steps.forEach((step) => {
    const item = document.createElement("article");
    item.className = `build-step is-${step.state}`;

    const bullet = document.createElement("div");
    bullet.className = "build-step-bullet";
    bullet.textContent = step.state === "complete" ? "✓" : step.state === "failed" ? "!" : "";

    const copy = document.createElement("div");
    copy.className = "build-step-copy";

    const label = document.createElement("p");
    label.className = "build-step-title";
    label.textContent = step.label;

    const detail = document.createElement("p");
    detail.className = "build-step-detail";
    detail.textContent = step.detail;

    copy.append(label, detail);
    item.append(bullet, copy);
    elements.buildModalSteps.append(item);
  });
}

function describeBuildJob(job) {
  if (job.status === "completed") {
    return {
      pill: "Done",
      title: `${job.ideaTitle} is ready`,
      copy: "Your agent finished the first pass. Open the folder, run it locally, and inspect what shipped.",
      markState: "completed",
      markGlyph: "✓",
      steps: buildStepsForStatus(job),
    };
  }

  if (job.status === "failed") {
    return {
      pill: "Needs help",
      title: `${job.ideaTitle} hit a snag`,
      copy: "The goal stopped before handoff. You can still open the folder and inspect the latest notes.",
      markState: "failed",
      markGlyph: "!",
      steps: buildStepsForStatus(job),
    };
  }

  if (job.status === "queued") {
    return {
      pill: "Starting…",
      title: `Starting ${job.ideaTitle}`,
      copy: `Goalie created the project folder and is waking up ${job.providerLabel}.`,
      markState: "running",
      markGlyph: "",
      steps: buildStepsForStatus(job),
    };
  }

  return {
    pill: "Building…",
    title: `Building ${job.ideaTitle}`,
    copy: `${job.providerLabel} is working on this goal now. Watch live output in the Terminal window Goalie opened.`,
    markState: "running",
    markGlyph: "",
    steps: buildStepsForStatus(job),
  };
}

function buildStepsForStatus(job) {
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";
  const isQueued = job.status === "queued";
  const builderState = isDone ? "complete" : isFailed ? "failed" : "active";

  return [
    {
      state: "complete",
      label: "Project folder ready",
      detail: job.projectDir ? shortenPath(job.projectDir) : "Fresh workspace created for this MVP.",
    },
    {
      state: builderState,
      label: `${job.providerLabel} in control`,
      detail: isQueued
        ? "Connecting to the local builder and preparing the first files."
        : isFailed
          ? "The builder stopped before the final handoff."
          : "Writing the first version of the product inside that folder.",
    },
    {
      state: isDone ? "complete" : isFailed ? "pending" : "pending",
      label: "Ready to open",
      detail: isDone
        ? "The first pass is done and ready for you to inspect."
        : "This step flips on when the build is ready to open.",
    },
  ];
}

function setBuildModalMark(state, glyph = "") {
  elements.buildModalMark.dataset.state = state;
  elements.buildModalMarkCore.classList.toggle("is-spinner", state === "running");
  elements.buildModalMarkCore.textContent = state === "running" ? "" : glyph;
}

function setBuildModalVisible(visible) {
  state.buildModalVisible = visible;
  elements.buildModalBackdrop.classList.toggle("is-visible", visible);
  elements.buildModalBackdrop.setAttribute("aria-hidden", String(!visible));
  document.body.classList.toggle("has-build-modal", visible);
}

function buildStatusMeta(job) {
  if (job.status === "completed") {
    return `${job.providerLabel} finished the first pass for this MVP.`;
  }

  if (job.status === "failed") {
    return `${job.providerLabel} stopped before finishing this build.`;
  }

  return `${job.providerLabel} is working in a fresh project folder.`;
}

function formatBuildLogs(logs) {
  return logs?.length ? logs.slice(-8).join("\n") : "Waiting for build logs…";
}

async function openActiveProjectFolder() {
  if (!state.activeBuildId) {
    return;
  }

  try {
    const response = await fetch("/api/open-project", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId: state.activeBuildId,
      }),
    });

    if (!response.ok) {
      throw new Error("The project folder could not be opened.");
    }

    flashFeedback("Project folder opened.");
  } catch {
    flashFeedback("The project folder could not be opened.");
  }
}

function isBuildTerminal(status) {
  return status === "completed" || status === "failed";
}

function syncCategoryButtons() {
  elements.categoryButtons.forEach((pill) => {
    const active = pill.dataset.category === state.category;
    pill.classList.toggle("is-active", active);
    pill.setAttribute("aria-pressed", String(active));
  });
}

function syncProviderButtons() {
  elements.providerButtons.forEach((button) => {
    const providerKey = button.dataset.provider || "";
    const providerMeta = state.providers[providerKey];
    const active = providerKey === state.provider;
    const available = providerMeta?.available !== false;

    button.classList.toggle("is-active", active);
    button.classList.toggle("is-disabled", !available);
    button.disabled = !available;
    button.setAttribute("aria-pressed", String(active));
    button.title = providerMeta?.detail || "";
  });
}

function updateModeUI() {
  const current = modeSettings.find(
    (setting) => state.intensity >= setting.min && state.intensity <= setting.max,
  );
  elements.modeChip.textContent = current.label;
  elements.modeCopy.textContent = current.copy;
  document.documentElement.style.setProperty("--slider-value", `${state.intensity}%`);
}

function setFeedback(message, { persist = false } = {}) {
  if (persist) {
    state.defaultFeedback = message;
  }

  elements.feedbackMessage.textContent = message;
}

function flashFeedback(message) {
  window.clearTimeout(state.feedbackTimeout);
  setFeedback(message);
  state.feedbackTimeout = window.setTimeout(() => {
    elements.feedbackMessage.textContent = state.defaultFeedback;
  }, 1400);
}

function firstAvailableProvider() {
  return ["claude", "codex"].find((key) => state.providers[key]?.available) || "";
}

function updateDesktopBanner(payload) {
  if (!payload.desktopMode || !elements.desktopBanner) {
    return;
  }

  if (window.localStorage.getItem("goalie-desktop-banner-dismissed") === "1") {
    hideDesktopBanner(false);
    return;
  }

  const readyAgents = ["claude", "codex"].filter((key) => payload.providers?.[key]?.available);
  const missingAgents = ["claude", "codex"].filter((key) => payload.providers?.[key] && !payload.providers[key].available);

  if (readyAgents.length) {
    const labels = readyAgents.map((key) => payload.providers[key].label);
    elements.desktopBannerTitle.textContent =
      labels.length === 2 ? "Claude Code and Codex are ready" : `${labels[0]} is ready`;
    elements.desktopBannerDetail.textContent = `Projects build into ${shortenPath(payload.projectRoot || "~/Goalie Projects")} using your existing subscription.`;
  } else {
    elements.desktopBannerTitle.textContent = "Install a local agent to start building";
    elements.desktopBannerDetail.textContent =
      missingAgents.map((key) => payload.providers[key].detail).join(" ") ||
      "Install Claude Code or Codex CLI, then reopen Goalie.";
  }

  elements.desktopBanner.classList.remove("is-hidden");
}

function hideDesktopBanner(persist) {
  if (!elements.desktopBanner) {
    return;
  }

  elements.desktopBanner.classList.add("is-hidden");

  if (persist) {
    try {
      window.localStorage.setItem("goalie-desktop-banner-dismissed", "1");
    } catch {
      // Ignore storage failures.
    }
  }
}

function shortenPath(fullPath) {
  return fullPath.replace(/^\/Users\/[^/]+/, "~");
}
