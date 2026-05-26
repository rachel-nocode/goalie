import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const buildJobs = new Map();
const IDEA_COUNT = 12;

export async function getLocalProviderState(rootDir) {
  const providers = {
    claude: await getClaudeStatus(),
    codex: await getCodexStatus(rootDir),
  };

  return {
    desktopMode: process.env.GOALIE_DESKTOP === "1",
    preferredProvider: providers.claude.available ? "claude" : providers.codex.available ? "codex" : null,
    projectRoot: getProjectRoot(),
    providers,
  };
}

export async function generateIdeasWithLocalCli({
  rootDir,
  provider,
  categoryName,
  intensityValue,
  intensityBand,
  signals,
}) {
  const providerState = await getLocalProviderState(rootDir);
  const selectedProvider = chooseProvider(provider, providerState);

  if (!selectedProvider) {
    return {
      ideas: [],
      provider: null,
      warning: "No local Claude or Codex setup is ready yet, so the app used backup ideas.",
    };
  }

  const prompt = buildIdeaPrompt({
    categoryName,
    intensityValue,
    intensityBand,
    signals,
  });

  const attempts = [selectedProvider];
  for (const candidate of ["claude", "codex"]) {
    if (!attempts.includes(candidate) && providerState.providers[candidate]?.available) {
      attempts.push(candidate);
    }
  }

  for (const candidate of attempts) {
    const rawIdeas =
      candidate === "claude"
        ? await requestClaudeIdeas({ prompt, cwd: rootDir })
        : await requestCodexIdeas({ prompt, cwd: rootDir, rootDir });

    if (!rawIdeas.length) {
      continue;
    }

    return {
      ideas: rawIdeas
        .map((idea, index) =>
          normalizeIdea({
            title: idea.title,
            idea: idea.idea || idea.description,
            why: idea.why || idea.whyNow,
            starterPrompt: idea.starterPrompt || idea.goToMarket,
            sourceMix: Array.isArray(idea.sourceMix) ? idea.sourceMix : inferSources(signals.slice(index, index + 2)),
            trendScore: idea.trendScore,
            wildness: idea.wildness,
            signals: [signals[index % signals.length], signals[(index + 2) % signals.length]].filter(Boolean),
          }),
        )
        .slice(0, IDEA_COUNT),
      provider: candidate,
      warning:
        candidate !== selectedProvider
          ? `${providerState.providers[selectedProvider].label} did not return ideas, so the app fell back to ${providerState.providers[candidate].label}.`
          : null,
    };
  }

  return {
    ideas: [],
    provider: null,
    warning: `${providerState.providers[selectedProvider].label} could not return ideas right now, so the app used backup ideas.`,
  };
}

export async function startLocalBuild({
  rootDir,
  provider,
  ideaId,
  idea,
  categoryLabel,
  intensityLabel,
}) {
  const providerState = await getLocalProviderState(rootDir);
  const selectedProvider = chooseProvider(provider, providerState);

  if (!selectedProvider) {
    throw new Error("No local Claude or Codex setup is ready for builds.");
  }

  const projectRoot = getProjectRoot();
  mkdirSync(projectRoot, { recursive: true });

  const slugBase = slugify(idea.title || "tiny-mvp-project") || "tiny-mvp-project";
  const projectSlug = `${slugBase}-${Date.now().toString(36).slice(-5)}`;
  const projectDir = path.join(projectRoot, projectSlug);
  mkdirSync(projectDir, { recursive: true });

  const briefPath = path.join(projectDir, "idea-brief.md");
  const brief = [
    `# ${idea.title || "Untitled idea"}`,
    "",
    `Category: ${categoryLabel || "General"}`,
    `Build mode: ${intensityLabel || "Normal"}`,
    `Builder: ${providerState.providers[selectedProvider].label}`,
    "",
    "## The idea",
    idea.idea || "",
    "",
    "## The why",
    idea.why || "",
    "",
    "## AI prompt",
    idea.starterPrompt || "",
    "",
    "## Trend signals",
    ...(idea.sourceTitles || []).map((item) => `- ${item}`),
  ].join("\n");
  await fs.writeFile(briefPath, brief, "utf8");

  const job = {
    id: `build_${randomUUID()}`,
    ideaId: ideaId || "",
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: selectedProvider,
    providerLabel: providerState.providers[selectedProvider].label,
    projectDir,
    projectSlug,
    ideaTitle: cleanSentence(idea.title) || "Untitled idea",
    logs: [
      `Project folder created at ${projectDir}`,
      `Using ${providerState.providers[selectedProvider].label}`,
      "Writing idea brief and starting build agent…",
    ],
    summary: "",
    error: "",
  };

  buildJobs.set(job.id, job);
  void runBuildJob({ rootDir, job, idea });

  return serializeJob(job);
}

