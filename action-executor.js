// action-executor.js - Action execution for Manureva AI Assistant
// Handles the agentic loop: parsing actions, executing DOM commands, building continuations.
// Depends on globals: state, loopCount, MAX_* constants, sendToBackground, getPageContent,
//                     sendMessageToAssistant (from sidepanel.js)
//                     addSystemNotice, updateTodoUI (from ui.js)
//                     parseAllActions (from action-parser.js)
//                     detectPlatform (from shared.js)

// ============================================================================
// HELPERS
// ============================================================================

// Wait for a tab to finish loading (polls tab status instead of fixed delays).
async function waitForTabReady(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await sendToBackground({ type: 'GET_TAB_INFO', tabId });
    if (info?.status === 'complete') {
      // Give the page a moment to run its JS after "complete"
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false; // timed out
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
// MAIN ACTION PROCESSING
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
  // STEP 0: CHECK FOR COMPLETION (mission-aware)
  // ==========================================================================
  let hasCompleteEstimate = false;

  if (state.missionType === 'estimation') {
    // Estimation missions: complete when time estimate + complexity are provided
    const hasTimeEstimate = /\*\*Total[:\*]*\s*[\d.]+\s*(hour|hr|min|h\b)/i.test(content) ||
                            /Total:?\s*[\d.]+\s*(hour|hr|min|h\b)/i.test(content) ||
                            /estimate[d]?:?\s*[\d.]+\s*(hour|hr|min|h\b)/i.test(content);

    const hasComplexity = /(Complexity|Confidence)[:\*]*\s*(Low|Medium|High)/i.test(content);

    const hasExplicitEstimation = /estimation complete/i.test(content) ||
                                   /here'?s my estimate/i.test(content);

    hasCompleteEstimate = (hasTimeEstimate && hasComplexity) || hasExplicitEstimation;
  } else {
    // Non-estimation missions: complete when explicit completion marker is present
    hasCompleteEstimate = /\u2705\s*(Task Complete|Research Complete|Done|Finished|Mission Complete)/i.test(content) ||
                          /task complete/i.test(content) ||
                          /research complete/i.test(content) ||
                          /mission complete/i.test(content);
  }

  if (hasCompleteEstimate) {
    console.log(`[Sidepanel] \u2705 TASK COMPLETE DETECTED (type: ${state.missionType})`);
    addSystemNotice('\u2705 Task complete!');

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
      addSystemNotice(`\u{1F4BE} Stored: ${store.key}`);
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

  const navActions = actions.filter(a => a.type === 'navigate');
  const switchActions = actions.filter(a => a.type === 'switchTab');

  let targetUrl = state.pendingNavigationUrl || navActions[0]?.url;

  if (targetUrl) {
    state.navigationCount++;

    if (state.navigationCount > MAX_NAVIGATIONS_PER_MISSION) {
      console.log('[Sidepanel] \u26A0\uFE0F Navigation limit reached');
      addSystemNotice(`\u26A0\uFE0F Navigation limit (${MAX_NAVIGATIONS_PER_MISSION}). Wrapping up...`);
    } else {
      console.log('[Sidepanel] \u{1F680} NAVIGATING:', targetUrl);
      addSystemNotice(`\u{1F680} Nav ${state.navigationCount}/${MAX_NAVIGATIONS_PER_MISSION}: ${truncateUrl(targetUrl)}`);
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

          addSystemNotice(`\u2705 Opened: ${result.title || targetUrl}`);
          logAction('navigate', targetUrl, 'success');

          // Wait for the new tab to finish loading, then inject content script
          await waitForTabReady(result.tabId, 15000);
          await sendToBackground({ type: 'INJECT_CONTENT_SCRIPT', tabId: result.tabId });
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          addSystemNotice(`\u274C Navigation failed`);
          logAction('navigate', targetUrl, 'failed');
        }
      } catch (err) {
        addSystemNotice(`\u274C Error: ${err.message}`);
        logAction('navigate', targetUrl, 'failed');
      }
    }
    state.pendingNavigationUrl = null;
  }

  // Handle switchTab
  if (switchActions.length > 0 && !navigationExecuted) {
    const switchAction = switchActions[0];
    console.log('[Sidepanel] \u{1F504} SWITCHING TAB:', switchAction);
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
        addSystemNotice(`\u{1F504} Switched to: ${result.title || result.platform}`);
        logAction('switchTab', result.title, 'success');
      }
    } catch (err) {
      logAction('switchTab', '', 'failed');
    }
  }

  // ==========================================================================
  // STEP 5: EXECUTE DOM ACTIONS
  // ==========================================================================
  const domActions = actions.filter(a =>
    ['click', 'scroll', 'type', 'pressKey', 'setslider', 'read', 'verify', 'wait'].includes(a.type)
  );

  let domActionExecuted = false;

  for (const action of domActions) {
    if (action.type === 'click' && state.clickCount >= MAX_CLICKS_PER_MISSION) {
      addSystemNotice(`\u26A0\uFE0F Click limit reached`);
      continue;
    }
    if (action.type === 'scroll' && state.scrollCount >= MAX_SCROLLS_PER_MISSION) {
      addSystemNotice(`\u26A0\uFE0F Scroll limit reached`);
      continue;
    }
    if (action.type === 'type' && state.typeCount >= MAX_TYPES_PER_MISSION) {
      addSystemNotice(`\u26A0\uFE0F Type limit reached`);
      continue;
    }

    const result = await executeDomAction(action);

    if (result?.executed) {
      domActionExecuted = true;
    }
  }

  // ==========================================================================
  // STEP 6: CONTINUATION LOGIC
  // ==========================================================================
  const anyActionExecuted = navigationExecuted || switchExecuted || domActionExecuted ||
                            todoActions.length > 0 || storeActions.length > 0;

  // If in estimation mode and AI asked for ticket info it already has, FORCE CONTINUE
  const hasJiraContext = !!state.storedJiraContext?.ticketInfo;
  const aiAskedForTicket = /jira ticket|what needs to be|what ticket|specific task/i.test(content);

  if (state.missionType === 'estimation' && aiAskedForTicket && hasJiraContext) {
    console.log('[Sidepanel] \u26A0\uFE0F AI asked for ticket but we have it - FORCING CONTINUE');
    addSystemNotice('\u26A0\uFE0F AI forgot context - reminding it...');
    loopCount++;

    if (loopCount <= MAX_LOOP_ITERATIONS) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const reminderMessage = buildReminderMessage();
      await sendMessageToAssistant(reminderMessage, false);
    }
    return;
  }

  const shouldContinue = anyActionExecuted && !hasCompleteEstimate;

  console.log('[Sidepanel] Continue decision:', {
    anyActionExecuted,
    hasCompleteEstimate,
    hasJiraContext,
    aiAskedForTicket,
    shouldContinue,
    loopCount
  });

  if (shouldContinue) {
    loopCount++;

    if (loopCount > MAX_LOOP_ITERATIONS) {
      console.log('[Sidepanel] Max iterations reached');
      addSystemNotice('\u26A0\uFE0F Max iterations. Stopping.');
      return;
    }

    console.log(`[Sidepanel] \u{1F504} AUTO-CONTINUING (iteration ${loopCount}/${MAX_LOOP_ITERATIONS})...`);
    addSystemNotice(`\u{1F504} Step ${loopCount}/${MAX_LOOP_ITERATIONS}`);

    await new Promise(resolve => setTimeout(resolve, 2500));
    const continueMessage = await buildContinuationMessage();
    await sendMessageToAssistant(continueMessage, false);
  }

  console.log('[Sidepanel] ========== ACTION PROCESSING DONE ==========');
}

