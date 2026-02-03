import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface SimulatorDevice {
  udid: string;
  name: string;
  state: 'Booted' | 'Shutdown' | string;
  deviceType: string;
  runtime: string;
  isAvailable: boolean;
}

export interface SimulatorScreenshot {
  deviceName: string;
  udid: string;
  dataUrl: string;
  width: number;
  height: number;
}

// Check if we're on macOS and have xcrun
export async function isIOSSimulatorAvailable(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    await execAsync('xcrun simctl help');
    return true;
  } catch {
    return false;
  }
}

// List available simulators
export async function listSimulators(): Promise<SimulatorDevice[]> {
  try {
    const { stdout } = await execAsync('xcrun simctl list devices -j');
    const data = JSON.parse(stdout);
    const devices: SimulatorDevice[] = [];

    for (const [runtime, deviceList] of Object.entries(data.devices)) {
      if (!Array.isArray(deviceList)) continue;

      for (const device of deviceList as Array<{ udid: string; name: string; state: string; deviceTypeIdentifier: string; isAvailable: boolean }>) {
        // Only include iPhone/iPad devices
        if (device.name.includes('iPhone') || device.name.includes('iPad')) {
          devices.push({
            udid: device.udid,
            name: device.name,
            state: device.state,
            deviceType: device.deviceTypeIdentifier,
            runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', '').replace(/-/g, ' '),
            isAvailable: device.isAvailable,
          });
        }
      }
    }

    return devices;
  } catch (error) {
    console.error('Error listing simulators:', error);
    return [];
  }
}

// Get booted simulators
export async function getBootedSimulators(): Promise<SimulatorDevice[]> {
  const all = await listSimulators();
  return all.filter(d => d.state === 'Booted');
}

// Boot a simulator
export async function bootSimulator(udid: string): Promise<boolean> {
  try {
    await execAsync(`xcrun simctl boot ${udid}`);
    // Wait for it to be ready
    await new Promise(resolve => setTimeout(resolve, 5000));
    return true;
  } catch (error: unknown) {
    // Already booted is fine
    if (error instanceof Error && error.message.includes('current state: Booted')) {
      return true;
    }
    console.error('Error booting simulator:', error);
    return false;
  }
}

// Open URL in simulator Safari
export async function openUrlInSimulator(udid: string, url: string): Promise<boolean> {
  try {
    // First open clears any Safari dialogs/Start Page overlays
    await execAsync(`xcrun simctl openurl ${udid} "${url}"`);
    // Wait for Safari to process the URL
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Open again to ensure URL is loaded (handles Start Page overlay case)
    await execAsync(`xcrun simctl openurl ${udid} "${url}"`);
    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 4000));
    return true;
  } catch (error) {
    console.error('Error opening URL in simulator:', error);
    return false;
  }
}

// Take screenshot of simulator
export async function takeSimulatorScreenshot(udid: string): Promise<string | null> {
  const tempFile = path.join(os.tmpdir(), `breakbot-sim-${udid}-${Date.now()}.png`);

  try {
    await execAsync(`xcrun simctl io ${udid} screenshot "${tempFile}"`);

    // Read file and convert to base64
    const buffer = await fs.promises.readFile(tempFile);
    const base64 = buffer.toString('base64');

    // Clean up temp file
    await fs.promises.unlink(tempFile).catch(() => {});

    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Error taking simulator screenshot:', error);
    return null;
  }
}

// Get simulator screen size
export async function getSimulatorScreenSize(udid: string): Promise<{ width: number; height: number } | null> {
  try {
    // Take a quick screenshot to get dimensions
    const tempFile = path.join(os.tmpdir(), `breakbot-size-${udid}.png`);
    await execAsync(`xcrun simctl io ${udid} screenshot "${tempFile}"`);

    // Use sips to get image dimensions
    const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight "${tempFile}"`);
    await fs.promises.unlink(tempFile).catch(() => {});

    const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);

    if (widthMatch && heightMatch) {
      return {
        width: parseInt(widthMatch[1], 10),
        height: parseInt(heightMatch[1], 10),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Full test on iOS Simulator
export async function testOnSimulator(
  url: string,
  udid?: string
): Promise<{
  success: boolean;
  device?: SimulatorDevice;
  screenshot?: string;
  screenSize?: { width: number; height: number };
  error?: string;
}> {
  // Check availability
  if (!(await isIOSSimulatorAvailable())) {
    return {
      success: false,
      error: 'iOS Simulator not available. Requires macOS with Xcode installed.',
    };
  }

  let targetUdid = udid;

  // If no UDID specified, try to use a booted simulator or boot one
  if (!targetUdid) {
    const booted = await getBootedSimulators();
    if (booted.length > 0) {
      targetUdid = booted[0].udid;
    } else {
      // Try to find and boot an iPhone simulator
      const all = await listSimulators();
      const iphone = all.find(d => d.name.includes('iPhone') && d.isAvailable);
      if (iphone) {
        const booted = await bootSimulator(iphone.udid);
        if (!booted) {
          return {
            success: false,
            error: `Failed to boot simulator: ${iphone.name}`,
          };
        }
        targetUdid = iphone.udid;
        // Give it more time to fully boot
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        return {
          success: false,
          error: 'No available iPhone simulator found. Please open Simulator.app first.',
        };
      }
    }
  }

  // Get device info
  const allDevices = await listSimulators();
  const device = allDevices.find(d => d.udid === targetUdid);

  if (!device) {
    return {
      success: false,
      error: `Simulator with UDID ${targetUdid} not found`,
    };
  }

  // Make sure it's booted
  if (device.state !== 'Booted') {
    const booted = await bootSimulator(targetUdid);
    if (!booted) {
      return {
        success: false,
        error: `Failed to boot simulator: ${device.name}`,
      };
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Open URL
  const opened = await openUrlInSimulator(targetUdid, url);
  if (!opened) {
    return {
      success: false,
      device,
      error: 'Failed to open URL in simulator',
    };
  }

  // Additional wait for page to fully render (CSS, images, fonts, etc.)
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Take screenshot
  const screenshot = await takeSimulatorScreenshot(targetUdid);
  const screenSize = await getSimulatorScreenSize(targetUdid);

  return {
    success: true,
    device,
    screenshot: screenshot || undefined,
    screenSize: screenSize || undefined,
  };
}