export function getBuildJob(jobId) {
  const job = buildJobs.get(jobId);
  return job ? serializeJob(job) : null;
}

export function getLatestBuildJob() {
  const latest = [...buildJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? serializeJob(latest) : null;
}

export async function openBuildProject(jobId) {
  const job = buildJobs.get(jobId);
  if (!job) {
    return false;
  }

  const opener = spawn("open", [job.projectDir], {
    stdio: "ignore",
    detached: true,
  });
  opener.unref();
  return true;
}

async function runBuildJob({ rootDir, job, idea }) {
  setJobState(job, "running");
  appendJobLog(job, `Build started for "${job.ideaTitle}".`);

  job.logPath = path.join(job.projectDir, ".goalie-build.log");
  await fs.writeFile(job.logPath, `Goalie build log for ${job.ideaTitle}\n\n`, "utf8");
  openBuildLogTerminal(job.projectDir, job.logPath, job.providerLabel);

  const prompt = buildProjectPrompt({ idea, projectDir: job.projectDir });

  try {
    let result;

    if (job.provider === "claude") {
      const claudePath = findCommandPath("claude");
      if (!claudePath) {
        throw new Error("Claude Code is not installed.");
      }

      result = await runProcess(claudePath, [
        "-p",
        "--model",
        "sonnet",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        job.projectDir,
        "--",
        prompt,
      ], {
        cwd: job.projectDir,
        env: {
          ...process.env,
          PATH: getAugmentedPath(),
        },
        onStdout: (line) => appendJobLog(job, line),
        onStderr: (line) => appendJobLog(job, line),
      });

      job.summary = cleanSentence(result.stdout);
    } else {
      const codexPath = findCommandPath("codex");
      if (!codexPath) {
        throw new Error("Codex CLI is not installed.");
      }

      const codexHome = await ensureCodexHome(rootDir);
      const lastMessageFile = path.join(job.projectDir, ".codex-last-message.txt");

      result = await runProcess(codexPath, [
        "exec",
        "--skip-git-repo-check",
        "--output-last-message",
        lastMessageFile,
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        job.projectDir,
        prompt,
      ], {
        cwd: job.projectDir,
        env: {
          ...process.env,
          PATH: getAugmentedPath(),
          HOME: codexHome,
        },
        onStdout: (line) => appendCodexLog(job, line),
        onStderr: (line) => appendJobLog(job, line),
      });

      job.summary = cleanSentence(await safeReadFile(lastMessageFile));
    }

    job.updatedAt = new Date().toISOString();

    if (result.exitCode !== 0) {
      job.status = "failed";
      job.error = `Build command exited with code ${result.exitCode}.`;
      appendJobLog(job, job.error);
      return;
    }

    job.status = "completed";
    appendJobLog(job, "Build finished. Open the project folder to inspect the result.");
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unknown build error.";
    appendJobLog(job, job.error);
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

function openBuildLogTerminal(projectDir, logPath, providerLabel) {
  const tailCommand = [
    `cd ${shellQuote(projectDir)}`,
    `printf '%s\\n\\n' "Goalie: ${providerLabel} is building this project. Live logs below."`,
    `tail -n 50 -f ${shellQuote(logPath)}`,
  ].join(" && ");

  const script = [
    'tell application "Terminal"',
    "  activate",
    `  do script ${JSON.stringify(tailCommand)}`,
    "end tell",
  ].join("\n");

  const child = spawn("osascript", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

function getAugmentedPath() {
  const parts = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extras = [
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];

  for (const entry of extras) {
    if (!parts.includes(entry)) {
      parts.push(entry);
    }
  }

  return parts.join(path.delimiter);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function getClaudeStatus() {
  const commandPath = findCommandPath("claude");

  return {
    key: "claude",
    label: "Claude Code",
    available: Boolean(commandPath),
    detail: commandPath ? "Ready for local idea generation and project builds." : "Claude Code is not installed.",
  };
}

async function getCodexStatus(rootDir) {
  const commandPath = findCommandPath("codex");
  const authPath = path.join(os.homedir(), ".codex", "auth.json");
  const authReady = existsSync(authPath);

  if (!commandPath) {
    return {
      key: "codex",
      label: "Codex CLI",
      available: false,
      detail: "Codex CLI is not installed.",
    };
  }

  if (!authReady) {
    return {
      key: "codex",
      label: "Codex CLI",
      available: false,
      detail: "Codex CLI is installed, but no local login was found.",
    };
  }

  await ensureCodexHome(rootDir);

  return {
    key: "codex",
    label: "Codex CLI",
    available: true,
    detail: "Ready through a clean Goalie Codex runtime.",
  };
}

function chooseProvider(requestedProvider, providerState) {
  if (requestedProvider === "claude" && providerState.providers.claude.available) {
    return "claude";
  }

  if (requestedProvider === "codex" && providerState.providers.codex.available) {
    return "codex";
  }

  return providerState.preferredProvider;
}

async function requestClaudeIdeas({ prompt, cwd }) {
  try {
    const result = await runProcess("claude", [
      "-p",
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--permission-mode",
      "bypassPermissions",
      "--add-dir",
      cwd,
      "--",
      prompt,
    ], {
      cwd,
      timeoutMs: 120000,
    });

    if (result.exitCode !== 0) {
      return [];
    }

    const payload = safeParseJson(result.stdout);
    const rawContent = payload?.result || payload?.content?.[0]?.text || result.stdout;
    const parsed = safeParseJson(rawContent);
    return Array.isArray(parsed?.ideas) ? parsed.ideas : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function requestCodexIdeas({ prompt, cwd, rootDir }) {
  try {
    const codexHome = await ensureCodexHome(rootDir);
    const tempFile = path.join(os.tmpdir(), `goalie-codex-${randomUUID()}.txt`);

    const result = await runProcess("codex", [
      "exec",
      "--skip-git-repo-check",
      "--output-last-message",
      tempFile,
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      cwd,
      prompt,
    ], {
      cwd,
      env: {
        ...process.env,
        HOME: codexHome,
      },
      timeoutMs: 120000,
    });

    if (result.exitCode !== 0) {
      return [];
    }

    const content = await safeReadFile(tempFile);
    const parsed = safeParseJson(content);
    return Array.isArray(parsed?.ideas) ? parsed.ideas : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildIdeaPrompt({ categoryName, intensityValue, intensityBand, signals }) {
  const signalLines = signals
    .slice(0, 12)
    .map(
      (signal, index) =>
        `${index + 1}. [${signal.sourceLabel}] ${signal.title} | ${signal.summary} | ${signal.url}`,
    )
    .join("\n");

  return [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Create ${IDEA_COUNT} startup ideas for the ${categoryName} category.`,
    `Slider intensity: ${intensityValue}/100 (${intensityBand.label}). ${intensityBand.promptStyle}`,
    "Every idea must feel specific, timely, and directly tied to the trend signals.",
    "Avoid generic filler like vague dashboards, vague assistants, or copycat wrappers.",
    "Each idea must name a clear user, a painful job to be done, and a sharp product wedge.",
    "Make the writing simple enough for a beginner to scan fast.",
    'Write the idea line in this format: "For [buyer], this [product] ..."',
    "The why must be no more than 2 short sentences.",
    'The starter prompt must be short, begin with "Build", and be useful for vibe coding a first version.',
    "Title rules: 2 to 5 words. Do not use these title words anywhere: AI, SaaS, App, Tool, Platform, Marketplace, Assistant, Dashboard, Solution, Consultant, Specialist, Optimizer, Tracker, Engine.",
    "Bad idea example: AI SEO Auditor for websites.",
    "Good idea example: SERP Drop Triage for agencies, which watches post-update ranking losses and drafts the first recovery brief page by page.",
    "Bad idea example: SaaS benchmarking platform.",
    "Good idea example: Renewal Leak Finder for finance teams, which reads SaaS invoices and flags quiet price creep before renewal calls.",
    "Return JSON only with this shape:",
    '{"ideas":[{"title":"","idea":"","why":"","starterPrompt":"","sourceMix":[""],"trendScore":0,"wildness":0}]}',
    "Trend signals:",
    signalLines,
  ].join("\n");
}

function buildProjectPrompt({ idea, projectDir }) {
  return [
    "You are building a first working MVP inside the current directory.",
    `Current project folder: ${projectDir}`,
    "Do not ask questions. Make reasonable product and stack choices yourself.",
    "Default to a web MVP unless the idea clearly demands something else.",
    "Keep the scope focused on one clear workflow that proves the product wedge.",
    "Create a README with what the product does, how to run it, and what is unfinished.",
    "If dependencies are needed, install them and leave the project runnable.",
    "Use clean file names and practical defaults. Avoid overengineering.",
    "Goal title:",
    idea.title || "",
    "The goal:",
    idea.idea || "",
    "Why now:",
    idea.why || "",
    "Starter prompt:",
    idea.starterPrompt || "",
    "Trend signal notes:",
    ...(idea.sourceTitles || []),
    "When you finish, reply with a short summary, the exact run command, and the main files created.",
  ].join("\n");
}

async function ensureCodexHome(rootDir) {
  const homeRoot = path.join(rootDir, ".cache", "codex-home");
  const codexDir = path.join(homeRoot, ".codex");
  const sourceAuth = path.join(os.homedir(), ".codex", "auth.json");
  const targetAuth = path.join(codexDir, "auth.json");
  const configPath = path.join(codexDir, "config.toml");

  mkdirSync(codexDir, { recursive: true });

  if (existsSync(sourceAuth)) {
    await fs.copyFile(sourceAuth, targetAuth);
  }

  const config = [
    'model = "gpt-5.2"',
    'model_reasoning_effort = "medium"',
    'model_verbosity = "low"',
    'web_search = "off"',
    "",
  ].join("\n");

  await fs.writeFile(configPath, config, "utf8");
  return homeRoot;
}

function getProjectRoot() {
  return path.join(os.homedir(), "Goalie Projects");
}

function findCommandPath(command) {
  const pathValue = process.env.PATH || "";
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const part of pathValue.split(path.delimiter)) {
    if (!part) {
      continue;
    }

    for (const extension of extensions) {
      const fullPath = path.join(part, `${command}${extension}`);
      try {
        accessSync(fullPath, fsConstants.X_OK);
        return fullPath;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function appendJobLog(job, message) {
  if (!message) {
    return;
  }

  const lines = String(message)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    job.logs.push(line);
  }

  job.logs = job.logs.slice(-140);
  job.updatedAt = new Date().toISOString();

  if (job.logPath) {
    void fs.appendFile(job.logPath, `${lines.join("\n")}\n`, "utf8").catch(() => {});
  }
}

function appendCodexLog(job, chunk) {
  const lines = String(chunk)
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) =>
      line.includes("[202") ||
      line.startsWith("exec ") ||
      line.includes("succeeded in") ||
      line.includes("failed in") ||
      line.includes("turn diff") ||
      line.startsWith("diff --git") ||
      line.includes("tokens used") ||
      line.startsWith("ERROR") ||
      line.startsWith("Warning:"),
    );

  if (!lines.length) {
    return;
  }

  appendJobLog(job, lines.join("\n"));
}

function setJobState(job, nextState) {
  job.status = nextState;
  job.updatedAt = new Date().toISOString();
}

function serializeJob(job) {
  return {
    id: job.id,
    ideaId: job.ideaId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    provider: job.provider,
    providerLabel: job.providerLabel,
    projectDir: job.projectDir,
    projectSlug: job.projectSlug,
    ideaTitle: job.ideaTitle,
    logs: job.logs.slice(-80),
    summary: job.summary,
    error: job.error,
  };
}

async function runProcess(command, args, { cwd, env, timeoutMs = 0, onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            fail(new Error(`${command} timed out after ${timeoutMs}ms.`));
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (onStdout) {
        onStdout(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (onStderr) {
        onStderr(text);
      }
    });

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      fail(error);
    });

    child.on("close", (exitCode) => {
      if (timer) {
        clearTimeout(timer);
      }

      finish({
        exitCode: exitCode ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function safeReadFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function normalizeIdea({ title, idea, why, starterPrompt, sourceMix, trendScore, wildness, signals }) {
  return {
    title: truncate(cleanSentence(title) || "Trend Signal Studio", 48),
    idea: truncate(cleanSentence(idea) || "A fresh software idea pulled from today's trend signals.", 190),
    why: truncate(
      limitSentences(cleanSentence(why) || "Multiple sources are moving around the same customer pain right now.", 2),
      190,
    ),
    starterPrompt: truncate(
      cleanSentence(starterPrompt) ||
        "Build a simple MVP for this idea with one main workflow, clear inputs, and a clean results screen.",
      220,
    ),
    sourceMix: Array.isArray(sourceMix) && sourceMix.length ? sourceMix.slice(0, 3) : inferSources(signals),
    trendScore: clamp(Number.parseInt(trendScore, 10) || averageSignalScore(signals), 40, 99),
    wildness: clamp(Number.parseInt(wildness, 10) || 24, 5, 99),
    sourceTitles: signals.filter(Boolean).map((signal) => signal.title).slice(0, 2),
  };
}

function inferSources(signals) {
  return [...new Set(signals.filter(Boolean).map((signal) => signal.sourceLabel))].slice(0, 3);
}

function averageSignalScore(signals) {
  if (!signals.length) {
    return 68;
  }

  return Math.round(signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length);
}

function safeParseJson(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    const start = Math.min(
      ...["{", "["]
        .map((token) => value.indexOf(token))
        .filter((index) => index !== -1),
    );
    const end = Math.max(value.lastIndexOf("}"), value.lastIndexOf("]"));

    if (!Number.isFinite(start) || end === -1) {
      return null;
    }

    try {
      return JSON.parse(value.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function cleanSentence(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim();
}

function limitSentences(value, maxSentences) {
  const parts = value.match(/[^.!?]+[.!?]?/g) || [];
  return parts.slice(0, maxSentences).join(" ").trim();
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || "";
  }

  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
