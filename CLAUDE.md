# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AdvocateAI is a privacy-first, fully offline React Native app that helps low-income users understand and respond to legal/medical documents. All processing (OCR, AI analysis, anomaly detection, PDF generation) happens on-device — no server, no cloud, no telemetry.

## Commands

```bash
npm start                  # Start Expo dev server
npm run android            # Build & run on Android device/emulator
npm run ios                # Build & run on iOS simulator
npm run lint               # TypeScript type checking (tsc --noEmit)
npm run prebuild           # Full native rebuild (cleans generated dirs)
npm run prebuild:android   # Android-only native prebuild
```

To run a single TypeScript check on a file: `npx tsc --noEmit --skipLibCheck`

## Four Core System Components

### 1. Multimodal Capture Engine (`src/ocr/`)
**Smart Camera Scanner** (`app/scan.tsx`): Frame overlay UI, flash toggle, haptic feedback.

**Layout-Preserving OCR** (`src/ocr/processor.ts`): Three-pass adaptive pipeline:
1. Standard resolution → ML Kit OCR
2. If blocks detected, auto-crop to text bounds (removes background noise), re-OCR
3. High-resolution fallback (3000px) for blurry text

**Table Extraction** (`src/ocr/tables.ts`): Groups OCR blocks into rows by Y-proximity, detects column boundaries via X-clustering, returns `ExtractedTable[]` with spatial cell positions. Blocks belonging to tables are rendered as pipe-delimited rows; non-table blocks become paragraphs.

**Voice STT** (`src/voice/stt.ts`): whisper.rn lazy-load (same pattern as llama.rn). Uses `expo-av` for recording. Falls back to empty string + UI prompt in demo mode. Supports 6 languages. Model lives at `${documentDirectory}/whisper/ggml-tiny.en.bin`.

### 2. Local Reasoning & Translation Engine (`src/ai/`)
**Document Analysis** (`engine.ts` → `analyzeDocument()`): Produces plain-language summary, severity, key findings, recommended actions, rights reminder, deadline.

**Anomaly & Overcharge Detector** (`engine.ts` → `detectAnomalies()`): Separate AI pass after main analysis. Uses `buildAnomalyPrompt()` which includes table/line-item data. Detects: `OVERCHARGE`, `DUPLICATE_CHARGE`, `UNAUTHORIZED`, `ILLEGAL_TERM`, `MISSING_DISCLOSURE`, `UNBUNDLING`. Results persisted back into analysis JSON.

**Action Planner** (`src/notifications/deadlines.ts`): `calculateDeadlines(doc)` returns statutory deadline windows (per US law) + document-extracted due dates, sorted by urgency. Statutory windows per `DocumentType` are defined in `STATUTORY_DEADLINES`.

### 3. Execution & Output Engine (`src/pdf/`, `src/export/`, `src/ai/`)
**Dispute Letter Generator / Call Scripts** (`engine.ts`): `generateLetter()`, `generateCallScript()`, `generateReply()`.

**PDF Generator** (`src/pdf/generator.ts`): Single-letter PDFs (US Letter, 1-inch margins, auto page breaks).

**Case Bundle Export** (`src/export/caseBundle.ts`): Multi-section PDF containing case summary, AI analysis, anomaly flags, document text, table line items, all generated letters, and correspondence thread. Shareable via `expo-sharing`.

### 4. Privacy & Case Management (`src/documents/`)
**Encrypted On-Device Vault** (`src/documents/store.ts` + `src/documents/encryption.ts`): SQLite via expo-sqlite. `raw_text` and `analysis` columns are AES-256-GCM encrypted using Web Crypto API (Hermes built-in). `encryptField()`/`decryptField()` are async — all `getDocument()` and `getAllDocuments()` calls are async. The encryption key is PBKDF2-derived (100k iterations, SHA-256); replace the static `KEY_MATERIAL` string in `encryption.ts` with a `expo-secure-store` value for production hardening.

**Deadline Alert System** (`src/notifications/deadlines.ts`): `scheduleDeadlineAlerts()` schedules expo-notifications at 7 days, 3 days, 1 day, and day-of (9 AM local). Notification IDs persisted in `scheduled_alerts` SQLite table. `cancelAlertsForDocument()` cancels all scheduled alerts for a doc.

