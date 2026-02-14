// background.js - Service Worker for Manureva AI Assistant
// Version 4.1.0 - Refactored: shared utils in shared.js, deduplicated API logic.

importScripts('shared.js');

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
  MODEL: 'claude-sonnet-4-20250514',
  MAX_TOKENS: 8192  // Increased for complex workflows
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
let apiKey = null;

const missionState = {
  primaryGoal: null,
  missionType: 'general',  // 'estimation', 'action', 'research', 'general'
  primaryTabId: null,
  primaryTabInfo: null,
  pageContext: null,
  criticalFindings: [],
  currentStep: 0,
  totalSteps: 5,
  progress: '0/5',
  tabData: new Map(),
  todoList: [],
  completedActions: []
};

const tabRegistry = new Map();

// ============================================================================
// MISSION TYPE DETECTION
// ============================================================================
function detectMissionType(goal) {
  if (!goal) return 'general';
  const g = goal.toLowerCase();

  // Estimation keywords
  if (/\b(estimate|estimation|how long|time estimate|story points?|size this|assess complexity)\b/.test(g)) {
    return 'estimation';
  }
  // Action/execution keywords
  if (/\b(book|buy|purchase|sign up|register|fill|submit|order|checkout|download|install|configure|set up|create|delete|send|post|upload|apply|reserve)\b/.test(g)) {
    return 'action';
  }
  // Research keywords
  if (/\b(find|search|look up|what is|how does|explain|compare|list|show me|check if|tell me about|research)\b/.test(g)) {
    return 'research';
  }
  return 'general';
}

// ============================================================================
// SYSTEM PROMPTS - Mission-Adaptive
// ============================================================================
const BASE_PROMPT = `You are Manureva AI Assistant, an autonomous browser automation agent. You can navigate websites, click buttons, scroll, type, and analyze content to accomplish tasks for the user.

## CORE RULES

### RULE #1: STAY TRUE TO THE MISSION
Your job is to accomplish EXACTLY what the user asked for. Read the PRIMARY GOAL below carefully and execute it faithfully. Do NOT deviate to a different task type.

### RULE #2: KEEP GOING UNTIL DONE
After each action, you'll get updated page content. Keep taking actions until the mission is complete:
1. Navigate to sites → read what you see → interact as needed
2. Use the page content provided to decide your next action
3. Only stop when the user's actual goal is fully accomplished

### RULE #3: ONE ACTION PER RESPONSE
Output ONE action tag, then STOP. Wait for the result before deciding the next step.

### RULE #4: BE PRECISE WITH INTERACTIONS
- For clicking: ALWAYS prefer CSS selectors over text matching when elements have data attributes, IDs, or unique classes
- For calendar/date pickers: Use selectors like [data-date="2026-04-20"], [aria-label="April 20"], or button[data-day="20"] instead of just the number text
- For form fields: Use the input's ID, name, or aria-label as the selector
- When text is ambiguous (short text like "5", "20", single words), use a CSS selector instead
- Example: <click selector="[aria-label='Saturday, April 20, 2026']" description="Select April 20" /> is better than <click text="20" />

## ACTION TAGS

Navigate to URL:
<navigate url="https://example.com" purpose="Check frontend" />

Scroll the page:
<scroll direction="down" amount="500" purpose="See footer" />
<scroll to="bottom" purpose="View full page" />

Click something (prefer selector for precision):
<click selector="#submit-btn" description="Submit form" />
<click selector="[aria-label='April 20']" description="Select date" />
<click text="Appearance" description="Open menu" />

Type text:
<type selector="#search-input" text="search query" purpose="Enter search" />

Press a key:
<pressKey key="Return" purpose="Submit" />

Store a finding:
<storeContext key="price" value="$450 round trip" />

Switch browser tab:
<switchTab platform="jira" />

Create a to-do list:
<todo action="create">
- Step 1 description
- Step 2 description
</todo>

Update to-do status:
<todo action="update" item="1" status="done" />`;

