// content.js - Content Script for Manureva AI Assistant
// Handles DOM reading, clicking, scrolling, and visual feedback

console.log('[Manureva Content] Script loaded');

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content] Received:', message.type || message);
  
  try {
    switch (message.type) {
      case 'PING':
        sendResponse({ ready: true });
        break;
      
      case 'GET_PAGE_CONTENT':
        const content = extractPageContent();
        sendResponse(content);
        break;
      
      case 'CLICK':
        handleClick(message, sendResponse);
        break;
      
      case 'SCROLL':
        handleScroll(message, sendResponse);
        break;
      
      case 'TYPE':
        handleType(message, sendResponse);
        break;
      
      case 'PRESS_KEY':
        handlePressKey(message, sendResponse);
        break;
      
      case 'OBSERVE':
        const observation = extractPageContent();
        sendResponse({ success: true, data: observation });
        break;
      
      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('[Content] Error:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Keep channel open for async
});

// ============================================================================
// PAGE CONTENT EXTRACTION
// ============================================================================
function extractPageContent() {
  const url = window.location.href;
  const platform = detectPlatform(url);
  
  let result = {
    url,
    title: document.title,
    platform,
    summary: '',
    mainContent: '',
    keyElements: [],
    extractedData: {},
    ticketInfo: null,
    relatedLinks: [],
    navigationOptions: []
  };
  
  // Platform-specific extraction
  if (platform === 'jira') {
    result = { ...result, ...extractJiraContent() };
  } else if (platform === 'wordpress-admin') {
    result = { ...result, ...extractWordPressAdmin() };
  } else {
    result = { ...result, ...extractGenericContent() };
  }
  
  // Common extractions
  result.keyElements = extractKeyElements();
  result.relatedLinks = extractLinks();
  result.navigationOptions = extractNavigation();
  
  return result;
}

function detectPlatform(url) {
  if (/atlassian\.net|jira\./i.test(url)) return 'jira';
  if (/\/wp-admin|\/wp-login/i.test(url)) return 'wordpress-admin';
  if (/github\.com/i.test(url)) return 'github';
  return 'website';
}

// ============================================================================
// JIRA EXTRACTION
// ============================================================================
function extractJiraContent() {
  const result = {
    ticketInfo: {},
    mainContent: '',
    summary: ''
  };
  
  // Ticket key
  const keyEl = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]') ||
                document.querySelector('[data-testid="issue-key"]') ||
                document.querySelector('.issuekey a');
  if (keyEl) {
    result.ticketInfo.key = keyEl.textContent.trim();
  }
  
  // Summary/Title
  const summaryEl = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"]') ||
                    document.querySelector('h1[data-testid]') ||
                    document.querySelector('#summary-val');
  if (summaryEl) {
    result.ticketInfo.summary = summaryEl.textContent.trim();
    result.summary = result.ticketInfo.summary;
  }
  
  // Description
  const descEl = document.querySelector('[data-testid="issue.views.field.rich-text.description"]') ||
                 document.querySelector('.description-content') ||
                 document.querySelector('#description-val');
  if (descEl) {
    result.mainContent = descEl.textContent.trim().substring(0, 2000);
    result.ticketInfo.description = result.mainContent;
  }
  
  // Status
  const statusEl = document.querySelector('[data-testid="issue.views.issue-base.foundation.status.status-field-wrapper"]') ||
                   document.querySelector('.status-lozenge');
  if (statusEl) {
    result.ticketInfo.status = statusEl.textContent.trim();
  }
  
  // Priority
  const priorityEl = document.querySelector('[data-testid="issue.views.field.priority.priority-view"]') ||
                     document.querySelector('.priority-field');
  if (priorityEl) {
    result.ticketInfo.priority = priorityEl.textContent.trim();
  }
  
  // Assignee
  const assigneeEl = document.querySelector('[data-testid="issue.views.field.user.assignee"]') ||
                     document.querySelector('.assignee-field');
  if (assigneeEl) {
    result.ticketInfo.assignee = assigneeEl.textContent.trim();
  }
  
  // Extract URLs from description
  const links = descEl ? descEl.querySelectorAll('a[href]') : [];
  result.relatedLinks = Array.from(links).map(a => ({
    text: a.textContent.trim(),
    url: a.href
  })).filter(l => l.url && !l.url.includes('atlassian'));
  
  return result;
}

