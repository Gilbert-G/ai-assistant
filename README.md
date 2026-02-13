# Manureva AI Assistant

An AI-powered Chrome browser extension that acts as an autonomous browser automation agent. It uses Claude API to analyze websites, execute multi-step workflows, and provide accurate time estimates for Jira tickets.

## Features

- **Autonomous Navigation**: AI navigates between tabs, clicks buttons, scrolls pages
- **Jira Integration**: Extracts ticket info and stores context across navigations
- **WordPress/Divi Support**: Understands WP admin structure for theme analysis
- **Visual Feedback**: Click ripples, scroll indicators, and element highlights
- **Context Preservation**: Never forgets the original task even after multiple navigations
- **Agentic Loop**: Continuous analysis until task completion

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Side Panel    │◄───►│  Background      │◄───►│  Content Script │
│  (sidepanel.js) │     │  (background.js) │     │  (content.js)   │
│                 │     │                  │     │                 │
│  • Chat UI      │     │  • Claude API    │     │  • DOM reading  │
│  • Action parse │     │  • Tab mgmt      │     │  • Click/scroll │
│  • Loop control │     │  • State store   │     │  • Extraction   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this folder
5. Click the extension icon to open the side panel
6. Enter your Claude API key in settings

## Usage

1. Open a Jira ticket in your browser
2. Open the Manureva AI side panel
3. Type: "Can you estimate this ticket? I have opened the back-office: [URL]"
4. Watch as the AI navigates, analyzes, and provides an estimate

## Action Tags

The AI outputs XML-style action tags that the extension executes:

| Tag | Description |
|-----|-------------|
| `<navigate url="..." />` | Open URL in new tab |
| `<click text="..." />` | Click element by text |
| `<scroll direction="down" />` | Scroll the page |
| `<type selector="..." text="..." />` | Type into input |
| `<pressKey key="Return" />` | Press keyboard key |
| `<storeContext key="..." value="..." />` | Store finding |

## Configuration

### Limits (in sidepanel.js)

```javascript
const MAX_LOOP_ITERATIONS = 25;
const MAX_CLICKS_PER_MISSION = 20;
const MAX_NAVIGATIONS_PER_MISSION = 12;
const MAX_SCROLLS_PER_MISSION = 30;
```

### API Model (in background.js)

```javascript
const CONFIG = {
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
  MODEL: 'claude-sonnet-4-20250514',
  MAX_TOKENS: 8192
};
```

## Development

### File Structure

```
manureva-ai-assistant/
├── manifest.json       # Chrome extension manifest
├── background.js       # Service worker + Claude API
├── sidepanel.js        # UI + agentic loop logic
├── sidepanel.html      # Side panel HTML
├── content.js          # DOM interaction
├── content.css         # Visual feedback styles
├── icons/              # Extension icons
└── README.md           # This file
```

### Key Concepts

1. **Agentic Loop**: After each AI response, parse actions, execute them, then send fresh page content back to the AI. Loop until estimate provided.

2. **Context Layering**: Store important context (Jira ticket, findings) separately and inject into every API call.

3. **Auto-Correction**: If AI asks for info it already has, automatically remind it.

## License

MIT

## Credits

Developed by Manureva Digital Solutions