**Export & Share Hub** (`app/action.tsx` → "Export Case" button): Calls `generateCaseBundle()`.

## Architecture

**Data flow:**
```
Camera/Files → OCR (ML Kit + tables.ts) → Classifier (regex) → SQLite (encrypted)
     → AI Analysis (llama.rn) → Anomaly Detection (llama.rn) → Action Screen
     → Letter Generator (llama.rn) → PDF / Case Bundle → Share
     → Deadline Calculation → expo-notifications alerts
```

### Key Modules

**`src/ai/engine.ts`** — Singleton LLM. Model: `${documentDirectory}/models/model.gguf`. Memory profiles: DEFAULTS (2048 ctx), LOW_MEM (512 ctx), ULTRA_LOW_MEM (256 ctx). iOS: 6 threads + GPU. Android: 4 threads + CPU. Falls back to demo mode when native unavailable.

**`src/ai/prompts.ts`** — Chat templates for Qwen2.5/Llama 3.2 instruct format. Contains `buildAnalysisPrompt`, `buildLetterPrompt`, `buildCallScriptPrompt`, `buildFormPrompt`, `buildReplyPrompt`, `buildAnomalyPrompt`.

**`src/ocr/processor.ts`** — Three-pass OCR with auto-crop. Calls `extractTables()` from `tables.ts`. Returns `OCRResult` with `tables: ExtractedTable[]`.

**`src/documents/store.ts`** — All read operations are async (due to AES decryption). Schema has 5 tables: `documents`, `letters`, `threads`, `thread_messages`, `scheduled_alerts`. Cascade delete on document removal (letters only; alerts deleted manually).

**`src/voice/stt.ts`** — `startRecording()` / `stopRecording()` via expo-av. `transcribeAudio()` via whisper.rn. Returns empty string in demo mode (caller shows fallback).

**`src/notifications/deadlines.ts`** — `configureNotifications()` must be called once at app startup (done in `app/_layout.tsx`). `calculateDeadlines(doc)` is synchronous. `scheduleDeadlineAlerts()` is async.

**`src/documents/encryption.ts`** — Uses `crypto.subtle` (Hermes global). The `as any` cast on `crypto.subtle` works around a TypeScript strict-lib type mismatch with `Uint8Array<ArrayBufferLike>` vs `BufferSource`.

**`src/export/caseBundle.ts`** — Multi-page PDF with header bar on each page, structured sections. Writes to `${documentDirectory}/exports/`.

### Navigation (Expo Router file-based)

- `app/(tabs)/` — Home, Documents, Letters tabs
- `app/scan` — Camera with frame overlay
- `app/review` — OCR review, voice input (mic button), table preview
- `app/action` — AI analysis, anomaly flags, deadline cards, set-reminder, case export
- `app/letter` — Letter/form/script generation, editing, PDF export
- `app/thread` — Correspondence simulation
- `app/model-setup` — Model download/management

### Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `babel.config.js`).

## Packages Requiring Native Rebuild

These are declared in `src/types/declarations.d.ts` and lazy-loaded at runtime:
- `whisper.rn` — on-device STT (same lazy-load singleton pattern as llama.rn)
- `expo-notifications` — local deadline alerts

Both fall back gracefully: STT returns empty string, notifications request returns `granted: false`.

## Key Constraints

- **No server**: All data stays on-device. Do not add any network calls for user documents.
- **All `getDocument()` / `getAllDocuments()` calls are async** — they decrypt `raw_text` before returning.
- **`configureNotifications()` must run at app start** — already wired in `app/_layout.tsx`.
- **Anomaly detection runs after main analysis** — it's a second inference pass and should not block the UI. Run it concurrently and merge results back.
- **`eas.json`** contains placeholder Apple credentials — needs real values before App Store submission.
- **Whisper model not in repo** — users must download `ggml-tiny.en.bin` separately (~75 MB). Multilingual: swap for `ggml-small.bin` (~466 MB) in `src/voice/stt.ts`.
- **Encryption key** in `encryption.ts` is currently a static string — replace with `expo-secure-store` for production.