// ============================================================================
// TODO ACTION HANDLER
// ============================================================================
async function handleTodoAction(todo) {
  if (todo.action === 'create' && todo.items) {
    state.todoList = todo.items.map(text => ({
      text: text.replace(/^[-\u2022]\s*/, ''),
      status: 'pending'
    }));

    await sendToBackground({
      type: 'UPDATE_TODO',
      action: 'create',
      items: todo.items
    }).catch(() => {});

    updateTodoUI(state.todoList);
    addSystemNotice(`\u{1F4DD} Created ${state.todoList.length} tasks`);
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

      const statusEmoji = todo.status === 'done' ? '\u2705' : todo.status === 'in-progress' ? '\u{1F504}' : '\u2B1C';
      addSystemNotice(`${statusEmoji} Task ${todo.item}: ${todo.status}`);
    }
  }
}

// ============================================================================
// DOM ACTION EXECUTOR
// ============================================================================
async function executeDomAction(action) {
  const result = { executed: false, urlChanged: false };

  switch (action.type) {
    case 'click':
      addSystemNotice(`\u{1F5B1}\uFE0F Click: ${action.text || action.selector || action.description}`);
      logAction('click', action.text || action.selector, 'started');

      const urlBefore = (await sendToBackground({ type: 'GET_TAB_INFO', tabId: state.currentTabId }))?.url;

      try {
        let clickResult = await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'CLICK',
            index: action.index,
            selector: action.selector,
            text: action.text,
            description: action.description
          }
        });

        // Retry once on failure — page may still be loading / rendering
        if (!clickResult?.success) {
          console.log('[ActionExecutor] Click failed, retrying after 2s...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          // Re-inject content script in case it was lost
          await sendToBackground({ type: 'INJECT_CONTENT_SCRIPT', tabId: state.currentTabId });
          await new Promise(resolve => setTimeout(resolve, 500));

          clickResult = await sendToBackground({
            type: 'EXECUTE_IN_TAB',
            tabId: state.currentTabId,
            action: {
              type: 'CLICK',
              index: action.index,
              selector: action.selector,
              text: action.text,
              description: action.description
            }
          });
        }

        if (clickResult?.success) {
          state.clickCount++;
          result.executed = true;
          addSystemNotice(`\u2705 Clicked (${state.clickCount}/${MAX_CLICKS_PER_MISSION})`);
          logAction('click', action.text || action.selector, 'success');

          await new Promise(resolve => setTimeout(resolve, 2000));
          const urlAfter = (await sendToBackground({ type: 'GET_TAB_INFO', tabId: state.currentTabId }))?.url;
          result.urlChanged = urlBefore !== urlAfter;

          if (result.urlChanged) {
            addSystemNotice(`\u{1F4C4} Page changed`);
          }
        } else {
          addSystemNotice(`\u26A0\uFE0F Click failed: ${clickResult?.error || 'element not found'}`);
          logAction('click', action.text || action.selector, 'failed');
        }
      } catch (err) {
        logAction('click', action.text || action.selector, 'failed');
      }
      break;

    case 'scroll':
      const scrollDesc = action.to || `${action.direction} ${action.amount || 300}px`;
      addSystemNotice(`\u{1F4DC} Scroll: ${scrollDesc}`);
      logAction('scroll', scrollDesc, 'started');

      try {
        const scrollResult = await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'SCROLL',
            direction: action.direction,
            to: action.to,
            amount: parseInt(action.amount) || 300
          }
        });

        if (scrollResult?.success) {
          state.scrollCount++;
          result.executed = true;
          await new Promise(resolve => setTimeout(resolve, 800));

          if (scrollResult.scrolled === false) {
            addSystemNotice(`\u26A0\uFE0F Already at ${action.to || action.direction} limit`);
          } else {
            addSystemNotice(`\u2705 Scrolled (${state.scrollCount}/${MAX_SCROLLS_PER_MISSION})`);
          }
          logAction('scroll', scrollDesc, 'success');
        } else {
          addSystemNotice(`\u26A0\uFE0F Scroll failed: ${scrollResult?.error || 'unknown'}`);
          logAction('scroll', scrollDesc, 'failed');
        }
      } catch (err) {
        addSystemNotice(`\u26A0\uFE0F Scroll failed: ${err.message}`);
        logAction('scroll', scrollDesc, 'failed');
      }
      break;

    case 'type':
      addSystemNotice(`\u2328\uFE0F Type: "${action.text}"`);
      logAction('type', action.text, 'started');

      try {
        const typeResult = await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'TYPE',
            index: action.index,
            selector: action.selector,
            text: action.text,
            clear: action.clear
          }
        });

        if (typeResult?.success) {
          state.typeCount++;
          result.executed = true;
          // Wait for autocomplete/dropdown to appear after typing
          await new Promise(resolve => setTimeout(resolve, 1500));
          addSystemNotice(`\u2705 Typed (${state.typeCount}/${MAX_TYPES_PER_MISSION})`);
          logAction('type', action.text, 'success');
        } else {
          addSystemNotice(`\u26A0\uFE0F Type failed: ${typeResult?.error || 'no input field'}`);
          logAction('type', action.text, 'failed');
        }
      } catch (err) {
        logAction('type', action.text, 'failed');
      }
      break;

    case 'pressKey':
      addSystemNotice(`\u2328\uFE0F Key: ${action.key}`);
      logAction('pressKey', action.key, 'started');

      try {
        const keyResult = await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'PRESS_KEY',
            key: action.key,
            ctrl: action.ctrl,
            shift: action.shift,
            alt: action.alt,
            meta: action.meta
          }
        });

        if (keyResult?.success) {
          result.executed = true;
          await new Promise(resolve => setTimeout(resolve, 500));
          addSystemNotice(`\u2705 Key pressed: ${action.key}`);
          logAction('pressKey', action.key, 'success');
        } else {
          addSystemNotice(`\u26A0\uFE0F Key press failed: ${keyResult?.error || 'unknown'}`);
          logAction('pressKey', action.key, 'failed');
        }
      } catch (err) {
        addSystemNotice(`\u26A0\uFE0F Key press failed: ${err.message}`);
        logAction('pressKey', action.key, 'failed');
      }
      break;

    case 'setslider':
      addSystemNotice(`\u{1F39A}\uFE0F Set slider: ${action.value}`);
      logAction('setSlider', `value=${action.value}`, 'started');

      try {
        const sliderResult = await sendToBackground({
          type: 'EXECUTE_IN_TAB',
          tabId: state.currentTabId,
          action: {
            type: 'SET_SLIDER_VALUE',
            index: action.index,
            selector: action.selector,
            value: action.value
          }
        });

        if (sliderResult?.success) {
          result.executed = true;
          addSystemNotice(`\u2705 Slider set to ${sliderResult.newValue}`);
          logAction('setSlider', `value=${sliderResult.newValue}`, 'success');
        } else {
          addSystemNotice(`\u26A0\uFE0F Slider failed: ${sliderResult?.error || 'unknown'}`);
          logAction('setSlider', `value=${action.value}`, 'failed');
        }
      } catch (err) {
        addSystemNotice(`\u26A0\uFE0F Slider failed: ${err.message}`);
        logAction('setSlider', `value=${action.value}`, 'failed');
      }
      break;

    case 'wait':
      const duration = parseInt(action.duration) || 1000;
      addSystemNotice(`\u23F3 Waiting ${duration}ms`);
      await new Promise(resolve => setTimeout(resolve, duration));
      result.executed = true;
      break;

    case 'read':
    case 'verify':
      addSystemNotice(`\u{1F441}\uFE0F ${action.type === 'read' ? 'Reading' : 'Verifying'}: ${action.target || action.purpose || 'page'}`);
      logAction(action.type, action.target || 'page', 'started');
      result.executed = true;
      logAction(action.type, action.target || 'page', 'success');
      break;
  }

  return result;
}

