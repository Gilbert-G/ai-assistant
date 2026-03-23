// action-parser.js - Action tag parsing for Manureva AI Assistant
// Parses XML-style action tags from Claude API responses.

function parseAllActions(content) {
  const actions = [];

  // Match self-closing tags: <action attr="value" />
  const selfClosingRegex = /<(navigate|click|scroll|type|pressKey|setSlider|wait|read|verify|observe|switchTab|storeContext|analyze|continue|todo)\s+([^>]*?)\/>/gi;

  // Match tags with inner content: <action attr="value">...content...</action>
  // Uses [\s\S]*? (non-greedy any-char including newlines) instead of [^<]* to
  // handle inner content that may contain < characters.
  const withContentRegex = /<(navigate|click|scroll|type|pressKey|setSlider|wait|read|verify|observe|switchTab|storeContext|analyze|continue|todo)\s*([^>]*?)>([\s\S]*?)<\/\1>/gi;

  let match;

  // Pass 1: Self-closing tags
  while ((match = selfClosingRegex.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const attrString = match[2] || '';
    const attrs = parseAttributes(attrString);
    actions.push({ type, ...attrs, _offset: match.index });
  }

  // Pass 2: Tags with inner content
  while ((match = withContentRegex.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const attrString = match[2] || '';
    const innerContent = match[3] || '';
    const attrs = parseAttributes(attrString);

    // Handle todo with inner content (list of items)
    if (type === 'todo' && innerContent) {
      attrs.items = innerContent.trim().split('\n').map(l => l.trim()).filter(l => l);
    }

    actions.push({ type, ...attrs, _offset: match.index });
  }

  // Sort by position in content to preserve original order, then drop _offset
  actions.sort((a, b) => a._offset - b._offset);
  actions.forEach(a => delete a._offset);

  return actions;
}

function parseAttributes(str) {
  const attrs = {};
  // Match double-quoted and single-quoted attributes separately
  // so that a single quote inside double quotes (and vice versa) is preserved.
  const doubleQuoted = /(\w+)="([^"]*)"/g;
  const singleQuoted = /(\w+)='([^']*)'/g;
  let match;

  while ((match = doubleQuoted.exec(str)) !== null) {
    attrs[match[1]] = match[2];
  }
  while ((match = singleQuoted.exec(str)) !== null) {
    // Only set if not already captured by double-quoted pass
    if (!(match[1] in attrs)) {
      attrs[match[1]] = match[2];
    }
  }

  return attrs;
}
