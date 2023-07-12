// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import path = require("path");
import url = require("url");
import { logger } from "vscode-debugadapter";
import { OutputChannelLogger } from "../extension/log/OutputChannelLogger";
import * as semver from "semver";
import { Request } from "../common/node/request";
import { ensurePackagerRunning } from "../common/packagerStatus";
import { ProjectVersionHelper } from "../common/projectVersionHelper";
import { ErrorHelper } from "../common/error/errorHelper";
import { InternalErrorCode } from "../common/error/internalErrorCode";
import { FileSystem } from "../common/node/fileSystem";
import { SourceMapUtil } from "./sourceMap";

export interface DownloadedScript {
    contents: string;
    filepath: string;
}

interface IStrictUrl extends url.Url {
    pathname: string;
    href: string;
}

export class ScriptImporter {
    public static DEBUGGER_WORKER_FILE_BASENAME = "debuggerWorker";
    public static DEBUGGER_WORKER_FILENAME = `${ScriptImporter.DEBUGGER_WORKER_FILE_BASENAME}.js`;

    private static readonly REMOVE_SOURCE_URL_VERSION = "0.61.0";
    private static readonly DEBUGGER_UI_SUPPORTED_VERSION = "0.50.0";

    private packagerAddress: string;
    private packagerPort: number;
    private sourcesStoragePath: string;
    private packagerRemoteRoot?: string;
    private packagerLocalRoot?: string;
    private sourceMapUtil: SourceMapUtil;
    private logger2: OutputChannelLogger = OutputChannelLogger.getChannel(
        OutputChannelLogger.MAIN_CHANNEL_NAME,
        true,
    );

    constructor(
        packagerAddress: string,
        packagerPort: number,
        sourcesStoragePath: string,
        packagerRemoteRoot?: string,
        packagerLocalRoot?: string,
    ) {
        this.packagerAddress = packagerAddress;
        this.packagerPort = packagerPort;
        this.sourcesStoragePath = sourcesStoragePath;
        this.packagerRemoteRoot = packagerRemoteRoot;
        this.packagerLocalRoot = packagerLocalRoot;
        this.sourceMapUtil = new SourceMapUtil();
    }

    public async downloadAppScript(
        scriptUrlString: string,
        projectRootPath: string,
    ): Promise<DownloadedScript> {
        const overriddenScriptUrlString = scriptUrlString;

        // We'll get the source code, and store it locally to have a better debugging experience
        const isHttps = overriddenScriptUrlString.startsWith("https");
        let scriptBody = await Request.request(overriddenScriptUrlString, true, isHttps);

        const rnVersions = await ProjectVersionHelper.getReactNativeVersions(projectRootPath);
        // unfortunatelly Metro Bundler is broken in RN 0.54.x versions, so use this workaround unless it will be fixed
        // https://github.com/facebook/metro/issues/147
        // https://github.com/microsoft/vscode-react-native/issues/660
        if (
            ProjectVersionHelper.getRNVersionsWithBrokenMetroBundler().includes(
                rnVersions.reactNativeVersion,
            )
        ) {
            const noSourceMappingUrlGenerated = scriptBody.match(/sourceMappingURL=/g) === null;
            if (noSourceMappingUrlGenerated) {
                const sourceMapPathUrl = overriddenScriptUrlString.replace("bundle", "map");
                scriptBody = this.sourceMapUtil.appendSourceMapPaths(scriptBody, sourceMapPathUrl);
            }
        }

        // Extract sourceMappingURL from body
        const scriptUrl = <IStrictUrl>url.parse(overriddenScriptUrlString); // scriptUrl = "http://localhost:8081/index.ios.bundle?platform=ios&dev=true"
        const sourceMappingUrl = this.sourceMapUtil.getSourceMapURL(scriptUrl, scriptBody); // sourceMappingUrl = "http://localhost:8081/index.ios.map?platform=ios&dev=true"

        let waitForSourceMapping: Promise<void> = Promise.resolve();
        if (sourceMappingUrl) {
            /* handle source map - request it and store it locally */
            waitForSourceMapping = this.writeAppSourceMap(sourceMappingUrl, scriptUrl).then(() => {
                scriptBody = this.sourceMapUtil.updateScriptPaths(
                    scriptBody,
                    <IStrictUrl>sourceMappingUrl,
                );
                if (
                    semver.gte(
                        rnVersions.reactNativeVersion,
                        ScriptImporter.REMOVE_SOURCE_URL_VERSION,
                    ) ||
                    ProjectVersionHelper.isCanaryVersion(rnVersions.reactNativeVersion)
                ) {
                    scriptBody = this.sourceMapUtil.removeSourceURL(scriptBody);
                }
            });
        }
        await waitForSourceMapping;
        const scriptFilePath = await this.writeAppScript(scriptBody, scriptUrl);
        logger.log(`Script ${overriddenScriptUrlString} downloaded to ${scriptFilePath}`);
        return { contents: scriptBody, filepath: scriptFilePath };
    }

