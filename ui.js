// ui.js - UI rendering for Manureva AI Assistant
// All DOM rendering functions extracted from sidepanel.js.
// Depends on globals: elements (from sidepanel.js), parseAttributes (from action-parser.js)

// ============================================================================
// UTILITIES
// ============================================================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// TO-DO LIST UI
// ============================================================================
function createTodoContainer() {
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

  const missionBanner = document.getElementById('mission-banner');
  if (missionBanner && missionBanner.parentNode) {
    missionBanner.parentNode.insertBefore(todoContainer, missionBanner.nextSibling);
  }

  elements.todoContainer = todoContainer;
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
// MESSAGE RENDERING
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

// ============================================================================
// CONTENT FORMATTING (DOM-based, safe from HTML injection)
// ============================================================================
function formatAssistantContent(content) {
  const container = document.createElement('div');

  const ACTION_ICONS = {
    navigate: '\u{1F680}', click: '\u{1F5B1}\uFE0F', scroll: '\u{1F4DC}', type: '\u2328\uFE0F', pressKey: '\u2328\uFE0F',
    setSlider: '\u{1F39A}\uFE0F',
    wait: '\u23F3', read: '\u{1F441}\uFE0F', verify: '\u2713', observe: '\u{1F441}\uFE0F', storeContext: '\u{1F4BE}',
    switchTab: '\u{1F504}', analyze: '\u{1F50D}', continue: '\u25B6\uFE0F', todo: '\u{1F4DD}'
  };
  const actionTypes = Object.keys(ACTION_ICONS);

  // Strip action tags from content and collect them for rendering
  const actionTagRegex = new RegExp(
    `<(${actionTypes.join('|')})\\s*([^>]*?)(?:\\/>|>([^<]*)<\\/\\1>)`, 'gi'
  );
  const actionBlocks = [];
  const strippedContent = content.replace(actionTagRegex, (match, actionType, attrString) => {
    const attrs = parseAttributes(attrString || '');
    let summary = actionType;
    if (attrs.url) summary = `navigate \u2192 ${attrs.url.substring(0, 35)}...`;
    else if (attrs.text) summary = `${actionType} \u2192 "${attrs.text}"`;
    else if (attrs.direction) summary = `scroll ${attrs.direction}`;
    else if (attrs.key) summary = `pressKey: ${attrs.key}`;
    else if (attrs.value && actionType.toLowerCase() === 'setslider') summary = `setSlider \u2192 ${attrs.value}`;
    else if (attrs.purpose) summary = `${actionType}: ${attrs.purpose.substring(0, 30)}`;

    actionBlocks.push({ type: actionType.toLowerCase(), summary });
    return `\n%%ACTION_BLOCK_${actionBlocks.length - 1}%%\n`;
  });

  // Process content line-by-line using DOM methods
  const lines = strippedContent.split('\n');
  let inCodeBlock = false;
  let codeLines = [];

  for (const line of lines) {
    // Check for action block placeholder
    const actionMatch = line.trim().match(/^%%ACTION_BLOCK_(\d+)%%$/);
    if (actionMatch) {
      const idx = parseInt(actionMatch[1]);
      const block = actionBlocks[idx];
      if (block) {
        const actionDiv = document.createElement('div');
        actionDiv.className = 'action-block';
        const headerDiv = document.createElement('div');
        headerDiv.className = 'action-header';
        headerDiv.textContent = `${ACTION_ICONS[block.type] || '\u25B6\uFE0F'} ${block.summary}`;
        actionDiv.appendChild(headerDiv);
        container.appendChild(actionDiv);
      }
      continue;
    }

    // Code block start/end
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        const codeText = codeLines.join('\n');
        code.textContent = codeText;
        pre.appendChild(code);
        // Add copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(codeText).then(() => {
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = 'Copy';
              copyBtn.classList.remove('copied');
            }, 2000);
          });
        });
        pre.appendChild(copyBtn);
        container.appendChild(pre);
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Regular line
    if (line.trim() === '') {
      container.appendChild(document.createElement('br'));
      continue;
    }

    const lineSpan = document.createElement('span');
    appendFormattedInline(lineSpan, line);
    container.appendChild(lineSpan);
    container.appendChild(document.createElement('br'));
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const codeText = codeLines.join('\n');
    code.textContent = codeText;
    pre.appendChild(code);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(codeText).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    });
    pre.appendChild(copyBtn);
    container.appendChild(pre);
  }

  return container.innerHTML;
}

function appendFormattedInline(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

// ============================================================================
// LOADING, ERRORS, NOTICES
// ============================================================================
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
