// sidepanel.js - Manureva AI Assistant Side Panel
// Version 4.1.0 - Refactored: UI, parsing, and execution extracted to modules.
// Depends on: shared.js, action-parser.js, ui.js, action-executor.js (loaded before this file)

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
const state = {
  messages: [],
  isProcessing: false,
  primaryTabId: null,
  currentTabId: null,
  openTabs: new Map(),
  missionActive: false,
  missionType: 'general',  // 'estimation', 'action', 'research', 'general'
  apiKeySet: false,
  originalContext: null,
  lastUserMessage: '',
  pendingNavigationUrl: null,
  storedJiraContext: null,
  pendingImageData: null,

  // Action tracking
  clickCount: 0,
  navigationCount: 0,
  scrollCount: 0,
  typeCount: 0,

  // Workflow state
  visitedPages: new Set(),
  todoList: [],
  actionLog: []
};

// Agentic loop tracking
let loopCount = 0;
const MAX_LOOP_ITERATIONS = 40;
const MAX_CLICKS_PER_MISSION = 50;
const MAX_NAVIGATIONS_PER_MISSION = 20;
const MAX_SCROLLS_PER_MISSION = 50;
const MAX_TYPES_PER_MISSION = 30;

// Message history limit to prevent unbounded growth
const MAX_MESSAGE_HISTORY = 20;

// ============================================================================
// DOM ELEMENTS
// ============================================================================
const elements = {
  chatContainer: null,
  userInput: null,
  sendBtn: null,
  stopBtn: null,
  voiceBtn: null,
  uploadBtn: null,
  fileInput: null,
  settingsBtn: null,
  settingsPanel: null,
  closeSettings: null,
  apiKeyInput: null,
  saveApiKey: null,
  apiKeyStatus: null,
  resetBtn: null,
  missionBanner: null,
  missionGoal: null,
  missionProgress: null,
  progressFill: null,
  todoContainer: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  createTodoContainer();
  setupEventListeners();
  await checkApiKey();
  await initializePrimaryTab();

  console.log('[Sidepanel] Initialized - Advanced Workflow v4.1.0');
});

async function initializePrimaryTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    state.primaryTabId = tab.id;
    state.currentTabId = tab.id;

    await sendToBackground({
      type: 'SET_PRIMARY_TAB',
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    }).catch(() => {});

    state.openTabs.set(tab.id, {
      url: tab.url,
      title: tab.title,
      platform: detectPlatform(tab.url),
      purpose: 'primary',
      isPrimary: true
    });

    console.log(`[Sidepanel] Primary tab set: ${tab.id} - ${tab.url}`);
  }
}

function initializeElements() {
  elements.chatContainer = document.getElementById('chat-container');
  elements.userInput = document.getElementById('user-input');
  elements.sendBtn = document.getElementById('send-btn');
  elements.settingsBtn = document.getElementById('settings-btn');
  elements.settingsPanel = document.getElementById('settings-panel');
  elements.closeSettings = document.getElementById('close-settings');
  elements.apiKeyInput = document.getElementById('api-key-input');
  elements.saveApiKey = document.getElementById('save-api-key');
  elements.apiKeyStatus = document.getElementById('api-key-status');
  elements.resetBtn = document.getElementById('reset-btn');
  elements.stopBtn = document.getElementById('stop-btn');
  elements.voiceBtn = document.getElementById('voice-btn');
  elements.uploadBtn = document.getElementById('upload-btn');
  elements.fileInput = document.getElementById('file-input');
  elements.missionBanner = document.getElementById('mission-banner');
  elements.missionGoal = document.getElementById('mission-goal');
  elements.missionProgress = document.getElementById('mission-progress');
  elements.progressFill = document.getElementById('progress-fill');
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================
function setupEventListeners() {
  elements.sendBtn.addEventListener('click', handleSendMessage);
  elements.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  elements.userInput.addEventListener('input', () => {
    elements.userInput.style.height = 'auto';
    elements.userInput.style.height = Math.min(elements.userInput.scrollHeight, 200) + 'px';
  });

  elements.settingsBtn.addEventListener('click', toggleSettings);
  elements.closeSettings.addEventListener('click', toggleSettings);
  elements.saveApiKey.addEventListener('click', saveApiKey);
  elements.resetBtn.addEventListener('click', resetMission);
  elements.stopBtn.addEventListener('click', stopMission);
  elements.voiceBtn.addEventListener('click', toggleVoiceInput);
  elements.fileInput.addEventListener('change', handleFileUpload);

  // Close settings panel with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!elements.settingsPanel.classList.contains('hidden')) {
        e.preventDefault();
        toggleSettings();
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TAB_UPDATED') {
      handleTabUpdate(message);
    }
  });

  // Track user tab switches to keep currentTabId accurate
  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (!state.isProcessing) {
      state.currentTabId = activeInfo.tabId;
    }
  });

  // Invalidate stale tab references when tabs are closed
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    state.openTabs.delete(tabId);

    const wasPrimary = state.primaryTabId === tabId;
    const wasCurrent = state.currentTabId === tabId;

    if (wasPrimary) {
      state.primaryTabId = null;
    }
    if (wasCurrent) {
      // Fall back to another known tab, or query the browser for the active tab
      state.currentTabId = state.primaryTabId;
    }

    // If we lost the primary tab, try to recover by adopting the active tab
    if (wasPrimary || (wasCurrent && !state.currentTabId)) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
          if (!state.primaryTabId) state.primaryTabId = activeTab.id;
          if (!state.currentTabId) state.currentTabId = activeTab.id;
        }
      } catch (e) {
        // Browser query failed — will recover on next user action
      }
    }
  });
}

