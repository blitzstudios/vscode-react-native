// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import { ErrorHelper } from "../../common/error/errorHelper";
import { InternalErrorCode } from "../../common/error/internalErrorCode";
import { ProjectVersionHelper } from "../../common/projectVersionHelper";
import { selectProject } from "./util";
import { ReactNativeCommand } from "./util/reactNativeCommand";

export class StartPackager extends ReactNativeCommand {
    codeName = "startPackager";
    label = "Start Packager";
    error = ErrorHelper.getInternalError(InternalErrorCode.FailedToStartPackager);

    async baseFn() {
        this.project = await selectProject();
        await ProjectVersionHelper.getReactNativePackageVersionsFromNodeModules(
            this.project.getOrUpdateNodeModulesRoot(),
        );

        if (await this.project.getPackager().isRunning()) {
            await this.project.getPackager().stop();
        }
        await this.project.getPackager().start();
    }
}
