# AdvocateAI

> Your free, private AI lawyer in your pocket.

AdvocateAI is a fully offline, privacy-first mobile app that helps low-income users understand and fight back against confusing legal and medical documents — medical bills, eviction notices, insurance denials, and more. All AI processing, OCR, and data storage happen entirely on your device. No server. No cloud. No telemetry. Ever.

---

## Features

- **Smart Document Scanner** — Three-pass adaptive OCR with automatic table extraction and layout preservation
- **On-Device AI Analysis** — Local LLM (Qwen 2.5 / Llama 3.2) explains documents in plain English, identifies your rights, and flags deadlines
- **Anomaly & Overcharge Detector** — A dedicated second AI pass scans for overcharges, duplicate billing, unauthorized fees, illegal terms, missing disclosures, and medical unbundling
- **Dispute Letter Generator** — Generates legally-grounded dispute letters, appeal letters, call scripts, and form completions tailored to your document
- **Deadline Alert System** — Calculates statutory deadline windows and schedules local notifications at 7, 3, and 1 day out
- **Encrypted Case Bundle** — Export a complete case PDF (analysis + anomaly flags + letters + correspondence) to share with a lawyer
- **Voice Input** — Describe your situation verbally using on-device Whisper speech recognition
- **Correspondence Thread** — Track back-and-forth with institutions in one place

---

## Supported Documents

| Document Type | Example |
|---|---|
| Medical Bills | Hospital charges, lab fees, EOBs |
| Insurance Denials | Claim denial letters |
| Eviction Notices | Pay-or-quit, unlawful detainer |
| Housing Notices | Lease violations, rent increases |
| Legal Notices | Court summons, debt collection |
| Benefits / Welfare Forms | SNAP, Medicaid, SSI |
| Utility Bills | Disputed charges, shutoff notices |
| General Documents | Any official letter or form |

---

## Privacy Architecture

AdvocateAI is built with a zero-knowledge design:

- All AI inference runs on-device via **llama.rn** — no API calls, no internet required
- OCR uses **Google ML Kit on-device** — never Google Cloud Vision
- Voice transcription uses **Whisper.rn** — audio never leaves your device
- All documents, letters, and chat messages are encrypted at rest with **AES-256-GCM**
- Encryption key is stored in the device's hardware-backed **Secure Enclave / Android Keystore**
- **No account required** — no email, no phone number, no sign-up
- **No analytics, crash reporting, or telemetry** of any kind
- Android cloud backup is disabled — your data never syncs to Google Drive or iCloud

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo (bare workflow) |
| Navigation | Expo Router (file-based) |
| AI / LLM | llama.rn (on-device inference) |
| OCR | Google ML Kit Text Recognition v2 |
| Speech-to-Text | Whisper.rn |
| Database | expo-sqlite (SQLite) |
| Encryption | AES-256-GCM via @noble/ciphers + PBKDF2 (600K iterations) |
| Key Storage | expo-secure-store (Keystore / Secure Enclave) |
| PDF Export | Custom PDF generator |
| Notifications | expo-notifications (local only) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Expo CLI
- Android Studio (for Android) or Xcode (for iOS)

### Install

```bash
git clone https://github.com/tibebesolomon/advocateai.git
cd advocateai
npm install
```

### Run

```bash
npm start              # Start Expo dev server
npm run android        # Build & run on Android device/emulator
npm run ios            # Build & run on iOS simulator
```

### AI Model Setup

The app requires a local GGUF model file. On first launch, tap **Set Up AI** to download a compatible model (Qwen 2.5 or Llama 3.2 instruct, ~2–4 GB). The model is stored in the app's document directory and never shared.

---

## Build for Production

This project uses [EAS Build](https://docs.expo.dev/build/introduction/).

```bash
# Android (AAB for Play Store)
eas build --platform android --profile production

# iOS (for App Store)
eas build --platform ios --profile production
```

---

## Project Structure

```
app/                    # Expo Router screens
  (tabs)/               # Home, Documents, Letters tabs
  scan.tsx              # Camera scanner
  review.tsx            # OCR review + voice input
  action.tsx            # AI analysis + anomaly detection
  letter.tsx            # Letter generation + PDF export
  chat.tsx              # Advocate AI chat
  thread.tsx            # Correspondence thread
  model-setup.tsx       # AI model download/management

src/
  ai/                   # LLM engine, prompts, analysis logic
  documents/            # SQLite store, AES-256-GCM encryption
  export/               # Case bundle PDF generator
  notifications/        # Deadline calculation + local alerts
  ocr/                  # Image processor, table extractor, PDF reader
  pdf/                  # Letter PDF generator
  ui/                   # Theme, components, responsive utilities
  voice/                # Whisper STT, TTS

docs/                   # GitHub Pages (landing page + legal)
```

---

## Links

- [Landing Page](https://tibebesolomon.github.io/advocateai/)
- [Privacy Policy](https://tibebesolomon.github.io/advocateai/privacy.html)
- [Terms of Service](https://tibebesolomon.github.io/advocateai/terms.html)

---

## Disclaimer

AdvocateAI is not a law firm and does not provide legal advice. AI-generated summaries, analyses, and letters are informational only and should be reviewed carefully before use. For serious legal matters, consult a licensed attorney. Many communities offer free legal aid — [lawhelp.org](https://www.lawhelp.org) can help you find one.

---

## License

MIT License — free to use, modify, and distribute.
