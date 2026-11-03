
 document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  // Add your NEW Gemini API key here. Never publish this frontend version publicly:
  // browser JavaScript cannot keep an API key secret. Use a backend proxy for deployment.
  const GEMINI_API_KEY = "AQ.Ab8RN6LoNCdxeuGjogaXG3dp70GamZ7MpzQuGesUm-PcsFQPCA";
  const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

  const STORAGE_KEY = "smart_ai_conversations_v2"; // Keeps your existing saved chats.
  const THEME_KEY = "voxora_theme_v1";
  const SETTINGS_KEY = "voxora_settings_v1";
  const $ = id => document.getElementById(id);

  const questionInput = $("question");
  const submitButton = $("submit-button");
  const responseArea = $("response");
  const historyElement = $("history");
  const newChatButton = $("new-chat");
  const voiceButton = $("voice-button");
  const sidebar = $("sidebar");
  const menuToggle = $("menu-toggle");
  const closeSidebarButton = $("close-sidebar");
  const sidebarOverlay = $("sidebar-overlay");
  const themeToggle = $("theme-toggle");
  const themeSelect = $("theme-select");
  const settingsToggle = $("settings-toggle");
  const settingsPanel = $("settings-panel");
  const settingsClose = $("settings-close");
  const autoSpeakInput = $("auto-speak");
  const voiceSelect = $("voice-select");
  const speechRateInput = $("speech-rate");
  const rateValue = $("rate-value");
  const voiceNote = $("voice-note");

  let conversations = loadConversations();
  let activeConversationId = null;
  let isLoading = false;
  let recognition = null;
  let isListening = false;
  let availableVoices = [];
  let currentSpeechMessage = null;
  let currentSpeechText = "";
  let speechUtterance = null;
  let themeMode = localStorage.getItem(THEME_KEY) || "system";
  let settings = loadSettings();

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return {
        autoSpeak: saved.autoSpeak !== false,
        voiceURI: typeof saved.voiceURI === "string" ? saved.voiceURI : "",
        rate: Number.isFinite(Number(saved.rate)) ? Math.min(1.2, Math.max(.75, Number(saved.rate))) : .95
      };
    } catch {
      return { autoSpeak: true, voiceURI: "", rate: .95 };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function loadConversations() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved)) return saved.filter(item =>
        item && typeof item.id === "string" && Array.isArray(item.messages)
      );
      return [];
    } catch (error) {
      console.warn("Could not load saved conversations:", error);
      return [];
    }
  }

  function saveConversations() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (error) {
      console.warn("Could not save chat history:", error);
    }
  }

  function createId() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getActiveConversation() {
    return conversations.find(item => item.id === activeConversationId);
  }

  function createConversation() {
    const conversation = {
      id: createId(),
      title: "New conversation",
      messages: [],
      updatedAt: Date.now()
    };
    conversations.unshift(conversation);
    activeConversationId = conversation.id;
    saveConversations();
    renderHistory();
    renderMessages();
    return conversation;
  }

  // Theme: System follows the operating system; Light and Dark are explicit choices.
  function applyTheme(mode) {
    themeMode = mode;
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
    document.body.dataset.theme = resolved;
    themeSelect.value = mode;
    themeToggle.textContent = resolved === "dark" ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", `Switch to ${resolved === "dark" ? "light" : "dark"} mode`);
    themeToggle.title = `Switch to ${resolved === "dark" ? "light" : "dark"} mode`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content", resolved === "dark" ? "#201e21" : "#fffaf7"
    );
    localStorage.setItem(THEME_KEY, mode);
  }

  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
  themeToggle.addEventListener("click", () => {
    applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (themeMode === "system") applyTheme("system");
  });

  function openSettings() {
    settingsPanel.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
  }
  function closeSettings() {
    settingsPanel.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
  }
  settingsToggle.addEventListener("click", () => settingsPanel.hidden ? openSettings() : closeSettings());
  settingsClose.addEventListener("click", closeSettings);
  document.addEventListener("click", event => {
    if (!settingsPanel.hidden && !settingsPanel.contains(event.target) &&
        !settingsToggle.contains(event.target)) closeSettings();
  });

  function renderHistory() {
    historyElement.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "Your conversations will appear here.";
      historyElement.appendChild(empty);
      return;
    }
    [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).forEach(conversation => {
      const button = document.createElement("button");
      button.className = "history-item";
      button.type = "button";
      if (conversation.id === activeConversationId) button.classList.add("active");
      const icon = document.createElement("span");
      icon.textContent = "◈";
      const title = document.createElement("span");
      title.textContent = conversation.title || "Conversation";
      button.append(icon, title);
      button.addEventListener("click", () => {
        if (isLoading) return;
        stopSpeech();
        activeConversationId = conversation.id;
        renderHistory();
        renderMessages();
        closeMobileSidebar();
      });
      historyElement.appendChild(button);
    });
  }

  function createWelcomeScreen() {
    const welcome = document.createElement("div");
    welcome.className = "welcome-screen";
    welcome.innerHTML = `
      <div class="welcome-orbit" aria-hidden="true"><span class="welcome-icon">✳</span><span class="orbit-dot orbit-dot-one"></span><span class="orbit-dot orbit-dot-two"></span></div>
      <div class="welcome-eyebrow"><span></span> A LITTLE SPACE FOR BIG IDEAS</div>
      <h1>Where would you<br>like to <em>begin?</em></h1>
      <p class="welcome-description">Questions, plans, wild ideas — bring them all.<br>Let's make sense of something together.</p>
      <div class="suggestion-grid">
        <button class="suggestion-card" data-prompt="Explain something fascinating about space in a clear, engaging way."><span class="suggestion-icon coral">✧</span><strong>Explore the unknown</strong><small>Space, science & big questions</small><span class="card-arrow">↗</span></button>
        <button class="suggestion-card" data-prompt="Teach me one genuinely useful or surprising thing today."><span class="suggestion-icon amber">⌁</span><strong>Learn something new</strong><small>A fresh idea worth knowing</small><span class="card-arrow">↗</span></button>
        <button class="suggestion-card" data-prompt="Help me brainstorm a few original ideas for a creative project."><span class="suggestion-icon lilac">✎</span><strong>Think creatively</strong><small>Turn a blank page into ideas</small><span class="card-arrow">↗</span></button>
        <button class="suggestion-card" data-prompt="Tell me a fascinating science fact and explain why it is true."><span class="suggestion-icon green">◈</span><strong>Follow your curiosity</strong><small>Understand how things work</small><span class="card-arrow">↗</span></button>
      </div>
      <div class="welcome-signoff"><span>✦</span> No perfect prompts needed. Just start.</div>`;
    return welcome;
  }

  function renderMessages() {
    responseArea.replaceChildren();
    const conversation = getActiveConversation();
    if (!conversation || conversation.messages.length === 0) {
      responseArea.appendChild(createWelcomeScreen());
      return;
    }
    conversation.messages.forEach((message, index) => appendMessage(message.role, message.text, index));
    scrollToBottom();
  }

  // Render a safe, lightweight subset of Gemini's Markdown without injecting HTML.
  function renderMarkdown(container, markdown) {
    container.replaceChildren();
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    let codeLines = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = document.createElement("p");
      appendInlineMarkdown(p, paragraph.join(" "));
      container.appendChild(p);
      paragraph = [];
    };
    const flushList = () => { list = null; };

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        flushParagraph(); flushList();
        if (codeLines === null) codeLines = [];
        else {
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          code.textContent = codeLines.join("\n");
          pre.appendChild(code); container.appendChild(pre); codeLines = null;
        }
        continue;
      }
      if (codeLines !== null) { codeLines.push(line); continue; }
      if (!line.trim()) { flushParagraph(); flushList(); continue; }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph(); flushList();
        const h = document.createElement(`h${heading[1].length}`);
        appendInlineMarkdown(h, heading[2]); container.appendChild(h); continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet || numbered) {
        flushParagraph();
        const tag = bullet ? "ul" : "ol";
        if (!list || list.tagName.toLowerCase() !== tag) {
          flushList(); list = document.createElement(tag); container.appendChild(list);
        }
        const li = document.createElement("li");
        appendInlineMarkdown(li, (bullet || numbered)[1]); list.appendChild(li); continue;
      }
      const quote = line.match(/^\s*&gt;\s?(.*)$/) || line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flushParagraph(); flushList();
        const blockquote = document.createElement("blockquote");
        appendInlineMarkdown(blockquote, quote[1]); container.appendChild(blockquote); continue;
      }
      flushList(); paragraph.push(line.trim());
    }
    flushParagraph();
    if (codeLines !== null) {
      const pre = document.createElement("pre"); const code = document.createElement("code");
      code.textContent = codeLines.join("\n"); pre.appendChild(code); container.appendChild(pre);
    }
  }

  function appendInlineMarkdown(parent, source) {
    const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let last = 0; let match;
    while ((match = pattern.exec(source)) !== null) {
      parent.appendChild(document.createTextNode(source.slice(last, match.index)));
      let node;
      if (match[5] !== undefined) { node = document.createElement("code"); node.textContent = match[5]; }
      else if (match[6] !== undefined) { node = document.createElement("span"); node.textContent = match[6]; node.title = match[7]; }
      else if (match[1] || match[2]) { node = document.createElement("strong"); node.textContent = match[2] || match[4]; }
      else { node = document.createElement("em"); node.textContent = match[4]; }
      parent.appendChild(node); last = pattern.lastIndex;
    }
    parent.appendChild(document.createTextNode(source.slice(last)));
  }

  // TTS should receive readable prose, not Markdown markers, emoji names, or URLs.
  function cleanTextForSpeech(markdown) {
    return String(markdown || "")
      .replace(/```[\s\S]*?```/g, " Code example omitted. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/\*\*|__|(?<!\*)\*(?!\*)|(?<!_)_(?!_)/g, "")
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
      .replace(/[\t ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+([,.;!?])/g, "$1")
      .trim();
  }

  function appendMessage(role, text, index) {
    const isUser = role === "user";
    const message = document.createElement("article");
    message.className = `message ${isUser ? "user-message" : "ai-message"}`;
    if (!isUser) message.dataset.messageIndex = String(index);

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = isUser ? "V" : "✳";

    const content = document.createElement("div");
    content.className = "message-content";
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = isUser ? "You" : "Voxora";

    const messageText = document.createElement("div");
    messageText.className = "message-text";
    if (isUser) {
      messageText.textContent = text;
    } else {
      renderMarkdown(messageText, text);
    }
    content.append(label, messageText);

    if (!isUser) {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      const isLatestAssistant = isLatestAssistantMessage(index);
      actions.append(
        makeActionButton("listen", "▶ Listen", "primary-action"),
        makeActionButton("pause", "Ⅱ Pause"),
        makeActionButton("stop", "■ Stop"),
        makeActionButton("copy", "Copy"),
      );
      if (isLatestAssistant) actions.append(makeActionButton("regenerate", "↻ Regenerate"));
      content.appendChild(actions);
    }

    message.append(avatar, content);
    responseArea.appendChild(message);
    scrollToBottom();
    return message;
  }

  function makeActionButton(action, label, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `message-action ${extraClass}`.trim();
    button.dataset.action = action;
    button.textContent = label;
    if (action === "pause" || action === "stop") button.disabled = true;
    return button;
  }

  function isLatestAssistantMessage(index) {
    const conversation = getActiveConversation();
    if (!conversation) return false;
    let lastAssistant = -1;
    conversation.messages.forEach((message, i) => {
      if (message.role === "assistant") lastAssistant = i;
    });
    return index === lastAssistant;
  }

  function updateSpeechButtons() {
    responseArea.querySelectorAll(".ai-message").forEach(message => {
      const isCurrent = message === currentSpeechMessage;
      const listen = message.querySelector('[data-action="listen"]');
      const pause = message.querySelector('[data-action="pause"]');
      const stop = message.querySelector('[data-action="stop"]');
      if (!listen || !pause || !stop) return;
      const speaking = isCurrent && window.speechSynthesis?.speaking;
      const paused = isCurrent && window.speechSynthesis?.paused;
      listen.textContent = paused ? "▶ Resume" : (speaking ? "▶ Restart" : "▶ Listen");
      pause.disabled = !speaking || paused;
      stop.disabled = !isCurrent || (!speaking && !paused);
    });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => responseArea.scrollTo({
      top: responseArea.scrollHeight, behavior: "smooth"
    }));
  }

  function showTyping() {
    const typing = document.createElement("article");
    typing.className = "message ai-message";
    typing.id = "typing-message";
    typing.innerHTML = `<div class="message-avatar">✳</div><div class="message-content"><div class="message-label">Voxora</div><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    responseArea.appendChild(typing);
    scrollToBottom();
  }
  function removeTyping() { $("typing-message")?.remove(); }

  function setLoading(state) {
    isLoading = state;
    submitButton.disabled = state;
    questionInput.disabled = state;
    submitButton.innerHTML = state ? '<span class="send-loading">···</span>' : "<span>↑</span>";
    submitButton.title = state ? "Waiting for response" : "Send message";
  }

  function resizeTextarea() {
    questionInput.style.height = "auto";
    questionInput.style.height = `${Math.min(questionInput.scrollHeight, 150)}px`;
  }
  questionInput.addEventListener("input", resizeTextarea);

  async function fetchAnswerFromGemini(messages) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "PASTE_YOUR_NEW_GEMINI_API_KEY_HERE") {
      throw new Error("Add your new Gemini API key near the top of scripts.js.");
    }

    // Send the conversation, not just the latest question, so follow-up questions have context.
    const contents = messages
      .filter(message => (message.role === "user" || message.role === "assistant") && typeof message.text === "string")
      .map(message => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.text }]
      }));

    if (!contents.length || contents[contents.length - 1].role !== "user") {
      throw new Error("The conversation is not ready to send. Please try again.");
    }

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
      })
    };

    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(GEMINI_ENDPOINT, requestOptions);
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const answer = data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "").join("").trim();
          if (answer) return answer;
          throw new Error(data.promptFeedback?.blockReason || "Gemini returned an empty response.");
        }

        const message = data.error?.message || `HTTP ${response.status}`;
        if ([429, 500, 503, 504].includes(response.status) && attempt < 2) {
          lastError = new Error(`HTTP ${response.status}: ${message}`);
          await delay(900 * (2 ** attempt));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${message}`);
      } catch (error) {
        lastError = error;
        const isHttpError = /^HTTP \d+:/.test(error.message) || error.message.includes("Gemini returned");
        if (isHttpError && !/HTTP (429|500|503|504):/.test(error.message)) throw error;
        if (attempt === 2) break;
        await delay(900 * (2 ** attempt));
      }
    }
    throw new Error(lastError?.message || "Unable to reach Gemini. Check your connection and try again.");
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function askQuestion() {
    if (isLoading) return;
    const question = questionInput.value.trim();
    if (!question) return;
    stopSpeech();

    if (!activeConversationId) createConversation();
    const conversation = getActiveConversation();
    if (!conversation) return;

    conversation.messages.push({ role: "user", text: question });
    if (conversation.messages.filter(item => item.role === "user").length === 1) {
      conversation.title = question.length > 38 ? `${question.slice(0, 38)}…` : question;
    }
    conversation.updatedAt = Date.now();
    saveConversations();

    appendMessage("user", question);
    questionInput.value = "";
    resizeTextarea();
    closeMobileSidebar();
    setLoading(true);
    showTyping();

    await generateAssistantAnswer(conversation);
  }

  async function generateAssistantAnswer(conversation) {
    setLoading(true);
    if (!$("typing-message")) showTyping();
    try {
      const answer = await fetchAnswerFromGemini(conversation.messages);
      removeTyping();
      conversation.messages.push({ role: "assistant", text: answer });
      conversation.updatedAt = Date.now();
      saveConversations();
      renderMessages();
      renderHistory();
      const latestMessage = responseArea.querySelector(".ai-message:last-of-type");
      if (settings.autoSpeak) speak(answer, latestMessage);
    } catch (error) {
      removeTyping();
      const errorMessage = `I couldn't get a response just now.\n${error.message}`;
      conversation.messages.push({ role: "assistant", text: errorMessage });
      conversation.updatedAt = Date.now();
      saveConversations();
      renderMessages();
      renderHistory();
    } finally {
      setLoading(false);
      questionInput.focus();
    }
  }

  async function regenerateLatestAnswer() {
    if (isLoading) return;
    const conversation = getActiveConversation();
    if (!conversation || !conversation.messages.length) return;
    const last = conversation.messages[conversation.messages.length - 1];
    if (last.role !== "assistant") return;
    stopSpeech();
    conversation.messages.pop();
    saveConversations();
    renderMessages();
    setLoading(true);
    showTyping();
    await generateAssistantAnswer(conversation);
  }

  // Speech synthesis uses voices supplied by the browser/operating system.
  function getSelectedVoice() {
    return availableVoices.find(voice => voice.voiceURI === settings.voiceURI) ||
      availableVoices.find(voice => /en-US/i.test(voice.lang) && /Google|Natural|Aria|Jenny|Samantha|Ava/i.test(voice.name)) ||
      availableVoices.find(voice => /en-US/i.test(voice.lang)) ||
      availableVoices.find(voice => /^en/i.test(voice.lang)) || null;
  }

  function populateVoices() {
    if (!("speechSynthesis" in window)) {
      voiceSelect.innerHTML = '<option value="">Speech not supported</option>';
      voiceNote.textContent = "This browser does not support speech synthesis.";
      return;
    }
    availableVoices = speechSynthesis.getVoices();
    const englishVoices = availableVoices.filter(voice => /^en/i.test(voice.lang));
    const voices = englishVoices.length ? englishVoices : availableVoices;
    voiceSelect.replaceChildren();

    if (!voices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No voices available";
      voiceSelect.appendChild(option);
      voiceNote.textContent = "Your browser has not provided any voices yet. Try reopening this panel.";
      return;
    }

    voices.forEach(voice => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})${voice.default ? " — Default" : ""}`;
      voiceSelect.appendChild(option);
    });
    const selected = voices.find(voice => voice.voiceURI === settings.voiceURI) || getSelectedVoice() || voices[0];
    settings.voiceURI = selected.voiceURI;
    voiceSelect.value = selected.voiceURI;
    saveSettings();
    voiceNote.textContent = "Voice quality depends on voices installed on your device. Some systems offer more natural voices than others.";
  }

  function speak(text, messageElement) {
    if (!("speechSynthesis" in window)) {
      voiceNote.textContent = "Speech synthesis is not supported in this browser.";
      return;
    }
    speechSynthesis.cancel();
    currentSpeechMessage = messageElement || null;
    const speechText = cleanTextForSpeech(text);
    if (!speechText) return;
    currentSpeechText = speechText;
    speechUtterance = new SpeechSynthesisUtterance(speechText);
    const voice = getSelectedVoice();
    if (voice) {
      speechUtterance.voice = voice;
      speechUtterance.lang = voice.lang;
    } else {
      speechUtterance.lang = "en-US";
    }
    speechUtterance.rate = settings.rate;
    speechUtterance.pitch = 1;
    speechUtterance.volume = 1;
    speechUtterance.onend = () => {
      currentSpeechMessage = null;
      currentSpeechText = "";
      speechUtterance = null;
      updateSpeechButtons();
    };
    speechUtterance.onerror = event => {
      if (event.error !== "canceled" && event.error !== "interrupted") {
        console.warn("Speech synthesis error:", event.error);
      }
      currentSpeechMessage = null;
      currentSpeechText = "";
      speechUtterance = null;
      updateSpeechButtons();
    };
    speechSynthesis.speak(speechUtterance);
    updateSpeechButtons();
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    currentSpeechMessage = null;
    currentSpeechText = "";
    speechUtterance = null;
    updateSpeechButtons();
  }

  function pauseSpeech() {
    if (!("speechSynthesis" in window) || !speechSynthesis.speaking || speechSynthesis.paused) return;
    speechSynthesis.pause();
    updateSpeechButtons();
  }

  function resumeSpeech() {
    if (!("speechSynthesis" in window) || !speechSynthesis.paused) return;
    speechSynthesis.resume();
    updateSpeechButtons();
  }

  autoSpeakInput.checked = settings.autoSpeak;
  autoSpeakInput.addEventListener("change", () => {
    settings.autoSpeak = autoSpeakInput.checked;
    saveSettings();
    if (!settings.autoSpeak) stopSpeech();
  });
  voiceSelect.addEventListener("change", () => {
    settings.voiceURI = voiceSelect.value;
    saveSettings();
  });
  speechRateInput.value = String(settings.rate);
  rateValue.value = `${settings.rate.toFixed(2)}×`;
  speechRateInput.addEventListener("input", () => {
    settings.rate = Number(speechRateInput.value);
    rateValue.value = `${settings.rate.toFixed(2)}×`;
    saveSettings();
  });
  if ("speechSynthesis" in window) {
    populateVoices();
    speechSynthesis.addEventListener?.("voiceschanged", populateVoices);
    window.addEventListener("load", populateVoices, { once: true });
  } else {
    populateVoices();
  }

  function startRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input is not supported in this browser. Try the latest version of Chrome.");
      return;
    }
    if (isLoading) return;
    if (isListening) {
      recognition?.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    isListening = true;
    voiceButton.classList.add("listening");
    voiceButton.title = "Listening… click to stop";
    $("mic-icon").textContent = "●";

    recognition.onresult = event => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      questionInput.value = `${finalTranscript || interimTranscript}`.trim();
      resizeTextarea();
    };
    recognition.onerror = event => {
      console.warn("Voice input:", event.error);
      if (event.error === "not-allowed") alert("Microphone permission is blocked. Allow microphone access in your browser settings.");
    };
    recognition.onend = () => {
      isListening = false;
      voiceButton.classList.remove("listening");
      voiceButton.title = "Speak your message";
      $("mic-icon").textContent = "♩";
      questionInput.focus();
    };
    try {
      recognition.start();
    } catch (error) {
      isListening = false;
      voiceButton.classList.remove("listening");
      $("mic-icon").textContent = "♩";
      console.warn(error);
    }
  }

  function openMobileSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
  }
  function closeMobileSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
  }
  menuToggle.addEventListener("click", openMobileSidebar);
  closeSidebarButton.addEventListener("click", closeMobileSidebar);
  sidebarOverlay.addEventListener("click", closeMobileSidebar);

  submitButton.addEventListener("click", askQuestion);
  voiceButton.addEventListener("click", startRecognition);
  newChatButton.addEventListener("click", () => {
    if (isLoading) return;
    stopSpeech();
    activeConversationId = null;
    renderHistory();
    renderMessages();
    questionInput.value = "";
    resizeTextarea();
    closeMobileSidebar();
    questionInput.focus();
  });

  questionInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askQuestion();
    }
  });

  responseArea.addEventListener("click", async event => {
    const card = event.target.closest(".suggestion-card");
    if (card && !isLoading) {
      questionInput.value = card.dataset.prompt || "";
      askQuestion();
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const messageElement = actionButton.closest(".ai-message");
    const messageIndex = Number(messageElement?.dataset.messageIndex);
    const conversation = getActiveConversation();
    const message = conversation?.messages[messageIndex];
    if (!message || message.role !== "assistant") return;

    if (action === "listen") {
      if (messageElement === currentSpeechMessage && speechSynthesis.paused) resumeSpeech();
      else speak(message.text, messageElement);
    } else if (action === "pause") {
      if (messageElement === currentSpeechMessage) pauseSpeech();
    } else if (action === "stop") {
      if (messageElement === currentSpeechMessage) stopSpeech();
    } else if (action === "copy") {
      try {
        await navigator.clipboard.writeText(message.text);
        actionButton.textContent = "Copied!";
        setTimeout(() => { actionButton.textContent = "Copy"; }, 1300);
      } catch {
        actionButton.textContent = "Copy unavailable";
        setTimeout(() => { actionButton.textContent = "Copy"; }, 1500);
      }
    } else if (action === "regenerate" && isLatestAssistantMessage(messageIndex)) {
      regenerateLatestAnswer();
    }
  });

  // Initial setup
  applyTheme(["system", "light", "dark"].includes(themeMode) ? themeMode : "system");
  renderHistory();
  renderMessages();
  resizeTextarea();
});