# IdeaNibble

IdeaNibble is a micro SaaS idea generator for tiny MVPs. It uses trend signals from SEO, ASO, and developer communities, then lets your installed Claude Code or Codex CLI build a first MVP into its own project folder.

## Run the web app

1. Run `npm install`.
2. Run `npm run dev`.
3. Open `http://localhost:3000`.

## Run the Mac app shell

1. Run `npm install`.
2. Run `npm run desktop:dev`.
3. An IdeaNibble desktop window should open and start the local server for you.

## Package the Mac app

1. Run `npm run desktop:pack`.
2. Look for the generated app inside `desktop-dist/`.

## Local provider notes

- Claude Code is the default local provider when it is installed.
- Codex uses a clean app-specific runtime inside `.cache/codex-home` so a broken global Codex config will not block IdeaNibble.
- IdeaNibble builds projects into `~/IdeaNibble Projects`.

## Optional keys

- `TWITTER_BEARER_TOKEN`: enables live X signals.
- `GITHUB_TOKEN`: raises GitHub API limits.
- `GROQ_API_KEY`: optional fallback if you still want API-based idea generation.