// ============================================================================
// API KEY MANAGEMENT
// ============================================================================
async function checkApiKey() {
  const response = await sendToBackground({ type: 'GET_API_KEY' });
  state.apiKeySet = !!response?.apiKey;

  if (!state.apiKeySet) {
    elements.settingsPanel.classList.remove('hidden');
    elements.apiKeyStatus.textContent = 'Veuillez entrer votre cl\u00e9 API Claude pour commencer.';
    elements.apiKeyStatus.className = 'status-text';
  }
}

async function saveApiKey() {
  const apiKey = elements.apiKeyInput.value.trim();

  if (!apiKey) {
    elements.apiKeyStatus.textContent = 'Veuillez entrer une cl\u00e9 API.';
    elements.apiKeyStatus.className = 'status-text error';
    return;
  }

  if (!apiKey.startsWith('sk-ant-')) {
    elements.apiKeyStatus.textContent = 'Format de cl\u00e9 invalide. Doit commencer par sk-ant-';
    elements.apiKeyStatus.className = 'status-text error';
    return;
  }

  const response = await sendToBackground({ type: 'SET_API_KEY', apiKey });

  if (response?.success) {
    state.apiKeySet = true;
    elements.apiKeyStatus.textContent = 'Cl\u00e9 API enregistr\u00e9e avec succ\u00e8s !';
    elements.apiKeyStatus.className = 'status-text success';
    elements.apiKeyInput.value = '';

    setTimeout(() => {
      elements.settingsPanel.classList.add('hidden');
    }, 1500);
  }
}

