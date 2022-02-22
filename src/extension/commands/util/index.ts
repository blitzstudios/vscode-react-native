// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as assert from "assert";
import * as vscode from "vscode";
import * as nls from "vscode-nls";
import { AppLauncher } from "../../appLauncher";
import {
    IAndroidRunOptions,
    IIOSRunOptions,
    ImacOSRunOptions,
    IWindowsRunOptions,
    PlatformType,
} from "../../launchArgs";
import { OutputChannelLogger } from "../../log/OutputChannelLogger";
import { SettingsHelper } from "../../settingsHelper";
import { TargetType } from "../../generalPlatform";
import { CommandExecutor } from "../../../common/commandExecutor";
import { ProjectsStorage } from "../../projectsStorage";
import { ErrorHelper } from "../../../common/error/errorHelper";
import { InternalErrorCode } from "../../../common/error/internalErrorCode";

nls.config({
    messageFormat: nls.MessageFormat.bundle,
    bundleFormat: nls.BundleFormat.standalone,
})();
const localize = nls.loadMessageBundle();

export const getRunOptions = (
    project: AppLauncher,
    platform: PlatformType,
    target: TargetType = TargetType.Simulator,
) => {
    const folderUri = project.getWorkspaceFolderUri();

    const runOptions: IAndroidRunOptions | IIOSRunOptions | IWindowsRunOptions | ImacOSRunOptions =
        {
            platform,
            packagerPort: SettingsHelper.getPackagerPort(folderUri.fsPath),
            runArguments: SettingsHelper.getRunArgs(platform, target, folderUri),
            env: SettingsHelper.getEnvArgs(platform, target, folderUri),
            envFile: SettingsHelper.getEnvFile(platform, target, folderUri),
            projectRoot: SettingsHelper.getReactNativeProjectRoot(folderUri.fsPath),
            nodeModulesRoot: project.getOrUpdateNodeModulesRoot(),
            reactNativeVersions: project.getReactNativeVersions() || {
                reactNativeVersion: "",
                reactNativeWindowsVersion: "",
                reactNativeMacOSVersion: "",
            },
            workspaceRoot: project.getWorkspaceFolderUri().fsPath,
            ...(platform === PlatformType.iOS && target === "device" && { target: "device" }),
        };

    CommandExecutor.ReactNativeCommand = SettingsHelper.getReactNativeGlobalCommandName(
        project.getWorkspaceFolderUri(),
    );

    return runOptions;
};

export const loginToExponent = (project: AppLauncher): Promise<xdl.IUser> => {
    return project
        .getExponentHelper()
        .loginToExponent(
            (message, password) =>
                new Promise(
                    vscode.window.showInputBox({ placeHolder: message, password }).then,
                ).then(it => it || ""),
            message =>
                new Promise(vscode.window.showInformationMessage(message).then).then(
                    it => it || "",
                ),
        )
        .catch(err => {
            OutputChannelLogger.getMainChannel().warning(
                localize(
                    "ExpoErrorOccuredMakeSureYouAreLoggedIn",
                    "An error has occured. Please make sure you are logged in to Expo, your project is setup correctly for publishing and your packager is running as Expo.",
                ),
            );
            throw err;
        });
};

export const selectProject = async () => {
    const logger = OutputChannelLogger.getMainChannel();
    const projectKeys = Object.keys(ProjectsStorage.projectsCache);

    if (projectKeys.length === 0) {
        throw ErrorHelper.getInternalError(
            InternalErrorCode.WorkspaceNotFound,
            "Current workspace does not contain React Native projects.",
        );
    }

    if (projectKeys.length === 1) {
        logger.debug(`Command palette: once project ${projectKeys[0]}`);
        return ProjectsStorage.projectsCache[projectKeys[0]];
    }

    const selected = await vscode.window.showQuickPick(projectKeys).then(it => it);

    assert(selected, "Selection canceled");

    logger.debug(`Command palette: selected project ${selected}`);
    return ProjectsStorage.projectsCache[selected];
};