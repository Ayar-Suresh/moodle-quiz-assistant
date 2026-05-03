// content.js — QuizSnipe Content Script
// Detects quiz questions, injects floating panel, highlights answers

(function () {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────
  let panel = null;
  let detectedQuestions = [];
  let isVisible = false;
  let solveAllMode = false;

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    injectPanel();
    scanPage();
    observePageChanges();
    setupKeyboardShortcut();
  }

  // ─── Question Detection Engine ────────────────────────────────────────────
  function scanPage() {
    detectedQuestions = [];

    const strategies = [
      detectMoodleQuestions,
      detectRadioButtonGroups,
      detectSelectElements,
      detectCheckboxGroups,
      detectCustomQuizMarkup,
    ];

    for (const strategy of strategies) {
      const found = strategy();
      detectedQuestions.push(...found);
    }

    // Deduplicate by question text
    const seen = new Set();
    detectedQuestions = detectedQuestions.filter(q => {
      const key = q.question.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    updatePanelCount();
    return detectedQuestions;
  }

  // ─── Moodle / Shoolini LMS Detection (highest priority) ──────────────────
  function detectMoodleQuestions() {
    const questions = [];

    // Moodle question containers: div.que, or div[id^='question-']
    const containers = document.querySelectorAll(
      'div.que, div[id^="question-"], div[class*="multichoice"]'
    );

    containers.forEach(container => {
      // Question text lives in .qtext (or .questiontext on older Moodle)
      const qtextEl = container.querySelector('.qtext, .questiontext');
      if (!qtextEl) return;

      const questionText = cleanText(qtextEl.textContent);
      if (!questionText || questionText.length < 3) return;

      // Find ALL radio inputs inside this question container
      // Skip the hidden sr-only "clear choice" radio (value=="-1")
      const radios = Array.from(
        container.querySelectorAll('input[type="radio"]')
      ).filter(r => r.value !== "-1" && !r.classList.contains("sr-only"));

      if (radios.length < 2) return;

      const options = radios.map(radio => {
        // Option text via aria-labelledby
        let text = "";
        const labelledBy = radio.getAttribute("aria-labelledby");
        if (labelledBy) {
          const labelEl = document.getElementById(labelledBy);
          if (labelEl) {
            const clone = labelEl.cloneNode(true);
            clone.querySelectorAll(".answernumber").forEach(n => n.remove());
            text = cleanText(clone.textContent);
          }
        }
        // Fallback: next sibling div
        if (!text) {
          const sib = radio.nextElementSibling;
          if (sib) {
            const clone = sib.cloneNode(true);
            clone.querySelectorAll(".answernumber").forEach(n => n.remove());
            text = cleanText(clone.textContent);
          }
        }
        return { element: radio, text, type: "radio" };
      }).filter(o => o.text.length > 0);

      if (options.length >= 2) {
        questions.push({
          question: questionText,
          options,
          type: "moodle",
          container
        });
      }
    });

    return questions;
  }

  function detectRadioButtonGroups() {
    const questions = [];
    const radioGroups = {};

    // Group radios by name attribute
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      const groupName = radio.name || radio.closest("form")?.id || "unnamed_" + Math.random();
      if (!radioGroups[groupName]) radioGroups[groupName] = [];
      radioGroups[groupName].push(radio);
    });

    for (const [name, radios] of Object.entries(radioGroups)) {
      if (radios.length < 2) continue;

      const questionText = extractQuestionText(radios[0]);
      if (!questionText) continue;

      const options = radios.map(radio => ({
        element: radio,
        text: extractOptionText(radio),
        type: "radio"
      })).filter(o => o.text.length > 0);

      if (options.length >= 2) {
        questions.push({ question: questionText, options, type: "radio-group", groupName });
      }
    }

    return questions;
  }

  function detectSelectElements() {
    const questions = [];

    document.querySelectorAll("select").forEach(select => {
      const opts = Array.from(select.options).filter(o => o.value && o.text.trim() && o.value !== "");
      if (opts.length < 2) return;

      const questionText = extractQuestionText(select);
      if (!questionText) return;

      const options = opts.map(opt => ({
        element: opt,
        selectElement: select,
        text: opt.text.trim(),
        type: "select"
      }));

      questions.push({ question: questionText, options, type: "select" });
    });

    return questions;
  }

  function detectCheckboxGroups() {
    const questions = [];
    const checkboxGroups = {};

    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const groupName = cb.name || cb.closest("fieldset")?.id || "cb_" + Math.random();
      if (!checkboxGroups[groupName]) checkboxGroups[groupName] = [];
      checkboxGroups[groupName].push(cb);
    });

    for (const [name, checkboxes] of Object.entries(checkboxGroups)) {
      if (checkboxes.length < 2) return;

      const questionText = extractQuestionText(checkboxes[0]);
      if (!questionText) return;

      const options = checkboxes.map(cb => ({
        element: cb,
        text: extractOptionText(cb),
        type: "checkbox"
      })).filter(o => o.text.length > 0);

      if (options.length >= 2) {
        questions.push({ question: questionText, options, type: "checkbox-group", groupName: name });
      }
    }

    return questions;
  }

  function detectCustomQuizMarkup() {
    const questions = [];

    // Common quiz framework selectors
    const quizSelectors = [
      // Google Forms
      { container: '[role="listitem"]', question: '[role="heading"]', option: '[role="radio"], [role="checkbox"]' },
      // Typeform-like
      { container: '.question', question: 'h1, h2, .question-title', option: 'li, .option, [data-qa="choice"]' },
      // Moodle
      { container: '.que', question: '.qtext', option: '.answer .r0, .answer .r1, .answer label' },
      // Khan Academy
      { container: '[data-testid="exercise-card"]', question: '[data-testid="perseus-renderer"]', option: '[data-testid="radio-choice"]' },
      // Quizlet
      { container: '.AssistiveLink', question: '.RichTextViewer', option: '.MultipleChoiceAnswer' },
      // Generic patterns
      { container: '.question-container, .quiz-question, [class*="question"]', question: '.question-text, p:first-child, h3, h4', option: 'label, .option, .choice, [class*="option"], [class*="choice"], [class*="answer"]' },
    ];

    for (const sel of quizSelectors) {
      document.querySelectorAll(sel.container).forEach(container => {
        const qEl = container.querySelector(sel.question);
        const optEls = container.querySelectorAll(sel.option);

        if (!qEl || optEls.length < 2) return;

        const questionText = cleanText(qEl.textContent);
        if (!questionText || questionText.length < 5) return;

        const options = Array.from(optEls).map(el => ({
          element: el,
          text: cleanText(el.textContent),
          type: "custom"
        })).filter(o => o.text.length > 1);

        if (options.length >= 2) {
          questions.push({ question: questionText, options, type: "custom" });
        }
      });
    }

    return questions;
  }

  // ─── Text Extraction Helpers ───────────────────────────────────────────────
  function extractQuestionText(inputElement) {
    // Priority 1: Moodle / LMS — climb to .que or [id^="question-"]
    const queContainer = inputElement.closest('.que, [id^="question-"], .question-block, .quiz-question-block');
    if (queContainer) {
      const qtextEl = queContainer.querySelector(".qtext, .questiontext, .question-text, .qtextformat");
      if (qtextEl) return cleanText(qtextEl.textContent).slice(0, 500);
    }

    // Priority 2: Google Forms / role="group" or fieldset
    const roleGroup = inputElement.closest('[role="group"], [role="radiogroup"], fieldset');
    if (roleGroup) {
      const heading = roleGroup.querySelector('[role="heading"], legend, .freebirdFormviewerComponentsQuestionBaseTitle');
      if (heading) {
        const t = cleanText(heading.textContent);
        if (t.length > 5) return t.slice(0, 500);
      }
    }

    // Priority 3: walk upward checking known question selectors
    let el = inputElement.parentElement;
    for (let depth = 0; depth < 8 && el; depth++, el = el.parentElement) {
      const qtextEl = el.querySelector(".qtext, .question-text, .questiontext, .stem");
      if (qtextEl) {
        const t = cleanText(qtextEl.textContent);
        if (t.length > 5) return t.slice(0, 500);
      }

      const legend = el.querySelector("legend");
      if (legend) {
        const t = cleanText(legend.textContent);
        if (t.length > 5) return t.slice(0, 500);
      }

      const heading = el.querySelector("h1, h2, h3, h4, h5");
      if (heading && !heading.closest(".answer, .ablock")) {
        const t = cleanText(heading.textContent);
        if (t.length > 5 && !isOptionText(t)) return t.slice(0, 500);
      }

      if (el.tagName === "FORM" || el.tagName === "BODY") break;
    }

    // Priority 4: preceding sibling text
    const parent = inputElement.closest("div, section, article");
    if (parent) {
      const firstRadio = parent.querySelector('input[type="radio"], input[type="checkbox"]');
      if (firstRadio) {
        let sib = firstRadio.closest("div, p")?.previousElementSibling;
        for (let i = 0; i < 5 && sib; i++, sib = sib.previousElementSibling) {
          const t = cleanText(sib.textContent);
          if (t.length > 8 && !isOptionText(t)) return t.slice(0, 500);
        }
      }
    }

    return null;
  }

  function extractOptionText(inputElement) {
    // ── Priority 1: aria-labelledby (Moodle, Google Forms, WCAG-compliant LMS) ──
    const labelledBy = inputElement.getAttribute("aria-labelledby");
    if (labelledBy) {
      // aria-labelledby can be a space-separated list of IDs
      const ids = labelledBy.trim().split(/\s+/);
      const parts = [];
      for (const refId of ids) {
        const refEl = document.getElementById(refId);
        if (!refEl) continue;
        const clone = refEl.cloneNode(true);
        // Strip answer-number prefixes like "a. " "b. " so AI doesn't get confused
        clone.querySelectorAll(".answernumber, .answer-number, [class*='answerlabel']").forEach(n => n.remove());
        const t = cleanText(clone.textContent);
        if (t) parts.push(t);
      }
      if (parts.length > 0) return parts.join(" ").trim();
    }

    // ── Priority 2: <label for="id"> ──────────────────────────────────────────
    const id = inputElement.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) {
        const clone = label.cloneNode(true);
        clone.querySelectorAll("input, .answernumber").forEach(n => n.remove());
        return cleanText(clone.textContent);
      }
    }

    // ── Priority 3: wrapping <label> ──────────────────────────────────────────
    const parentLabel = inputElement.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll("input, .answernumber").forEach(n => n.remove());
      return cleanText(clone.textContent);
    }

    // ── Priority 4: next sibling element (common pattern) ────────────────────
    const nextEl = inputElement.nextElementSibling;
    if (nextEl) {
      const clone = nextEl.cloneNode(true);
      clone.querySelectorAll(".answernumber").forEach(n => n.remove());
      return cleanText(clone.textContent);
    }

    // ── Priority 5: raw next text node ───────────────────────────────────────
    const next = inputElement.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE) {
      return cleanText(next.textContent);
    }

    return "";
  }

  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function isOptionText(text) {
    return /^[A-Ea-e][\.\)]\s/.test(text) || text.length < 5;
  }

  // ─── Answer Highlighting ───────────────────────────────────────────────────
  async function solveQuestion(questionObj, index) {
    const { question, options } = questionObj;

    // Get API key from background
    const keyRes = await chrome.runtime.sendMessage({ type: "GET_API_KEY" });
    const apiKey = keyRes.apiKey;

    if (!apiKey) {
      showPanelError("⚠️ No API key. Click the extension icon to add your Groq key.");
      return null;
    }

    updateQuestionStatus(index, "thinking");

    const result = await chrome.runtime.sendMessage({
      type: "SOLVE_QUESTION",
      payload: { apiKey, question, options: options.map(o => ({ text: o.text })) }
    });

    if (!result.success) {
      updateQuestionStatus(index, "error", result.error);
      return null;
    }

    const { answer, confidence, reason } = result.data;
    const answerIndex = answer.charCodeAt(0) - 65; // A=0, B=1, ...

    // Highlight the correct option
    if (answerIndex >= 0 && answerIndex < options.length) {
      highlightAnswer(options, answerIndex, reason);
      updateQuestionStatus(index, "solved", `${answer}) ${options[answerIndex]?.text?.slice(0, 40)} — ${confidence}% confidence`);
    }

    return result.data;
  }

  function highlightAnswer(options, correctIndex, reason) {
    // Remove previous highlights
    options.forEach((opt, i) => {
      const el = opt.element;
      const container = getOptionContainer(el);

      container?.classList.remove("qs-correct", "qs-incorrect");

      if (i === correctIndex) {
        container?.classList.add("qs-correct");

        // For radio/checkbox/moodle, mark correct and scroll into view
        if (opt.type === "radio" || opt.type === "checkbox" || opt.type === "moodle") {
          el.setAttribute("data-qs-correct", "true");
          // Scroll into view
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        if (opt.type === "select") {
          opt.selectElement.value = opt.element.value;
          opt.element.setAttribute("data-qs-correct", "true");
        }

        if (opt.type === "custom") {
          el.classList.add("qs-highlight-custom");
        }

        // Add tooltip with reason
        if (reason) {
          container?.setAttribute("data-qs-tooltip", `✓ ${reason}`);
        }
      } else {
        container?.classList.add("qs-incorrect");
      }
    });
  }

  function getOptionContainer(el) {
    // Moodle: radio lives directly inside .r0 or .r1 wrapper divs
    const moodleRow = el.closest('.r0, .r1');
    if (moodleRow) return moodleRow;

    // Standard patterns
    return el.closest("label, li, .option, .choice, [class*='option'], [class*='choice'], tr") || el.parentElement;
  }

  function clearAllHighlights() {
    document.querySelectorAll(".qs-correct, .qs-incorrect, .qs-highlight-custom").forEach(el => {
      el.classList.remove("qs-correct", "qs-incorrect", "qs-highlight-custom");
      el.removeAttribute("data-qs-tooltip");
    });
    document.querySelectorAll("[data-qs-correct]").forEach(el => {
      el.removeAttribute("data-qs-correct");
    });
  }

  // ─── Floating Panel UI ────────────────────────────────────────────────────
  function injectPanel() {
    if (document.getElementById("qs-panel")) return;

    panel = document.createElement("div");
    panel.id = "qs-panel";
    panel.innerHTML = `
      <div id="qs-header">
        <div id="qs-logo">
          <span class="qs-bolt">⚡</span>
          <span id="qs-title">QuizSnipe</span>
        </div>
        <div id="qs-header-actions">
          <button id="qs-scan-btn" title="Rescan page (Ctrl+Shift+Q)">↺</button>
          <button id="qs-minimize-btn" title="Minimize">−</button>
          <button id="qs-close-btn" title="Close">×</button>
        </div>
      </div>
      <div id="qs-body">
        <div id="qs-status-bar">
          <span id="qs-count">Scanning...</span>
          <span id="qs-badge"></span>
        </div>
        <div id="qs-questions-list"></div>
        <div id="qs-actions">
          <button id="qs-solve-all-btn" class="qs-btn-primary">
            <span class="qs-btn-icon">🎯</span> Solve All
          </button>
          <button id="qs-clear-btn" class="qs-btn-secondary">Clear</button>
        </div>
        <div id="qs-error-msg" style="display:none"></div>
      </div>
      <div id="qs-drag-handle"></div>
    `;

    document.body.appendChild(panel);
    makeDraggable(panel);
    bindPanelEvents();
  }

  function bindPanelEvents() {
    document.getElementById("qs-close-btn").addEventListener("click", () => {
      panel.style.display = "none";
      isVisible = false;
    });

    document.getElementById("qs-minimize-btn").addEventListener("click", () => {
      const body = document.getElementById("qs-body");
      const btn = document.getElementById("qs-minimize-btn");
      if (body.style.display === "none") {
        body.style.display = "";
        btn.textContent = "−";
      } else {
        body.style.display = "none";
        btn.textContent = "+";
      }
    });

    document.getElementById("qs-scan-btn").addEventListener("click", () => {
      clearAllHighlights();
      scanPage();
      renderQuestionsList();
    });

    document.getElementById("qs-solve-all-btn").addEventListener("click", solveAll);
    document.getElementById("qs-clear-btn").addEventListener("click", () => {
      clearAllHighlights();
      renderQuestionsList();
    });
  }

  async function solveAll() {
    if (detectedQuestions.length === 0) {
      showPanelError("No questions detected on this page.");
      return;
    }

    const btn = document.getElementById("qs-solve-all-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="qs-spinner">⟳</span> Solving...';

    // Solve concurrently (up to 3 at a time for API rate limits)
    const batchSize = 3;
    for (let i = 0; i < detectedQuestions.length; i += batchSize) {
      const batch = detectedQuestions.slice(i, i + batchSize);
      await Promise.all(batch.map((q, j) => solveQuestion(q, i + j)));
    }

    btn.disabled = false;
    btn.innerHTML = '<span class="qs-btn-icon">🎯</span> Solve All';
  }

  function renderQuestionsList() {
    const list = document.getElementById("qs-questions-list");
    if (!list) return;

    if (detectedQuestions.length === 0) {
      list.innerHTML = `<div class="qs-empty">No quiz questions detected on this page.</div>`;
      return;
    }

    list.innerHTML = detectedQuestions.map((q, i) => `
      <div class="qs-question-item" id="qs-q-${i}">
        <div class="qs-question-text">${escapeHtml(q.question.slice(0, 90))}${q.question.length > 90 ? "…" : ""}</div>
        <div class="qs-question-meta">
          <span class="qs-opt-count">${q.options.length} options</span>
          <span class="qs-status" id="qs-status-${i}">—</span>
        </div>
        <button class="qs-solve-one-btn" data-index="${i}">Solve ↗</button>
      </div>
    `).join("");

    list.querySelectorAll(".qs-solve-one-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const idx = parseInt(e.target.dataset.index);
        btn.textContent = "⟳";
        btn.disabled = true;
        await solveQuestion(detectedQuestions[idx], idx);
        btn.textContent = "✓";
      });
    });
  }

  function updatePanelCount() {
    const countEl = document.getElementById("qs-count");
    const badge = document.getElementById("qs-badge");
    if (!countEl) return;

    const n = detectedQuestions.length;
    countEl.textContent = n === 0 ? "No questions found" : `${n} question${n > 1 ? "s" : ""} detected`;
    if (badge) badge.textContent = n > 0 ? n : "";

    renderQuestionsList();
  }

  function updateQuestionStatus(index, status, message = "") {
    const statusEl = document.getElementById(`qs-status-${index}`);
    const item = document.getElementById(`qs-q-${index}`);
    if (!statusEl) return;

    const states = {
      thinking: { text: "⟳ Thinking…", cls: "qs-thinking" },
      solved: { text: `✓ ${message}`, cls: "qs-solved" },
      error: { text: `✗ ${message}`, cls: "qs-error-status" }
    };

    const state = states[status];
    statusEl.textContent = state.text;
    statusEl.className = "qs-status " + state.cls;
    if (item) item.className = "qs-question-item " + state.cls;
  }

  function showPanelError(msg) {
    const errEl = document.getElementById("qs-error-msg");
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.style.display = "block";
    setTimeout(() => { errEl.style.display = "none"; }, 5000);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ─── Draggable Panel ──────────────────────────────────────────────────────
  function makeDraggable(el) {
    const header = el.querySelector("#qs-header");
    let startX, startY, startLeft, startTop;

    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = Math.max(0, startLeft + dx) + "px";
        el.style.top = Math.max(0, startTop + dy) + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ─── Keyboard Shortcut ────────────────────────────────────────────────────
  function setupKeyboardShortcut() {
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "Q") {
        e.preventDefault();
        if (!panel) return;
        if (panel.style.display === "none" || !isVisible) {
          panel.style.display = "";
          isVisible = true;
          scanPage();
        } else {
          panel.style.display = "none";
          isVisible = false;
        }
      }
    });
  }

  // ─── Page Observer ────────────────────────────────────────────────────────
  function observePageChanges() {
    const observer = new MutationObserver(() => {
      clearTimeout(window._qsScanTimeout);
      window._qsScanTimeout = setTimeout(() => {
        scanPage();
      }, 800);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  // ─── Message from popup ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "TOGGLE_PANEL") {
      if (!panel) injectPanel();
      const isHidden = panel.style.display === "none" || !isVisible;
      panel.style.display = isHidden ? "" : "none";
      isVisible = isHidden;
      if (isHidden) scanPage();
      sendResponse({ visible: isHidden, count: detectedQuestions.length });
      return true;
    }

    if (message.type === "GET_STATUS") {
      sendResponse({ count: detectedQuestions.length, visible: isVisible });
      return true;
    }
  });

  // ─── Start ────────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
