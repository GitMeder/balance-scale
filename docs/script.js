(() => {
  const joinScreen = document.getElementById("join-screen");
  const joinForm = document.getElementById("joinForm");
  const joinHint = document.getElementById("joinHint");
  const nameInput = document.getElementById("playerName");
  const lobbyCodeInput = document.getElementById("lobbyCodeInput");
  const createLobbyBtn = document.getElementById("createLobbyBtn");
  const joinLobbyBtn = document.getElementById("joinLobbyBtn");
  const statusMessage = document.getElementById("statusMessage");
  const resultMessage = document.getElementById("resultMessage");
  const roundNumberLabel = document.getElementById("roundNumberLabel");
  const playersList = document.getElementById("playersList");
  const numberGridSection = document.getElementById("numberGridSection");
  const numberGrid = document.getElementById("numberGrid");
  const selectedNumberLabel = document.getElementById("selectedNumberLabel");
  const hostPanel = document.getElementById("hostPanel");
  const hostStatus = document.getElementById("hostStatus");
  const hostHint = document.getElementById("hostHint");
  const startRoundBtn = document.getElementById("startRoundBtn");
  const nextRoundBtn = document.getElementById("nextRoundBtn");
  const rulesList = document.getElementById("rulesList");
  const averageValue = document.getElementById("averageValue");
  const targetValue = document.getElementById("targetValue");
  const choicesContainer = document.getElementById("choicesContainer");
  const choicesBody = document.getElementById("choicesBody");
  const fillBotsBtn = document.getElementById("fillBotsBtn");
  const infoModal = document.getElementById("infoModal");
  const infoModalTitle = document.getElementById("infoModalTitle");
  const infoModalText = document.getElementById("infoModalText");
  const infoModalClose = document.getElementById("infoModalClose");
  const lobbyCodeBanner = document.getElementById("lobbyCodeBanner");
  const lobbyCodeValue = document.getElementById("lobbyCodeValue");
  const copyLobbyLinkBtn = document.getElementById("copyLobbyLinkBtn");
  const chatPanel = document.getElementById("chatPanel");
  const chatMessagesList = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const emojiToggleBtn = document.getElementById("emojiToggleBtn");
  const emojiPicker = document.getElementById("emojiPicker");
  const chatTypingIndicator = document.getElementById("chatTypingIndicator");
  const chatTypingText = document.getElementById("chatTypingText");

  function normalizeLobbyCode(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/[^0-9a-z]/gi, "").toUpperCase();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const lobbyFromQuery = urlParams.get("lobby") || "";
  const serverFromQuery = urlParams.get("server") || "";
  const configServerUrl =
    (window.APP_CONFIG && typeof window.APP_CONFIG.socketUrl === "string"
      ? window.APP_CONFIG.socketUrl
      : "") || "";
  const initialLobbyCode = normalizeLobbyCode(lobbyFromQuery);
  const inviteLockedLobbyId = initialLobbyCode || null;
  const socketTarget = serverFromQuery || configServerUrl || undefined;
  const socket = window.io ? window.io(socketTarget || undefined, { autoConnect: true }) : null;

  const NAME_LIMIT = 24;
  const MAX_LOBBY_CODE_LENGTH = 8;
  const CLIENT_ID_STORAGE_KEY = "balanceScaleClientId";
  const PLAYER_COLORS = [
    "#ef4444",
    "#f97316",
    "#facc15",
    "#22c55e",
    "#0ea5e9",
    "#6366f1",
    "#a855f7",
    "#ec4899",
    "#14b8a6",
    "#fb7185",
  ];

  const DEFAULT_RULES = [
    "Submit a whole number between 0 and 100. Closest to 0.8x the lobby average wins.",
  ];
  const CHAT_MESSAGE_LIMIT = 200;
  const TYPING_REFRESH_INTERVAL = 2200;

  function generateClientId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return (
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10)
    ).toUpperCase();
  }

  function getOrCreateClientId() {
    try {
      const store = window.sessionStorage;
      const stored = store.getItem(CLIENT_ID_STORAGE_KEY);
      if (stored) {
        return stored;
      }
      const next = generateClientId();
      store.setItem(CLIENT_ID_STORAGE_KEY, next);
      return next;
    } catch (error) {
      console.warn("Unable to access sessionStorage for client id:", error);
      return generateClientId();
    }
  }

  const persistentClientId = getOrCreateClientId();

  function getNextColor() {
    const color = PLAYER_COLORS[state.colorCursor % PLAYER_COLORS.length];
    state.colorCursor += 1;
    return color;
  }

  function getPlayerColor(name) {
    const key = name || "";
    if (!key) {
      return "#475569";
    }
    if (!state.playerColors.has(key)) {
      state.playerColors.set(key, getNextColor());
    }
    return state.playerColors.get(key);
  }

  const EMOJI_CHOICES = [
    "😀",
    "😎",
    "🤖",
    "🤔",
    "🙌",
    "🔥",
    "🎯",
    "⚡️",
    "🌟",
    "💡",
    "💥",
    "🧠",
    "🕹️",
    "💬",
    "🥳",
    "😅",
    "😴",
    "🤯",
    "🧊",
    "🚀",
  ];

  let emojiPickerOpen = false;
  const typingSignal = {
    active: false,
    lastSent: 0,
  };

  const state = {
    lobbyId: null,
    pendingLobbyId: initialLobbyCode || null,
    playerName: "",
    connected: false,
    hasSubmitted: false,
    isEliminated: false,
    roundNumber: 0,
    players: [],
    socketId: null,
    isHost: false,
    lobbyState: "waiting",
    awaitingNextRound: false,
    roundActive: false,
    minPlayers: 5,
    rules: DEFAULT_RULES,
    selectedNumber: null,
    guessEnabled: false,
    pendingAction: null,
    hasJoinedLobby: false,
    serverOverride: serverFromQuery || "",
    clientId: persistentClientId,
    awaitingChoices: false,
    allPlayersReady: false,
    readyAcknowledged: false,
    playerColors: new Map(),
    colorCursor: 0,
    latestWinners: new Set(),
    chatMessages: [],
    typingPlayers: [],
    inviteLocked: Boolean(inviteLockedLobbyId),
  };

  refreshRoundNumberLabel();
  updateJoinButtonHighlight();
  setChatAvailability(false);
  buildEmojiPicker();

  if (initialLobbyCode && lobbyCodeInput) {
    lobbyCodeInput.value = initialLobbyCode;
  }

  if (state.inviteLocked && state.pendingLobbyId && lobbyCodeInput) {
    lobbyCodeInput.value = state.pendingLobbyId;
    lobbyCodeInput.readOnly = true;
    lobbyCodeInput.classList.add("locked-input");
    lobbyCodeInput.setAttribute("aria-readonly", "true");
  }

  if (state.inviteLocked && createLobbyBtn) {
    createLobbyBtn.classList.add("hidden");
  }

  if (state.inviteLocked && joinHint && state.pendingLobbyId) {
    joinHint.textContent = `You've been invited to lobby ${state.pendingLobbyId}. Pick a name to join.`;
  }

  if (!socket) {
    console.error("Socket.IO client failed to load.");
    setStatus("Unable to load Socket.IO client library.");
    return;
  }

  function setStatus(text) {
    statusMessage.textContent = text || "";
  }

  function setResult(text, tone = "info") {
    resultMessage.textContent = text || "";
    resultMessage.classList.remove("muted", "result-positive", "result-negative");

    if (tone === "positive") {
      resultMessage.classList.add("result-positive");
    } else if (tone === "negative") {
      resultMessage.classList.add("result-negative");
    } else {
      resultMessage.classList.add("muted");
    }
  }

  const numberButtons = new Map();

  function updateNumberGridUI() {
    if (!numberGridSection || !numberGrid) {
      return;
    }

    if (selectedNumberLabel) {
      selectedNumberLabel.textContent = Number.isInteger(state.selectedNumber)
        ? String(state.selectedNumber)
        : "–";
    }

    const enableButtons = state.guessEnabled && !state.hasSubmitted && !state.isEliminated;

    numberButtons.forEach((btn, value) => {
      const isSelected = state.selectedNumber === value;
      btn.classList.toggle("selected", isSelected);
      btn.disabled = !enableButtons;
      btn.classList.toggle("disabled", !enableButtons && !isSelected);
    });
  }

  function setChatAvailability(enabled) {
    if (chatInput) {
      chatInput.disabled = !enabled;
      if (!enabled) {
        chatInput.value = "";
      }
    }
    if (chatSendBtn) {
      chatSendBtn.disabled = !enabled;
    }
    if (emojiToggleBtn) {
      emojiToggleBtn.disabled = !enabled;
      if (!enabled) {
        closeEmojiPicker();
      }
    }
    if (!enabled) {
      emitTypingState(false);
      clearTypingIndicator();
    }
  }

  function resetTypingSignal() {
    typingSignal.active = false;
    typingSignal.lastSent = 0;
  }

  function emitTypingState(active) {
    if (!socket || !state.lobbyId || !state.hasJoinedLobby) {
      typingSignal.active = active && typingSignal.active;
      return;
    }
    const now = Date.now();
    const changed = typingSignal.active !== active;
    const shouldRefresh = active && now - typingSignal.lastSent > TYPING_REFRESH_INTERVAL;
    if (!changed && !shouldRefresh) {
      return;
    }
    socket.emit("chat_typing", {
      lobby_id: state.lobbyId,
      typing: active,
    });
    typingSignal.active = active;
    typingSignal.lastSent = now;
  }

  function closeEmojiPicker() {
    if (!emojiPicker) {
      emojiPickerOpen = false;
      return;
    }
    emojiPicker.classList.add("hidden");
    emojiPicker.setAttribute("aria-hidden", "true");
    if (emojiToggleBtn) {
      emojiToggleBtn.setAttribute("aria-expanded", "false");
    }
    emojiPickerOpen = false;
  }

  function openEmojiPicker() {
    if (!emojiPicker || !emojiToggleBtn) {
      return;
    }
    emojiPicker.classList.remove("hidden");
    emojiPicker.setAttribute("aria-hidden", "false");
    emojiToggleBtn.setAttribute("aria-expanded", "true");
    emojiPickerOpen = true;
  }

  function toggleEmojiPicker() {
    if (!emojiPicker || !emojiToggleBtn || emojiToggleBtn.disabled) {
      return;
    }
    if (emojiPickerOpen) {
      closeEmojiPicker();
    } else {
      openEmojiPicker();
    }
  }

  function insertEmojiAtCursor(emoji) {
    if (!chatInput || typeof emoji !== "string") {
      return;
    }
    const input = chatInput;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = `${before}${emoji}${after}`;
    const newPos = start + emoji.length;
    input.focus();
    input.setSelectionRange(newPos, newPos);
  }

  function buildEmojiPicker() {
    if (!emojiPicker) {
      return;
    }
    emojiPicker.innerHTML = "";
    EMOJI_CHOICES.forEach((emoji) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "emoji-option";
      button.dataset.emoji = emoji;
      button.textContent = emoji;
      emojiPicker.appendChild(button);
    });
  }

  function normalizeChatMessage(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const text = typeof entry.message === "string" ? entry.message.trim() : "";
    if (!text) {
      return null;
    }
    const timestamp =
      typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
        ? entry.timestamp
        : Date.now();
    return {
      id: entry.id || `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : "Player",
      playerId: entry.player_id || entry.playerId || null,
      message: text,
      timestamp,
    };
  }

  function formatChatTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function isNearBottom(element) {
    if (!element) {
      return true;
    }
    const threshold = 48;
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  }

  function renderChatMessages(forceScroll = false) {
    if (!chatMessagesList) {
      return;
    }

    const shouldStick = forceScroll || isNearBottom(chatMessagesList);
    chatMessagesList.innerHTML = "";

    if (!state.chatMessages.length) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "No messages yet.";
      chatMessagesList.appendChild(empty);
      return;
    }

    state.chatMessages.forEach((entry) => {
      const wrapper = document.createElement("div");
      wrapper.className = "chat-message";
      if (
        (entry.playerId && socket && entry.playerId === socket.id) ||
        entry.name === state.playerName
      ) {
        wrapper.classList.add("chat-message-self");
      }

      const header = document.createElement("div");
      header.className = "chat-message-header";

      const author = document.createElement("span");
      author.className = "chat-author";
      author.textContent = entry.name;

      const timestamp = document.createElement("span");
      timestamp.className = "chat-timestamp";
      timestamp.textContent = formatChatTimestamp(entry.timestamp);

      header.appendChild(author);
      header.appendChild(timestamp);

      const body = document.createElement("div");
      body.className = "chat-text";
      body.textContent = entry.message;

      wrapper.appendChild(header);
      wrapper.appendChild(body);
      chatMessagesList.appendChild(wrapper);
    });

    if (shouldStick) {
      chatMessagesList.scrollTop = chatMessagesList.scrollHeight;
    }
  }

  function renderTypingIndicator() {
    if (!chatTypingIndicator || !chatTypingText) {
      return;
    }
    const names = Array.isArray(state.typingPlayers) ? state.typingPlayers : [];
    if (!names.length) {
      chatTypingIndicator.classList.add("hidden");
      chatTypingText.textContent = "";
      return;
    }
    let label = "";
    if (names.length === 1) {
      label = `${names[0]} is typing…`;
    } else if (names.length === 2) {
      label = `${names[0]} and ${names[1]} are typing…`;
    } else {
      label = `${names[0]}, ${names[1]} +${names.length - 2} more are typing…`;
    }
    chatTypingText.textContent = label;
    chatTypingIndicator.classList.remove("hidden");
  }

  function clearTypingIndicator() {
    state.typingPlayers = [];
    renderTypingIndicator();
  }

  function refreshRoundNumberLabel() {
    if (!roundNumberLabel) {
      return;
    }
    roundNumberLabel.textContent =
      state.roundNumber > 0 ? `Round ${state.roundNumber}` : "Round –";
  }

  function setGuessEnabled(enabled) {
    state.guessEnabled = Boolean(enabled) && !state.isEliminated;
    updateNumberGridUI();
  }

  function clearNumberHighlights() {
    numberButtons.forEach((btn) => {
      btn.classList.remove("target", "choice-self", "choice-other", "choice-highlight");
      btn.style.removeProperty("--choice-accent");
    });
  }

  function emitPlayerReady(reason = "auto") {
    if (!socket || !state.lobbyId || !state.playerName) {
      return;
    }
    if (state.isEliminated) {
      return;
    }
    socket.emit("player_ready", {
      lobby_id: state.lobbyId,
      reason,
    });
    state.readyAcknowledged = true;
  }

  function handleNumberClick(value) {
    if (
      !Number.isInteger(value) ||
      !socket ||
      !state.guessEnabled ||
      state.hasSubmitted ||
      state.isEliminated
    ) {
      return;
    }

    state.selectedNumber = value;
    state.hasSubmitted = true;
    setGuessEnabled(false);

    setStatus("Waiting for other players to submit…");
    setResult("Guess locked in. Waiting for the round to resolve…", "info");

    socket.emit("submit_number", {
      lobby_id: state.lobbyId,
      number: value,
    });
  }

  function initializeNumberGrid() {
    if (!numberGrid) {
      return;
    }
    numberGrid.innerHTML = "";
    for (let value = 0; value <= 100; value += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "number-cell disabled";
      btn.dataset.value = String(value);
      btn.textContent = value.toString();
      btn.addEventListener("click", () => handleNumberClick(value));
      numberGrid.appendChild(btn);
      numberButtons.set(value, btn);
    }
    updateNumberGridUI();
  }

  initializeNumberGrid();

  function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "";
    }
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2);
  }

  function resetRoundBreakdown() {
    averageValue.textContent = "–";
    targetValue.textContent = "–";
    choicesBody.innerHTML = "";
    choicesContainer.classList.add("hidden");
    clearNumberHighlights();
    updateNumberGridUI();
  }

  const modalQueue = [];
  let modalActive = false;

  function updateRulesList(rules) {
    if (!rulesList) {
      return;
    }
    const nextRules = Array.isArray(rules) && rules.length ? rules : DEFAULT_RULES;
    state.rules = nextRules;
    rulesList.innerHTML = "";
    nextRules.forEach((rule) => {
      const li = document.createElement("li");
      li.textContent = rule;
      rulesList.appendChild(li);
    });
  }

  updateRulesList(DEFAULT_RULES);
  function dequeueModal() {
    if (!modalQueue.length) {
      modalActive = false;
      if (infoModal) {
        infoModal.classList.add("hidden");
      }
      return;
    }
    const { title, message } = modalQueue.shift();
    if (infoModal && infoModalTitle && infoModalText) {
      infoModalTitle.textContent = title || "Notice";
      infoModalText.textContent = message || "";
      infoModal.classList.remove("hidden");
      modalActive = true;
    }
  }

  function enqueueModal(title, message) {
    modalQueue.push({ title, message });
    if (!modalActive) {
      dequeueModal();
    }
  }

  if (infoModalClose) {
    infoModalClose.addEventListener("click", () => {
      if (infoModal) {
        infoModal.classList.add("hidden");
      }
      modalActive = false;
      dequeueModal();
    });
  }

  if (infoModal) {
    infoModal.addEventListener("click", (event) => {
      if (event.target === infoModal) {
        infoModal.classList.add("hidden");
        modalActive = false;
        dequeueModal();
      }
    });
  }

  function showRuleModal(message) {
    enqueueModal("New Rule", message);
  }

  function showWinnerModal(title, message) {
    enqueueModal(title, message);
  }

  function renderChoiceRows(choices = {}, winners = [], disqualified = []) {
    let rows = [];
    if (Array.isArray(choices)) {
      rows = choices
        .map((entry, index) => ({
          name: entry?.name ?? `Player ${index + 1}`,
          value:
            typeof entry?.choice === "number"
              ? entry.choice
              : typeof entry?.value === "number"
                ? entry.value
                : Number(entry?.value),
        }))
        .filter((row) => typeof row.value === "number" && !Number.isNaN(row.value));
    } else if (choices && typeof choices === "object") {
      rows = Object.entries(choices).map(([name, value]) => ({
        name,
        value: typeof value === "number" ? value : Number(value),
      }));
    }

    if (!rows.length) {
      choicesContainer.classList.add("hidden");
      choicesBody.innerHTML = "";
      return;
    }

    choicesContainer.classList.remove("hidden");
    const winnersSet = new Set(Array.isArray(winners) ? winners : []);
    const dqSet = new Set(Array.isArray(disqualified) ? disqualified : []);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    choicesBody.innerHTML = "";
    rows.forEach((row) => {
      const div = document.createElement("div");
      div.className = "choice-row";
      if (winnersSet.has(row.name)) {
        div.classList.add("choice-winner");
      } else if (dqSet.has(row.name)) {
        div.classList.add("choice-disqualified");
      }

      const color = getPlayerColor(row.name);
      div.style.setProperty("--choice-accent", color);

      const nameSpan = document.createElement("span");
      nameSpan.className = "choice-name";

      const colorDot = document.createElement("span");
      colorDot.className = "choice-color-dot";
      colorDot.style.backgroundColor = color;
      nameSpan.appendChild(colorDot);

      const label = document.createElement("span");
      label.textContent = row.name;
      nameSpan.appendChild(label);

      if (winnersSet.has(row.name)) {
        const winnerFlag = document.createElement("span");
        winnerFlag.className = "choice-winner-flag";
        winnerFlag.textContent = "Winner";
        nameSpan.appendChild(winnerFlag);
      }

      const valueSpan = document.createElement("span");
      const wholeValue = Number.isFinite(row.value)
        ? Math.max(0, Math.min(100, Math.round(row.value)))
        : 0;
      valueSpan.textContent = wholeValue.toString();

      div.appendChild(nameSpan);
      div.appendChild(valueSpan);
      choicesBody.appendChild(div);
    });
  }

  function renderRoundBreakdown(payload = {}) {
    const averageText =
      typeof payload.average === "number" ? formatNumber(payload.average) : "";
    const targetText =
      typeof payload.target === "number" ? formatNumber(payload.target) : "";
    averageValue.textContent = averageText || "–";
    targetValue.textContent = targetText || "–";
    renderChoiceRows(payload.choices, payload.winners, payload.disqualified);

    clearNumberHighlights();

    if (typeof payload.target === "number" && Number.isFinite(payload.target)) {
      const targetInt = Math.round(payload.target);
      if (numberButtons.has(targetInt)) {
        numberButtons.get(targetInt).classList.add("target");
      }
    }

    if (payload.choices && typeof payload.choices === "object") {
      Object.entries(payload.choices).forEach(([name, value]) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return;
        }
        const intValue = Math.max(0, Math.min(100, Math.round(numeric)));
        const button = numberButtons.get(intValue);
        if (!button) {
          return;
        }
        const color = getPlayerColor(name);
        button.style.setProperty("--choice-accent", color);
        button.classList.add("choice-highlight");
        if (name === state.playerName) {
          button.classList.add("choice-self");
        } else {
          button.classList.add("choice-other");
        }
      });
    }
  }

  function normalizePlayersList(data = []) {
    if (Array.isArray(data)) {
      return data
        .map((player, index) => {
          if (!player) {
            return null;
          }
          const name = player.name ?? player.id ?? `Player ${index + 1}`;
          const score =
            typeof player.score === "number"
              ? player.score
              : typeof player.points === "number"
                ? player.points
                : 0;
          const eliminated = Boolean(player.eliminated);
          const isHost = Boolean(player.is_host || player.isHost);
          const isBot = Boolean(player.is_bot || player.isBot);
          const ready =
            typeof player.ready === "boolean"
              ? player.ready
              : typeof player.is_ready === "boolean"
                ? player.is_ready
                : false;
          const choiceSubmitted = Boolean(
            player.choice_submitted || player.choiceSubmitted || player.hasSubmitted,
          );
          return { name, score, eliminated, isHost, isBot, ready, choiceSubmitted };
        })
        .filter(Boolean);
    }

    if (data && typeof data === "object") {
      return Object.entries(data).map(([name, score]) => ({
        name,
        score: typeof score === "number" ? score : Number(score) || 0,
        eliminated: false,
        isHost: false,
        isBot: false,
        ready: false,
        choiceSubmitted: false,
      }));
    }

    return [];
  }

  function updatePlayersList(data, options = {}) {
    const { persist = true } = options;
    const players = normalizePlayersList(data);

    if (!persist && state.players.length) {
      const baseline = new Map(state.players.map((player) => [player.name, player]));
      players.forEach((player) => {
        const original = baseline.get(player.name);
        if (original) {
          player.isHost = original.isHost;
          player.eliminated = original.eliminated;
        }
      });
    }

    if (persist) {
      state.players = players;
    }

    if (state.playerName) {
      const selfEntry = players.find((player) => player.name === state.playerName);
      if (selfEntry) {
        state.isEliminated = Boolean(selfEntry.eliminated);
      }
    }

    if (!players.length) {
      playersList.innerHTML = `<li class="muted">No players have joined yet.</li>`;
      return;
    }

    playersList.innerHTML = "";
    players.forEach((player, index) => {
      const li = document.createElement("li");
      li.className = "player-row";
      const color = getPlayerColor(player.name);
      li.style.setProperty("--player-accent", color);

      if (player.name === state.playerName) {
        li.classList.add("me");
      }

      if (player.eliminated) {
        li.classList.add("eliminated");
      }

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-name";
      const colorDot = document.createElement("span");
      colorDot.className = "player-color-dot";
      colorDot.style.backgroundColor = color;
      nameSpan.appendChild(colorDot);

      const nameText = document.createElement("span");
      nameText.textContent = player.name ?? `Player ${index + 1}`;
      nameSpan.appendChild(nameText);

      if (player.isHost) {
        const badge = document.createElement("span");
        badge.className = "host-badge";
        badge.textContent = "Host";
        nameSpan.appendChild(badge);
      } else if (player.isBot) {
        const badge = document.createElement("span");
        badge.className = "bot-badge";
        badge.textContent = "Bot";
        nameSpan.appendChild(badge);
      }

      if (state.latestWinners.has(player.name)) {
        li.classList.add("round-winner");
        const winnerBadge = document.createElement("span");
        winnerBadge.className = "winner-badge";
        winnerBadge.textContent = "Winner";
        nameSpan.appendChild(winnerBadge);
      }

      const showRoundStatus =
        state.awaitingChoices && !player.eliminated && state.lobbyState === "running";
      if (showRoundStatus) {
        const statusChip = document.createElement("span");
        statusChip.className = "player-round-status";
        if (player.choiceSubmitted) {
          statusChip.textContent = "Guess locked";
          statusChip.classList.add("player-round-status--locked");
        } else {
          statusChip.textContent = player.isBot ? "Calculating…" : "Choosing…";
          statusChip.classList.add("player-round-status--pending");
        }
        nameSpan.appendChild(statusChip);
      }

      const scoreSpan = document.createElement("span");
      scoreSpan.className = "player-score";
      scoreSpan.textContent =
        typeof player.score === "number" && !Number.isNaN(player.score)
          ? player.score.toString()
          : "0";

      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      playersList.appendChild(li);
    });
  }

  function syncHostRole(payload = {}) {
    if (typeof payload.min_players === "number") {
      state.minPlayers = payload.min_players;
    }
    if (typeof payload.state === "string") {
      state.lobbyState = payload.state;
    }
    if (typeof payload.awaiting_next_round === "boolean") {
      state.awaitingNextRound = payload.awaiting_next_round;
    }
    if (typeof payload.awaiting_choices === "boolean") {
      state.awaitingChoices = payload.awaiting_choices;
    }
    if (typeof payload.all_players_ready === "boolean") {
      state.allPlayersReady = payload.all_players_ready;
    }
    if (typeof payload.round === "number") {
      state.roundNumber = payload.round;
    }

    if (typeof payload.state === "string" && typeof payload.awaiting_choices === "boolean") {
      state.roundActive = payload.state === "running" && payload.awaiting_choices;
    }

    if (socket && socket.id) {
      state.socketId = socket.id;
    }

    const hostId = payload.host_id;
    state.isHost = Boolean(hostId && state.socketId && hostId === state.socketId);
  }

  function updateHostControls(meta = {}) {
    if (!hostPanel) {
      return;
    }

    if (!state.isHost) {
      hostPanel.classList.add("hidden");
      hostStatus.textContent = "Waiting for the host…";
      hostHint.textContent = "";
      startRoundBtn.classList.add("hidden");
      nextRoundBtn.classList.remove("hidden");
      nextRoundBtn.disabled = true;
      if (fillBotsBtn) {
        fillBotsBtn.disabled = true;
      }
      return;
    }

    hostPanel.classList.remove("hidden");
    const playerCount = meta.player_count ?? state.players.length;
    const deficit = Math.max(state.minPlayers - playerCount, 0);
    const enoughPlayers = playerCount >= state.minPlayers;
    const waitingForFirstRound = state.lobbyState === "waiting";
    const readyForInitialStart = waitingForFirstRound && !state.roundActive;
    const readyForNextRound =
      state.lobbyState === "running" && state.awaitingNextRound && !state.roundActive;
    const canFillBots = deficit > 0 && !state.roundActive && waitingForFirstRound;
    const allReady = state.allPlayersReady;

    startRoundBtn.classList.toggle("hidden", state.roundActive || !waitingForFirstRound);
    nextRoundBtn.classList.toggle("hidden", waitingForFirstRound || !readyForNextRound);
    startRoundBtn.disabled = !(enoughPlayers && readyForInitialStart && allReady);
    nextRoundBtn.disabled = !(enoughPlayers && readyForNextRound && allReady);
    if (fillBotsBtn) {
      fillBotsBtn.classList.toggle("hidden", !canFillBots);
      fillBotsBtn.disabled = !canFillBots;
      const labelCount = Math.max(deficit, 0);
      if (labelCount > 0) {
        fillBotsBtn.textContent = `Add ${labelCount} bot${labelCount === 1 ? "" : "s"}`;
      } else {
        fillBotsBtn.textContent = "Fill empty seats with bots";
      }
    }

    let statusText = "";
    let hintText = "";

    if (state.roundActive) {
      statusText = "Round is currently in progress.";
      hintText = "You can start the next round once the results are in.";
    } else if (waitingForFirstRound) {
      statusText = "Waiting to start the first round.";
      if (!enoughPlayers) {
        hintText = deficit
          ? `Waiting for ${deficit} more player(s). Use the bot button if needed.`
          : "Waiting for additional players.";
      } else if (!allReady) {
        hintText = "Waiting for every player to mark as ready.";
      } else {
        hintText = 'Click "Start round" when everyone is ready.';
      }
    } else if (readyForNextRound) {
      statusText = "Review the round results, then start the next round.";
      hintText = allReady
        ? 'Click "Start next round" to continue.'
        : "Waiting for every player to mark as ready.";
    } else if (state.lobbyState === "finished") {
      statusText = "Game finished.";
      hintText = "Refresh to start a new lobby.";
    } else {
      statusText = "Waiting for the current round to complete.";
    }

    hostStatus.textContent = statusText;
    hostHint.textContent = hintText;
  }

  function emitHostStartRequest() {
    if (!state.isHost || !socket) {
      return;
    }
    if (!state.allPlayersReady) {
      return;
    }
    startRoundBtn.disabled = true;
    nextRoundBtn.disabled = true;
    state.awaitingNextRound = false;
    updateHostControls();
    socket.emit("host_start_round", { lobby_id: state.lobbyId });
  }

  function emitFillBotsRequest() {
    if (!state.isHost || !socket || state.roundActive) {
      return;
    }
    socket.emit("fill_with_bots", { lobby_id: state.lobbyId });
  }

  function submitChatMessage(event) {
    if (event) {
      event.preventDefault();
    }
    if (!socket || !state.lobbyId || !chatInput || chatInput.disabled) {
      return;
    }
    const text = chatInput.value.trim();
    if (!text) {
      return;
    }
    chatInput.value = "";
    socket.emit("send_chat_message", {
      lobby_id: state.lobbyId,
      message: text,
    });
    emitTypingState(false);
  }

  function handleChatInputChange() {
    if (!chatInput || chatInput.disabled) {
      emitTypingState(false);
      return;
    }
    const hasValue = Boolean(chatInput.value.trim());
    emitTypingState(hasValue);
  }

  function updateRoundDetails(payload = {}) {
    const roundValue =
      typeof payload.round === "number" && Number.isFinite(payload.round)
        ? payload.round
        : state.roundNumber;

    if (typeof roundValue === "number" && Number.isFinite(roundValue) && roundValue > 0) {
      state.roundNumber = roundValue;
    } else if (state.lobbyState === "waiting" && !state.roundActive) {
      state.roundNumber = 0;
    }

    refreshRoundNumberLabel();
  }

  function describeScoreChange(before, after) {
    if (typeof before !== "number" || typeof after !== "number") {
      return null;
    }
    const delta = after - before;
    if (Number.isNaN(delta) || delta === 0) {
      return { text: "You won this round!", tone: "positive" };
    }
    const absDelta = Math.abs(delta);
    const label = `${absDelta} point${absDelta === 1 ? "" : "s"}`;
    return delta > 0
      ? { text: `Great job! You gained ${label}.`, tone: "positive" }
      : { text: `You lost ${label} this round.`, tone: "negative" };
  }

  function buildInviteUrl() {
    const url = new URL(window.location.href);
    if (state.lobbyId) {
      url.searchParams.set("lobby", state.lobbyId);
    }
    if (state.serverOverride) {
      url.searchParams.set("server", state.serverOverride);
    } else {
      url.searchParams.delete("server");
    }
    return url.toString();
  }

  function syncLobbyUrlInHistory() {
    if (!state.lobbyId || !window.history || typeof window.history.replaceState !== "function") {
      return;
    }
    const inviteUrl = buildInviteUrl();
    window.history.replaceState({}, "", inviteUrl);
  }

  function updateLobbyCodeBanner() {
    if (!lobbyCodeBanner || !lobbyCodeValue) {
      return;
    }
    if (state.lobbyId) {
      lobbyCodeValue.textContent = state.lobbyId;
      lobbyCodeBanner.classList.remove("hidden");
    } else {
      lobbyCodeBanner.classList.add("hidden");
    }
  }

  function copyLobbyInviteLink() {
    if (!state.lobbyId) {
      return;
    }
    const inviteUrl = buildInviteUrl();
    const flashCopied = () => {
      if (!copyLobbyLinkBtn) {
        return;
      }
      const originalText = copyLobbyLinkBtn.textContent;
      copyLobbyLinkBtn.textContent = "Copied!";
      copyLobbyLinkBtn.disabled = true;
      setTimeout(() => {
        copyLobbyLinkBtn.textContent = originalText || "Copy invite link";
        copyLobbyLinkBtn.disabled = false;
      }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteUrl).then(flashCopied).catch(() => {
        window.prompt("Share this lobby link:", inviteUrl);
      });
    } else {
      window.prompt("Share this lobby link:", inviteUrl);
    }
  }

  function setJoinButtonsDisabled(disabled) {
    if (createLobbyBtn && !state.inviteLocked) {
      createLobbyBtn.disabled = disabled;
    }
    if (joinLobbyBtn) {
      joinLobbyBtn.disabled = disabled;
    }
  }

  function updateJoinButtonHighlight() {
    if (!joinLobbyBtn) {
      return;
    }
    if (state.inviteLocked) {
      if (createLobbyBtn) {
        createLobbyBtn.classList.add("hidden");
      }
      joinLobbyBtn.classList.remove("secondary-button");
      return;
    }
    if (!createLobbyBtn) {
      return;
    }
    const hasLobbyCode = Boolean(state.pendingLobbyId);
    if (hasLobbyCode) {
      createLobbyBtn.classList.add("secondary-button");
      joinLobbyBtn.classList.remove("secondary-button");
    } else {
      createLobbyBtn.classList.remove("secondary-button");
      joinLobbyBtn.classList.add("secondary-button");
    }
  }

  function preparePlayerIdentity() {
    const chosenName = nameInput.value.trim().slice(0, NAME_LIMIT);
    if (!chosenName) {
      joinHint.textContent = "Please choose a display name first.";
      return false;
    }
    state.playerName = chosenName;
    state.isEliminated = false;
    state.roundNumber = 0;
    state.hasSubmitted = false;
    joinHint.textContent = "";
    return true;
  }

  function executePendingAction() {
    if (!state.pendingAction || !socket || !state.playerName) {
      return;
    }
    if (state.pendingAction.type === "create") {
      socket.emit("create_lobby", {
        player_name: state.playerName,
        client_id: state.clientId,
      });
    } else if (state.pendingAction.type === "join" && state.pendingAction.lobbyId) {
      emitJoinEvent(state.pendingAction.lobbyId);
    }
  }

  function requestLobbyCreation(event) {
    if (event) {
      event.preventDefault();
    }
    if (state.inviteLocked) {
      if (joinHint && state.pendingLobbyId) {
        joinHint.textContent = `This invite lets you join lobby ${state.pendingLobbyId}.`;
      }
      return;
    }
    if (!preparePlayerIdentity()) {
      return;
    }
    state.pendingLobbyId = null;
    updateJoinButtonHighlight();
    state.pendingAction = { type: "create" };
    joinHint.textContent = "Creating a fresh lobby for you…";
    setJoinButtonsDisabled(true);
    if (state.connected) {
      executePendingAction();
    } else {
      setStatus("Connecting to server…");
    }
  }

  function requestLobbyJoin(event) {
    if (event) {
      event.preventDefault();
    }
    if (!preparePlayerIdentity()) {
      return;
    }
    let targetLobby = null;
    if (state.inviteLocked) {
      targetLobby = state.pendingLobbyId || inviteLockedLobbyId;
    } else {
      const typedCode = lobbyCodeInput ? normalizeLobbyCode(lobbyCodeInput.value) : "";
      targetLobby = typedCode || state.pendingLobbyId;
    }
    if (!targetLobby) {
      joinHint.textContent = "Enter a lobby code shared by the host.";
      return;
    }
    state.pendingLobbyId = targetLobby;
    updateJoinButtonHighlight();
    state.pendingAction = { type: "join", lobbyId: targetLobby };
    joinHint.textContent = `Joining lobby ${targetLobby}…`;
    setJoinButtonsDisabled(true);
    if (state.connected) {
      executePendingAction();
    } else {
      setStatus("Connecting to server…");
    }
  }

  function handleJoinSuccess(lobbyId, options = {}) {
    if (!lobbyId) {
      return;
    }

    state.lobbyId = lobbyId;
    state.pendingLobbyId = lobbyId;
    updateJoinButtonHighlight();
    state.pendingAction = null;
    state.hasJoinedLobby = true;
    state.roundNumber = 0;
    state.roundActive = false;
    state.awaitingNextRound = false;
    state.lobbyState = "waiting";
    state.selectedNumber = null;
    state.hasSubmitted = false;
    state.awaitingChoices = false;

    setJoinButtonsDisabled(false);
    if (joinScreen) {
      joinScreen.classList.add("hidden");
    }
    if (numberGridSection) {
      numberGridSection.classList.remove("hidden");
    }
    setGuessEnabled(false);
    updateNumberGridUI();
    resetRoundBreakdown();
    updateLobbyCodeBanner();
    syncLobbyUrlInHistory();

    const joinMessage = options.created
      ? `Lobby ${lobbyId} created. Share the code or invite link with your friends.`
      : `Joined lobby "${lobbyId}". Waiting for other players…`;
    setStatus(joinMessage);
    setResult("Waiting for the first round…", "info");
    state.readyAcknowledged = false;
    state.playerColors = new Map();
    state.colorCursor = 0;
    state.latestWinners = new Set();
    state.chatMessages = [];
    renderChatMessages(true);
    clearTypingIndicator();
    if (chatPanel) {
      chatPanel.classList.remove("hidden");
    }
    setChatAvailability(true);
    refreshRoundNumberLabel();
    emitPlayerReady("post-join");
  }

  function emitJoinEvent(targetLobbyId = state.lobbyId) {
    if (!state.playerName || !socket || !targetLobbyId) {
      return;
    }

    socket.emit("join_lobby", {
      lobby_id: targetLobbyId,
      player_name: state.playerName,
      client_id: state.clientId,
    });
  }

  joinForm.addEventListener("submit", (event) => {
    if (state.inviteLocked) {
      requestLobbyJoin(event);
      return;
    }
    const inputHasCode = lobbyCodeInput && Boolean(normalizeLobbyCode(lobbyCodeInput.value));
    if (inputHasCode || state.pendingLobbyId) {
      requestLobbyJoin(event);
    } else {
      requestLobbyCreation(event);
    }
  });

  if (createLobbyBtn && !state.inviteLocked) {
    createLobbyBtn.addEventListener("click", requestLobbyCreation);
  }

  if (joinLobbyBtn) {
    joinLobbyBtn.addEventListener("click", requestLobbyJoin);
  }

  if (lobbyCodeInput) {
    lobbyCodeInput.addEventListener("input", () => {
      if (state.inviteLocked) {
        lobbyCodeInput.value = state.pendingLobbyId || inviteLockedLobbyId || "";
        return;
      }
      const normalized = normalizeLobbyCode(lobbyCodeInput.value).slice(0, MAX_LOBBY_CODE_LENGTH);
      lobbyCodeInput.value = normalized;
      state.pendingLobbyId = normalized || null;
      updateJoinButtonHighlight();
    });
  }

  if (chatForm) {
    chatForm.addEventListener("submit", submitChatMessage);
  }

  if (chatInput) {
    chatInput.addEventListener("input", handleChatInputChange);
    chatInput.addEventListener("focus", handleChatInputChange);
    chatInput.addEventListener("blur", () => emitTypingState(false));
  }

  if (emojiToggleBtn) {
    emojiToggleBtn.addEventListener("click", (event) => {
      event.preventDefault();
      toggleEmojiPicker();
    });
  }

  if (emojiPicker) {
    emojiPicker.addEventListener("click", (event) => {
      const target = event.target.closest("[data-emoji]");
      if (!target) {
        return;
      }
      event.preventDefault();
      insertEmojiAtCursor(target.dataset.emoji);
      closeEmojiPicker();
    });
  }

  document.addEventListener("click", (event) => {
    if (!emojiPickerOpen || !emojiPicker || !emojiToggleBtn) {
      return;
    }
    const withinPicker = emojiPicker.contains(event.target);
    const withinButton = emojiToggleBtn.contains(event.target);
    if (!withinPicker && !withinButton) {
      closeEmojiPicker();
    }
  });

  startRoundBtn.addEventListener("click", emitHostStartRequest);
  nextRoundBtn.addEventListener("click", emitHostStartRequest);
  fillBotsBtn.addEventListener("click", emitFillBotsRequest);

  socket.on("connect", () => {
    state.connected = true;
    state.socketId = socket.id;
    resetTypingSignal();
    if (state.pendingAction) {
      executePendingAction();
    } else if (state.playerName && state.lobbyId) {
      emitJoinEvent();
      setStatus("Connected! Waiting for the next round…");
    } else {
      setStatus("Connected! Choose a name to join.");
    }
    updateHostControls();
    if (state.hasJoinedLobby) {
      setChatAvailability(true);
    }
  });

  socket.on("connect_error", (error) => {
    console.error("Connection error:", error);
    setStatus("Unable to reach the game server. Retrying…");
  });

  socket.io.on("reconnect", (attempt) => {
    console.info("Reconnected after", attempt, "attempts");
    setStatus("Reconnected to the server.");
    state.socketId = socket.id;
    if (state.pendingAction) {
      executePendingAction();
    } else if (state.playerName && state.lobbyId && !state.isEliminated) {
      emitJoinEvent();
    }
    updateHostControls();
  });

  socket.on("disconnect", (reason) => {
    state.connected = false;
    setStatus(`Disconnected (${reason || "unknown reason"}). Trying to reconnect…`);
    state.readyAcknowledged = false;
    setChatAvailability(false);
    resetTypingSignal();
  });

  socket.on("connected", (payload = {}) => {
    if (payload.sid) {
      console.debug("Connected with server id:", payload.sid);
    }
  });

  socket.on("lobby_created", (payload = {}) => {
    const lobbyId = normalizeLobbyCode(payload.lobby_id || payload.lobbyId || "");
    if (!lobbyId) {
      setJoinButtonsDisabled(false);
      return;
    }
    handleJoinSuccess(lobbyId, { created: true });
  });

  socket.on("joined_lobby", (payload = {}) => {
    const lobbyId = normalizeLobbyCode(payload.lobby_id || payload.lobbyId || "");
    if (!lobbyId) {
      setJoinButtonsDisabled(false);
      return;
    }
    handleJoinSuccess(lobbyId);
  });

  socket.on("chat_history", (payload = {}) => {
    const lobbyId = normalizeLobbyCode(payload.lobby_id || payload.lobbyId || "");
    if (!state.lobbyId || (lobbyId && lobbyId !== state.lobbyId)) {
      return;
    }
    const incoming = Array.isArray(payload.messages) ? payload.messages : [];
    state.chatMessages = incoming
      .map(normalizeChatMessage)
      .filter(Boolean)
      .slice(-CHAT_MESSAGE_LIMIT);
    renderChatMessages(true);
    if (chatPanel) {
      chatPanel.classList.remove("hidden");
    }
    clearTypingIndicator();
    setChatAvailability(true);
  });

  socket.on("chat_message", (payload = {}) => {
    const lobbyId = normalizeLobbyCode(payload.lobby_id || payload.lobbyId || "");
    if (state.lobbyId && lobbyId && lobbyId !== state.lobbyId) {
      return;
    }
    const message = normalizeChatMessage(payload);
    if (!message) {
      return;
    }
    state.chatMessages.push(message);
    if (state.chatMessages.length > CHAT_MESSAGE_LIMIT) {
      state.chatMessages = state.chatMessages.slice(-CHAT_MESSAGE_LIMIT);
    }
    renderChatMessages();
  });

  socket.on("typing_state", (payload = {}) => {
    const lobbyId = normalizeLobbyCode(payload.lobby_id || payload.lobbyId || "");
    if (state.lobbyId && lobbyId && lobbyId !== state.lobbyId) {
      return;
    }
    const names = Array.isArray(payload.players) ? payload.players : [];
    state.typingPlayers = names.filter((name) => name && name !== state.playerName);
    renderTypingIndicator();
  });

  socket.on("error", (payload = {}) => {
    const message = payload.message || payload.error || "Server reported an error.";
    setResult(message, "negative");
    setStatus(message);
    if (!state.playerName || !state.hasJoinedLobby) {
      joinHint.textContent = message;
    }
    if (!state.hasJoinedLobby) {
      state.pendingAction = null;
      setJoinButtonsDisabled(false);
    }
  });

  socket.on("lobby_update", (payload = {}) => {
    const players = Array.isArray(payload.players) ? payload.players : payload;
    updatePlayersList(players, { persist: true });
    syncHostRole(payload);
    if (typeof payload.all_players_ready === "boolean") {
      state.allPlayersReady = payload.all_players_ready;
    }
    updateHostControls(payload);
    updateRulesList(payload.active_rules);
    updateRoundDetails(payload);
    if (typeof payload.awaiting_choices === "boolean") {
      state.awaitingChoices = payload.awaiting_choices;
    }

    if (!state.playerName) {
      return;
    }

    const playerCount =
      typeof payload.player_count === "number" ? payload.player_count : state.players.length;

    if (state.lobbyState === "waiting") {
      const remaining = Math.max(state.minPlayers - playerCount, 0);
      if (remaining > 0) {
        setStatus(`Waiting for players… (${playerCount}/${state.minPlayers})`);
      } else if (state.isHost) {
        setStatus("You can start the first round whenever you're ready.");
      } else {
        setStatus("Waiting for the host to start the first round.");
      }
    } else if (
      state.lobbyState === "running" &&
      state.awaitingChoices &&
      !state.hasSubmitted &&
      !state.isEliminated
    ) {
      setGuessEnabled(true);
      setStatus("Round in progress. Make your guess!");
    }

    if (
      state.hasJoinedLobby &&
      payload.state === "waiting" &&
      !state.roundActive &&
      !state.awaitingChoices &&
      !state.readyAcknowledged &&
      !state.isEliminated
    ) {
      emitPlayerReady("waiting-state");
    }
  });

  socket.on("game_started", (payload = {}) => {
    state.hasSubmitted = false;
    state.roundActive = true;
    state.awaitingNextRound = false;
    state.lobbyState = "running";
    state.awaitingChoices =
      typeof payload.awaiting_choices === "boolean" ? payload.awaiting_choices : true;
    state.readyAcknowledged = false;
    state.latestWinners = new Set();
    state.roundNumber = typeof payload.round === "number" ? payload.round : state.roundNumber + 1;
    resetRoundBreakdown();
    state.selectedNumber = null;
    setGuessEnabled(true);

    updateRoundDetails(payload);
    if (payload.players) {
      updatePlayersList(payload.players, { persist: true });
    }

    updateHostControls(payload);
    updateRulesList(payload.active_rules);
    if (state.players.length) {
      updatePlayersList(state.players, { persist: true });
    }

    const roundLabel = state.roundNumber || payload.round || 1;
    setStatus(`Round ${roundLabel} has started! Submit your guess.`);
    setResult("Round in progress. Make your guess!", "info");
  });

  socket.on("round_result", (payload = {}) => {
    state.hasSubmitted = false;
    state.roundActive = false;
    state.awaitingNextRound = Boolean(payload.awaiting_next_round);
    state.awaitingChoices =
      typeof payload.awaiting_choices === "boolean" ? payload.awaiting_choices : false;
    setGuessEnabled(false);

    if (Array.isArray(payload.players_after)) {
      updatePlayersList(payload.players_after, { persist: true });
    } else if (Array.isArray(payload.players)) {
      updatePlayersList(payload.players, { persist: true });
    } else if (payload.scores_after) {
      updatePlayersList(payload.scores_after, { persist: false });
    }

    updateRoundDetails(payload);
    renderRoundBreakdown(payload);
    updateHostControls(payload);
    updateRulesList(payload.active_rules);

    let message = "Round finished.";
    let tone = "info";
    const winners = Array.isArray(payload.winners) ? payload.winners : [];
    state.latestWinners = new Set(winners);

    const before = payload.scores_before?.[state.playerName];
    const after = payload.scores_after?.[state.playerName];
    const scoreChange = describeScoreChange(before, after);
    if (scoreChange) {
      message = scoreChange.text;
      tone = scoreChange.tone;
    }

    if (
      Array.isArray(payload.disqualified) &&
      payload.disqualified.includes(state.playerName)
    ) {
      message = "Duplicate choice detected. You were disqualified this round.";
      tone = "negative";
    }

    const waitingStatus = state.awaitingNextRound
      ? state.isHost
        ? "Round complete. Start the next round when you're ready."
        : "Round complete. Waiting for the host to start the next round…"
      : "Round complete.";

    setStatus(waitingStatus);
    setResult(message, tone);
    if (state.players.length) {
      updatePlayersList(state.players, { persist: true });
    }

    if (state.awaitingNextRound && !state.isEliminated) {
      state.readyAcknowledged = false;
      emitPlayerReady(`after-round-${state.roundNumber || payload.round || 0}`);
    }
  });

  socket.on("player_eliminated", (payload = {}) => {
    const eliminatedName = payload.name || payload.player;
    if (!eliminatedName) {
      return;
    }

    if (Array.isArray(payload.active_rules)) {
      updateRulesList(payload.active_rules);
    }

    const newRules = Array.isArray(payload.new_rules)
      ? payload.new_rules.filter(Boolean)
      : payload.new_rule
        ? [payload.new_rule]
        : [];
    const ruleNotice = newRules.length
      ? `${newRules.join("; ")}`
      : null;

    if (eliminatedName === state.playerName) {
      state.isEliminated = true;
      setGuessEnabled(false);
      const selfMessage = ruleNotice
        ? `${ruleNotice} You have been eliminated from the game.`
        : "You have been eliminated from the game.";
      setResult(selfMessage, "negative");
      setStatus(
        ruleNotice
          ? "You are out of the game. A new rule has been added for the remaining players."
          : "You are out of the game. Watch how it ends!"
      );
    } else {
      setStatus(`${eliminatedName} has been eliminated.`);
    }

    if (ruleNotice) {
      showRuleModal(ruleNotice);
    }
  });

  socket.on("game_over", (payload = {}) => {
    state.lobbyState = "finished";
    state.roundActive = false;
    state.awaitingNextRound = false;
    state.readyAcknowledged = false;
    setGuessEnabled(false);
    const winner =
      payload.winner ||
      (Array.isArray(payload.winners) ? payload.winners.join(", ") : null);
    if (winner) {
      showWinnerModal("Game winner", `${winner} won the game.`);
    }
    const message = winner ? "Game over." : "Game over! Thanks for playing.";
    setResult(message, "positive");
    setStatus("Game over. Waiting for the host to start a new game.");
    updateHostControls(payload);
  });

  if (copyLobbyLinkBtn) {
    copyLobbyLinkBtn.addEventListener("click", copyLobbyInviteLink);
  }
})();