const ESTIMATION_PROMPT_ADDON = `

## MISSION TYPE: ESTIMATION
You are estimating a Jira ticket. Your goal is to explore the relevant systems and provide a time estimate.

### ESTIMATION RULES
- You ALREADY HAVE the Jira ticket — check the "STORED JIRA TICKET" section below
- NEVER ask "what ticket?" or "what needs to be estimated?" — USE the stored ticket info
- Reference the ticket key in your responses: "Based on ticket [KEY]..."
- Keep exploring until you can provide an informed estimate

### ESTIMATE FORMAT
When ready, provide:

**Estimate for [TICKET-KEY]: [Summary]**

**What I found:**
- [Observation 1]
- [Observation 2]

**Time breakdown:**
- Task 1: X min
- Task 2: X min
- Buffer: X min
- **Total: X hour(s)**

**Complexity:** Low/Medium/High`;

const ACTION_PROMPT_ADDON = `

## MISSION TYPE: ACTION/EXECUTION
You are performing a real task on behalf of the user. Your goal is to COMPLETE the task, not estimate it.

### ACTION RULES
- EXECUTE the task step by step — do NOT provide time estimates or assessments
- Focus on actually accomplishing what the user asked (booking, purchasing, filling forms, etc.)
- Verify each step succeeded before moving to the next
- If you encounter errors or unexpected states, try alternative approaches
- Report what you accomplished, not how long it would take
- When the task is fully done, say "✅ Task Complete" and summarize what was accomplished`;

const RESEARCH_PROMPT_ADDON = `

## MISSION TYPE: RESEARCH/INVESTIGATION
You are researching information for the user. Your goal is to find and report accurate information.

### RESEARCH RULES
- Navigate to relevant sources and extract the information requested
- Verify facts across multiple sources when possible
- Report findings clearly and concisely
- When you have a comprehensive answer, present it and say "✅ Research Complete"`;

const GENERAL_PROMPT_ADDON = `

## MISSION TYPE: GENERAL
Follow the user's instructions precisely. Complete whatever task they've described.
When the task is done, say "✅ Task Complete" and summarize what was accomplished.`;


// ============================================================================
// INITIALIZATION
// ============================================================================
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Manureva] Extension installed - v4.0.0 Advanced Workflow');
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received:', message.type);
  
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      console.error('[Background] Error:', error);
      sendResponse({ success: false, error: error.message });
    });
  
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CLAUDE_API_CALL':
      return await callClaudeAPI(message.payload);
    
    case 'CLAUDE_API_CALL_WITH_CONTEXT':
      return await callClaudeAPIWithContext(message.payload);
    
    case 'SET_API_KEY':
      return setApiKey(message.apiKey);
    
    case 'GET_API_KEY':
      return { apiKey: apiKey };
    
    case 'INJECT_CONTENT_SCRIPT':
      return await injectContentScript(message.tabId);
    
    case 'GET_TAB_INFO':
      return await getTabInfo(message.tabId);
    
    case 'NAVIGATE_TAB':
      return await navigateTab(message.tabId, message.url);
    
    case 'NAVIGATE_NEW_TAB':
      return await navigateNewTab(message.url, message.purpose);
    
    case 'CREATE_TAB':
      return await createTab(message.url, message.active);
    
    case 'SWITCH_TO_TAB':
      return await switchToTab(message.tabId, message.platform);
    
    case 'EXECUTE_IN_TAB':
      return await executeInTab(message.tabId, message.action);
    
    case 'SET_PRIMARY_TAB':
      return setPrimaryTab(message.tabId, message.url, message.title);
    
    case 'SET_PRIMARY_GOAL':
      return setPrimaryGoal(message.goal, message.pageContext);
    
    case 'GET_MISSION_CONTEXT':
      return getMissionContext();
    
    case 'RESET_MISSION':
      return resetMission();
    
    case 'ADD_CRITICAL_FINDING':
      return addCriticalFinding(message.finding, message.source);
    
    case 'STORE_TAB_DATA':
      return storeTabData(message.tabId, message.key, message.value);
    
    case 'GET_TAB_DATA':
      return getTabData(message.tabId, message.key);
    
    // NEW: To-do list management
    case 'UPDATE_TODO':
      return updateTodoList(message.action, message.items, message.itemIndex, message.status);
    
    case 'GET_TODO':
      return { todoList: missionState.todoList };
    
    // NEW: Track completed actions
    case 'LOG_ACTION':
      return logCompletedAction(message.action, message.result);
    
    case 'GET_ACTION_LOG':
      return { actions: missionState.completedActions };
    
    default:
      console.warn('[Background] Unknown message type:', message.type);
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ============================================================================
// CLAUDE API
// ============================================================================
async function ensureApiKey() {
  if (!apiKey) {
    const stored = await chrome.storage.local.get('apiKey');
    if (stored.apiKey) {
      apiKey = stored.apiKey;
    } else {
      throw new Error('API key not set.');
    }
  }
}

