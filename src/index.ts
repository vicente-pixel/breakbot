#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeResponsiveDesign, closeBrowser as closeDOMBrowser } from './lib/dom-analyzer.js';
import { captureScreenshots, closeBrowser as closeScreenshotBrowser } from './lib/screenshot.js';
import { DEFAULT_VIEWPORTS, getTailwindBreakpoint } from './lib/viewports.js';
import {
  isIOSSimulatorAvailable,
  listSimulators,
  getBootedSimulators,
  testOnSimulator,
  bootSimulator,
} from './lib/ios-simulator.js';

const server = new McpServer({
  name: 'breakbot',
  version: '0.1.0',
});

// ============================================================================
// TOOL: test_responsive
// Main tool - uses DOM analysis (no AI cost)
// ============================================================================
server.tool(
  'test_responsive',
  'Test a website for responsive design issues across multiple viewport sizes. Uses DOM inspection to detect overflow, touch target, and layout issues. No AI/API cost - runs entirely locally.',
  {
    url: z.string().url().describe('The URL of the website to test'),
  },
  async ({ url }) => {
    try {
      const result = await analyzeResponsiveDesign(url);

      // Build token-optimized report
      let report = `## Responsive Test: ${url}\n\n`;

      // Summary
      if (result.summary.totalIssues === 0) {
        report += `**PASS** - No issues found\n`;
        return { content: [{ type: 'text' as const, text: report }] };
      }

      report += `**${result.summary.highSeverity} high, ${result.summary.mediumSeverity} medium severity issues**\n`;
      if (result.summary.worstViewport) {
        report += `Worst: ${result.summary.worstViewport} | Types: ${result.summary.commonIssues.join(', ')}\n`;
      }
      report += '\n';

      // Compact viewport table
      report += `| Viewport | Issues | H-Scroll |\n|----------|--------|----------|\n`;
      for (const vp of result.viewports) {
        if (vp.issues.length === 0) continue;
        report += `| ${vp.viewport.name} (${vp.viewport.width}px) | ${vp.issues.length} | ${vp.metrics.hasHorizontalScroll ? 'YES' : '-'} |\n`;
      }
      report += '\n';

      // Deduplicated issues - group by selector+type, track which viewports affected
      const issueMap = new Map<string, {
        type: string;
        selector: string;
        severity: string;
        description: string;
        suggestedFix?: string;
        viewports: string[];
      }>();

      for (const vp of result.viewports) {
        for (const issue of vp.issues) {
          const key = `${issue.type}|${issue.selector}`;
          if (!issueMap.has(key)) {
            issueMap.set(key, {
              type: issue.type,
              selector: issue.selector,
              severity: issue.severity,
              description: issue.description.replace(/\d+px/g, 'Npx'), // Normalize pixel values
              suggestedFix: issue.suggestedFix,
              viewports: [],
            });
          }
          const entry = issueMap.get(key)!;
          if (!entry.viewports.includes(vp.viewport.name)) {
            entry.viewports.push(vp.viewport.name);
          }
        }
      }

      // Output deduplicated issues
      report += `### Unique Issues (${issueMap.size})\n\n`;

      // Group by type
      const byType = new Map<string, typeof issueMap extends Map<string, infer V> ? V[] : never>();
      for (const issue of issueMap.values()) {
        if (!byType.has(issue.type)) byType.set(issue.type, []);
        byType.get(issue.type)!.push(issue);
      }

      for (const [type, issues] of byType) {
        const icon = issues[0].severity === 'high' ? '🔴' : '🟡';
        report += `**${icon} ${type}** (${issues.length} elements)\n`;

        // Show up to 5 selectors per type
        const shown = issues.slice(0, 5);
        for (const issue of shown) {
          const vpCount = issue.viewports.length;
          const vpInfo = vpCount === result.viewports.length ? 'all viewports' : `${vpCount} viewports`;
          report += `- \`${issue.selector}\` (${vpInfo})\n`;
        }
        if (issues.length > 5) {
          report += `- ...and ${issues.length - 5} more\n`;
        }
        report += '\n';
      }

      // Compact fixes
      const hasOverflow = result.summary.commonIssues.includes('horizontal-overflow');
      const hasTouchTarget = result.summary.commonIssues.includes('touch-target');

      if (hasOverflow || hasTouchTarget) {
        report += `### Fixes\n`;
        if (hasOverflow) report += `- Overflow: \`max-w-full overflow-x-hidden\` or \`w-full\`\n`;
        if (hasTouchTarget) report += `- Touch targets: \`min-w-[44px] min-h-[44px]\` or \`p-3\`\n`;
      }

      return {
        content: [{ type: 'text' as const, text: report }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text' as const,
          text: `## Error Testing ${url}\n\n**Error:** ${errorMessage}\n\nPlease check that the URL is accessible.`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// TOOL: screenshot_viewport
// Take a screenshot at a specific viewport (useful for debugging)
// ============================================================================
server.tool(
  'screenshot_viewport',
  'Take a screenshot of a website at a specific viewport width. Useful for visually inspecting a specific breakpoint.',
  {
    url: z.string().url().describe('The URL to screenshot'),
    width: z.number().min(320).max(2560).describe('Viewport width in pixels'),
  },
  async ({ url, width }) => {
    try {
      const viewport = {
        width,
        height: Math.round(width * 0.75),
        name: `${width}px`,
      };

      const screenshots = await captureScreenshots(url, [viewport]);
      const screenshot = screenshots[0];
      const breakpoint = getTailwindBreakpoint(width);

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Screenshot: ${url}\n\n**Width:** ${width}px | **Breakpoint:** ${breakpoint}`,
          },
          {
            type: 'image' as const,
            data: screenshot.dataUrl.replace('data:image/png;base64,', ''),
            mimeType: 'image/png',
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text' as const,
          text: `## Error\n\n${errorMessage}`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// TOOL: ios_test
// Test on iOS Simulator
// ============================================================================
server.tool(
  'ios_test',
  'Test a website on iOS Simulator (macOS only, requires Xcode). Opens the URL in Safari on an iPhone simulator and takes a screenshot. Great for testing real iOS Safari behavior.',
  {
    url: z.string().url().describe('The URL to test'),
    simulator_udid: z.string().optional().describe('Specific simulator UDID (optional, will use any booted or boot an iPhone)'),
  },
  async ({ url, simulator_udid }) => {
    const available = await isIOSSimulatorAvailable();

    if (!available) {
      return {
        content: [{
          type: 'text' as const,
          text: `## iOS Simulator Not Available\n\nThis tool requires:\n- macOS\n- Xcode with iOS Simulator installed\n\nAlternatively, use \`test_responsive\` for cross-platform testing.`,
        }],
        isError: true,
      };
    }

    const result = await testOnSimulator(url, simulator_udid);

    if (!result.success) {
      return {
        content: [{
          type: 'text' as const,
          text: `## iOS Simulator Error\n\n**Error:** ${result.error}\n\nTry:\n1. Open Simulator.app manually first\n2. Use \`ios_list_simulators\` to see available devices`,
        }],
        isError: true,
      };
    }

    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      {
        type: 'text' as const,
        text: `## iOS Simulator Test: ${url}\n\n` +
          `**Device:** ${result.device?.name}\n` +
          `**Runtime:** ${result.device?.runtime}\n` +
          `**Screen Size:** ${result.screenSize?.width}x${result.screenSize?.height}px\n`,
      },
    ];

    if (result.screenshot) {
      content.push({
        type: 'image' as const,
        data: result.screenshot.replace('data:image/png;base64,', ''),
        mimeType: 'image/png',
      });
    }

    return { content };
  }
);

// ============================================================================
// TOOL: ios_list_simulators
// List available iOS Simulators
// ============================================================================
server.tool(
  'ios_list_simulators',
  'List available iOS Simulators on this Mac. Shows device name, UDID, and current state.',
  {},
  async () => {
    const available = await isIOSSimulatorAvailable();

    if (!available) {
      return {
        content: [{
          type: 'text' as const,
          text: `## iOS Simulator Not Available\n\nRequires macOS with Xcode installed.`,
        }],
      };
    }

    const devices = await listSimulators();
    const booted = devices.filter(d => d.state === 'Booted');

    let report = `## iOS Simulators\n\n`;

    if (booted.length > 0) {
      report += `### Currently Running\n\n`;
      for (const d of booted) {
        report += `- **${d.name}** (${d.runtime})\n`;
        report += `  - UDID: \`${d.udid}\`\n`;
      }
      report += '\n';
    }

    report += `### Available Devices\n\n`;
    report += `| Device | Runtime | State | UDID |\n`;
    report += `|--------|---------|-------|------|\n`;

    for (const d of devices.slice(0, 20)) {
      const stateIcon = d.state === 'Booted' ? '🟢' : '⚪';
      report += `| ${d.name} | ${d.runtime} | ${stateIcon} ${d.state} | \`${d.udid.slice(0, 8)}...\` |\n`;
    }

    if (devices.length > 20) {
      report += `\n*...and ${devices.length - 20} more devices*\n`;
    }

    return {
      content: [{ type: 'text' as const, text: report }],
    };
  }
);

// ============================================================================
// TOOL: ios_boot_simulator
// Boot a specific iOS Simulator
// ============================================================================
server.tool(
  'ios_boot_simulator',
  'Boot a specific iOS Simulator by UDID. Use ios_list_simulators to find available devices.',
  {
    udid: z.string().describe('The UDID of the simulator to boot'),
  },
  async ({ udid }) => {
    const available = await isIOSSimulatorAvailable();

    if (!available) {
      return {
        content: [{
          type: 'text' as const,
          text: `## iOS Simulator Not Available\n\nRequires macOS with Xcode installed.`,
        }],
        isError: true,
      };
    }

    const devices = await listSimulators();
    const device = devices.find(d => d.udid === udid);

    if (!device) {
      return {
        content: [{
          type: 'text' as const,
          text: `## Error\n\nNo simulator found with UDID: ${udid}`,
        }],
        isError: true,
      };
    }

    if (device.state === 'Booted') {
      return {
        content: [{
          type: 'text' as const,
          text: `## Already Running\n\n**${device.name}** is already booted.`,
        }],
      };
    }

    const success = await bootSimulator(udid);

    if (success) {
      return {
        content: [{
          type: 'text' as const,
          text: `## Simulator Booted\n\n**${device.name}** is now running.\n\nUse \`ios_test\` to test a URL on this device.`,
        }],
      };
    } else {
      return {
        content: [{
          type: 'text' as const,
          text: `## Error\n\nFailed to boot ${device.name}. Try opening Simulator.app manually.`,
        }],
        isError: true,
      };
    }
  }
);

// ============================================================================
// TOOL: list_breakpoints
// Reference for Tailwind breakpoints
// ============================================================================
server.tool(
  'list_breakpoints',
  'List Tailwind CSS breakpoints and the viewport sizes Breakbot tests.',
  {},
  async () => {
    const info = `## Tailwind CSS Breakpoints

| Prefix | Min Width | Description |
|--------|-----------|-------------|
| (none) | 0px | Mobile-first default |
| sm: | 640px | Small devices |
| md: | 768px | Medium devices (tablets) |
| lg: | 1024px | Large devices (laptops) |
| xl: | 1280px | Extra large devices |
| 2xl: | 1536px | 2X extra large devices |

## Breakbot Test Viewports

${DEFAULT_VIEWPORTS.map(v => `- **${v.name}**: ${v.width}×${v.height}px → \`${getTailwindBreakpoint(v.width)}\``).join('\n')}

## Usage Tips

1. **Mobile-first**: Write base styles for mobile, then add responsive prefixes for larger screens
2. **Example**: \`class="text-sm md:text-base lg:text-lg"\`
3. **Common patterns**:
   - Hide on mobile: \`hidden sm:block\`
   - Stack on mobile: \`flex flex-col md:flex-row\`
   - Full width on mobile: \`w-full md:w-1/2 lg:w-1/3\``;

    return {
      content: [{ type: 'text' as const, text: info }],
    };
  }
);

// Cleanup on exit
async function cleanup() {
  await closeDOMBrowser();
  await closeScreenshotBrowser();
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Breakbot MCP server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
