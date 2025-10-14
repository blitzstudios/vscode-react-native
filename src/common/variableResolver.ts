// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as os from "os";
import { ChildProcess } from "./node/childProcess";

/**
 * Resolves custom variables in the format: ${vscode:variable_name}
 */
export async function resolveCustomVariables(value: any): Promise<any> {
    if (typeof value === "string") {
        return resolveCustomVariablesInString(value);
    } else if (Array.isArray(value)) {
        return await Promise.all(value.map(item => resolveCustomVariables(item)));
    } else if (typeof value === "object" && value !== null) {
        const resolved: any = {};
        for (const [key, val] of Object.entries(value)) {
            // eslint-disable-next-line no-await-in-loop
            resolved[key] = await resolveCustomVariables(val);
        }
        return resolved;
    }
    return value;
}

async function resolveCustomVariablesInString(str: string): Promise<string> {
    // Match ${vscode:...} pattern
    const customVarRegex = /\${vscode:([^}]+)}/g;
    const matches: Array<{ fullMatch: string; varName: string }> = [];

    // Find all matches
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = customVarRegex.exec(str)) !== null) {
        matches.push({
            fullMatch: match[0],
            varName: match[1].trim(),
        });
    }

    if (matches.length === 0) {
        return str;
    }

    let result = str;

    // Resolve all matches
    for (const matchInfo of matches) {
        let value: string;

        switch (matchInfo.varName) {
            case "local_ip":
                value = getLocalIpAddress();
                break;
            case "ios_device_udid":
                // eslint-disable-next-line no-await-in-loop
                value = await getIOSDeviceUDID();
                break;
            default:
                // If variable is unknown, leave it as-is
                value = matchInfo.fullMatch;
        }

        result = result.replace(matchInfo.fullMatch, value);
    }

    return result;
}

/**
 * Gets the local IP address of the machine
 * Returns the first non-internal IPv4 address found
 */
function getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();

    // Priority order: en0 (WiFi on Mac), eth0 (Ethernet on Linux), then any other
    const priorityOrder = ["en0", "eth0", "Ethernet", "Wi-Fi"];

    // First, try priority interfaces
    for (const interfaceName of priorityOrder) {
        const iface = interfaces[interfaceName];
        if (iface) {
            for (const addr of iface) {
                // Skip internal (loopback) addresses and IPv6
                if (addr.family === "IPv4" && !addr.internal) {
                    return addr.address;
                }
            }
        }
    }

    // If no priority interface found, use any non-internal IPv4 address
    for (const interfaceName of Object.keys(interfaces)) {
        const iface = interfaces[interfaceName];
        if (iface) {
            for (const addr of iface) {
                // Skip internal (loopback) addresses and IPv6
                if (addr.family === "IPv4" && !addr.internal) {
                    return addr.address;
                }
            }
        }
    }

    // Fallback to localhost if no external IP found
    return "localhost";
}

/**
 * Gets the UDID of the first connected iOS physical device (iPhone, iPad, or iPod)
 */
async function getIOSDeviceUDID(): Promise<string> {
    if (process.platform !== "darwin") {
        return ""; // iOS devices only work on macOS
    }

    try {
        const childProcess = new ChildProcess();
        const output = await childProcess.execToString("xcrun xctrace list devices");

        // Parse output to find iOS physical devices
        const lines = output.split("\n");

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Only match iPhone, iPad, or iPod devices (not Mac, Apple Watch, etc.)
            if (
                !trimmedLine.startsWith("iPhone") &&
                !trimmedLine.startsWith("iPad") &&
                !trimmedLine.startsWith("iPod")
            ) {
                continue;
            }

            // Skip simulator lines
            if (trimmedLine.includes("Simulator")) {
                continue;
            }

            // Extract the UDID from the last set of parentheses
            const match = trimmedLine.match(/\(([\da-f]{8}-[\da-f]{16})\)/i);
            if (match) {
                return match[1];
            }
        }

        return ""; // No device found
    } catch (error) {
        return ""; // Command failed
    }
}
