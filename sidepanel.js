// sidepanel.js - Manureva AI Assistant Side Panel
// Version 4.0.0 - Advanced Multi-Step Workflow Support

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
  apiKeySet: false,
  originalContext: null,
  lastUserMessage: '',
  pendingNavigationUrl: null,
  storedJiraContext: null,
  
  // Action tracking - INCREASED LIMITS for complex workflows
  clickCount: 0,
  navigationCount: 0,
  scrollCount: 0,
  typeCount: 0,
  
  // Workflow state
  visitedPages: new Set(),
  todoList: [],
  actionLog: []
};

// Agentic loop tracking - INCREASED for complex workflows
let loopCount = 0;
const MAX_LOOP_ITERATIONS = 25;  // Increased from 10
const MAX_CLICKS_PER_MISSION = 20;  // Increased from 5
const MAX_NAVIGATIONS_PER_MISSION = 12;  // Increased from 4
const MAX_SCROLLS_PER_MISSION = 30;  // New limit
const MAX_TYPES_PER_MISSION = 15;  // New limit

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
  todoContainer: null  // NEW: To-do list container
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initializeElements();
  createTodoContainer();  // NEW
  setupEventListeners();
  await checkApiKey();
  await initializePrimaryTab();
  
  console.log('[Sidepanel] Initialized - Advanced Workflow v4.0.0');
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

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (/atlassian\.net|jira\./i.test(url)) return 'jira';
  if (/\/wp-admin|\/wp-login/i.test(url)) return 'wordpress-admin';
  if (/github\.com/i.test(url)) return 'github';
  if (/elegantthemes|divi/i.test(url)) return 'divi';
  return 'website';
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
// TO-DO LIST UI (NEW)
// ============================================================================
function createTodoContainer() {
  // Create to-do list container after mission banner
  const todoContainer = document.createElement('div');
  todoContainer.id = 'todo-container';
  todoContainer.className = 'todo-container hidden';
  todoContainer.innerHTML = `
    <div class="todo-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
      <span>Task Progress</span>
      <span class="todo-count"></span>
    </div>
    <div class="todo-items"></div>
  `;
  
  // Insert after mission banner
  const missionBanner = document.getElementById('mission-banner');
  if (missionBanner && missionBanner.parentNode) {
    missionBanner.parentNode.insertBefore(todoContainer, missionBanner.nextSibling);
  }
  
  elements.todoContainer = todoContainer;
  
  // Add styles
  addTodoStyles();
}

function addTodoStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .todo-container {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 8px;
      margin: 8px 12px;
      padding: 12px;
      font-size: 12px;
    }
    .todo-container.hidden { display: none; }
    .todo-header {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #a5b4fc;
      font-weight: 600;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(99, 102, 241, 0.2);
    }
    .todo-count {
      margin-left: auto;
      background: rgba(99, 102, 241, 0.3);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
    }
    .todo-items { display: flex; flex-direction: column; gap: 6px; }
    .todo-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.03);
      transition: all 0.2s ease;
    }
    .todo-item.done {
      background: rgba(34, 197, 94, 0.1);
      border-left: 2px solid #22c55e;
    }
    .todo-item.in-progress {
      background: rgba(59, 130, 246, 0.1);
      border-left: 2px solid #3b82f6;
      animation: pulse-border 2s infinite;
    }
    .todo-item.pending {
      opacity: 0.7;
      border-left: 2px solid transparent;
    }
    .todo-icon {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .todo-icon.done { color: #22c55e; }
    .todo-icon.in-progress { color: #3b82f6; }
    .todo-icon.pending { color: #64748b; }
    .todo-text { color: #e2e8f0; line-height: 1.4; }
    .todo-item.done .todo-text { 
      text-decoration: line-through; 
      color: #94a3b8; 
    }
    @keyframes pulse-border {
      0%, 100% { border-left-color: #3b82f6; }
      50% { border-left-color: #60a5fa; }
    }
    
    /* Action log styling */
    .action-log {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      margin-top: 8px;
      padding: 8px;
      max-height: 100px;
      overflow-y: auto;
      font-size: 11px;
    }
    .action-log-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      color: #94a3b8;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .action-log-item:last-child { border-bottom: none; }
    .action-log-item .action-icon { 
      width: 14px; 
      height: 14px; 
      flex-shrink: 0;
    }
    .action-log-item.success .action-icon { color: #22c55e; }
    .action-log-item.failed .action-icon { color: #ef4444; }
    .action-log-item.pending .action-icon { color: #f59e0b; }
  `;
  document.head.appendChild(style);
}

function updateTodoUI(todoList) {
  if (!elements.todoContainer) return;
  
  if (!todoList || todoList.length === 0) {
    elements.todoContainer.classList.add('hidden');
    return;
  }
  
  elements.todoContainer.classList.remove('hidden');
  
  const doneCount = todoList.filter(t => t.status === 'done').length;
  const totalCount = todoList.length;
  
  const countEl = elements.todoContainer.querySelector('.todo-count');
  if (countEl) {
    countEl.textContent = `${doneCount}/${totalCount}`;
  }
  
  const itemsEl = elements.todoContainer.querySelector('.todo-items');
  if (itemsEl) {
    itemsEl.innerHTML = todoList.map((item, i) => {
      const status = item.status || 'pending';
      const icon = status === 'done' 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
        : status === 'in-progress'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
      
      return `
        <div class="todo-item ${status}">
          <div class="todo-icon ${status}">${icon}</div>
          <div class="todo-text">${escapeHtml(item.text)}</div>
        </div>
      `;
    }).join('');
  }
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
  
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TAB_UPDATED') {
      handleTabUpdate(message);
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
    
    // Track visited pages
    if (message.url) {
      state.visitedPages.add(message.url);
    }
  }
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
  
  // CAPTURE URL IMMEDIATELY
  const urlMatch = userMessage.match(/https?:\/\/[^\s<>"']+/);
  if (urlMatch) {
    state.pendingNavigationUrl = urlMatch[0].replace(/[.,;:!?\)\]]+$/, '');
    console.log('[Sidepanel] 🎯 URL CAPTURED:', state.pendingNavigationUrl);
    addSystemNotice(`🔍 URL detected: ${state.pendingNavigationUrl}`);
  } else {
    state.pendingNavigationUrl = null;
  }
  
  await sendMessageToAssistant(userMessage, true);
}

async function sendMessageToAssistant(message, isUserInitiated = true) {
  state.isProcessing = true;
  elements.sendBtn.disabled = true;
  
  if (isUserInitiated) {
    // Reset counters for new mission
    loopCount = 0;
    state.clickCount = 0;
    state.navigationCount = 0;
    state.scrollCount = 0;
    state.typeCount = 0;
    state.visitedPages.clear();
    state.todoList = [];
    state.actionLog = [];
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
    
    // AUTO-STORE JIRA CONTEXT if we're on a Jira page
    if (pageContent?.platform === 'jira' && pageContent?.ticketInfo) {
      console.log('[Sidepanel] 📋 AUTO-STORING Jira context');
      state.storedJiraContext = {
        ticketInfo: pageContent.ticketInfo,
        description: pageContent.mainContent,
        url: tabInfo?.url,
        title: tabInfo?.title,
        relatedLinks: pageContent.relatedLinks
      };
      
      // Store in background
      if (pageContent.ticketInfo.key) {
        await sendToBackground({
          type: 'ADD_CRITICAL_FINDING',
          finding: `Ticket: ${pageContent.ticketInfo.key} - ${pageContent.ticketInfo.summary || 'No summary'}`,
          source: tabInfo?.url
        }).catch(() => {});
      }
      
      addSystemNotice(`📋 Jira ticket context saved: ${pageContent.ticketInfo.key || 'ticket'}`);
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
      
      await sendToBackground({ 
        type: 'SET_PRIMARY_GOAL', 
        goal: message,
        pageContext: pageContext
      }).catch(() => {});
      
      state.missionActive = true;
      updateMissionBanner(message);
    }
    
    state.messages.push({ role: 'user', content: message });
    
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
      addAssistantMessage(response.content);
      
      // Parse and execute actions
      await parseAndExecuteActions(response.content, state.lastUserMessage);
      
      await updateMissionContext();
    } else {
      addErrorMessage(response?.error || 'Failed to get response');
    }
  } catch (error) {
    removeLoading(loadingId);
    addErrorMessage(error.message);
    console.error('[Sidepanel] Error:', error);
  }
  
  state.isProcessing = false;
  elements.sendBtn.disabled = false;
}

// ============================================================================
// ACTION PARSING & EXECUTION - ENHANCED
// ============================================================================
async function parseAndExecuteActions(content, userMessage = '') {
  console.log('[Sidepanel] ========== ACTION PROCESSING v4.0.0 ==========');
  console.log('[Sidepanel] Counters:', {
    clicks: state.clickCount,
    navigations: state.navigationCount,
    scrolls: state.scrollCount,
    loops: loopCount
  });
  
  // ==========================================================================
  // STEP 0: CHECK FOR COMPLETION
  // ==========================================================================
  
  // Multiple ways to detect a complete estimate
  const hasTimeEstimate = /\*\*Total[:\*]*\s*[\d.]+\s*(hour|hr|min|h\b)/i.test(content) ||
                          /Total:?\s*[\d.]+\s*(hour|hr|min|h\b)/i.test(content) ||
                          /estimate[d]?:?\s*[\d.]+\s*(hour|hr|min|h\b)/i.test(content);
  
  const hasComplexity = /(Complexity|Confidence)[:\*]*\s*(Low|Medium|High)/i.test(content);
  
  const hasExplicitCompletion = /✅\s*(Estimation Complete|Task Complete|Done|Finished)/i.test(content) ||
                                 /estimation complete/i.test(content) ||
                                 /here'?s my estimate/i.test(content);
  
  const hasCompleteEstimate = (hasTimeEstimate && hasComplexity) || hasExplicitCompletion;
  
  if (hasCompleteEstimate) {
    console.log('[Sidepanel] ✅ TASK COMPLETE DETECTED');
    addSystemNotice('✅ Task complete!');
    
    // Mark all todos as done
    if (state.todoList.length > 0) {
      state.todoList.forEach(t => t.status = 'done');
      updateTodoUI(state.todoList);
    }
    return;
  }
  
  // ==========================================================================
  // STEP 1: PARSE ALL ACTION TAGS
  // ==========================================================================
  const actions = parseAllActions(content);
  console.log('[Sidepanel] Parsed actions:', actions.map(a => a.type).join(', ') || 'none');
  
  // ==========================================================================
  // STEP 2: HANDLE TODO LIST
  // ==========================================================================
  const todoActions = actions.filter(a => a.type === 'todo');
  for (const todo of todoActions) {
    await handleTodoAction(todo);
  }
  
  // ==========================================================================
  // STEP 3: HANDLE CONTEXT STORAGE
  // ==========================================================================
  const storeActions = actions.filter(a => a.type === 'storeContext');
  for (const store of storeActions) {
    try {
      await sendToBackground({
        type: 'ADD_CRITICAL_FINDING',
        finding: `${store.key}: ${store.value}`,
        source: 'AI extraction'
      });
      addSystemNotice(`💾 Stored: ${store.key}`);
      logAction('storeContext', store.key, 'success');
    } catch (err) {
      logAction('storeContext', store.key, 'failed');
    }
  }
  
  // ==========================================================================
  // STEP 4: HANDLE NAVIGATION
  // ==========================================================================
  let navigationExecuted = false;
  let switchExecuted = false;
  
  // Check for pending URL from user message
  const navActions = actions.filter(a => a.type === 'navigate');
  const switchActions = actions.filter(a => a.type === 'switchTab');
  
  // Determine navigation target
  let targetUrl = state.pendingNavigationUrl || navActions[0]?.url;
  
  if (targetUrl) {
    state.navigationCount++;
    
    if (state.navigationCount > MAX_NAVIGATIONS_PER_MISSION) {
      console.log('[Sidepanel] ⚠️ Navigation limit reached');
      addSystemNotice(`⚠️ Navigation limit (${MAX_NAVIGATIONS_PER_MISSION}). Wrapping up...`);
    } else {
      console.log('[Sidepanel] 🚀 NAVIGATING:', targetUrl);
      addSystemNotice(`🚀 Nav ${state.navigationCount}/${MAX_NAVIGATIONS_PER_MISSION}: ${truncateUrl(targetUrl)}`);
      logAction('navigate', targetUrl, 'started');
      
      try {
        const result = await sendToBackground({
          type: 'NAVIGATE_NEW_TAB',
          url: targetUrl,
          purpose: navActions[0]?.purpose || 'User navigation'
        });
        
        if (result?.success && result.tabId) {
          state.currentTabId = result.tabId;
          navigationExecuted = true;
          state.visitedPages.add(result.url || targetUrl);
          
          state.openTabs.set(result.tabId, {
            url: result.url || targetUrl,
            title: result.title || 'New Tab',
            platform: result.platform || detectPlatform(targetUrl),
            isPrimary: false
          });
          
          addSystemNotice(`✅ Opened: ${result.title || targetUrl}`);
          logAction('navigate', targetUrl, 'success');
          
          // Wait for page and inject content script
          await new Promise(resolve => setTimeout(resolve, 1500));
          await sendToBackground({ type: 'INJECT_CONTENT_SCRIPT', tabId: result.tabId });
        } else {
          addSystemNotice(`❌ Navigation failed`);
          logAction('navigate', targetUrl, 'failed');
        }
      } catch (err) {
        addSystemNotice(`❌ Error: ${err.message}`);
        logAction('navigate', targetUrl, 'failed');
      }
    }
    state.pendingNavigationUrl = null;
  }
  
  // Handle switchTab
  if (switchActions.length > 0 && !navigationExecuted) {
    const switchAction = switchActions[0];
    console.log('[Sidepanel] 🔄 SWITCHING TAB:', switchAction);
    logAction('switchTab', switchAction.platform || switchAction.tabId, 'started');
    
    try {
      const result = await sendToBackground({
        type: 'SWITCH_TO_TAB',
        tabId: switchAction.tabId === 'primary' ? state.primaryTabId : switchAction.tabId,
        platform: switchAction.platform
      });
      
      if (result?.success) {
        state.currentTabId = result.tabId;
        switchExecuted = true;
        addSystemNotice(`🔄 Switched to: ${result.title || result.platform}`);
        logAction('switchTab', result.title, 'success');
      }
    } catch (err) {
      logAction('switchTab', '', 'failed');
    }
  }
  
  // ==========================================================================
  // STEP 5: EXECUTE DOM ACTIONS (click, scroll, type, etc.)
  // ==========================================================================
  const domActions = actions.filter(a => 
    ['click', 'scroll', 'type', 'pressKey', 'read', 'verify', 'wait'].includes(a.type)
  );
  
  let domActionExecuted = false;
  let urlChangedAfterAction = false;
  
  for (const action of domActions) {
    // Check limits
    if (action.type === 'click' && state.clickCount >= MAX_CLICKS_PER_MISSION) {
      addSystemNotice(`⚠️ Click limit reached`);
      continue;
    }
    if (action.type === 'scroll' && state.scrollCount >= MAX_SCROLLS_PER_MISSION) {
      addSystemNotice(`⚠️ Scroll limit reached`);
      continue;
    }
    if (action.type === 'type' && state.typeCount >= MAX_TYPES_PER_MISSION) {
      addSystemNotice(`⚠️ Type limit reached`);
      continue;
    }
    
    // Execute action
    const result = await executeDomAction(action);
    
    if (result?.executed) {
      domActionExecuted = true;
      if (result?.urlChanged) {
        urlChangedAfterAction = true;
      }
    }
  }
  
  // ==========================================================================
  // STEP 6: SIMPLE AGGRESSIVE CONTINUATION LOGIC
  // ==========================================================================
  
  // ALWAYS CONTINUE unless:
  // 1. Complete estimate detected (task done)
  // 2. Max iterations reached
  // 3. NO actions at all and AI is just chatting
  
  const anyActionExecuted = navigationExecuted || switchExecuted || domActionExecuted || 
                            todoActions.length > 0 || storeActions.length > 0;
  
  // Check if AI is asking a question (stopping point)
  const isAskingQuestion = /could you (please )?(provide|share|open|give)/i.test(content) ||
                           /please (provide|share|open|give)/i.test(content) ||
                           /what (specific|exactly|should)/i.test(content);
  
  // If AI asked a question BUT we have Jira context, FORCE CONTINUE (AI forgot)
  const hasJiraContext = !!state.storedJiraContext?.ticketInfo;
  const aiAskedForTicket = /jira ticket|what needs to be|what ticket|specific task/i.test(content);
  
  if (aiAskedForTicket && hasJiraContext) {
    console.log('[Sidepanel] ⚠️ AI asked for ticket but we have it - FORCING CONTINUE');
    addSystemNotice('⚠️ AI forgot context - reminding it...');
    loopCount++;
    
    if (loopCount <= MAX_LOOP_ITERATIONS) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const reminderMessage = await buildReminderMessage();
      await sendMessageToAssistant(reminderMessage, false);
    }
    return;
  }
  
  // Determine if we should continue
  const shouldContinue = anyActionExecuted && !hasCompleteEstimate;
  
  console.log('[Sidepanel] Continue decision:', {
    anyActionExecuted,
    hasCompleteEstimate,
    isAskingQuestion,
    hasJiraContext,
    aiAskedForTicket,
    shouldContinue,
    loopCount
  });
  
  if (shouldContinue) {
    loopCount++;
    
    if (loopCount > MAX_LOOP_ITERATIONS) {
      console.log('[Sidepanel] Max iterations reached');
      addSystemNotice('⚠️ Max iterations. Stopping.');
      return;
    }
    
    console.log(`[Sidepanel] 🔄 AUTO-CONTINUING (iteration ${loopCount}/${MAX_LOOP_ITERATIONS})...`);
    addSystemNotice(`🔄 Step ${loopCount}/${MAX_LOOP_ITERATIONS}`);
    
    // Wait for page stability
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Build continuation message
    const continueMessage = await buildContinuationMessage();
    
    // Continue the conversation
    await sendMessageToAssistant(continueMessage, false);
  }
  
  console.log('[Sidepanel] ========== ACTION PROCESSING DONE ==========');
}

// ============================================================================
// REMINDER MESSAGE - When AI forgets context
// ============================================================================
async function buildReminderMessage() {
  let msg = `[CONTEXT REMINDER]\n\n`;
  msg += `⚠️ **YOU ALREADY HAVE THE JIRA TICKET. DO NOT ASK FOR IT.**\n\n`;
  
  if (state.storedJiraContext?.ticketInfo) {
    msg += `**📋 HERE IS THE TICKET AGAIN:**\n`;
    const jira = state.storedJiraContext;
    if (jira.ticketInfo.key) msg += `- **Ticket:** ${jira.ticketInfo.key}\n`;
    if (jira.ticketInfo.summary) msg += `- **Task:** ${jira.ticketInfo.summary}\n`;
    if (jira.description) msg += `- **Description:** ${jira.description.substring(0, 1000)}\n`;
    msg += '\n';
  }
  
  msg += `**INSTRUCTION:** Continue your analysis. Do NOT ask for the ticket again.\n`;
  msg += `Use <scroll>, <click>, <read> tags to explore, then provide your estimate.`;
  
  return msg;
}

// ============================================================================
// ACTION PARSING HELPERS
// ============================================================================
function parseAllActions(content) {
  const actions = [];
  
  // Parse XML-style action tags
  // Supports: <action attr="value" /> and <action attr="value"></action>
  const tagRegex = /<(navigate|click|scroll|type|pressKey|wait|read|verify|observe|switchTab|storeContext|analyze|continue|todo)\s*([^>]*?)(?:\/>|>([^<]*)<\/\1>)/gi;
  
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const attrString = match[2] || '';
    const innerContent = match[3] || '';
    
    const attrs = parseAttributes(attrString);
    
    // Handle todo with inner content
    if (type === 'todo' && innerContent) {
      attrs.items = innerContent.trim().split('\n').map(l => l.trim()).filter(l => l);
    }
    
    actions.push({ type, ...attrs });
  }
  
  return actions;
}

function parseAttributes(str) {
  const attrs = {};
  // Match attr="value" or attr='value'
  const attrRegex = /(\w+)=["']([^"']+)["']/g;
  let match;
  
  while ((match = attrRegex.exec(str)) !== null) {
    attrs[match[1]] = match[2];
  }
  
  return attrs;
}

// ============================================================================
// ACTION EXECUTION HELPERS
// ============================================================================
async function handleTodoAction(todo) {
  if (todo.action === 'create' && todo.items) {
    state.todoList = todo.items.map(text => ({
      text: text.replace(/^[-•]\s*/, ''),
      status: 'pending'
    }));
    
    await sendToBackground({
      type: 'UPDATE_TODO',
      action: 'create',
      items: todo.items
    }).catch(() => {});
    
    updateTodoUI(state.todoList);
    addSystemNotice(`📝 Created ${state.todoList.length} tasks`);
  } 
  else if (todo.action === 'update' && todo.item) {
    const index = parseInt(todo.item) - 1;
    if (index >= 0 && index < state.todoList.length) {
      state.todoList[index].status = todo.status || 'done';
      
      await sendToBackground({
        type: 'UPDATE_TODO',
        action: 'update',
        itemIndex: index,
        status: todo.status
      }).catch(() => {});
      
      updateTodoUI(state.todoList);
      
      const statusEmoji = todo.status === 'done' ? '✅' : todo.status === 'in-progress' ? '🔄' : '⬜';
      addSystemNotice(`${statusEmoji} Task ${todo.item}: ${todo.status}`);
    }
  }
}

async function executeDomAction(action) {
  const result = { executed: false, urlChanged: false };
  
  switch (action.type) {
    case 'click':
      state.clickCount++;
      addSystemNotice(`🖱️ Click ${state.clickCount}/${MAX_CLICKS_PER_MISSION}: ${action.text || action.selector || action.description}`);
      logAction('click', action.text || action.selector, 'started');
      
      const urlBefore = (await sendToBackground({ type: 'GET_TAB_INFO', tabId: state.currentTabId }))?.url;
      
      try {
        const clickResult = await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'CLICK',
            selector: action.selector,
            text: action.text,
            description: action.description
          }
        });
        
        result.executed = true;
        
        if (clickResult?.success) {
          addSystemNotice(`✅ Clicked`);
          logAction('click', action.text || action.selector, 'success');
          
          // Wait and check if URL changed
          await new Promise(resolve => setTimeout(resolve, 2000));
          const urlAfter = (await sendToBackground({ type: 'GET_TAB_INFO', tabId: state.currentTabId }))?.url;
          result.urlChanged = urlBefore !== urlAfter;
          
          if (result.urlChanged) {
            addSystemNotice(`📄 Page changed`);
          }
        } else {
          addSystemNotice(`⚠️ Click failed`);
          logAction('click', action.text || action.selector, 'failed');
        }
      } catch (err) {
        logAction('click', action.text || action.selector, 'failed');
      }
      break;
    
    case 'scroll':
      state.scrollCount++;
      const scrollDesc = action.to || `${action.direction} ${action.amount || 300}px`;
      addSystemNotice(`📜 Scroll ${state.scrollCount}/${MAX_SCROLLS_PER_MISSION}: ${scrollDesc}`);
      logAction('scroll', scrollDesc, 'started');
      
      try {
        await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'SCROLL',
            direction: action.direction,
            to: action.to,
            amount: parseInt(action.amount) || 300
          }
        });
        
        result.executed = true;
        await new Promise(resolve => setTimeout(resolve, 800));
        addSystemNotice(`✅ Scrolled`);
        logAction('scroll', scrollDesc, 'success');
      } catch (err) {
        logAction('scroll', scrollDesc, 'failed');
      }
      break;
    
    case 'type':
      state.typeCount++;
      addSystemNotice(`⌨️ Type ${state.typeCount}/${MAX_TYPES_PER_MISSION}: "${action.text}"`);
      logAction('type', action.text, 'started');
      
      try {
        await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'TYPE',
            selector: action.selector,
            text: action.text
          }
        });
        
        result.executed = true;
        addSystemNotice(`✅ Typed`);
        logAction('type', action.text, 'success');
      } catch (err) {
        logAction('type', action.text, 'failed');
      }
      break;
    
    case 'pressKey':
      addSystemNotice(`⌨️ Key: ${action.key}`);
      logAction('pressKey', action.key, 'started');
      
      try {
        await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'PRESS_KEY',
            key: action.key
          }
        });
        
        result.executed = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        logAction('pressKey', action.key, 'success');
      } catch (err) {
        logAction('pressKey', action.key, 'failed');
      }
      break;
    
    case 'wait':
      const duration = parseInt(action.duration) || 1000;
      addSystemNotice(`⏳ Waiting ${duration}ms`);
      await new Promise(resolve => setTimeout(resolve, duration));
      result.executed = true;
      break;
    
    case 'read':
    case 'verify':
      addSystemNotice(`👁️ ${action.type === 'read' ? 'Reading' : 'Verifying'}: ${action.target || action.purpose || 'page'}`);
      logAction(action.type, action.target || 'page', 'started');
      result.executed = true;
      logAction(action.type, action.target || 'page', 'success');
      break;
  }
  
  return result;
}

// ============================================================================
// CONTINUATION MESSAGE BUILDER
// ============================================================================
async function buildContinuationMessage() {
  // Get fresh page content
  const pageContent = await getPageContent(state.currentTabId);
  const tabInfo = await sendToBackground({ 
    type: 'GET_TAB_INFO', 
    tabId: state.currentTabId 
  });
  
  // Get stored context
  const storedContext = await sendToBackground({ type: 'GET_MISSION_CONTEXT' }).catch(() => ({}));
  
  let msg = `[CONTINUATION - Step ${loopCount}]\n\n`;
  
  // ⚠️ JIRA CONTEXT FIRST AND PROMINENT
  if (state.storedJiraContext?.ticketInfo) {
    msg += `⚠️ **REMEMBER: YOU HAVE THE JIRA TICKET - DO NOT ASK FOR IT**\n\n`;
    msg += `**📋 JIRA TICKET (use this for your estimate):**\n`;
    const jira = state.storedJiraContext;
    if (jira.ticketInfo.key) msg += `- **Ticket:** ${jira.ticketInfo.key}\n`;
    if (jira.ticketInfo.summary) msg += `- **Task:** ${jira.ticketInfo.summary}\n`;
    if (jira.ticketInfo.status) msg += `- **Status:** ${jira.ticketInfo.status}\n`;
    if (jira.ticketInfo.priority) msg += `- **Priority:** ${jira.ticketInfo.priority}\n`;
    if (jira.description) {
      msg += `- **Description:** ${jira.description.substring(0, 800)}\n`;
    }
    if (jira.relatedLinks?.length > 0) {
      msg += `- **Related URLs:** ${jira.relatedLinks.map(l => l.url).join(', ')}\n`;
    }
    msg += '\n';
    msg += `**YOUR GOAL:** Estimate the above ticket based on what you observe on the current page.\n\n`;
  } else {
    // No Jira context - check stored findings
    if (storedContext?.context?.criticalFindings?.length > 0) {
      const ticketFinding = storedContext.context.criticalFindings.find(f => /ticket:/i.test(f));
      if (ticketFinding) {
        msg += `⚠️ **STORED TICKET INFO:** ${ticketFinding}\n\n`;
      }
    }
  }
  
  // Include other stored findings
  if (storedContext?.context?.criticalFindings?.length > 0) {
    msg += `**💾 FINDINGS SO FAR:**\n`;
    storedContext.context.criticalFindings.slice(0, 8).forEach(f => {
      msg += `- ${f}\n`;
    });
    msg += '\n';
  }
  
  // Current page info
  msg += `**📍 CURRENT PAGE:**\n`;
  msg += `- URL: ${tabInfo?.url || 'Unknown'}\n`;
  msg += `- Title: ${tabInfo?.title || 'Unknown'}\n`;
  msg += `- Platform: ${pageContent?.platform?.toUpperCase() || 'Unknown'}\n\n`;
  
  // Resource status
  msg += `**📊 RESOURCES:**\n`;
  msg += `- Navigations: ${state.navigationCount}/${MAX_NAVIGATIONS_PER_MISSION}\n`;
  msg += `- Clicks: ${state.clickCount}/${MAX_CLICKS_PER_MISSION}\n`;
  msg += `- Scrolls: ${state.scrollCount}/${MAX_SCROLLS_PER_MISSION}\n`;
  msg += `- Iterations: ${loopCount}/${MAX_LOOP_ITERATIONS}\n\n`;
  
  // To-do status
  if (state.todoList.length > 0) {
    msg += `**📝 TO-DO STATUS:**\n`;
    state.todoList.forEach((item, i) => {
      const icon = item.status === 'done' ? '✅' : item.status === 'in-progress' ? '🔄' : '⬜';
      msg += `${icon} ${i + 1}. ${item.text}\n`;
    });
    msg += '\n';
  }
  
  // Page content
  if (pageContent?.summary) {
    msg += `**Page Summary:** ${pageContent.summary}\n\n`;
  }
  
  if (pageContent?.mainContent) {
    msg += `**Page Content:**\n${pageContent.mainContent.substring(0, 1500)}\n\n`;
  }
  
  if (pageContent?.keyElements?.length > 0) {
    msg += `**Interactive Elements:**\n${pageContent.keyElements.slice(0, 15).join('\n')}\n\n`;
  }
  
  msg += `---\n`;
  msg += `Continue analyzing this page in relation to the Jira ticket above. `;
  msg += `Use action tags for next steps, or provide your final estimate if ready.\n`;
  msg += `DO NOT ask for the Jira ticket - you already have it stored above.`;
  
  return msg;
}

// ============================================================================
// LOGGING HELPERS
// ============================================================================
function logAction(type, target, status) {
  state.actionLog.push({
    type,
    target: target?.substring(0, 50),
    status,
    time: Date.now()
  });
  
  // Keep only last 30
  if (state.actionLog.length > 30) {
    state.actionLog = state.actionLog.slice(-30);
  }
  
  // Log to background
  sendToBackground({
    type: 'LOG_ACTION',
    action: `${type}: ${target?.substring(0, 50) || ''}`,
    result: status
  }).catch(() => {});
}

function truncateUrl(url) {
  if (!url) return '';
  if (url.length <= 50) return url;
  return url.substring(0, 47) + '...';
}

// ============================================================================
// UI RENDERING
// ============================================================================
function addMessageToUI(role, content) {
  const welcomeMsg = elements.chatContainer.querySelector('.welcome-message');
  if (welcomeMsg) welcomeMsg.remove();
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  const avatarSvg = role === 'user' 
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>';
  
  messageDiv.innerHTML = `
    <div class="message-avatar">${avatarSvg}</div>
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(content)}</div>
    </div>
  `;
  
  elements.chatContainer.appendChild(messageDiv);
  scrollToMessageTop(messageDiv);
}

function addAssistantMessage(content) {
  const welcomeMsg = elements.chatContainer.querySelector('.welcome-message');
  if (welcomeMsg) welcomeMsg.remove();
  
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  
  const formattedContent = formatAssistantContent(content);
  
  messageDiv.innerHTML = `
    <div class="message-avatar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="message-content">
      <div class="message-bubble">${formattedContent}</div>
    </div>
  `;
  
  elements.chatContainer.appendChild(messageDiv);
  scrollToMessageTop(messageDiv);
}

function formatAssistantContent(content) {
  let formatted = escapeHtml(content);
  
  // Format action tags with nice styling
  const actionTypes = ['navigate', 'click', 'scroll', 'type', 'pressKey', 'wait', 
                       'read', 'verify', 'observe', 'storeContext', 'switchTab', 
                       'analyze', 'continue', 'todo'];
  
  const actionPattern = new RegExp(
    `&lt;(${actionTypes.join('|')})(\\s+[^&]*?)?(?:\\/&gt;|&gt;([^&]*?)&lt;\\/\\1&gt;)`,
    'gi'
  );
  
  formatted = formatted.replace(actionPattern, (match, actionType, attrs, inner) => {
    // Extract key info for display
    let summary = actionType;
    const decodedAttrs = (attrs || '').replace(/&quot;/g, '"');
    
    const urlMatch = decodedAttrs.match(/url="([^"]+)"/);
    const textMatch = decodedAttrs.match(/text="([^"]+)"/);
    const dirMatch = decodedAttrs.match(/direction="([^"]+)"/);
    const keyMatch = decodedAttrs.match(/key="([^"]+)"/);
    const purposeMatch = decodedAttrs.match(/purpose="([^"]+)"/);
    
    if (urlMatch) summary = `navigate → ${urlMatch[1].substring(0, 35)}...`;
    else if (textMatch) summary = `${actionType} → "${textMatch[1]}"`;
    else if (dirMatch) summary = `scroll ${dirMatch[1]}`;
    else if (keyMatch) summary = `pressKey: ${keyMatch[1]}`;
    else if (purposeMatch) summary = `${actionType}: ${purposeMatch[1].substring(0, 30)}`;
    
    // Get icon based on action type
    const icons = {
      navigate: '🚀',
      click: '🖱️',
      scroll: '📜',
      type: '⌨️',
      pressKey: '⌨️',
      wait: '⏳',
      read: '👁️',
      verify: '✓',
      observe: '👁️',
      storeContext: '💾',
      switchTab: '🔄',
      analyze: '🔍',
      continue: '▶️',
      todo: '📝'
    };
    
    return `<div class="action-block">
      <div class="action-header">${icons[actionType] || '▶️'} ${summary}</div>
    </div>`;
  });
  
  // Format code blocks
  formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold text
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Line breaks
  formatted = formatted.replace(/\n/g, '<br>');
  
  return formatted;
}

function scrollToMessageTop(messageElement) {
  const offset = 16;
  const messageTop = messageElement.offsetTop - offset;
  elements.chatContainer.scrollTo({ top: messageTop, behavior: 'smooth' });
}

function showLoading() {
  const loadingId = 'loading-' + Date.now();
  const loadingDiv = document.createElement('div');
  loadingDiv.id = loadingId;
  loadingDiv.className = 'message assistant';
  loadingDiv.innerHTML = `
    <div class="message-avatar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="message-content">
      <div class="loading-indicator">
        <div class="loading-dots"><span></span><span></span><span></span></div>
        <span>Thinking...</span>
      </div>
    </div>
  `;
  elements.chatContainer.appendChild(loadingDiv);
  scrollToMessageTop(loadingDiv);
  return loadingId;
}

function removeLoading(loadingId) {
  const loadingEl = document.getElementById(loadingId);
  if (loadingEl) loadingEl.remove();
}

function addErrorMessage(error) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'message assistant';
  errorDiv.innerHTML = `
    <div class="message-avatar" style="background: var(--error);">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
      </svg>
    </div>
    <div class="message-content">
      <div class="message-bubble" style="border-color: var(--error);">
        <strong>Error:</strong> ${escapeHtml(error)}
      </div>
    </div>
  `;
  elements.chatContainer.appendChild(errorDiv);
  scrollToMessageTop(errorDiv);
}

function addSystemNotice(text) {
  const notice = document.createElement('div');
  notice.className = 'message system-notice';
  notice.innerHTML = `
    <div class="message-content">
      <div class="system-notice-bubble">
        ${escapeHtml(text)}
      </div>
    </div>
  `;
  elements.chatContainer.appendChild(notice);
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
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
    
    // Update todo UI from background
    if (context?.context?.todoList) {
      state.todoList = context.context.todoList;
      updateTodoUI(state.todoList);
    }
  } catch (e) {}
}

async function resetMission() {
  if (confirm('Reset the current mission?')) {
    await sendToBackground({ type: 'RESET_MISSION' }).catch(() => {});
    
    // Reset all state
    state.messages = [];
    state.missionActive = false;
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
    
    // Reset UI
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
        <p>I'm your intelligent browser automation assistant. I can help you:</p>
        <ul>
          <li>Navigate to Jira tickets and analyze issues</li>
          <li>Deep-dive into WordPress/Divi admin panels</li>
          <li>Execute multi-step workflows across platforms</li>
          <li>Provide accurate time estimates</li>
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
  
  try {
    await sendToBackground({
      type: 'INJECT_CONTENT_SCRIPT',
      tabId: targetTabId
    });
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const response = await chrome.tabs.sendMessage(targetTabId, {
      type: 'GET_PAGE_CONTENT'
    });
    
    return response;
  } catch (error) {
    console.error('[Sidepanel] Failed to get page content:', error);
    return null;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================
function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