async function fetchClaudeAPI(systemPrompt, messages) {
  const MAX_RETRIES = 3;
  const BACKOFF_BASE = 2000; // 2s, 4s, 8s

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(CONFIG.CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          max_tokens: CONFIG.MAX_TOKENS,
          system: systemPrompt,
          messages: messages
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const status = response.status;
        // Retry on 429 (rate limit) and 5xx (server errors), not on 4xx client errors
        if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
          const delay = BACKOFF_BASE * Math.pow(2, attempt - 1);
          console.warn(`[Background] API error ${status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`API error: ${status} - ${errorData.error?.message || 'Unknown'}`);
      }

      const data = await response.json();

      return {
        success: true,
        content: data.content.filter(b => b.type === 'text').map(b => b.text).join('\n'),
        usage: data.usage,
        stopReason: data.stop_reason
      };
    } catch (error) {
      // Retry on network errors (Failed to fetch), not on JSON parse / logic errors
      if (error.message === 'Failed to fetch' && attempt < MAX_RETRIES) {
        const delay = BACKOFF_BASE * Math.pow(2, attempt - 1);
        console.warn(`[Background] Fetch failed, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

function buildSystemPrompt() {
  let prompt = BASE_PROMPT;

  // Append mission-specific addon
  switch (missionState.missionType) {
    case 'estimation':
      prompt += ESTIMATION_PROMPT_ADDON;
      break;
    case 'action':
      prompt += ACTION_PROMPT_ADDON;
      break;
    case 'research':
      prompt += RESEARCH_PROMPT_ADDON;
      break;
    default:
      prompt += GENERAL_PROMPT_ADDON;
      break;
  }

  return prompt;
}

async function callClaudeAPI(payload) {
  await ensureApiKey();
  const { messages, systemPrompt } = payload;
  return await fetchClaudeAPI(systemPrompt || buildSystemPrompt(), messages);
}

async function callClaudeAPIWithContext(payload) {
  await ensureApiKey();
  const { messages, pageContext } = payload;

  // Build mission-adaptive system prompt
  let contextualPrompt = buildSystemPrompt();

  // Add Jira context ONLY for estimation missions (or if context exists and is relevant)
  if (pageContext?.storedJiraContext) {
    const jira = pageContext.storedJiraContext;
    if (missionState.missionType === 'estimation') {
      contextualPrompt += `\n\n## ⚠️⚠️⚠️ STORED JIRA TICKET - YOU ALREADY HAVE THIS - DO NOT ASK FOR IT ⚠️⚠️⚠️`;
      contextualPrompt += `\n\n**THIS IS THE TICKET YOU ARE ESTIMATING:**`;
    } else {
      contextualPrompt += `\n\n## STORED JIRA TICKET (for reference)`;
    }
    if (jira.ticketInfo) {
      if (jira.ticketInfo.key) contextualPrompt += `\n- **Ticket Key:** ${jira.ticketInfo.key}`;
      if (jira.ticketInfo.summary) contextualPrompt += `\n- **Task:** ${jira.ticketInfo.summary}`;
      if (jira.ticketInfo.status) contextualPrompt += `\n- **Status:** ${jira.ticketInfo.status}`;
      if (jira.ticketInfo.priority) contextualPrompt += `\n- **Priority:** ${jira.ticketInfo.priority}`;
      if (jira.ticketInfo.assignee) contextualPrompt += `\n- **Assignee:** ${jira.ticketInfo.assignee}`;
    }
    if (jira.description) {
      contextualPrompt += `\n- **Full Description:** ${jira.description.substring(0, 1200)}`;
    }
    if (jira.relatedLinks?.length > 0) {
      contextualPrompt += `\n- **Related URLs in ticket:** ${jira.relatedLinks.map(l => l.url).join(', ')}`;
    }
    if (missionState.missionType === 'estimation') {
      contextualPrompt += `\n\n**⚠️ NEVER ask "what ticket?" or "what needs to be estimated?" - USE THE INFO ABOVE.**`;
      contextualPrompt += `\n**Reference this ticket in your analysis: "Based on ${jira.ticketInfo?.key || 'the ticket'}..."**`;
    }
  }

  // Add current page context
  if (pageContext) {
    contextualPrompt += `\n\n## CURRENT SESSION CONTEXT

### Active Page
- **URL:** ${pageContext.url || 'Unknown'}
- **Title:** ${pageContext.title || 'Unknown'}
- **Platform:** ${pageContext.platform?.toUpperCase() || 'Unknown'}`;

    if (pageContext.summary) {
      contextualPrompt += `\n- **Summary:** ${pageContext.summary}`;
    }
  }

  // Add to-do list if exists
  if (missionState.todoList.length > 0) {
    contextualPrompt += `\n\n### TO-DO LIST STATUS`;
    missionState.todoList.forEach((item, i) => {
      const statusIcon = item.status === 'done' ? '✅' : item.status === 'in-progress' ? '🔄' : '⬜';
      contextualPrompt += `\n${statusIcon} ${i + 1}. ${item.text}`;
    });
  }

  // Add stored findings
  if (missionState.criticalFindings.length > 0) {
    contextualPrompt += `\n\n### STORED FINDINGS`;
    missionState.criticalFindings.forEach(f => {
      contextualPrompt += `\n- ${f}`;
    });
  }

  // Add recent action log
  if (missionState.completedActions.length > 0) {
    const recentActions = missionState.completedActions.slice(-10);
    contextualPrompt += `\n\n### RECENT ACTIONS (last ${recentActions.length})`;
    recentActions.forEach(a => {
      contextualPrompt += `\n- ${a.action}: ${a.result || 'completed'}`;
    });
  }

  // Add primary goal
  if (missionState.primaryGoal) {
    contextualPrompt += `\n\n### PRIMARY GOAL\n${missionState.primaryGoal}`;
  }

  console.log('[Background] API call with context:', {
    missionType: missionState.missionType,
    platform: pageContext?.platform,
    findings: missionState.criticalFindings.length,
    todoItems: missionState.todoList.length,
    hasJiraContext: !!pageContext?.storedJiraContext
  });

  return await fetchClaudeAPI(contextualPrompt, messages);
}

// ============================================================================
// API KEY
// ============================================================================
function setApiKey(key) {
  apiKey = key;
  chrome.storage.local.set({ apiKey: key });
  return { success: true };
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================
async function injectContentScript(tabId) {
  try {
    try {
      const results = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (results?.ready) return { success: true, alreadyInjected: true };
    } catch (e) {}
    
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'content.js'] });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return { success: true };
  } catch (error) {
    console.error('[Background] Inject failed:', error);
    return { success: false, error: error.message };
  }
}

async function getTabInfo(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      platform: detectPlatform(tab.url)
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  
  // Log the action
  logCompletedAction(`Navigate to ${url}`, 'started');
  
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        logCompletedAction(`Navigate to ${url}`, 'completed');
        resolve({ success: true });
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ success: true, timeout: true });
    }, 30000);
  });
}

