// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as nls from "vscode-nls";
import { createNotFoundMessage, executeCommand } from "../util";
import { IValidation, ValidationCategoryE, ValidationResultT } from "./types";

nls.config({
    messageFormat: nls.MessageFormat.bundle,
    bundleFormat: nls.BundleFormat.standalone,
})();

const label = "DeveloperMode";

async function test(): Promise<ValidationResultT> {
    const command =
        "reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock /v AllowDevelopmentWithoutDevLicense";
    const data = await executeCommand(command);
    if (data.stdout) {
        if (data.stdout.includes(" 0x1"))
            return {
                status: "success",
            };
    }

    return {
        status: "failure",
        comment: "Devmode is inactive.",
    };
}

const toLocale = nls.loadMessageBundle();

const main: IValidation = {
    label,
    platform: ["win32"],
    description: toLocale("DeveloperMode", "Required for building RNW apps"),
    category: ValidationCategoryE.Windows,
    exec: test,
};

export default main;