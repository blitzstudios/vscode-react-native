// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as path from "path";
import * as nls from "vscode-nls";
import { ErrorHelper } from "../../common/error/errorHelper";
import { OutputChannelLogger } from "../log/OutputChannelLogger";
import { FileSystem } from "../../common/node/fileSystem";
import { ChildProcess } from "../../common/node/childProcess";
import { TelemetryHelper } from "../../common/telemetryHelper";
import { PlatformType } from "../launchArgs";
import { PlistBuddy } from "./plistBuddy";

nls.config({
    messageFormat: nls.MessageFormat.bundle,
    bundleFormat: nls.BundleFormat.standalone,
})();
const localize = nls.loadMessageBundle();

export class SimulatorPlist {
    private iosProjectRoot: string;
    private projectRoot: string;
    private scheme?: string;
    private logger: OutputChannelLogger = OutputChannelLogger.getMainChannel();
    private nodeFileSystem: FileSystem;
    private plistBuddy: PlistBuddy;
    private nodeChildProcess: ChildProcess;

    constructor(
        iosProjectRoot: string,
        projectRoot: string,
        scheme?: string,
        {
            nodeFileSystem = new FileSystem(),
            plistBuddy = undefined,
            nodeChildProcess = new ChildProcess(),
        } = {},
    ) {
        this.iosProjectRoot = iosProjectRoot;
        this.projectRoot = projectRoot;
        this.scheme = scheme;
        this.nodeFileSystem = nodeFileSystem;
        this.plistBuddy = plistBuddy || new PlistBuddy();
        this.nodeChildProcess = nodeChildProcess;
    }

    public async findPlistFile(configuration?: string, productName?: string): Promise<string> {
        const [bundleId, bootedSimulators, basePathPromise] = await Promise.all([
            this.plistBuddy.getBundleId(
                this.iosProjectRoot,
                this.projectRoot,
                PlatformType.iOS,
                true,
                configuration,
                productName,
                this.scheme,
            ), // Find the name of the application
            this.nodeChildProcess.exec(`xcrun simctl list | grep "(Booted)" | awk -F "[()]" '{print $2}' | tr '\n' ',' | sed 's/.$//'`).then(res => res.outcome), // Find the path of the simulator(s) we are running
            this.nodeChildProcess.exec(`xcrun simctl getenv booted HOME`).then(res => res.outcome),
        ]);

        this.logger.info(`Booted Simulators: ${bootedSimulators}`);

        const basePath = basePathPromise.substring(0, basePathPromise.indexOf("/Devices/") + 9);
        let plistCandidates: string[] = [];
        const pathAfter = path.join("Library", "Preferences", `${bundleId}.plist`);

        for (const simulator of bootedSimulators.split(",")) {
            const pathBefore = path.join(
                basePath,
                simulator.toString().trim(),
                "data",
                "Containers",
                "Data",
                "Application",
            );

            // Look through $SIMULATOR_HOME/Containers/Data/Application/*/Library/Preferences to find $BUNDLEID.plist
            const apps = await this.nodeFileSystem.readDir(pathBefore);

            plistCandidates = plistCandidates.concat(
                apps
                    .map((app: string) => {
                        return path.join(pathBefore, app, pathAfter);
                    })
                    .filter(filePath => {
                        const fileExists = this.nodeFileSystem.existsSync(filePath);
                        if (fileExists) {
                            this.logger.info(`Found plist: ${filePath}`);
                        }
                        return fileExists;
                    }),
            );
        }

        if (plistCandidates.length === 0) {
            throw new Error(`Unable to find plist file for ${bundleId}`);
        } else if (plistCandidates.length > 1) {
            TelemetryHelper.sendSimpleEvent("multipleDebugPlistFound");
            this.logger.warning(
                ErrorHelper.getWarning(
                    localize(
                        "MultiplePlistCandidatesFoundAppMayNotBeDebuggedInDebugMode",
                        "Multiple plist candidates found. Application may not be in debug mode.",
                    ),
                ),
            );
        }

        return plistCandidates[0];
    }
}
