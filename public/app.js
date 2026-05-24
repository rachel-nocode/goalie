const state = {
  category: "all",
  intensity: 18,
  provider: "claude",
  providers: {},
  currentRequest: null,
  voterId: getVoterId(),
  feedbackTimeout: null,
  defaultFeedback: "Pulling trend signals…",
  activeBuildId: "",
  activeBuildJob: null,
  buildPoller: null,
  buildModalVisible: false,
};

const modeSettings = [
  {
    min: 0,
    max: 24,
    label: "Normal",
    copy: "Practical ideas that still feel current and sharp.",
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
};

void bootstrap();

async function bootstrap() {
  bindEvents();
  updateModeUI();
  renderBuildIdle();
  renderLoadingState();

  await loadHealth();
  await fetchIdeas();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => {
    fetchIdeas({ refresh: true });
  });

  elements.categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextCategory = button.dataset.category || "all";
      if (nextCategory === state.category) {
        return;
      }

      state.category = nextCategory;
      syncCategoryButtons();
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

  const providerNotes = [];
  for (const providerKey of ["claude", "codex"]) {
    const provider = state.providers[providerKey];
    if (!provider) {
      continue;
    }
    providerNotes.push(provider.available ? `${provider.label} ready.` : provider.detail);
  }

  elements.providerCopy.textContent =
    providerNotes.join(" ") || "This app can use your local Claude Code or Codex install.";
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

  setFeedback(refresh ? "Refreshing today’s batch…" : "Pulling trend signals…", { persist: true });

  try {
    const url = new URL("/api/ideas", window.location.origin);
    url.searchParams.set("category", state.category);
    url.searchParams.set("intensity", String(state.intensity));
    url.searchParams.set("provider", state.provider);
    if (refresh) {
      url.searchParams.set("refresh", "1");
    }

    const response = await fetch(url, {
      headers: {
        "X-Voter-Id": state.voterId,
      },
    });

    if (!response.ok) {
      throw new Error("The idea feed could not load.");
    }

    const payload = await response.json();
    if (state.currentRequest !== requestId) {
      return;
    }

    if (payload.providers) {
      state.providers = payload.providers;
      syncProviderButtons();
    }

    renderPayload(payload);
  } catch (error) {
    if (state.currentRequest !== requestId) {
      return;
    }

    renderError(error instanceof Error ? error.message : "The idea feed could not load.");
  }
}

function renderPayload(payload) {
  elements.generatedDate.textContent = payload.generatedDateLabel || "Today";
  const sectionPrefix = payload.category === "all" ? "Top trending ideas" : `${payload.categoryLabel} ideas`;
  elements.sectionTitle.textContent = `${sectionPrefix} for ${payload.intensityBand.toLowerCase()} mode`;
  elements.signalCountChip.textContent = `${payload.signalSummary.totalSignals} live signals`;
  elements.sourceCountChip.textContent = `${payload.signalSummary.topSources.length} active sources`;
  elements.modelChip.textContent = payload.providerLabel || "Backup ideas";
  if (payload.projectRoot) {
    elements.projectRootChip.textContent = `Builds in ${shortenPath(payload.projectRoot)}`;
  }
  setFeedback("Fresh ideas loaded.", { persist: true });

  renderIdeas(payload.ideas || [], payload);
}

function renderIdeas(ideas, payload) {
  elements.ideasGrid.replaceChildren();

  if (!ideas.length) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "No ideas showed up yet. Try another category or hit refresh.";
    elements.ideasGrid.append(empty);
    return;
  }

  ideas.forEach((idea, index) => {
    const card = document.createElement("article");
    card.className = "idea-card";
    card.style.setProperty("--rotation", `${index % 2 === 0 ? "-1.2deg" : "1.3deg"}`);

    const cardTop = document.createElement("div");
    cardTop.className = "idea-top";

    const sourceRow = document.createElement("div");
    sourceRow.className = "source-row";
    idea.sourceMix.forEach((source) => {
      const badge = document.createElement("span");
      badge.className = "source-badge";
      badge.textContent = source;
      sourceRow.append(badge);
    });

    const score = document.createElement("span");
    score.className = "score-pill";
    score.textContent = `${idea.trendScore}/100`;

    cardTop.append(sourceRow, score);

    const title = document.createElement("h3");
    title.textContent = idea.title;

    const ideaBlock = createCardSection("The idea", idea.idea);
    const whyBlock = createCardSection("The why", idea.why);
    const promptBlock = createCardSection("AI prompt", idea.starterPrompt, { prompt: true });

    const footer = document.createElement("div");
    footer.className = "idea-footer";

    const buildRow = createBuildRow(idea, payload);
    const voteRow = createVoteRow(idea);

    footer.append(buildRow, voteRow);
    card.append(cardTop, title, ideaBlock, whyBlock, promptBlock, footer);
    elements.ideasGrid.append(card);
  });
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

function createBuildRow(idea, payload) {
  const row = document.createElement("div");
  row.className = "build-row";

  const label = document.createElement("span");
  label.className = "vote-label";
  label.textContent = "Build";

  const button = document.createElement("button");
  button.className = "build-button";
  button.type = "button";
  button.textContent = "Build MVP";

  const currentProvider = state.providers[state.provider];
  if (!currentProvider?.available) {
    button.disabled = true;
    button.textContent = "Builder offline";
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Starting…";
    setFeedback("Starting local build…");

    try {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: state.provider,
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

      if (!response.ok) {
        throw new Error("The build could not be started.");
      }

      const job = await response.json();
      state.activeBuildId = job.id;
      state.activeBuildJob = job;
      setBuildModalVisible(true);
      renderBuildJob(job);
      startBuildPolling(job.id);
      flashFeedback("Build started.");
    } catch {
      flashFeedback("The build could not be started.");
      button.disabled = false;
      button.textContent = "Build MVP";
    }
  });

  row.append(label, button);
  return row;
}