function toggleSettings() {
  elements.settingsPanel.classList.toggle('hidden');
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================
function handleTabUpdate(message) {
  console.log('[Sidepanel] Tab updated:', message.tabId, message.url);

  if (message.tabId) {
    state.openTabs.set(message.tabId, {
      url: message.url,
      title: message.title,
      platform: message.platform || detectPlatform(message.url),
      isPrimary: message.isPrimary
    });

    if (message.url) {
      state.visitedPages.add(message.url);
    }
  }
}

// ============================================================================
// MESSAGE HISTORY MANAGEMENT
// ============================================================================
function trimMessageHistory() {
  if (state.messages.length <= MAX_MESSAGE_HISTORY) return;

  // Keep only the most recent messages
  let trimmed = state.messages.slice(-MAX_MESSAGE_HISTORY);

  // Ensure the first message is a user message (Claude API requirement)
  while (trimmed.length > 0 && trimmed[0].role !== 'user') {
    trimmed = trimmed.slice(1);
  }

  // Ensure messages strictly alternate user/assistant (API requirement).
  // Remove consecutive same-role messages from the start of the trimmed window.
  const valid = [];
  for (const msg of trimmed) {
    const lastRole = valid.length > 0 ? valid[valid.length - 1].role : null;
    if (msg.role === lastRole) {
      // Consecutive same role: keep the newer one (replace last)
      valid[valid.length - 1] = msg;
    } else {
      valid.push(msg);
    }
  }

  state.messages = valid;
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================
async function handleSendMessage() {
  const userMessage = elements.userInput.value.trim();

  if (!userMessage || state.isProcessing) return;

  if (!state.apiKeySet) {
    elements.settingsPanel.classList.remove('hidden');
    return;
  }

  elements.userInput.value = '';
  elements.userInput.style.height = 'auto';

  // Capture URL immediately
  const urlMatch = userMessage.match(/https?:\/\/[^\s<>"']+/);
  if (urlMatch) {
    state.pendingNavigationUrl = urlMatch[0].replace(/[.,;:!?\)\]]+$/, '');
    console.log('[Sidepanel] URL CAPTURED:', state.pendingNavigationUrl);
    addSystemNotice(`\u{1F50D} URL d\u00e9tect\u00e9e : ${state.pendingNavigationUrl}`);
  } else {
    state.pendingNavigationUrl = null;
  }

  await sendMessageToAssistant(userMessage, true);
}

// Track recursion depth so only the outermost call resets isProcessing
let _sendMessageDepth = 0;

async function sendMessageToAssistant(message, isUserInitiated = true) {
  _sendMessageDepth++;
  state.isProcessing = true;
  elements.sendBtn.classList.add('hidden');
  elements.stopBtn.classList.remove('hidden');
  elements.sendBtn.disabled = true;

  // Ensure service worker stays alive during API call
  startKeepAlive();

  if (isUserInitiated) {
    // Only reset counters when starting a NEW mission.
    // Follow-up messages during an active mission should not reset limits,
    // otherwise the user could bypass safety limits by sending a second message.
    if (!state.missionActive) {
      loopCount = 0;
      state.clickCount = 0;
      state.navigationCount = 0;
      state.scrollCount = 0;
      state.typeCount = 0;
      state.visitedPages.clear();
      state.todoList = [];
      state.actionLog = [];
    }
    loopCount = 0; // Always reset loop count for a new user turn
    state.lastUserMessage = message;
  }

  if (isUserInitiated) {
    addMessageToUI('user', message);
  }

  const loadingId = showLoading();

  try {
    const tabInfo = await sendToBackground({
      type: 'GET_TAB_INFO',
      tabId: state.currentTabId
    });

    const pageContent = await getPageContent(state.currentTabId);

    console.log('[Sidepanel] Page content extracted:', {
      platform: pageContent?.platform,
      hasTicketInfo: !!pageContent?.ticketInfo,
      contentLength: pageContent?.mainContent?.length
    });

    // Auto-store Jira context if on a Jira page
    if (pageContent?.platform === 'jira' && pageContent?.ticketInfo) {
      console.log('[Sidepanel] AUTO-STORING Jira context');
      state.storedJiraContext = {
        ticketInfo: pageContent.ticketInfo,
        description: pageContent.mainContent,
        url: tabInfo?.url,
        title: tabInfo?.title,
        relatedLinks: pageContent.relatedLinks
      };

      if (pageContent.ticketInfo.key) {
        await sendToBackground({
          type: 'ADD_CRITICAL_FINDING',
          finding: `Ticket: ${pageContent.ticketInfo.key} - ${pageContent.ticketInfo.summary || 'No summary'}`,
          source: tabInfo?.url
        }).catch(() => {});
      }

      addSystemNotice(`\u{1F4CB} Contexte Jira sauvegard\u00e9 : ${pageContent.ticketInfo.key || 'ticket'}`);
    }

    const pageContext = {
      url: tabInfo?.url,
      title: tabInfo?.title,
      platform: tabInfo?.platform || pageContent?.platform,
      keyElements: pageContent?.keyElements || [],
      summary: pageContent?.summary || '',
      mainContent: pageContent?.mainContent || '',
      extractedData: pageContent?.extractedData || null,
      ticketInfo: pageContent?.ticketInfo || null,
      relatedLinks: pageContent?.relatedLinks || null,
      navigationOptions: pageContent?.navigationOptions || null,
      isPrimary: state.currentTabId === state.primaryTabId,
      storedJiraContext: state.storedJiraContext,
      visitedPages: Array.from(state.visitedPages),
      actionCounts: {
        clicks: `${state.clickCount}/${MAX_CLICKS_PER_MISSION}`,
        navigations: `${state.navigationCount}/${MAX_NAVIGATIONS_PER_MISSION}`,
        scrolls: `${state.scrollCount}/${MAX_SCROLLS_PER_MISSION}`,
        types: `${state.typeCount}/${MAX_TYPES_PER_MISSION}`,
        loopIteration: `${loopCount}/${MAX_LOOP_ITERATIONS}`
      }
    };

    if (!state.missionActive && isUserInitiated) {
      state.originalContext = {
        url: tabInfo?.url,
        title: tabInfo?.title,
        platform: tabInfo?.platform,
        tabId: state.currentTabId,
        content: pageContent
      };

      const goalResult = await sendToBackground({
        type: 'SET_PRIMARY_GOAL',
        goal: message,
        pageContext: pageContext
      }).catch(() => ({}));

      state.missionType = goalResult?.missionType || 'general';
      state.missionActive = true;
      updateMissionBanner(message);
      console.log('[Sidepanel] Mission type:', state.missionType);
    }

    // Support multimodal messages (text + image)
    if (state.pendingImageData) {
      state.messages.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: state.pendingImageData.media_type,
              data: state.pendingImageData.data
            }
          },
          { type: 'text', text: message }
        ]
      });
      state.pendingImageData = null;
    } else {
      state.messages.push({ role: 'user', content: message });
    }
    trimMessageHistory();

    const response = await sendToBackground({
      type: 'CLAUDE_API_CALL_WITH_CONTEXT',
      payload: {
        messages: state.messages,
        pageContext,
        tabId: state.currentTabId
      }
    });

    removeLoading(loadingId);

    if (response?.success) {
      state.messages.push({ role: 'assistant', content: response.content });
      trimMessageHistory();
      addAssistantMessage(response.content);

      // Parse and execute actions
      await parseAndExecuteActions(response.content, state.lastUserMessage);

      await updateMissionContext();
    } else {
      // Remove the orphan user message to prevent consecutive user messages
      // which violate the Claude API alternation requirement
      if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'user') {
        state.messages.pop();
      }
      addErrorMessage(response?.error || 'Failed to get response');
    }
  } catch (error) {
    removeLoading(loadingId);
    // Remove the orphan user message on error as well
    if (state.messages.length > 0 && state.messages[state.messages.length - 1].role === 'user') {
      state.messages.pop();
    }
    addErrorMessage(error.message);
    console.error('[Sidepanel] Error:', error);
  } finally {
    _sendMessageDepth--;

    // Only the outermost call (depth 0) should restore UI state.
    // Recursive calls from the agentic continuation loop must NOT reset
    // isProcessing, otherwise the user could press Send mid-mission.
    if (_sendMessageDepth <= 0) {
      _sendMessageDepth = 0; // safety clamp
      state.isProcessing = false;
      elements.sendBtn.classList.remove('hidden');
      elements.stopBtn.classList.add('hidden');
      elements.sendBtn.disabled = false;

      // Sync currentTabId with the browser's actually-active tab.
      // During processing, the onActivated listener ignores tab switches to
      // prevent interference. Now that processing is done, we need to pick up
      // any tab changes that occurred in the meantime.
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
          state.currentTabId = activeTab.id;
        }
      } catch (e) {
        // Non-critical — keep existing currentTabId
      }
    }
  }
}

