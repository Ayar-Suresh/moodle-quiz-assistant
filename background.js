// background.js — QuizSnipe Service Worker
// Handles Groq API calls from content scripts (avoids CORS issues)

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SOLVE_QUESTION") {
    solveQuestion(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep message channel open for async
  }

  if (message.type === "GET_API_KEY") {
    chrome.storage.sync.get(["groqApiKey"], (result) => {
      sendResponse({ apiKey: result.groqApiKey || null });
    });
    return true;
  }

  if (message.type === "SAVE_API_KEY") {
    chrome.storage.sync.set({ groqApiKey: message.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function solveQuestion(payload) {
  const { apiKey, question, options } = payload;

  if (!apiKey) throw new Error("No API key set. Open the extension popup to add your Groq API key.");

  const optionsList = options
    .map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt.text}`)
    .join("\n");

  const prompt = `You are a quiz-solving assistant. Answer the following question by selecting the BEST option.

Question: ${question}

Options:
${optionsList}

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"answer": "A", "confidence": 95, "reason": "brief one-line reason"}

Where "answer" is the letter of the correct option (A, B, C, D, etc.).`;

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a precise quiz-solving AI. Always respond with valid JSON only, no extra text."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 100,
      temperature: 0.1,
      stream: false
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content?.trim();

  if (!rawText) throw new Error("Empty response from Groq.");

  // Parse JSON — handle if wrapped in markdown fences
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid response format from Groq.");

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed;
}
