// content.js - Content Script for Manureva AI Assistant
// Handles DOM reading, clicking, scrolling, and visual feedback

// Guard against double-injection (can happen if PING check fails due to timing)
if (window.__manurevaContentScriptLoaded) {
  console.log('[Manureva Content] Already loaded, skipping re-injection');
} else {
window.__manurevaContentScriptLoaded = true;

// Global element registry for index-based interaction
window.__manurevaElements = [];

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
  result.keyElements = buildElementMap();
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
// UNIVERSAL ELEMENT MAP — Indexed Accessibility Tree
// ============================================================================
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button', '[role="button"]',
  'input:not([type="hidden"])', 'textarea', 'select',
  'select option',
  '[role="link"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
  '[role="option"]', '[role="tab"]', '[role="treeitem"]',
  '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="combobox"]', '[role="searchbox"]', '[role="textbox"]', '[role="listbox"]',
  '[role="slider"]', '[role="spinbutton"]', '[role="gridcell"]',
  '[contenteditable="true"]', '[contenteditable=""]',
  'summary',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img[alt]', '[role="img"][aria-label]',
  '[role="alert"]', '[role="status"]',
  'dialog[open]', '[role="dialog"]', '[role="alertdialog"]'
].join(', ');

function inferRole(el) {
  const tag = el.tagName.toLowerCase();
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  switch (tag) {
    case 'a': return el.hasAttribute('href') ? 'link' : null;
    case 'button': case 'summary': return 'button';
    case 'input': {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    case 'textarea': return 'textbox';
    case 'select': return 'combobox';
    case 'option': return 'option';
    case 'img': return 'img';
    case 'dialog': return 'dialog';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    default:
      if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return 'textbox';
      return null;
  }
}

function getAccessibleName(el) {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim().substring(0, 80);

  // 2. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(' ').substring(0, 80);
  }

  const tag = el.tagName;

  // 3. Form controls: associated <label>, placeholder, title, name
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
    if (el.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) return lbl.textContent.trim().substring(0, 80);
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, textarea, select').forEach(c => c.remove());
      const labelText = clone.textContent.trim();
      if (labelText) return labelText.substring(0, 80);
    }
    if (el.placeholder) return el.placeholder.substring(0, 80);
    if (el.title) return el.title.substring(0, 80);
    if (el.name) return el.name.substring(0, 80);
    return '';
  }

  // 4. Images: alt text
  if (tag === 'IMG') {
    return (el.getAttribute('alt') || '').trim().substring(0, 80);
  }

  // 5. Text content (buttons, links, headings, options, etc.)
  const text = el.textContent?.trim().replace(/\s+/g, ' ');
  if (text && text.length <= 80) return text;
  if (text) return text.substring(0, 77) + '...';

  // 6. title attribute as last resort
  if (el.title) return el.title.substring(0, 80);

  return '';
}

function describeElement(el) {
  const role = inferRole(el);
  if (!role) return null;

  const name = getAccessibleName(el);

  // Require a name for elements that are meaningless without one
  const needsName = ['link', 'button', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
                     'option', 'tab', 'treeitem', 'heading', 'img', 'gridcell',
                     'alert', 'status', 'dialog', 'alertdialog'];
  if (needsName.includes(role) && !name) return null;

  const tag = el.tagName.toLowerCase();
  let desc = role;

  // Add heading level
  if (role === 'heading' && /^h[1-6]$/.test(tag)) {
    desc += ' level=' + tag[1];
  }

  if (name) desc += ' "' + name + '"';

  // Value for form elements
  if (['INPUT', 'TEXTAREA'].includes(el.tagName) && el.value) {
    desc += ' value="' + el.value.substring(0, 40) + '"';
  }
  if (el.tagName === 'SELECT' && el.selectedOptions?.length > 0) {
    desc += ' value="' + el.selectedOptions[0].text.trim().substring(0, 40) + '"';
  }

  // States
  const states = [];
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') states.push('disabled');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded === 'true') states.push('expanded');
  else if (expanded === 'false') states.push('collapsed');
  if (el.getAttribute('aria-selected') === 'true') states.push('selected');
  const checked = el.getAttribute('aria-checked');
  if (checked === 'true') states.push('checked');
  else if (checked === 'false') states.push('unchecked');
  if (el.required || el.getAttribute('aria-required') === 'true') states.push('required');

  if (states.length) desc += ' [' + states.join(', ') + ']';

  return desc;
}