// ============================================================================
// MISSION MANAGEMENT
// ============================================================================
function updateMissionBanner(goal) {
  elements.missionBanner.classList.remove('hidden');
  elements.missionGoal.textContent = goal.length > 50 ? goal.substring(0, 50) + '...' : goal;
}

async function updateMissionContext() {
  try {
    const context = await sendToBackground({ type: 'GET_MISSION_CONTEXT' });
    if (context?.context?.progress) {
      const [completed, total] = context.context.progress.split('/').map(s => parseInt(s));
      elements.missionProgress.textContent = context.context.progress + ' steps';
      elements.progressFill.style.width = total > 0 ? ((completed / total) * 100) + '%' : '0%';
    }

    if (context?.context?.todoList) {
      state.todoList = context.context.todoList;
      updateTodoUI(state.todoList);
    }
  } catch (e) {
    console.warn('[Sidepanel] updateMissionContext failed:', e.message || e);
  }
}

async function resetMission() {
  if (confirm('R\u00e9initialiser la mission en cours ?')) {
    stopKeepAlive();
    await sendToBackground({ type: 'RESET_MISSION' }).catch(() => {});

    state.messages = [];
    state.missionActive = false;
    state.missionType = 'general';
    state.originalContext = null;
    state.storedJiraContext = null;
    state.openTabs.clear();
    state.pendingNavigationUrl = null;
    state.clickCount = 0;
    state.navigationCount = 0;
    state.scrollCount = 0;
    state.typeCount = 0;
    state.visitedPages.clear();
    state.todoList = [];
    state.actionLog = [];
    loopCount = 0;

    updateTodoUI([]);
    await initializePrimaryTab();

    elements.missionBanner.classList.add('hidden');
    elements.chatContainer.innerHTML = `
      <div class="welcome-message">
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <h2>Bienvenue sur Manureva AI Assistant</h2>
        <p>Je suis votre assistant intelligent d'automatisation web. Je peux naviguer et interagir avec n'importe quel site :</p>
        <ul>
          <li>Remplir des formulaires, g\u00e9rer des comptes sur n'importe quel site</li>
          <li>Naviguer dans des applications web complexes (SPAs, tableaux de bord, admin)</li>
          <li>G\u00e9rer les pop-ups, banni\u00e8res de cookies et workflows multi-\u00e9tapes</li>
          <li>Rechercher, comparer et rapporter des informations sur le web</li>
        </ul>
        <p class="hint">Dites-moi ce que vous souhaitez accomplir !</p>
      </div>
    `;
  }
}