// ============================================================================
// WORDPRESS ADMIN EXTRACTION
// ============================================================================
function extractWordPressAdmin() {
  const result = {
    extractedData: {},
    mainContent: '',
    summary: ''
  };
  
  // Get current admin page
  const adminMenu = document.querySelector('#adminmenu .current');
  if (adminMenu) {
    result.extractedData.currentSection = adminMenu.textContent.trim();
  }
  
  // Page title
  const pageTitle = document.querySelector('.wp-heading-inline') ||
                    document.querySelector('h1');
  if (pageTitle) {
    result.summary = `WordPress Admin: ${pageTitle.textContent.trim()}`;
  }
  
  // Get main content area
  const mainContent = document.querySelector('#wpbody-content') ||
                      document.querySelector('.wrap');
  if (mainContent) {
    result.mainContent = mainContent.textContent.trim().substring(0, 2000);
  }
  
  // Detect theme
  const themeInfo = document.querySelector('.theme-info') ||
                    document.body.className.match(/theme-(\w+)/);
  if (themeInfo) {
    result.extractedData.theme = themeInfo.textContent || themeInfo[1];
  }
  
  // Check for Divi
  if (document.querySelector('#et_divi') || document.body.classList.contains('et_divi_theme')) {
    result.extractedData.isDivi = true;
  }
  
  return result;
}

// ============================================================================
// GENERIC CONTENT EXTRACTION
// ============================================================================
function extractGenericContent() {
  const result = {
    mainContent: '',
    summary: ''
  };
  
  // Summary from meta or h1
  const metaDesc = document.querySelector('meta[name="description"]');
  const h1 = document.querySelector('h1');
  result.summary = metaDesc?.content || h1?.textContent.trim() || document.title;
  
  // Main content
  const main = document.querySelector('main') ||
               document.querySelector('article') ||
               document.querySelector('.content') ||
               document.querySelector('#content') ||
               document.body;
  
  if (main) {
    result.mainContent = main.textContent.trim()
      .replace(/\s+/g, ' ')
      .substring(0, 3000);
  }
  
  return result;
}

// ============================================================================
// COMMON EXTRACTIONS
// ============================================================================
function extractKeyElements() {
  const elements = [];
  
  // Buttons
  document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach((el, i) => {
    if (i < 15 && el.offsetParent !== null) {
      const text = el.textContent.trim() || el.value || el.getAttribute('aria-label');
      if (text && text.length < 50) {
        elements.push(`Button: "${text}"`);
      }
    }
  });
  
  // Links in navigation
  document.querySelectorAll('nav a, .menu a, #menu a, .nav a').forEach((el, i) => {
    if (i < 10 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      if (text && text.length < 50) {
        elements.push(`Nav link: "${text}"`);
      }
    }
  });
  
  // Input fields
  document.querySelectorAll('input[type="text"], input[type="email"], textarea').forEach((el, i) => {
    if (i < 5 && el.offsetParent !== null) {
      const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.name;
      if (label) {
        elements.push(`Input: "${label}"`);
      }
    }
  });
  
  return elements;
}

function extractLinks() {
  const links = [];
  document.querySelectorAll('a[href]').forEach((el, i) => {
    if (i < 20 && el.offsetParent !== null) {
      const href = el.href;
      const text = el.textContent.trim();
      if (href && text && !href.startsWith('javascript:') && text.length < 100) {
        links.push({ text, url: href });
      }
    }
  });
  return links;
}

