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
    elements.apiKeyStatus.textContent = 'Please enter your Claude API key to get started.';
    elements.apiKeyStatus.className = 'status-text';
  }
}

async function saveApiKey() {
  const apiKey = elements.apiKeyInput.value.trim();

  if (!apiKey) {
    elements.apiKeyStatus.textContent = 'Please enter an API key.';
    elements.apiKeyStatus.className = 'status-text error';
    return;
  }

  if (!apiKey.startsWith('sk-ant-')) {
    elements.apiKeyStatus.textContent = 'Invalid API key format. Should start with sk-ant-';
    elements.apiKeyStatus.className = 'status-text error';
    return;
  }

  const response = await sendToBackground({ type: 'SET_API_KEY', apiKey });

  if (response?.success) {
    state.apiKeySet = true;
    elements.apiKeyStatus.textContent = 'API key saved successfully!';
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
    addSystemNotice(`\u{1F50D} URL detected: ${state.pendingNavigationUrl}`);
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

      addSystemNotice(`\u{1F4CB} Jira ticket context saved: ${pageContent.ticketInfo.key || 'ticket'}`);
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

    state.messages.push({ role: 'user', content: message });
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
  if (confirm('Reset the current mission?')) {
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
        <h2>Welcome to Manureva AI Assistant</h2>
        <p>I'm your intelligent browser automation assistant. I can navigate and interact with any website:</p>
        <ul>
          <li>Fill forms, book flights, manage accounts on any site</li>
          <li>Navigate complex web apps (SPAs, dashboards, admin panels)</li>
          <li>Handle pop-ups, cookie banners, and multi-step workflows</li>
          <li>Research, compare, and report findings across the web</li>
        </ul>
        <p class="hint">Tell me what you'd like to accomplish!</p>
      </div>
    `;
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
