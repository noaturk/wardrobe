<div align="center">

# Wardrobe

Your clothes, extracted and organized with gpt-image.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)

[See the original post →](https://x.com/cdngdev/status/2076812846793650485)

</div>

> This fork is configured as a private, single-owner production application.
> Start with [the documentation index](docs/index.md). Production uses the
> Express entry point (`npm run start`), never `vite preview`; every page, API
> and wardrobe image is session-protected.

![Wardrobe gallery](docs/screenshots/gallery.png)

![Modeled wardrobe editor](docs/screenshots/editor.png)

## Quick start

```bash
git clone https://github.com/noaturk/wardrobe.git
cd wardrobe
npm install
cp .env.example .env
npm run auth:hash-password
# Paste only the generated hash into ADMIN_PASSWORD_HASH in .env.
npm run dev
```

The importer stays disabled only until `OPENAI_API_KEY` is configured. A private
reference photo can be added later in **Settings** and is required only for the
optional outfit try-on.

Open [localhost:3000](http://localhost:3000).

## Import with Codex

This repo includes two Codex skills: one imports clothes and generates modeled item photos; the other styles complete outfits and generates a modeled lookbook.

```text
$import-clothes Import the clothes from ~/Pictures/outfits, create modeled photos, and add them to this wardrobe.
$generate-outfits Create modeled outfit ideas from my wardrobe.
```

Open the cloned repo in Codex and run either prompt. The import skill asks for a local model-reference PNG when needed, reviews every cutout and modeled photo, then writes to `data/library.json` and `data/imported/`. The outfit skill asks how many looks to create, then curates, generates, verifies, and saves the complete collection under `data/`.

### For agents

If you are setting up Wardrobe for a user, ask how they want to import their clothes:

- **Codex:** Ask for a folder or camera-roll location and a model-reference PNG, then extract, model, and import the individual pieces by following [the bundled import skill](.agents/skills/import-clothes/SKILL.md). Afterward, offer to create a requested number of modeled looks with [the outfit-generation skill](.agents/skills/generate-outfits/SKILL.md).
- **Web UI:** Help the user configure their own `OPENAI_API_KEY`, then upload
  the private model-reference image through Settings and import in the app.

## What it does

- Detects every garment in a photo with the OpenAI Responses API
- Accepts up to 20 clothing photos in one selection, including iPhone HEIC/HEIF,
  and tracks conversion, detection and review in a visible queue
- Extracts clean product cutouts with the OpenAI Images API
- Sorts approved pieces by category and suggests outfits locally without an API call
- Generates an AI try-on for one selected piece or a complete outfit only after
  the owner explicitly confirms it
- Lets the owner attach a real photo of themselves wearing a piece, using the
  camera or photo library without an OpenAI call
- Retries transient OpenAI image-gateway failures with fresh multipart requests
  and records status, duration and request IDs for every attempt
- Uses local private files/JSON in development and MySQL plus a private
  Hostinger filesystem directory in production
- Supports drag, drop, paste, editing, review, regeneration, and approval

## Configuration

| Variable | Default |
| --- | --- |
| `OPENAI_API_KEY` | Required |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | `medium` |
| `DAILY_IMAGE_GENERATION_LIMIT` | `0` (no app cap; positive number sets a daily cap) |
| `STORAGE_DRIVER` | `local` |
| `WARDROBE_DATA_DIR` | `data` |

## License

[MIT](LICENSE)