// ============================================================================
// STOP MISSION
// ============================================================================
function stopMission() {
  if (!state.isProcessing) return;

  console.log('[Sidepanel] STOP requested by user');
  state.isProcessing = false;
  _sendMessageDepth = 0;
  loopCount = MAX_LOOP_ITERATIONS + 1; // Prevent further continuations

  elements.sendBtn.classList.remove('hidden');
  elements.stopBtn.classList.add('hidden');
  elements.sendBtn.disabled = false;

  addSystemNotice('\u23F9\uFE0F Arr\u00eat\u00e9 par l\u2019utilisateur');
}

// ============================================================================
// VOICE INPUT (Web Speech API)
// ============================================================================
let speechRecognition = null;

async function toggleVoiceInput() {
  if (speechRecognition) {
    speechRecognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addSystemNotice('\u26A0\uFE0F Saisie vocale non support\u00e9e par ce navigateur');
    return;
  }

  // Request microphone permission BEFORE starting recognition.
  // Chrome extension side panels require an explicit getUserMedia() call
  // to trigger the permission prompt; without it SpeechRecognition fails
  // with "not-allowed".
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop the stream immediately — we only needed the permission grant.
    // SpeechRecognition manages its own audio capture internally.
    stream.getTracks().forEach(track => track.stop());
  } catch (err) {
    console.warn('[Sidepanel] Microphone permission denied:', err.message);
    addSystemNotice('\u26A0\uFE0F Acc\u00e8s au microphone refus\u00e9. V\u00e9rifiez les permissions du navigateur.');
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'fr-FR'; // Default to French since the user speaks French
  speechRecognition.interimResults = true;
  speechRecognition.continuous = false;

  elements.voiceBtn.classList.add('active');

  speechRecognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join('');
    elements.userInput.value = transcript;
    elements.userInput.style.height = 'auto';
    elements.userInput.style.height = Math.min(elements.userInput.scrollHeight, 200) + 'px';
  };

  speechRecognition.onend = () => {
    elements.voiceBtn.classList.remove('active');
    speechRecognition = null;
  };

  speechRecognition.onerror = (event) => {
    console.warn('[Sidepanel] Speech recognition error:', event.error);
    elements.voiceBtn.classList.remove('active');
    speechRecognition = null;
    if (event.error !== 'aborted') {
      addSystemNotice(`\u26A0\uFE0F Erreur vocale : ${event.error}`);
    }
  };

  speechRecognition.start();
}