async function navigateNewTab(url, purpose) {
  console.log('[Background] 🚀 Opening NEW TAB:', url);
  
  // Log the action
  logCompletedAction(`Opening new tab: ${url}`, 'started');
  
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    
    tabRegistry.set(tab.id, {
      url, title: 'Loading...', platform: detectPlatform(url),
      purpose, isPrimary: false, createdAt: Date.now()
    });
    
    return new Promise((resolve) => {
      const listener = (tabId, changeInfo, updatedTab) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          tabRegistry.set(tab.id, {
            ...tabRegistry.get(tab.id),
            url: updatedTab.url,
            title: updatedTab.title,
            platform: detectPlatform(updatedTab.url)
          });
          
          chrome.runtime.sendMessage({
            type: 'TAB_UPDATED',
            tabId: tab.id,
            url: updatedTab.url,
            title: updatedTab.title,
            platform: detectPlatform(updatedTab.url),
            isPrimary: false
          }).catch(() => {});
          
          logCompletedAction(`Navigated to ${updatedTab.url}`, 'completed');
          
          resolve({
            success: true,
            tabId: tab.id,
            url: updatedTab.url,
            title: updatedTab.title,
            platform: detectPlatform(updatedTab.url)
          });
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ success: true, tabId: tab.id, url, timeout: true });
      }, 30000);
    });
  } catch (error) {
    console.error('[Background] Failed to create tab:', error);
    return { success: false, error: error.message };
  }
}

