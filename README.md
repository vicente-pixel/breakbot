# Breakbot

MCP server for automated responsive design testing. Detects layout issues across viewports and provides Tailwind CSS fixes.

**No API costs** - uses DOM inspection instead of AI vision.

## Features

- **DOM-Based Analysis**: Detects overflow, touch target, and layout issues by inspecting the DOM (no AI/API cost)
- **9 Viewport Sizes**: Tests from 320px to 1536px covering all Tailwind breakpoints
- **iOS Simulator Support**: Test on real iOS Safari via Xcode Simulator (macOS)
- **Tailwind CSS Fixes**: Provides specific classes to fix detected issues

## Installation

```bash
git clone https://github.com/yourusername/breakbot.git
cd breakbot
npm install
npm run build
```

## Usage with Claude Code

Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "breakbot": {
      "command": "node",
      "args": ["/path/to/breakbot/dist/index.js"]
    }
  }
}
```

Replace `/path/to/breakbot` with the actual path where you cloned this repo.

> **Note**: For global installation, you can add this to `~/.claude/claude_desktop_config.json` instead.

**Other MCP clients** (Claude Desktop, Cursor, etc.) use a similar configuration format.

Then ask Claude:
- "Test example.com for responsive issues"
- "Check my site on iOS Simulator"
- "Take a screenshot at 375px width"

## MCP Tools

### `test_responsive`
Main testing tool. Analyzes a URL across 9 viewports using DOM inspection.

```
Input: { url: "https://example.com" }
Output: Report with issues found and Tailwind fixes
```

**Detects:**
- Horizontal overflow / scrollbars
- Small touch targets (< 44px)
- Text truncation
- Off-screen elements

### `screenshot_viewport`
Take a screenshot at a specific width.

```
Input: { url: "https://example.com", width: 375 }
Output: Screenshot image
```

### `ios_test`
Test on iOS Simulator (macOS + Xcode required).

```
Input: { url: "https://example.com" }
Output: Screenshot from real iOS Safari
```

### `ios_list_simulators`
List available iOS Simulators.

### `ios_boot_simulator`
Boot a specific simulator by UDID.

### `list_breakpoints`
Reference for Tailwind breakpoints.

## Viewport Sizes Tested

| Device | Width | Tailwind |
|--------|-------|----------|
| iPhone SE | 320px | default |
| iPhone 8 | 375px | default |
| iPhone 14 | 390px | default |
| Mobile Large | 480px | default |
| sm | 640px | sm: |
| md | 768px | md: |
| lg | 1024px | lg: |
| xl | 1280px | xl: |
| 2xl | 1536px | 2xl: |

## Issue Types Detected

| Type | Description | Suggested Fix |
|------|-------------|---------------|
| horizontal-overflow | Content wider than viewport | `overflow-x-hidden`, `max-w-full` |
| touch-target | Interactive element < 44px | `min-w-[44px] min-h-[44px]` |
| text-overflow | Truncated text | `break-words`, `whitespace-normal` |
| offscreen | Element partially off-screen | Check margins/positioning |

## Tech Stack

- Node.js + TypeScript
- Puppeteer (headless Chrome)
- MCP SDK
- xcrun simctl (iOS Simulator)

## License

MIT