// ============================================================================
// FILE UPLOAD
// ============================================================================
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Reset input so same file can be re-uploaded
  event.target.value = '';

  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    addSystemNotice(`\u26A0\uFE0F Fichier trop volumineux (max 5 Mo) : ${file.name}`);
    return;
  }

  try {
    if (file.type.startsWith('image/')) {
      // Convert image to base64 and send as context
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result;
        const userMsg = elements.userInput.value.trim();
        const message = userMsg
          ? `${userMsg}\n\n[Image jointe : ${file.name}]`
          : `Veuillez analyser cette image : ${file.name}`;

        // Store the image data for the API call
        state.pendingImageData = {
          type: 'image',
          media_type: file.type,
          data: base64.split(',')[1], // Remove data:... prefix
          filename: file.name
        };

        elements.userInput.value = message;
        elements.userInput.style.height = 'auto';
        elements.userInput.style.height = Math.min(elements.userInput.scrollHeight, 200) + 'px';
        addSystemNotice(`\u{1F4CE} Image jointe : ${file.name}`);
      };
      reader.readAsDataURL(file);
    } else {
      // Read text files
      const text = await file.text();
      const truncated = text.length > 10000 ? text.substring(0, 10000) + '\n...(truncated)' : text;
      const userMsg = elements.userInput.value.trim();
      const message = userMsg
        ? `${userMsg}\n\n--- Fichier : ${file.name} ---\n${truncated}`
        : `Veuillez analyser ce fichier :\n\n--- Fichier : ${file.name} ---\n${truncated}`;

      elements.userInput.value = message;
      elements.userInput.style.height = 'auto';
      elements.userInput.style.height = Math.min(elements.userInput.scrollHeight, 200) + 'px';
      addSystemNotice(`\u{1F4CE} Fichier joint : ${file.name}`);
    }
  } catch (err) {
    addSystemNotice(`\u26A0\uFE0F \u00c9chec de lecture du fichier : ${err.message}`);
  }
}

// ============================================================================
// PAGE CONTENT EXTRACTION
// ============================================================================
async function getPageContent(tabId) {
  const targetTabId = tabId || state.currentTabId;
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sendToBackground({
        type: 'INJECT_CONTENT_SCRIPT',
        tabId: targetTabId
      });

      await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 300 : 1000));

      const response = await chrome.tabs.sendMessage(targetTabId, {
        type: 'GET_PAGE_CONTENT'
      });

      if (response) return response;
    } catch (error) {
      console.warn(`[Sidepanel] getPageContent attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);
      if (attempt < MAX_RETRIES) {
        // Wait longer on each retry for the page to finish loading
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  console.error('[Sidepanel] Failed to get page content after all retries');
  return null;
}

// ============================================================================
// KEEPALIVE PORT - Prevents service worker termination during active missions
// ============================================================================
let keepAlivePort = null;
let keepAliveReconnectTimer = null;

function startKeepAlive() {
  if (keepAlivePort) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      // Reconnect if mission is still active or processing
      if (state.missionActive || state.isProcessing) {
        console.log('[Sidepanel] Keepalive lost during active mission, reconnecting...');
        keepAliveReconnectTimer = setTimeout(startKeepAlive, 1000);
      }
    });
    console.log('[Sidepanel] Keepalive port connected');
  } catch (e) {
    console.warn('[Sidepanel] Failed to establish keepalive:', e.message);
    keepAlivePort = null;
  }
}

function stopKeepAlive() {
  if (keepAliveReconnectTimer) {
    clearTimeout(keepAliveReconnectTimer);
    keepAliveReconnectTimer = null;
  }
  if (keepAlivePort) {
    try { keepAlivePort.disconnect(); } catch (e) {}
    keepAlivePort = null;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================
async function sendToBackground(message) {
  const MAX_SEND_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
      return response;
    } catch (error) {
      console.warn(`[Sidepanel] sendToBackground attempt ${attempt}/${MAX_SEND_RETRIES} failed:`, error.message);

      if (attempt < MAX_SEND_RETRIES) {
        // Try to re-establish keepalive (wakes up service worker)
        startKeepAlive();
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }

      // Final attempt failed - return error object to maintain backward compatibility
      return { success: false, error: `Connection lost: ${error.message}` };
    }
  }
}
