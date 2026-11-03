
 document.addEventListener("DOMContentLoaded", () => {
  "use strict";
  // Gemini requests go through the Cloudflare Worker; no API key is stored in this file.
  const BACKEND_ENDPOINT = "https://voxora-backend.vibhu-shrivastava24.workers.dev";

const STORAGE_KEY = "smart_ai_conversations_v2"; // Keeps your existing saved chats.
  const THEME_KEY = "voxora_theme_v1";
  const SETTINGS_KEY = "voxora_settings_v1";
  const PROFILE_NAME_KEY = "voxora_profile_name_v1";
  const QUOTE_KEY = "voxora_sidebar_quote_v1";
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
  let resumeSpeechAfterRecognition = false;
  let availableVoices = [];
  let currentSpeechMessage = null;
  let currentSpeechText = "";
  let speechUtterance = null;
  let themeMode = localStorage.getItem(THEME_KEY) || "system";
  let settings = loadSettings();
  let profileName = (localStorage.getItem(PROFILE_NAME_KEY) || "").trim();

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
      const entry = document.createElement("div");
      entry.className = "history-entry";
      const button = document.createElement("button");
      button.className = "history-item";
      button.type = "button";
      if (conversation.id === activeConversationId) button.classList.add("active");
      const icon = document.createElement("span");
      icon.textContent = "◈";
      const title = document.createElement("span");
      title.textContent = conversation.title || "Conversation";
      button.append(icon, title);
      let holdTimer = null;
      let holdTriggered = false;
      const clearHold = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; };
      button.addEventListener("pointerdown", () => {
        if (isLoading) return;
        holdTriggered = false;
        clearHold();
        holdTimer = setTimeout(() => {
          holdTriggered = true;
          showConversationDeleteConfirmation(entry, conversation);
        }, 600);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach(type => button.addEventListener(type, clearHold));
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        if (!isLoading) { holdTriggered = true; showConversationDeleteConfirmation(entry, conversation); }
      });
      button.addEventListener("click", () => {
        if (holdTriggered) { holdTriggered = false; return; }
        if (isLoading) return;
        stopSpeech();
        activeConversationId = conversation.id;
        renderHistory();
        renderMessages();
        closeMobileSidebar();
      });
      entry.appendChild(button);
      historyElement.appendChild(entry);
    });
  }

  function showConversationDeleteConfirmation(entry, conversation) {
    if (entry.querySelector(".history-delete-confirmation")) return;
    const confirmation = document.createElement("div");
    confirmation.className = "history-delete-confirmation";
    const prompt = document.createElement("span");
    prompt.textContent = "Delete this conversation?";
    const actions = document.createElement("div");
    actions.className = "history-delete-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "history-delete-cancel";
    cancel.textContent = "Cancel";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete-confirm";
    remove.textContent = "Delete";
    cancel.addEventListener("click", () => confirmation.remove());
    remove.addEventListener("click", () => {
      if (activeConversationId === conversation.id) {
        stopSpeech();
        activeConversationId = null;
        renderMessages();
      }
      conversations = conversations.filter(item => item.id !== conversation.id);
      saveConversations();
      renderHistory();
    });
    actions.append(cancel, remove);
    confirmation.append(prompt, actions);
    entry.appendChild(confirmation);
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
    avatar.textContent = isUser ? (profileName.charAt(0).toUpperCase() || "V") : "✳";

    const content = document.createElement("div");
    content.className = "message-content";
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = isUser ? (profileName || "You") : "Voxora";

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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
      })
    };

    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(BACKEND_ENDPOINT, requestOptions);
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

  function getLocalAnswer(question) {
    const q = String(question || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const answers = [
      [/^(who am i|what is my name|do you know my name)\b/, profileName ? `You are ${profileName}.` : "I do not know your name yet. Click your profile name in the sidebar to add it."],
      [/^(who made you|who created you|who is your creator|who built you)\b/, "I was created for the VOXORA project by Vibhor Shrivastava."],
      [/^(what is your name|who are you|introduce yourself)\b/, "I'm VOXORA, a personal AI assistant designed to help with questions, learning, ideas, and everyday problem-solving."],
      [/^(what is voxora|tell me about voxora)\b/, "VOXORA is a personal AI assistant website. It uses a Gemini model through a private backend and keeps chat history locally in this browser."],
      [/^(what can you do|your capabilities|what are your capabilities)\b/, "I can explain concepts, help with writing, brainstorm ideas, answer questions, assist with coding, and support learning. General questions use Gemini; a few basic questions are answered locally."],
      [/^(are you human|are you a person)\b/, "No. I'm an AI assistant, not a human."],
      [/^(are you free|does voxora cost money|is voxora free)\b/, "The current VOXORA version is designed to use available free-tier services, but those services can have usage limits and their terms may change."],
      [/^(do you remember me|do you have memory)\b/, "VOXORA stores conversation history in this browser's local storage. It does not provide shared cloud memory across devices."],
      [/^(where are my chats stored|where is chat history stored|do you store my chats)\b/, "Saved chats are stored locally in this browser on this device. Clearing browser site data can remove them, and they do not automatically sync to another device."],
      [/^(can i use you offline|do you work offline)\b/, "The local interface and saved chats can open offline, but Gemini-powered answers need an internet connection."],
      [/^(do you support voice|can you speak|how does voice work)\b/, "VOXORA uses your browser's built-in speech synthesis for spoken replies. Voice availability and choices depend on your browser and device."],
      [/^(can i change your voice|how do i change voice)\b/, "Open Settings and choose an available voice. You can also adjust speech rate and automatic speaking."],
      [/^(how do i change theme|can i change theme|dark mode)\b/, "Use the theme control in the top bar or choose System, Light, or Dark in Settings."],
      [/^(what model do you use|which ai model|which model powers you)\b/, "VOXORA sends requests to the Gemini model configured in its Cloudflare Worker backend."],
      [/^(can you browse the internet|do you have internet access)\b/, "This version does not have a dedicated live web-search feature."],
      [/^(can you help with maths|do you know maths|math help)\b/, "Yes. I can explain mathematical ideas, show worked examples, and help check calculations."],
      [/^(can you help with science|science help)\b/, "Yes. I can explain physics, chemistry, biology, and other science topics step by step."],
      [/^(can you help me study|help me study|study help)\b/, "Yes. I can explain topics, make revision plans, create practice questions, and help review your answers."],
      [/^(can you write code|coding help|can you program)\b/, "Yes. I can explain code, help debug errors, and write examples in common programming languages."],
      [/^(what languages do you know|which languages can you use)\b/, "I can work with many languages, including English and Hindi, though accuracy can vary by language and task."],
      [/^(can you generate images|do you make images)\b/, "This version of VOXORA is currently a text-chat assistant and does not include image generation."],
      [/^(can you read files|can i upload files)\b/, "File upload and document reading are not currently built into this version of VOXORA."],
      [/^(is my api key safe|where is the api key|is the key public)\b/, "The Gemini key is stored as a Secret in the Cloudflare Worker, not in the public website code. Never share it or commit it to GitHub."],
      [/^(does voxora sync|can i use chats on another device)\b/, "Not currently. Chats are stored separately in each browser's local storage; cloud sync and accounts are future features."],
      [/^(what are your limitations|what can t you do|your limitations)\b/, "I can make mistakes, may not know current information, and cannot access private files or accounts unless a feature explicitly connects them. Verify important information independently."]
    ];
    const match = answers.find(([pattern]) => pattern.test(q));
    return match ? match[1] : null;
  }

  async function generateAssistantAnswer(conversation) {
    setLoading(true);
    if (!$("typing-message")) showTyping();
    try {
      const latestUserMessage = [...conversation.messages].reverse().find(item => item.role === "user");
      const localAnswer = latestUserMessage ? getLocalAnswer(latestUserMessage.text) : null;
      const answer = localAnswer || await fetchAnswerFromGemini(conversation.messages);
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

    resumeSpeechAfterRecognition = Boolean("speechSynthesis" in window && speechSynthesis.speaking && !speechSynthesis.paused);
    if (resumeSpeechAfterRecognition) pauseSpeech();

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
      if (resumeSpeechAfterRecognition) {
        resumeSpeechAfterRecognition = false;
        if (!isLoading) resumeSpeech();
      }
      questionInput.focus();
    };
    try {
      recognition.start();
    } catch (error) {
      isListening = false;
      voiceButton.classList.remove("listening");
      $("mic-icon").textContent = "♩";
      if (resumeSpeechAfterRecognition) {
        resumeSpeechAfterRecognition = false;
        resumeSpeech();
      }
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

  const sidebarQuotes = [
    "A thoughtful space for curious minds.",
    "Stay curious. Keep asking better questions.",
    "Small questions can lead to big discoveries.",
    "Make room for ideas that challenge you.",
    "Learn deeply. Think independently.",
    "Every expert was once a beginner.",
    "Curiosity turns uncertainty into discovery.",
    "Good questions are the start of progress.",
    "Explore widely. Understand carefully.",
    "One idea can change how you see everything.",
    "Think clearly. Create boldly.",
    "Keep learning beyond the obvious."
  ];

  function applyProfileName() {
    const avatar = document.querySelector(".profile-avatar");
    const name = document.querySelector(".profile-info strong");
    if (avatar) avatar.textContent = profileName.charAt(0).toUpperCase() || "V";
    if (name) {
      name.textContent = profileName || "Your workspace";
      name.title = "Click to change your name";
      name.style.cursor = "pointer";
      name.onclick = changeProfileName;
    }
  }

  function changeProfileName() {
    const next = window.prompt("What name should VOXORA use?", profileName);
    if (next === null) return;
    const clean = next.trim().slice(0, 32);
    if (!clean) { window.alert("Please enter a name."); return; }
    profileName = clean;
    localStorage.setItem(PROFILE_NAME_KEY, profileName);
    applyProfileName();
    renderMessages();
  }

  function showNameSetup() {
    const overlay = document.createElement("div");
    overlay.className = "name-setup-overlay";
    const panel = document.createElement("form");
    panel.className = "name-setup-card";
    const mark = document.createElement("div");
    mark.className = "name-setup-mark";
    mark.textContent = "✳";
    const heading = document.createElement("h2");
    heading.textContent = "Welcome to VOXORA";
    const description = document.createElement("p");
    description.textContent = "What should I call you?";
    const input = document.createElement("input");
    input.type = "text"; input.maxLength = 32; input.autocomplete = "given-name";
    input.placeholder = "Your name"; input.required = true;
    const submit = document.createElement("button");
    submit.type = "submit"; submit.textContent = "Continue";
    panel.append(mark, heading, description, input, submit);
    panel.addEventListener("submit", event => {
      event.preventDefault();
      const clean = input.value.trim().slice(0, 32);
      if (!clean) return;
      profileName = clean;
      localStorage.setItem(PROFILE_NAME_KEY, profileName);
      applyProfileName();
      overlay.remove();
    });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
  }

  function rotateSidebarQuote() {
    const quote = document.querySelector(".sidebar-note span:last-child");
    if (!quote) return;
    const previous = Number(localStorage.getItem(QUOTE_KEY));
    let next = Math.floor(Math.random() * sidebarQuotes.length);
    if (sidebarQuotes.length > 1 && next === previous) next = (next + 1) % sidebarQuotes.length;
    localStorage.setItem(QUOTE_KEY, String(next));
    quote.textContent = sidebarQuotes[next];
  }

  // Initial setup
  applyTheme(["system", "light", "dark"].includes(themeMode) ? themeMode : "system");
  applyProfileName();
  rotateSidebarQuote();
  if (!profileName) showNameSetup();
  renderHistory();
  renderMessages();
  resizeTextarea();
});