async function createTab(url, active = false) {
  const tab = await chrome.tabs.create({ url, active });
  
  return new Promise((resolve) => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ success: true, tabId: tab.id });
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ success: true, tabId: tab.id, timeout: true });
    }, 30000);
  });
}

async function switchToTab(tabId, platform) {
  console.log('[Background] 🔄 Switching to tab:', tabId, 'platform:', platform);
  
  try {
    let targetTabId = tabId;
    
    // Handle special values
    if (tabId === 'primary' || tabId === 'jira' || (platform === 'jira' && !targetTabId)) {
      targetTabId = missionState.primaryTabId;
      console.log('[Background] Using primary tab:', targetTabId);
    }
    
    // If still no tabId, search by platform
    if (!targetTabId && platform) {
      // First check registry
      for (const [id, info] of tabRegistry.entries()) {
        if (info.platform === platform || info.platform?.includes(platform)) {
          targetTabId = id;
          break;
        }
      }
      
      // Fallback: search all tabs
      if (!targetTabId) {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          const tabPlatform = detectPlatform(tab.url);
          if (tabPlatform === platform || tabPlatform.includes(platform)) {
            targetTabId = tab.id;
            break;
          }
        }
      }
    }
    
    if (!targetTabId) {
      return { success: false, error: 'No matching tab found' };
    }
    
    await chrome.tabs.update(targetTabId, { active: true });
    const tab = await chrome.tabs.get(targetTabId);
    
    logCompletedAction(`Switched to tab: ${tab.title}`, 'completed');
    
    return {
      success: true,
      tabId: targetTabId,
      url: tab.url,
      title: tab.title,
      platform: detectPlatform(tab.url)
    };
  } catch (error) {
    console.error('[Background] Switch failed:', error);
    return { success: false, error: error.message };
  }
}

// Patterns for domains where automated DOM actions (click, type, pressKey) should be blocked
const SENSITIVE_DOMAIN_PATTERNS = [
  /bank|banking|chase|wellsfargo|bofa|citi|hsbc|barclays/i,
  /paypal|venmo|stripe\.com|square\.com/i,
  /signin\.aws|console\.aws/i,
  /accounts\.google|myaccount\.google/i,
  /login\.microsoft|portal\.azure/i,
  /chrome:\/\/|chrome-extension:\/\/|about:/i
];

function isSensitiveDomain(url) {
  if (!url) return false;
  return SENSITIVE_DOMAIN_PATTERNS.some(pattern => pattern.test(url));
}

