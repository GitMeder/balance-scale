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
  const roundInfo = document.getElementById("roundInfo");
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
    lastSubmissionRound: 0,
  };

  if (initialLobbyCode && lobbyCodeInput) {
    lobbyCodeInput.value = initialLobbyCode;
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
    state.lastSubmissionRound = state.roundNumber || state.lastSubmissionRound;
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
          return { name, score, eliminated, isHost, isBot };
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

  function updateRoundDetails(payload = {}) {
    const details = [];

    const round = typeof payload.round === "number" ? payload.round : state.roundNumber;
    if (typeof round === "number" && !Number.isNaN(round) && round > 0) {
      state.roundNumber = round;
      details.push(`Round ${round}`);
    }

    if (typeof payload.target === "number") {
      const formattedTarget = formatNumber(payload.target);
      if (formattedTarget) {
        details.push(`Target: ${formattedTarget}`);
      }
    }

    if (payload.choices && typeof payload.choices === "object") {
      const activePlayers = Object.keys(payload.choices).length;
      if (activePlayers) {
        details.push(`Choices submitted: ${activePlayers}`);
      }
    }

    if (payload.winners && Array.isArray(payload.winners) && payload.winners.length) {
      details.push(`Winner(s): ${payload.winners.join(", ")}`);
    }

    roundInfo.textContent = details.length ? details.join(" • ") : "Round status: idle";
  }

  function describeScoreChange(before, after) {
    if (typeof before !== "number" || typeof after !== "number") {
      return null;
    }
    const delta = after - before;
    if (Number.isNaN(delta) || delta === 0) {
      return { text: "No score change this round.", tone: "info" };
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
    if (createLobbyBtn) {
      createLobbyBtn.disabled = disabled;
    }
    if (joinLobbyBtn) {
      joinLobbyBtn.disabled = disabled;
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
    if (!preparePlayerIdentity()) {
      return;
    }
    state.pendingLobbyId = null;
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
    const typedCode = lobbyCodeInput ? normalizeLobbyCode(lobbyCodeInput.value) : "";
    const targetLobby = typedCode || state.pendingLobbyId;
    if (!targetLobby) {
      joinHint.textContent = "Enter a lobby code shared by the host.";
      return;
    }
    state.pendingLobbyId = targetLobby;
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
    state.pendingAction = null;
    state.hasJoinedLobby = true;
    state.roundActive = false;
    state.awaitingNextRound = false;
    state.lobbyState = "waiting";
    state.selectedNumber = null;
    state.hasSubmitted = false;
    state.lastSubmissionRound = 0;
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
    const inputHasCode = lobbyCodeInput && Boolean(normalizeLobbyCode(lobbyCodeInput.value));
    if (inputHasCode || state.pendingLobbyId) {
      requestLobbyJoin(event);
    } else {
      requestLobbyCreation(event);
    }
  });

  if (createLobbyBtn) {
    createLobbyBtn.addEventListener("click", requestLobbyCreation);
  }

  if (joinLobbyBtn) {
    joinLobbyBtn.addEventListener("click", requestLobbyJoin);
  }

  if (lobbyCodeInput) {
    lobbyCodeInput.addEventListener("input", () => {
      const normalized = normalizeLobbyCode(lobbyCodeInput.value).slice(0, MAX_LOBBY_CODE_LENGTH);
      lobbyCodeInput.value = normalized;
      state.pendingLobbyId = normalized || null;
    });
  }

  startRoundBtn.addEventListener("click", emitHostStartRequest);
  nextRoundBtn.addEventListener("click", emitHostStartRequest);
  fillBotsBtn.addEventListener("click", emitFillBotsRequest);

  socket.on("connect", () => {
    state.connected = true;
    state.socketId = socket.id;
    if (state.pendingAction) {
      executePendingAction();
    } else if (state.playerName && state.lobbyId) {
      emitJoinEvent();
      setStatus("Connected! Waiting for the next round…");
    } else {
      setStatus("Connected! Choose a name to join.");
    }
    updateHostControls();
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
    } else if (state.lobbyState === "running" && state.awaitingChoices && !state.isEliminated) {
      const currentRound = state.roundNumber || 0;
      if (currentRound > state.lastSubmissionRound) {
        state.hasSubmitted = false;
      }
      if (!state.hasSubmitted) {
        setGuessEnabled(true);
        setStatus("Round in progress. Make your guess!");
      }
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
    state.lastSubmissionRound = 0;
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
    state.lastSubmissionRound = 0;
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
      ? `New rule${newRules.length > 1 ? "s" : ""} unlocked: ${newRules.join("; ")}`
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
    setGuessEnabled(false);
    const winner =
      payload.winner ||
      (Array.isArray(payload.winners) ? payload.winners.join(", ") : null);
    if (winner) {
      showWinnerModal("Game winner", `${winner} won the game.`);
    }
    const message = winner ? "Game over." : "Game over! Thanks for playing.";
    setResult(message, "positive");
    setStatus("Game over. Restart the page to join a new session.");
    updateHostControls(payload);
  });

  if (copyLobbyLinkBtn) {
    copyLobbyLinkBtn.addEventListener("click", copyLobbyInviteLink);
  }
})();