// ============================================================================
// CONTINUATION & REMINDER MESSAGE BUILDERS
// ============================================================================
async function buildContinuationMessage() {
  const pageContent = await getPageContent(state.currentTabId);
  const tabInfo = await sendToBackground({
    type: 'GET_TAB_INFO',
    tabId: state.currentTabId
  });

  const storedContext = await sendToBackground({ type: 'GET_MISSION_CONTEXT' }).catch(() => ({}));
  const missionType = state.missionType || storedContext?.context?.missionType || 'general';

  let msg = `[CONTINUATION - Step ${loopCount}]\n\n`;

  // Jira context — only emphasize for estimation missions
  if (state.storedJiraContext?.ticketInfo) {
    const jira = state.storedJiraContext;
    if (missionType === 'estimation') {
      msg += `\u26A0\uFE0F **REMEMBER: YOU HAVE THE JIRA TICKET - DO NOT ASK FOR IT**\n\n`;
      msg += `**\u{1F4CB} JIRA TICKET (use this for your estimate):**\n`;
    } else {
      msg += `**\u{1F4CB} JIRA TICKET (for reference):**\n`;
    }
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
    if (missionType === 'estimation') {
      msg += `**YOUR GOAL:** Estimate the above ticket based on what you observe on the current page.\n\n`;
    }
  } else {
    if (storedContext?.context?.criticalFindings?.length > 0) {
      const ticketFinding = storedContext.context.criticalFindings.find(f => /ticket:/i.test(f));
      if (ticketFinding) {
        msg += `\u26A0\uFE0F **STORED TICKET INFO:** ${ticketFinding}\n\n`;
      }
    }
  }

  // Stored findings
  if (storedContext?.context?.criticalFindings?.length > 0) {
    msg += `**\u{1F4BE} FINDINGS SO FAR:**\n`;
    storedContext.context.criticalFindings.slice(0, 8).forEach(f => {
      msg += `- ${f}\n`;
    });
    msg += '\n';
  }

  // Current page info
  msg += `**\u{1F4CD} CURRENT PAGE:**\n`;
  msg += `- URL: ${tabInfo?.url || 'Unknown'}\n`;
  msg += `- Title: ${tabInfo?.title || 'Unknown'}\n`;
  msg += `- Platform: ${pageContent?.platform?.toUpperCase() || 'Unknown'}\n\n`;

  // Resource status
  msg += `**\u{1F4CA} RESOURCES:**\n`;
  msg += `- Navigations: ${state.navigationCount}/${MAX_NAVIGATIONS_PER_MISSION}\n`;
  msg += `- Clicks: ${state.clickCount}/${MAX_CLICKS_PER_MISSION}\n`;
  msg += `- Scrolls: ${state.scrollCount}/${MAX_SCROLLS_PER_MISSION}\n`;
  msg += `- Iterations: ${loopCount}/${MAX_LOOP_ITERATIONS}\n\n`;

  // To-do status
  if (state.todoList.length > 0) {
    msg += `**\u{1F4DD} TO-DO STATUS:**\n`;
    state.todoList.forEach((item, i) => {
      const icon = item.status === 'done' ? '\u2705' : item.status === 'in-progress' ? '\u{1F504}' : '\u2B1C';
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
    msg += `**Element Map:**\n${pageContent.keyElements.join('\n')}\n\n`;
  }

  // Mission-specific closing instruction
  msg += `---\n`;
  if (missionType === 'estimation') {
    msg += `Continue analyzing this page in relation to the Jira ticket above. `;
    msg += `Use action tags for next steps, or provide your final estimate if ready.\n`;
    msg += `DO NOT ask for the Jira ticket - you already have it stored above.`;
  } else if (missionType === 'action') {
    msg += `Continue executing the user's task. Use action tags for the next step.\n`;
    msg += `Focus on COMPLETING the task — do NOT provide time estimates or assessments.\n`;
    msg += `PRIMARY GOAL: ${storedContext?.context?.primaryGoal || state.lastUserMessage}`;
  } else if (missionType === 'research') {
    msg += `Continue researching. Use action tags to explore further, or present your findings if ready.\n`;
    msg += `PRIMARY GOAL: ${storedContext?.context?.primaryGoal || state.lastUserMessage}`;
  } else {
    msg += `Continue with the task. Use action tags for the next step.\n`;
    msg += `PRIMARY GOAL: ${storedContext?.context?.primaryGoal || state.lastUserMessage}`;
  }

  return msg;
}

function buildReminderMessage() {
  let msg = `[CONTEXT REMINDER]\n\n`;
  msg += `\u26A0\uFE0F **YOU ALREADY HAVE THE JIRA TICKET. DO NOT ASK FOR IT.**\n\n`;

  if (state.storedJiraContext?.ticketInfo) {
    msg += `**\u{1F4CB} HERE IS THE TICKET AGAIN:**\n`;
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
