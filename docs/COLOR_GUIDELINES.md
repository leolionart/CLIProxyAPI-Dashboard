
# Color Guidelines - CLIProxy Dashboard

This document describes the rules and usage of colors in the User Interface (UI) of the CLIProxy Dashboard. The color system is designed in a "Fintech/Crypto" style, combining Glassmorphism and Dark Mode OLED to create a modern, professional, and readable interface.

## 1. Main Color Palette

All colors are defined as CSS variables in the `frontend/src/styles/index.css` file for easy management and consistency.

### Dark Mode (Default)

- **Background:**
  - `--color-bg-deep: #000000` (Deep black background, battery saving for OLED screens)
  - `--color-bg-surface: #0F172A` (Main surface, slightly blue)
  - `--color-bg-card: rgba(15, 23, 42, 0.8)` (Card color with transparency)
  - `--color-bg-glass: rgba(30, 41, 59, 0.6)` (Glass effect color)

- **Fintech/Crypto Colors:**
  - `--color-primary: #F59E0B` (Amber yellow - main color, for key elements)
  - `--color-secondary: #FBBF24` (Yellow - secondary color)
  - `--color-cta: #8B5CF6` (Purple - for Call to Action buttons)
  - `--color-success: #10B981` (Emerald Green - indicating success, profit, growth)
  - `--color-danger: #EF4444` (Red - indicating error, loss, decline)
  - `--color-info: #3B82F6` (Blue - for informational notices)
  - `--color-cyan: #06B6D4` (Cyan - accent color)

- **Text:**
  - `--color-text: #F8FAFC` (Main text color)
  - `--color-text-secondary: #94A3B8` (Secondary text color)
  - `--color-text-muted: #64748B` (Muted text color)

### Light Mode

When the `.light` class is added to the dashboard, the following color variables are overridden:

- **Background:**
  - `--color-bg-deep: #F8FAFC`
  - `--color-bg-surface: #FFFFFF`
- **Text:**
  - `--color-text: #0F172A`
  - `--color-text-secondary: #475569`

## 2. Brand Colors

To help users easily identify AI service providers, we use a separate brand color palette defined in `frontend/src/components/Dashboard.jsx`.

- **OpenAI (gpt, chatgpt):** `#10a37f` (Green)
- **Anthropic (claude):** `#d97757` (Bronze Orange)
- **Google (gemini, palm):** `#4285f4` (Blue)
- **DeepSeek:** `#8b5cf6` (Purple)
- **Alibaba (qwen):** `#ff6a00` (Orange)
- **Meta (llama):** `#0668e1` (Blue)
- **Mistral:** `#6366f1` (Indigo)
- **xAI (grok):** `#64748b` (Dark Gray)
- **Cohere:** `#14b8a6` (Teal)
- **AI21 (jurassic):** `#a855f7` (Purple)
- **Unknown:** `#94a3b8` (Gray)

 The `getModelColor(modelName)` function automatically maps model names to their corresponding brand colors. If not found, it generates a consistent color based on the hash of the model name.

## 3. State-Based Colors

Colors are also used to reflect data status, especially in progress bars and quota indicators:
- **High (Safe):** Green/Emerald (`--color-success`).
- **Medium (Warning):** Yellow (`--color-primary`).
- **Low (Danger):** Red (`--color-danger`).

This approach provides immediate visual feedback to the user about system status.