function createVoteRow(idea) {
  const voteRow = document.createElement("div");
  voteRow.className = "vote-row";

  const voteLabel = document.createElement("span");
  voteLabel.className = "vote-label";
  voteLabel.textContent = "Vote";

  const voteCluster = document.createElement("div");
  voteCluster.className = "vote-cluster";

  const upvote = createVoteControl({
    active: idea.userVote === "up",
    count: idea.votes?.up || 0,
    direction: "up",
    label: "Upvote idea",
  });

  const downvote = createVoteControl({
    active: idea.userVote === "down",
    count: idea.votes?.down || 0,
    direction: "down",
    label: "Downvote idea",
  });

  const updateControls = () => {
    upvote.count.textContent = String(idea.votes?.up || 0);
    downvote.count.textContent = String(idea.votes?.down || 0);
    upvote.button.classList.toggle("is-active-up", idea.userVote === "up");
    downvote.button.classList.toggle("is-active-down", idea.userVote === "down");
    upvote.button.setAttribute("aria-pressed", String(idea.userVote === "up"));
    downvote.button.setAttribute("aria-pressed", String(idea.userVote === "down"));
  };

  const submitVote = async (direction, controls) => {
    controls.up.button.disabled = true;
    controls.down.button.disabled = true;
    setFeedback("Saving vote…");

    try {
      const response = await fetch("/api/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Voter-Id": state.voterId,
        },
        body: JSON.stringify({
          ideaId: idea.id,
          voterId: state.voterId,
          direction,
        }),
      });

      if (!response.ok) {
        throw new Error("Vote failed.");
      }

      const payload = await response.json();
      idea.votes = payload.votes;
      idea.userVote = payload.userVote;
      updateControls();
      flashFeedback("Vote saved.");
    } catch {
      flashFeedback("Vote could not be saved.");
    } finally {
      controls.up.button.disabled = false;
      controls.down.button.disabled = false;
    }
  };

  upvote.button.addEventListener("click", () => {
    const nextDirection = idea.userVote === "up" ? "clear" : "up";
    submitVote(nextDirection, { up: upvote, down: downvote });
  });

  downvote.button.addEventListener("click", () => {
    const nextDirection = idea.userVote === "down" ? "clear" : "down";
    submitVote(nextDirection, { up: upvote, down: downvote });
  });

  voteCluster.append(upvote.wrapper, downvote.wrapper);
  voteRow.append(voteLabel, voteCluster);
  updateControls();

  return voteRow;
}

function createVoteControl({ active, count, direction, label }) {
  const wrapper = document.createElement("div");
  wrapper.className = "vote-control";

  const button = document.createElement("button");
  button.className = "vote-button";
  button.type = "button";
  button.dataset.direction = direction;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(active));
  button.innerHTML = direction === "up" ? "&#128077;" : "&#128078;";

  const countLabel = document.createElement("span");
  countLabel.className = "vote-count";
  countLabel.textContent = String(count);

  wrapper.append(button, countLabel);

  return {
    wrapper,
    button,
    count: countLabel,
  };
}

function renderLoadingState() {
  elements.ideasGrid.innerHTML = "";

  for (let index = 0; index < 12; index += 1) {
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
  elements.buildModalTitle.textContent = "Starting build…";
  elements.buildModalCopy.textContent = "Creating a new project folder and waking up your local builder.";
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

function startBuildPolling(jobId) {
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
        flashFeedback(job.status === "completed" ? "Build finished." : "Build stopped with an error.");
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
      copy: "The first MVP finished building. Open the folder, run it locally, and inspect what the builder shipped.",
      markState: "completed",
      markGlyph: "✓",
      steps: buildStepsForStatus(job),
    };
  }

  if (job.status === "failed") {
    return {
      pill: "Needs help",
      title: `${job.ideaTitle} hit a snag`,
      copy: "The build stopped before the handoff. You can still open the folder and inspect the latest notes.",
      markState: "failed",
      markGlyph: "!",
      steps: buildStepsForStatus(job),
    };
  }

  if (job.status === "queued") {
    return {
      pill: "Starting…",
      title: `Starting ${job.ideaTitle}`,
      copy: `IdeaNibble created the project folder and is waking up ${job.providerLabel}.`,
      markState: "running",
      markGlyph: "",
      steps: buildStepsForStatus(job),
    };
  }

  return {
    pill: "Building…",
    title: `Building ${job.ideaTitle}`,
    copy: `${job.providerLabel} is writing the first MVP now. Keep this page open while the build finishes.`,
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

function shortenPath(fullPath) {
  return fullPath.replace(/^\/Users\/[^/]+/, "~");
}

function getVoterId() {
  const storageKey = "idea-machine-voter-id";

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue) {
      return storedValue;
    }

    const nextValue = createVoterId();
    window.localStorage.setItem(storageKey, nextValue);
    return nextValue;
  } catch {
    return createVoterId();
  }
}

function createVoterId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replace(/[^a-z0-9-]/gi, "").toLowerCase();
  }

  return `visitor-${Math.random().toString(36).slice(2, 12)}`;
}
