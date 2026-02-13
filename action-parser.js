// action-parser.js - Action tag parsing for Manureva AI Assistant
// Parses XML-style action tags from Claude API responses.

function parseAllActions(content) {
  const actions = [];

  // Supports: <action attr="value" /> and <action attr="value">inner</action>
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