// Detect active overlays, dialogs, cookie banners, and modals that block the page
function detectActiveOverlay() {
  // 1. Native <dialog open>
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog) return openDialog;

  // 2. ARIA dialogs
  const ariaDialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"])');
  if (ariaDialog && isVisible(ariaDialog)) return ariaDialog;

  // 3. Common modal/overlay CSS patterns
  const overlaySelectors = [
    '.modal.show', '.modal.in', '.modal.is-open', '.modal.is-active',
    '.overlay.active', '.overlay.visible',
    '[class*="cookie-banner"]', '[class*="cookie-consent"]',
    '[class*="consent-banner"]', '[class*="consent-modal"]',
    '[id*="cookie-banner"]', '[id*="cookie-consent"]',
    '[id*="consent-banner"]', '[id*="consent-modal"]',
    '[id*="gdpr"]', '[class*="gdpr"]',
    '[class*="CookieConsent"]', '[id*="CookieConsent"]',
    '[class*="onetrust"]', '[id*="onetrust"]',
    '[class*="cc-banner"]', '[class*="cc-window"]'
  ];

  for (const sel of overlaySelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    } catch (e) {} // ignore invalid selectors
  }

  // 4. Full-screen fixed/sticky elements with high z-index (generic modal detection)
  const topLevelDivs = document.querySelectorAll('body > div, body > aside, body > section');
  for (const el of topLevelDivs) {
    try {
      const style = getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'sticky') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity) > 0 &&
          parseInt(style.zIndex) > 100 &&
          el.offsetHeight > 80 &&
          el.offsetWidth > 200) {
        // Check it contains at least one interactive element (not just a floating header/nav)
        if (el.querySelector('button, a, [role="button"], input')) {
          return el;
        }
      }
    } catch (e) {}
  }

  return null;
}

function buildElementMap() {
  window.__manurevaElements = [];
  const entries = [];
  let idx = 0;
  const MAX_ELEMENTS = 200;

  const overlay = detectActiveOverlay();
  const candidates = document.querySelectorAll(INTERACTIVE_SELECTOR);

  if (overlay) {
    // When an overlay is detected, show overlay elements FIRST with a clear annotation
    entries.push('--- OVERLAY/DIALOG DETECTED (dismiss this first) ---');

    for (const el of candidates) {
      if (idx >= MAX_ELEMENTS) break;
      if (!overlay.contains(el)) continue;
      if (!isVisibleForMap(el)) continue;

      const info = describeElement(el);
      if (!info) continue;

      window.__manurevaElements[idx] = el;
      entries.push('[' + idx + '] ' + info);
      idx++;
    }

    entries.push('--- PAGE ELEMENTS (behind overlay) ---');

    for (const el of candidates) {
      if (idx >= MAX_ELEMENTS) break;
      if (overlay.contains(el)) continue;
      if (!isVisibleForMap(el)) continue;

      const info = describeElement(el);
      if (!info) continue;

      window.__manurevaElements[idx] = el;
      entries.push('[' + idx + '] ' + info);
      idx++;
    }
  } else {
    for (const el of candidates) {
      if (idx >= MAX_ELEMENTS) break;
      if (!isVisibleForMap(el)) continue;

      const info = describeElement(el);
      if (!info) continue;

      window.__manurevaElements[idx] = el;
      entries.push('[' + idx + '] ' + info);
      idx++;
    }
  }

  return entries;
}

// Slightly relaxed visibility check for element map building.
// Native <option> inside <select> is always "visible" for map purposes
// even though offsetParent may be null.
function isVisibleForMap(el) {
  if (el.tagName === 'OPTION') return true;
  return isVisible(el);
}

// ============================================================================
// COMMON EXTRACTIONS
// ============================================================================

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
  const { selector, text, description, index } = message;
  let element = null;

  // Priority 0: Index-based lookup (from element map — most reliable)
  if (index !== undefined && index !== null && window.__manurevaElements) {
    const idx = parseInt(index);
    const candidate = window.__manurevaElements[idx];
    // Verify the element is still in the DOM and visible (guards against stale references)
    if (candidate && document.body.contains(candidate) &&
        (candidate.tagName === 'OPTION' || isVisible(candidate))) {
      element = candidate;
    }
  }

  // Special handling: clicking an <option> inside a <select> sets the value directly
  if (element && element.tagName === 'OPTION' && element.parentElement?.tagName === 'SELECT') {
    const select = element.parentElement;
    select.value = element.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
    showClickFeedback(select);
    sendResponse({ success: true, method: 'select-option' });
    return;
  }

  // Try selector (fallback)
  if (!element && selector) {
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
  const { selector, text, index } = message;
  let input = null;

  // Priority 0: Index-based lookup (from element map)
  if (index !== undefined && index !== null && window.__manurevaElements) {
    const idx = parseInt(index);
    const candidate = window.__manurevaElements[idx];
    // Verify element is still in DOM and visible (guards against stale references)
    if (candidate && document.body.contains(candidate) && isVisible(candidate)) {
      input = candidate;
    }
  }

  // Fallback: selector or active element
  if (!input) {
    input = selector ? document.querySelector(selector) : document.activeElement;
  }

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
  const { key, ctrl, shift, alt, meta } = message;

  const keyMap = {
    'Return': 'Enter',
    'Enter': 'Enter',
    'Escape': 'Escape',
    'Tab': 'Tab',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
    'Space': ' '
  };

  const keyCode = keyMap[key] || key;
  const modifiers = {
    ctrlKey: ctrl === 'true' || ctrl === true,
    shiftKey: shift === 'true' || shift === true,
    altKey: alt === 'true' || alt === true,
    metaKey: meta === 'true' || meta === true
  };

  const target = document.activeElement || document.body;

  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: keyCode,
    code: keyCode,
    bubbles: true,
    cancelable: true,
    ...modifiers
  }));

  target.dispatchEvent(new KeyboardEvent('keyup', {
    key: keyCode,
    code: keyCode,
    bubbles: true,
    cancelable: true,
    ...modifiers
  }));

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
