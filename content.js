// content.js - Content Script for Manureva AI Assistant
// Handles DOM reading, clicking, scrolling, and visual feedback

// Guard against double-injection (can happen if PING check fails due to timing)
if (window.__manurevaContentScriptLoaded) {
  console.log('[Manureva Content] Already loaded, skipping re-injection');
} else {
window.__manurevaContentScriptLoaded = true;
console.log('[Manureva Content] Script loaded');

// ============================================================================
// DOMAIN SAFETY CHECK (defense-in-depth)
// ============================================================================
const SENSITIVE_DOMAIN_PATTERNS = [
  /bank|banking|chase|wellsfargo|bofa|citi|hsbc|barclays/i,
  /paypal|venmo|stripe\.com|square\.com/i,
  /signin\.aws|console\.aws/i,
  /accounts\.google|myaccount\.google/i,
  /login\.microsoft|portal\.azure/i
];

function isOnSensitiveDomain() {
  const url = window.location.href;
  return SENSITIVE_DOMAIN_PATTERNS.some(pattern => pattern.test(url));
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content] Received:', message.type || message);

  try {
    // Block mutating actions on sensitive domains
    const mutatingActions = ['CLICK', 'TYPE', 'PRESS_KEY'];
    if (mutatingActions.includes(message.type) && isOnSensitiveDomain()) {
      console.warn('[Content] Blocked action on sensitive domain:', window.location.href);
      sendResponse({ success: false, error: 'Action blocked: this domain is restricted for automated interactions.' });
      return true;
    }

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

// detectPlatform is provided by shared.js (injected before this file)

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

  // Buttons — include aria-label for icon-only buttons (calendar arrows, etc.)
  document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach((el, i) => {
    if (i < 25 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      const ariaLabel = el.getAttribute('aria-label');
      const title = el.getAttribute('title');
      const id = el.id ? `#${el.id}` : '';
      const label = text || el.value || ariaLabel || title;
      if (label && label.length < 80) {
        let entry = `Button: "${label}"`;
        if (ariaLabel && ariaLabel !== label) entry += ` [aria-label="${ariaLabel}"]`;
        if (id) entry += ` [selector="${id}"]`;
        elements.push(entry);
      }
    }
  });

  // ARIA combobox/searchbox/listbox widgets (SPAs use these instead of <input>)
  document.querySelectorAll('[role="combobox"], [role="searchbox"], [role="listbox"]').forEach((el, i) => {
    if (i < 10 && el.offsetParent !== null) {
      const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      const expanded = el.getAttribute('aria-expanded');
      const id = el.id ? `#${el.id}` : '';
      if (ariaLabel) {
        let entry = `Widget: "${ariaLabel}" [role="${el.getAttribute('role')}"]`;
        if (expanded) entry += ` [expanded=${expanded}]`;
        if (id) entry += ` [selector="${id}"]`;
        elements.push(entry);
      }
    }
  });

  // Open dropdown/listbox options — surface autocomplete suggestions to the LLM
  document.querySelectorAll('[role="listbox"] [role="option"], [role="menu"] [role="menuitem"]').forEach((el, i) => {
    if (i < 10 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      const ariaLabel = el.getAttribute('aria-label');
      if (text && text.length < 80) {
        let entry = `Option: "${text}"`;
        if (ariaLabel && ariaLabel !== text) entry += ` [aria-label="${ariaLabel}"]`;
        elements.push(entry);
      }
    }
  });

  // Calendar/date cells — critical for date pickers
  document.querySelectorAll('[role="gridcell"], [role="option"], td[data-date], [data-day]').forEach((el, i) => {
    if (i < 20 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      const ariaLabel = el.getAttribute('aria-label');
      const dataDate = el.getAttribute('data-date') || el.getAttribute('data-day');
      if (text && text.length < 50) {
        let entry = `Cell: "${text}"`;
        if (ariaLabel) entry += ` [aria-label="${ariaLabel}"]`;
        if (dataDate) entry += ` [data-date="${dataDate}"]`;
        elements.push(entry);
      }
    }
  });

  // Calendar header (current month/year) — helps LLM navigate to target month
  document.querySelectorAll('[role="heading"][aria-live], [role="grid"] caption, [class*="month"], [class*="Month"]').forEach((el, i) => {
    if (i < 3 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      if (text && text.length < 50) {
        elements.push(`Calendar header: "${text}"`);
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

  // Input fields — include selector info, also detect inputs without explicit type
  document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="number"], input:not([type]), textarea').forEach((el, i) => {
    if (i < 10 && el.offsetParent !== null) {
      const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.name;
      const id = el.id ? `#${el.id}` : '';
      const name = el.name ? `[name="${el.name}"]` : '';
      if (label) {
        let entry = `Input: "${label}"`;
        if (id) entry += ` [selector="${id}"]`;
        else if (name) entry += ` [selector="${name}"]`;
        elements.push(entry);
      }
    }
  });

  // Select/dropdown elements
  document.querySelectorAll('select').forEach((el, i) => {
    if (i < 5 && el.offsetParent !== null) {
      const label = el.getAttribute('aria-label') || el.name || el.id;
      if (label) {
        elements.push(`Select: "${label}" [options: ${el.options.length}]`);
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
function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isVisible(el) {
  if (!el.offsetParent && el.tagName !== 'BODY') return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function simulateRealClick(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };

  // Dispatch full pointer/mouse event sequence — required by React, Angular, and modern SPAs
  element.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
  element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
  element.dispatchEvent(new PointerEvent('pointerup', eventOpts));
  element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
  element.dispatchEvent(new MouseEvent('click', eventOpts));
}

function handleClick(message, sendResponse) {
  const { selector, text, description } = message;
  let element = null;

  // Try selector first (highest priority — most precise)
  if (selector) {
    element = document.querySelector(selector);
    // If selector found an element but it's not visible, try broader
    if (element && !isVisible(element)) {
      // First try other matching elements
      const allBySelector = document.querySelectorAll(selector);
      let found = false;
      for (const el of allBySelector) {
        if (isVisible(el)) {
          element = el;
          found = true;
          break;
        }
      }
      // If no visible match, walk up to the nearest visible parent (SPA overlay pattern).
      // SPAs often hide the real <input> and overlay a styled container.
      if (!found && element) {
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          if (isVisible(parent) && parent.offsetHeight > 0 && parent.offsetWidth > 0) {
            element = parent;
            found = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!found) element = null;
      }
    }
  }

  // Try text content with improved matching
  if (!element && text) {
    // Broad query covering interactive elements, SPA nav patterns, ARIA widgets, and framework components
    const allElements = document.querySelectorAll(
      'button, a, [role="button"], [role="gridcell"], [role="option"], [role="tab"], [role="menuitem"], ' +
      '[role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="searchbox"], ' +
      'input[type="submit"], input[type="button"], input, [onclick], [data-testid], ' +
      'td, th, li, label, span, div[tabindex], span[tabindex], ' +
      'nav a, nav button, nav span, nav div, ' +
      '[class*="tab"], [class*="Tab"], [class*="nav-"], [class*="menu-"]'
    );

    const textLower = text.toLowerCase().trim();
    let exactMatch = null;       // text === search (best)
    let exactInViewport = null;  // exact + in viewport (best of best)
    let substringMatch = null;   // text contains search
    let ariaMatch = null;        // aria-label match
    let placeholderMatch = null; // placeholder attribute match
    let directTextMatch = null;  // element's own direct text (not children)

    for (const el of allElements) {
      if (!isVisible(el)) continue;

      const elText = el.textContent.trim().toLowerCase();
      const elValue = el.value?.toLowerCase() || '';
      const elAriaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
      const elPlaceholder = el.getAttribute('placeholder')?.toLowerCase() || '';
      // Direct text: only the element's own text nodes (not descendants)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim().toLowerCase())
        .join(' ')
        .trim();

      // Priority 1: Exact text match
      if (elText === textLower || elValue === textLower || directText === textLower) {
        if (directText === textLower && !directTextMatch) directTextMatch = el;
        if (!exactMatch) exactMatch = el;
        if (!exactInViewport && isInViewport(el)) exactInViewport = el;
      }
      // Priority 2: Exact aria-label or placeholder match
      else if (elAriaLabel === textLower || elAriaLabel.includes(textLower)) {
        if (!ariaMatch) ariaMatch = el;
      }
      else if (elPlaceholder === textLower || elPlaceholder.includes(textLower)) {
        if (!placeholderMatch) placeholderMatch = el;
      }
      // Priority 3: Substring match (only if text is long enough to be unambiguous)
      else if (textLower.length >= 3 && (elText.includes(textLower) || elValue.includes(textLower))) {
        // Prefer shorter text (more specific match)
        if (!substringMatch || elText.length < substringMatch.textContent.trim().length) {
          substringMatch = el;
        }
      }
    }

    // Select best match: in-viewport exact > direct text > exact > aria > placeholder > substring
    element = exactInViewport || directTextMatch || exactMatch || ariaMatch || placeholderMatch || substringMatch;

    // Last resort: walk all visible elements in the DOM for a text match
    if (!element) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
          if (!isVisible(node)) return NodeFilter.FILTER_SKIP;
          const ownText = Array.from(node.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim().toLowerCase())
            .join(' ').trim();
          if (ownText === textLower) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        }
      });
      element = walker.nextNode();
    }
  }

  if (element) {
    // Visual feedback
    showClickFeedback(element);

    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Send response BEFORE the delayed click — if the click triggers a page
    // navigation, the content script is destroyed and sendResponse would be lost.
    const clickedText = element.textContent?.trim().substring(0, 50);
    sendResponse({ success: true, clicked: clickedText });

    // Click after a small delay for visual effect
    setTimeout(() => {
      simulateRealClick(element);
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

  // Find target element — support real inputs AND ARIA widget elements
  // (e.g. div[role="combobox"], div[contenteditable])
  let input = selector ? document.querySelector(selector) : document.activeElement;

  if (!input || (input === document.body)) {
    // Try focused element, then ARIA comboboxes, then standard inputs
    input = document.querySelector('input:focus, textarea:focus, [role="combobox"]:focus, [contenteditable]:focus') ||
            document.querySelector('[role="combobox"]') ||
            document.querySelector('input[type="text"]:not([type="hidden"]), input:not([type]), textarea');
  }

  // Accept INPUT, TEXTAREA, contenteditable, and ARIA combobox/searchbox elements
  const isTypable = input && (
    ['INPUT', 'TEXTAREA'].includes(input.tagName) ||
    input.hasAttribute('contenteditable') ||
    ['combobox', 'searchbox', 'textbox'].includes(input.getAttribute('role'))
  );

  if (!isTypable) {
    sendResponse({ success: false, error: 'No input field found' });
    return;
  }

  input.focus();

  // Clear existing value
  if (['INPUT', 'TEXTAREA'].includes(input.tagName)) {
    const prototype = input.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, '');
    } else {
      input.value = '';
    }
  } else if (input.hasAttribute('contenteditable')) {
    input.textContent = '';
  }

  // Simulate per-character keyboard input — required for SPA autocomplete/search.
  // SPAs like Google Flights listen for individual keydown/keyup events and
  // InputEvents with proper `inputType` and `data` properties.
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: char, code: `Key${char.toUpperCase()}`,
      bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keypress', {
      key: char, code: `Key${char.toUpperCase()}`,
      bubbles: true, cancelable: true
    }));

    // Append character to value
    if (['INPUT', 'TEXTAREA'].includes(input.tagName)) {
      const prototype = input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, text.substring(0, i + 1));
      } else {
        input.value = text.substring(0, i + 1);
      }
    } else if (input.hasAttribute('contenteditable')) {
      input.textContent = text.substring(0, i + 1);
    }

    // Fire InputEvent with proper properties for framework compatibility
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: char
    }));

    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: char, code: `Key${char.toUpperCase()}`,
      bubbles: true, cancelable: true
    }));
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));

  showTypeFeedback(input);
  sendResponse({ success: true });
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
} // end double-injection guard
