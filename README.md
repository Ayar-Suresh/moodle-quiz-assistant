# ⚡ QuizSnipe — AI Answer Highlighter

A Chrome Manifest V3 extension that **instantly detects quiz questions** on any page and uses **Groq's Llama 3.3 70B** to highlight the correct answer in milliseconds.

---

## 🚀 Quick Setup (3 steps)

### 1. Get a Free Groq API Key
1. Go to [console.groq.com](https://console.groq.com)
2. Sign up (free) → API Keys → Create key
3. Copy the key (starts with `gsk_...`)

### 2. Load Extension in Chrome
1. Open Chrome → go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select this folder (`moodle-quiz-assistant`)

### 3. Add Your API Key
1. Click the **⚡ QuizSnipe** icon in your toolbar
2. Paste your Groq API key → click **Save**
3. You're ready!

---

## 🎯 How to Use

| Action | How |
|--------|-----|
| Open panel | Click extension icon → **Open Panel** |
| Keyboard shortcut | `Ctrl + Shift + Q` |
| Solve all questions | Click **🎯 Solve All** in the panel |
| Solve one question | Click **Solve ↗** next to any question |
| Rescan the page | Click **↺** or **Scan** button |
| Clear highlights | Click **Clear** |

---

## ✨ Features

- **Universal Detection** — Works on Google Forms, Moodle, Quizlet, Typeform, Khan Academy, and any custom quiz markup
- **Smart Parsing** — Detects radio buttons, checkboxes, dropdowns, and custom option elements
- **Visual Highlights** — Correct answers glow green, wrong options dim automatically
- **Reason Tooltip** — Hover over the correct answer to see why AI chose it
- **Draggable Panel** — Move the floating panel anywhere on screen
- **Live Scanning** — Automatically rescans when page content changes (SPAs, AJAX)
- **Speed** — Groq's LPU inference returns answers in ~200ms

---

## 🔧 Files

```
moodle-quiz-assistant/
├── manifest.json      # MV3 extension config
├── background.js      # Service worker — handles Groq API calls
├── content.js         # Question detection + UI injection
├── content.css        # Floating panel + answer highlight styles
├── popup.html         # Extension popup (API key + controls)
├── popup.js           # Popup logic
└── icons/             # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## ⚙️ Customization

**Change AI model** — Edit `background.js` line 1:
```js
model: "llama-3.3-70b-versatile"  // fastest/smartest
// or: "llama-3.1-8b-instant"     // even faster, less accurate
// or: "mixtral-8x7b-32768"       // good for long questions
```

**Change detection sensitivity** — In `content.js`, `detectCustomQuizMarkup()` lists selectors for common quiz frameworks. Add your own:
```js
{ container: '.my-quiz', question: '.my-q', option: '.my-opt' }
```

---

## 🛡️ Privacy

- Your API key is stored locally in Chrome's sync storage
- Quiz content is sent to Groq's API (subject to [Groq's privacy policy](https://groq.com/privacy))
- No data is sent to any other server

---

## 💡 Tips

- Works best on **radio button quizzes** (single correct answer)
- For canvas-based quiz platforms (locked-down browsers), detection may be limited
- If a question isn't detected, try clicking **Scan ↺** after the page fully loads

## 👤 Author
Built by [Ayar Suresh]  
Email : ayar.sys@gmail.com