    public async downloadDebuggerWorker(
        sourcesStoragePath: string,
        projectRootPath: string,
        debuggerWorkerUrlPath?: string,
    ): Promise<void> {
        const errPackagerNotRunning = ErrorHelper.getInternalError(
            InternalErrorCode.CannotAttachToPackagerCheckPackagerRunningOnPort,
            this.packagerPort,
        );

        await ensurePackagerRunning(this.packagerAddress, this.packagerPort, errPackagerNotRunning);

        const rnVersions = await ProjectVersionHelper.getReactNativeVersions(projectRootPath);
        const debuggerWorkerURL = this.prepareDebuggerWorkerURL(
            rnVersions.reactNativeVersion,
            debuggerWorkerUrlPath,
        );
        const debuggerWorkerLocalPath = path.join(
            sourcesStoragePath,
            ScriptImporter.DEBUGGER_WORKER_FILENAME,
        );
        this.logger2.info(`About to download: ${debuggerWorkerURL} to: ${debuggerWorkerLocalPath}`);

        let body = await Request.request(debuggerWorkerURL, true);
        body = body.replace(
            /debuggerWorker\.[\dA-Fa-f]+\.worker\.js\.map/g,
            "debuggerWorker.js.map",
        );
        await new FileSystem().writeFile(debuggerWorkerLocalPath, body);

        const map = await Request.request(`${debuggerWorkerURL}.map`, true);
        return await new FileSystem().writeFile(`${debuggerWorkerLocalPath}.map`, map);
    }

    public prepareDebuggerWorkerURL(rnVersion: string, debuggerWorkerUrlPath?: string): string {
        let debuggerWorkerURL: string;
        // It can be empty string
        if (debuggerWorkerUrlPath !== undefined) {
            debuggerWorkerURL = `http://${this.packagerAddress}:${this.packagerPort}/${debuggerWorkerUrlPath}${ScriptImporter.DEBUGGER_WORKER_FILENAME}`;
        } else {
            let newPackager = "";
            if (
                !semver.valid(
                    rnVersion,
                ) /* Custom RN implementations should support new packager*/ ||
                semver.gte(rnVersion, ScriptImporter.DEBUGGER_UI_SUPPORTED_VERSION) ||
                ProjectVersionHelper.isCanaryVersion(rnVersion)
            ) {
                newPackager = "debugger-ui/";
            }
            debuggerWorkerURL = `http://${this.packagerAddress}:${this.packagerPort}/${newPackager}static/js/debuggerWorker.16cda763.worker.js`;
        }
        this.logger2.info(`debuggerWorkerUrlPath: ${debuggerWorkerUrlPath || ""}`);
        this.logger2.info(`debuggerWorkerURL: ${debuggerWorkerURL}`);
        return debuggerWorkerURL;
    }

    /**
     * Writes the script file to the project temporary location.
     */
    private async writeAppScript(scriptBody: string, scriptUrl: IStrictUrl): Promise<string> {
        const scriptFilePath = path.join(
            this.sourcesStoragePath,
            path.basename(scriptUrl.pathname),
        ); // scriptFilePath = "$TMPDIR/index.ios.bundle"
        await new FileSystem().writeFile(scriptFilePath, scriptBody);
        return scriptFilePath;
    }

    /**
     * Writes the source map file to the project temporary location.
     */
    private async writeAppSourceMap(
        sourceMapUrl: IStrictUrl,
        scriptUrl: IStrictUrl,
    ): Promise<void> {
        const isHttps = sourceMapUrl.protocol === "https:";
        const sourceMapBody = await Request.request(sourceMapUrl.href, true, isHttps);
        const sourceMappingLocalPath = path.join(
            this.sourcesStoragePath,
            path.basename(sourceMapUrl.pathname),
        ); // sourceMappingLocalPath = "$TMPDIR/index.ios.map"
        const scriptFileRelativePath = path.basename(scriptUrl.pathname); // scriptFileRelativePath = "index.ios.bundle"
        const updatedContent = this.sourceMapUtil.updateSourceMapFile(
            sourceMapBody,
            scriptFileRelativePath,
            this.sourcesStoragePath,
            this.packagerRemoteRoot,
            this.packagerLocalRoot,
        );
        return new FileSystem().writeFile(sourceMappingLocalPath, updatedContent);
    }
}
