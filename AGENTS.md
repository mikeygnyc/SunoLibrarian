# AGENTS.md

## Project Overview
- Name: `suno-export`
- Type: TypeScript CLI
- Entry point: `src/index.ts`
- Build output: `dist/`
- Runtime target: Node.js (CommonJS, ES2020)

This project provides a unified CLI to:
- download tracks + metadata from Suno
- process downloaded assets into library formats
- run end-to-end sync (`download` + `process`)

## Repository Layout
- `src/index.ts`: CLI command surface (`download`, `process`, `sync`, `download-images`)
- `src/client.ts`: Suno API client and download helpers
- `src/auth.ts`: browser-based token extraction via Puppeteer
- `src/converter.ts`: converter entrypoint used by CLI
- `src/library-processor.ts`: processing pipeline coordinator
- `src/audio-converter.ts`: ffmpeg conversion primitives
- `src/metadata-processor.ts`: metadata/tag embedding + sidecar writes
- `src/lib/interfaces/*.ts`: shared typed interface definitions
- `src/lib/metadata/normalize-metadata.ts`: canonical metadata normalization helpers
- `image_list.json`: sample/generated image list

## Common Commands
- Use `nvm` for any command that requires Node.js or npm. Ensure the correct Node version is selected before running Node-based tooling.
- Install deps: `npm install`
- Build: `npm run build`
- Run built CLI: `npm start -- --help`
- Run in dev mode: `npm run dev -- --help`

Note: `npm run build` currently runs `npm install && tsc -p tsconfig.json`.

## Expected Input/Output Conventions
- Download flow writes under an output root with subfolders:
  - `mp3/`
  - `wav/`
  - `metadata/`
  - `images/`
  - `songs_metadata.json`
- Process flow expects a download-style input root and writes converted files to output root.

## Change Guidelines For Agents
- Keep changes minimal and scoped to the task.
- Preserve CLI flags and command names unless the task explicitly changes them.
- Avoid breaking `songs_metadata.json` compatibility.
- Prefer pure functions and typed interfaces in `src/types.ts` when adding data fields.
- Keep filesystem writes atomic where practical (tmp + rename pattern is already used).
- Maintain existing module style (`commonjs` output, TypeScript strict mode).

## Validation Checklist
When making code changes, run:
1. `npm run build`
2. `npm start -- --help`
3. If CLI behavior changed, run the relevant subcommand help (for example `npm start -- process --help`).

If a command cannot be run in the current environment, document what could not be verified.

## Safety Notes
- `auth.ts` launches or connects to a browser and captures bearer tokens from requests.
- Never log or commit real auth tokens.
- Be careful with changes that increase network/API request volume (rate limits and account safety).