async function executeInTab(tabId, action) {
  // Block mutating DOM actions on sensitive domains
  const mutatingActions = ['CLICK', 'TYPE', 'PRESS_KEY'];
  if (mutatingActions.includes(action.type)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isSensitiveDomain(tab.url)) {
        console.warn('[Background] Blocked action on sensitive domain:', tab.url);
        logCompletedAction(`${action.type}`, 'blocked: sensitive domain');
        return { success: false, error: 'Action blocked: this domain is restricted for automated interactions.' };
      }
    } catch (e) {
      // If we can't verify the tab, block the action as a precaution
      return { success: false, error: 'Unable to verify tab safety.' };
    }
  }

  await injectContentScript(tabId);

  try {
    const result = await chrome.tabs.sendMessage(tabId, action);
    logCompletedAction(`${action.type}: ${action.description || action.text || action.selector || ''}`, result?.success ? 'success' : 'failed');
    return result;
  } catch (error) {
    console.error('[Background] Execute failed:', error);
    logCompletedAction(`${action.type}`, `failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// MISSION MANAGEMENT
// ============================================================================
function setPrimaryTab(tabId, url, title) {
  missionState.primaryTabId = tabId;
  missionState.primaryTabInfo = { url, title, platform: detectPlatform(url) };
  
  tabRegistry.set(tabId, {
    url, title, platform: detectPlatform(url), isPrimary: true, purpose: 'primary'
  });
  
  console.log('[Background] Primary tab:', tabId, url);
  return { success: true };
}

function setPrimaryGoal(goal, pageContext) {
  missionState.primaryGoal = goal;
  missionState.missionType = detectMissionType(goal);
  missionState.pageContext = pageContext;
  missionState.currentStep = 1;
  missionState.progress = '1/5';
  missionState.criticalFindings = [];
  missionState.todoList = [];
  missionState.completedActions = [];

  console.log('[Background] Mission type detected:', missionState.missionType, 'for goal:', goal.substring(0, 80));
  return { success: true, missionType: missionState.missionType };
}

function getMissionContext() {
  return {
    context: {
      primaryGoal: missionState.primaryGoal,
      missionType: missionState.missionType,
      primaryTabId: missionState.primaryTabId,
      primaryTabInfo: missionState.primaryTabInfo,
      criticalFindings: missionState.criticalFindings,
      todoList: missionState.todoList,
      completedActions: missionState.completedActions.slice(-20),
      progress: missionState.progress
    }
  };
}

function resetMission() {
  missionState.primaryGoal = null;
  missionState.missionType = 'general';
  missionState.primaryTabId = null;
  missionState.primaryTabInfo = null;
  missionState.pageContext = null;
  missionState.criticalFindings = [];
  missionState.currentStep = 0;
  missionState.progress = '0/0';
  missionState.tabData.clear();
  missionState.todoList = [];
  missionState.completedActions = [];
  tabRegistry.clear();

  return { success: true };
}

function addCriticalFinding(finding, source) {
  const entry = source ? `[${source}] ${finding}` : finding;
  
  // Avoid duplicates
  if (!missionState.criticalFindings.some(f => f.includes(finding.substring(0, 50)))) {
    missionState.criticalFindings.push(entry);
    console.log('[Background] Added finding:', entry.substring(0, 80));
  }
  
  return { success: true, count: missionState.criticalFindings.length };
}

function storeTabData(tabId, key, value) {
  missionState.tabData.set(`${tabId}-${key}`, value);
  return { success: true };
}

function getTabData(tabId, key) {
  return { value: missionState.tabData.get(`${tabId}-${key}`) };
}

// ============================================================================
// TO-DO LIST MANAGEMENT (NEW)
// ============================================================================
function updateTodoList(action, items, itemIndex, status) {
  switch (action) {
    case 'create':
      missionState.todoList = items.map(text => ({
        text: text.replace(/^[-•]\s*/, ''),
        status: 'pending',
        createdAt: Date.now()
      }));
      console.log('[Background] Created todo list:', missionState.todoList.length, 'items');
      return { success: true, todoList: missionState.todoList };
    
    case 'update':
      if (itemIndex >= 0 && itemIndex < missionState.todoList.length) {
        missionState.todoList[itemIndex].status = status;
        missionState.todoList[itemIndex].updatedAt = Date.now();
        console.log('[Background] Updated todo item', itemIndex, 'to', status);
      }
      return { success: true, todoList: missionState.todoList };
    
    case 'clear':
      missionState.todoList = [];
      return { success: true };
    
    default:
      return { success: false, error: 'Unknown todo action' };
  }
}

// ============================================================================
// ACTION LOGGING (NEW)
// ============================================================================
function logCompletedAction(action, result) {
  missionState.completedActions.push({
    action,
    result,
    timestamp: Date.now()
  });
  
  // Keep only last 50 actions
  if (missionState.completedActions.length > 50) {
    missionState.completedActions = missionState.completedActions.slice(-50);
  }
  
  return { success: true };
}

// ============================================================================
// TAB LISTENERS
// ============================================================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    if (tabRegistry.has(tabId)) {
      tabRegistry.set(tabId, {
        ...tabRegistry.get(tabId),
        url: tab.url, title: tab.title, platform: detectPlatform(tab.url)
      });
    }
    
    chrome.runtime.sendMessage({
      type: 'TAB_UPDATED',
      tabId, url: tab.url, title: tab.title,
      platform: detectPlatform(tab.url),
      isPrimary: tabId === missionState.primaryTabId
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRegistry.delete(tabId);
});

console.log('[Manureva] Background v4.0.0 loaded - Advanced Multi-Step Workflow');