function extractNavigation() {
  const nav = [];
  document.querySelectorAll('nav a, .menu a, .sidebar a, #adminmenu a').forEach((el, i) => {
    if (i < 15 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      if (text && text.length < 50) {
        nav.push(text);
      }
    }
  });
  return nav;
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================
function handleClick(message, sendResponse) {
  const { selector, text, description } = message;
  let element = null;
  
  // Try selector first
  if (selector) {
    element = document.querySelector(selector);
  }
  
  // Try text content
  if (!element && text) {
    const allElements = document.querySelectorAll('button, a, [role="button"], input[type="submit"], [onclick]');
    for (const el of allElements) {
      if (el.textContent.trim().toLowerCase().includes(text.toLowerCase()) ||
          el.value?.toLowerCase().includes(text.toLowerCase()) ||
          el.getAttribute('aria-label')?.toLowerCase().includes(text.toLowerCase())) {
        if (el.offsetParent !== null) { // Is visible
          element = el;
          break;
        }
      }
    }
  }
  
  if (element) {
    // Visual feedback
    showClickFeedback(element);
    
    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Click after a small delay for visual effect
    setTimeout(() => {
      element.click();
      sendResponse({ success: true, clicked: element.textContent?.trim().substring(0, 50) });
    }, 300);
  } else {
    sendResponse({ success: false, error: `Element not found: ${selector || text}` });
  }
}

function handleScroll(message, sendResponse) {
  const { direction, amount, to } = message;
  
  if (to === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } else if (to === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (direction === 'down') {
    window.scrollBy({ top: amount || 500, behavior: 'smooth' });
  } else if (direction === 'up') {
    window.scrollBy({ top: -(amount || 500), behavior: 'smooth' });
  }
  
  sendResponse({ success: true });
}

function handleType(message, sendResponse) {
  const { selector, text } = message;
  
  // Find input
  let input = selector ? document.querySelector(selector) : document.activeElement;
  
  // Try to find any focused or visible input
  if (!input || !['INPUT', 'TEXTAREA'].includes(input.tagName)) {
    input = document.querySelector('input:focus, textarea:focus') ||
            document.querySelector('input[type="text"]:not([type="hidden"]), textarea');
  }
  
  if (input) {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    showTypeFeedback(input);
    sendResponse({ success: true });
  } else {
    sendResponse({ success: false, error: 'No input field found' });
  }
}

function handlePressKey(message, sendResponse) {
  const { key } = message;
  
  const keyMap = {
    'Return': 'Enter',
    'Enter': 'Enter',
    'Escape': 'Escape',
    'Tab': 'Tab',
    'Backspace': 'Backspace'
  };
  
  const keyCode = keyMap[key] || key;
  
  const event = new KeyboardEvent('keydown', {
    key: keyCode,
    code: keyCode,
    bubbles: true,
    cancelable: true
  });
  
  document.activeElement.dispatchEvent(event);
  
  // Also trigger keyup
  const keyUpEvent = new KeyboardEvent('keyup', {
    key: keyCode,
    code: keyCode,
    bubbles: true,
    cancelable: true
  });
  document.activeElement.dispatchEvent(keyUpEvent);
  
  sendResponse({ success: true });
}

// ============================================================================
// VISUAL FEEDBACK
// ============================================================================
function showClickFeedback(element) {
  const rect = element.getBoundingClientRect();
  
  // Create ripple effect
  const ripple = document.createElement('div');
  ripple.style.cssText = `
    position: fixed;
    top: ${rect.top + rect.height / 2}px;
    left: ${rect.left + rect.width / 2}px;
    width: 20px;
    height: 20px;
    background: rgba(99, 102, 241, 0.5);
    border-radius: 50%;
    transform: translate(-50%, -50%) scale(0);
    pointer-events: none;
    z-index: 999999;
    animation: manureva-ripple 0.6s ease-out forwards;
  `;
  
  // Add animation keyframes if not exists
  if (!document.getElementById('manureva-styles')) {
    const style = document.createElement('style');
    style.id = 'manureva-styles';
    style.textContent = `
      @keyframes manureva-ripple {
        to {
          transform: translate(-50%, -50%) scale(4);
          opacity: 0;
        }
      }
      @keyframes manureva-highlight {
        0%, 100% { box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.5); }
        50% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.3); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(ripple);
  
  // Highlight element
  const originalOutline = element.style.outline;
  element.style.outline = '3px solid rgba(99, 102, 241, 0.7)';
  element.style.animation = 'manureva-highlight 0.3s ease-in-out';
  
  setTimeout(() => {
    ripple.remove();
    element.style.outline = originalOutline;
    element.style.animation = '';
  }, 600);
}

function showTypeFeedback(element) {
  const originalBorder = element.style.border;
  element.style.border = '2px solid #22c55e';
  element.style.boxShadow = '0 0 10px rgba(34, 197, 94, 0.3)';
  
  setTimeout(() => {
    element.style.border = originalBorder;
    element.style.boxShadow = '';
  }, 500);
}

console.log('[Manureva Content] Ready');
