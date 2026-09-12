import ChildProcess from "child_process";
import PackageJSON from "@npmcli/package-json";
import {
  isNonEmptyString,
  isUndefined,
  isNotUndefined,
  isNotNull,
  Timer,
  Logger,
  InvalidExternalDataError
} from "@yamato-daiwa/es-extensions";
import { ImprovedPath, NodeJS_Timer } from "@yamato-daiwa/es-extensions-nodejs";
import * as FilesAndDirectoriesDeleter from "rimraf";
import Path from "path";


class Package {

  private static readonly PACKAGE_DEPENDENCIES_INSTALLATION_ATTEMPTS_LIMIT: number = 3;
  private static readonly PACKAGE_DEPENDENCIES_REINSTALLATION_ATTEMPT_WAITING__SECONDS: number = 10;

  public readonly rootDirectoryAbsolutePath: string;
  public readonly rootDirectoryPathRelativeToMonorepoRoot: string;
  public readonly name: string;
  public readonly isPrivate: boolean;

  /* [ Approach ] Intended to be managed via `setInternalDependency` method. */
  public readonly internalDependencies: Package.InternalDependencies = new Map();
  public readonly directInternalDependents: Map<Package.Dependency.Name, Package> = new Map();

  private readonly metadataFile: PackageJSON;
  private readonly productionBuildingScript: string;


  /* ━━━ Initialization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  public static async capture(
    {
      monorepoRootDirectoryRelativePath,
      packageRootDirectoryPathRelativeToMonorepoRoot,
      productionBuildingScript
    }: Readonly<{
      monorepoRootDirectoryRelativePath: string;
      packageRootDirectoryPathRelativeToMonorepoRoot: string;
      productionBuildingScript: string;
    }>
  ): Promise<Package> {

    const projectRootDirectoryAbsolutePath: string =
        Path.join(monorepoRootDirectoryRelativePath, packageRootDirectoryPathRelativeToMonorepoRoot);

    const packageJSON: PackageJSON = await PackageJSON.load(projectRootDirectoryAbsolutePath);

    return new Package({
      projectRootDirectoryAbsolutePath,
      packageRootDirectoryPathRelativeToMonorepoRoot,
      packageJSON,
      productionBuildingScript
    });

  }


  private constructor(
    {
      projectRootDirectoryAbsolutePath,
      packageRootDirectoryPathRelativeToMonorepoRoot,
      packageJSON,
      productionBuildingScript
    }: Readonly<{
      projectRootDirectoryAbsolutePath: string;
      packageRootDirectoryPathRelativeToMonorepoRoot: string;
      packageJSON: PackageJSON;
      productionBuildingScript: string;
    }>
  ) {

    this.rootDirectoryAbsolutePath = projectRootDirectoryAbsolutePath;
    this.rootDirectoryPathRelativeToMonorepoRoot = packageRootDirectoryPathRelativeToMonorepoRoot;
    this.metadataFile = packageJSON;
    this.productionBuildingScript = productionBuildingScript;

    if (!isNonEmptyString(this.metadataFile.content.name)) {
      Logger.throwErrorWithFormattedMessage({
        errorInstance: new InvalidExternalDataError({
          mentionToExpectedData: `package.json at ${ this.rootDirectoryAbsolutePath }`,
          customMessage: "The \"name\" field is required to work with dependencies inside the monorepo."
        }),
        title: InvalidExternalDataError.localization.defaultTitle,
        occurrenceLocation: "Package.constructor(compoundParameter)"
      });
    }


    this.name = this.metadataFile.content.name;
    this.isPrivate = this.metadataFile.content.private === true;

  }


  /* ━━━ Instance Methods ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  /* ┅┅┅ Public ┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅ */
  /* ╍╍╍ Project Analyzing ╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍ */
  public hasDependencyOfAnyTypeWithName(packageName: string): boolean {
    return isNotUndefined(this.metadataFile.content.dependencies?.[packageName]) ||
        isNotUndefined(this.metadataFile.content.devDependencies?.[packageName]) ||
        isNotUndefined(this.metadataFile.content.peerDependencies?.[packageName]);
  }

  public setInternalDependency(dependencyProject: Package): void {

    this.internalDependencies.set(
      dependencyProject.name,
      ImprovedPath.computeRelativePath({
        basePath: this.rootDirectoryAbsolutePath,
        comparedPath: dependencyProject.rootDirectoryAbsolutePath,
        alwaysForwardSlashSeparators: true
      })
    );

    dependencyProject.directInternalDependents.set(this.name, this);

  }


  /* ╍╍╍ Switching to Local Development Phase ╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍ */
  public setVersion(targetVersion: string): this {
    this.metadataFile.update({ version: targetVersion });
    return this;
  }

  public symlinkifyDependencies(): this {

    /* [ Theory ] No need to symlinkify the peer dependencies until the preparation to deploying. */
    for (const [ packageName, pathRelativeMonorepoRootDirectory ] of this.internalDependencies.entries()) {

      if (isNotUndefined(this.metadataFile.content.dependencies?.[packageName])) {
        this.metadataFile.content.dependencies[packageName] = pathRelativeMonorepoRootDirectory;
      }

      if (isNotUndefined(this.metadataFile.content.devDependencies?.[packageName])) {
        this.metadataFile.content.devDependencies[packageName] = pathRelativeMonorepoRootDirectory;
      }

    }

    return this;

  }

  public async savePackageJSON_File(): Promise<void> {
    return this.metadataFile.save();
  }

  public async installDependenciesWhichRequired(): Promise<void> {

    Logger.logInfo({
      title: "Installing of dependencies",
      description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
      compactLayout: true
    });

    return new Promise<void>(
      (resolve: () => void, reject: (error: ChildProcess.ExecException) => void): void => {

        /* [ Theory ]
         * Usually no additional output will be on `stdout` or stderr` during execution, it is fine to listen only the
         *   process completions. */
        ChildProcess.exec(
          "npm install",
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8"
          },
          (error: ChildProcess.ExecException | null, standardOutput: string): void => {

            if (isNotNull(error)) {

              Logger.logErrorLikeMessage({
                title: "Dependencies installation, error occurred",
                description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
                compactLayout: true
              });

              reject(error);
              return;

            }


            Logger.logSuccess({
              title: "Dependencies has been installed",
              description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
              compactLayout: true
            });

            Logger.logGeneric(standardOutput);

            resolve();

          }
        );

      }
    );

  }

  public async auditAndFixVulnerabilitiesWhichPossible(): Promise<void> {

    let npmAuditReport: string | null;

    return new Promise<void>(
      (resolve: () => void, reject: (error: ChildProcess.ExecException) => void): void => {

        /* [ Theory ]
         * During the tests, the 3rd parameter of `ChildProcess.exec`'s callback was always empty, and the callback of
         *   `childProcess.stderr?.on("data", (data: string): void => {});` never called even when there are some
         *   automatically unfixable vulnerabilities. */
        const childProcess: ChildProcess.ChildProcess = ChildProcess.exec(
          "npm audit fix",
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8"
          },
          (error: ChildProcess.ExecException | null): void => {

            if (isNotNull(error)) {

              if (isNotNull(npmAuditReport)) {

                Logger.logWarning({
                  title: "Automatically Unfixable Vulnerabilities Detected",
                  description:
                      `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })\n` +
                      npmAuditReport
                });

                resolve();
                return;

              }

              Logger.logErrorLikeMessage({
                title: "Vulnerabilities inspection, error occurred",
                description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
                compactLayout: true
              });

              reject(error);
              return;

            }


            resolve();

          }
        );

        childProcess.stdout?.on("data", (data: string): void => {

          const trimmedData: string = data.trim();

          if (trimmedData.startsWith("# npm audit report")) {
            npmAuditReport = trimmedData;
          }

        });

      }
    );

  }


  /* ╍╍╍ Switching to Production Phase ╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍ */
  public async executeProductionBuilding(): Promise<void> {

    Logger.logInfo({
      title: "Production Building",
      description: this.rootDirectoryPathRelativeToMonorepoRoot,
      compactLayout: true
    });

    return new Promise<void>(
      (resolve: () => void, reject: (error: ChildProcess.ExecException) => void): void => {

        /* [ Theory ]
         * Usually no additional output will be on `stdout` or stderr` during execution, it is fine to listen only the
         *   process completions. */
        const childProcess: ChildProcess.ChildProcess = ChildProcess.exec(
          `npm run "${ this.productionBuildingScript }"`,
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8"
          },
          (error: ChildProcess.ExecException | null, standardOutput: string): void => {

            /* [ Theory ]
             * ● `exec` does not support colored output. See https://github.com/nodejs/help/issues/2183.
             * ● When the building is successful, the `standardOutput` will be like:
             * ```bash
             * > @yamato-daiwa/es-extensions@1.8.6-experimental.3 Rebuild Distributable
             * > rimraf Distributable && tsc -p tsconfig-cjs.json && tsc -p tsconfig-esm.json
             * ```
             * ● When the building fails, the `standardOutput` will include the TypeScript errors. And the `standardError`,
             *    the omitted third parameter of the callback will be even with stringified `error`.
             * ● No output has been registered in `childProcess.stderr?.on("data", () => {})` during the testing.
             */

            if (isNotNull(error)) {

              Logger.logErrorLikeMessage({
                title: "Production Building, Error Occurred",
                description:
                    `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }). ` +
                    "It must be resolved before publishing of the package.\n\n" +
                    standardOutput
              });


              reject(error);
              return;

            }


            Logger.logSuccess({
              title: "Production Building Complete",
              description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
              compactLayout: true
            });

            resolve();

          }
        );

        childProcess.stdout?.on(
          "data",
          (data: string): void => {

            /* [ Theory ] For the output like
             * ```
             * > @yamato-daiwa/es-extensions@1.8.6-experimental.3 Rebuild Distributable
             * > rimraf Distributable && tsc -p tsconfig-cjs.json && tsc -p tsconfig-esm.json
             * ```
             * */
            if (data.trim().startsWith(">")) {
              Logger.logGeneric(data.trim());
            }


            /* [ Theory ]
             * The errored output like
             * `NNN.ts(789,5): error TS6133: 'a' is declared but its value is never read.`
             * will also be here, but is will be printed in the above callback.
             * */

          }
        );

      }
    );

  }

  public async publish(
    {
      distributionTag,
      npmToken
    }: Readonly<{
      distributionTag?: string;
      npmToken: string;
    }>
  ): Promise<void> {

    Logger.logInfo({
      title: "Publishing",
      description: this.rootDirectoryPathRelativeToMonorepoRoot,
      compactLayout: true
    });

    return new Promise<void>(
      (resolve: () => void, reject: (error: ChildProcess.ExecException) => void): void => {

        const childProcess: ChildProcess.ChildProcess = ChildProcess.exec(
          [
            "npm publish",
            ...isNonEmptyString(distributionTag) ? [ "--tag", distributionTag ] : []
          ].join(" "),
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8",
            env: { NPM_TOKEN: npmToken }
          },
          (error: ChildProcess.ExecException | null): void => {

            /* [ Theory ]
             * ● `exec` does not support colored output. See https://github.com/nodejs/help/issues/2183.
             * ● Normally, nothing useful in the `standardOutput`, just at sign separated package name and version.
             *   Most output going from `standardError`.
             */
            if (isNotNull(error)) {

              if (error.message.includes("You cannot publish over the previously published versions")) {

                Logger.logWarning({
                  title: "Already published, skipping",
                  description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
                  compactLayout: true
                });

                resolve();
                return;

              }


              Logger.logErrorLikeMessage({
                title: "Package Publishing, Error Occurred",
                description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }). `,
                compactLayout: true
              });


              reject(error);
              return;

            }


            Logger.logSuccess({
              title: "Package Publishing Complete",
              description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
              compactLayout: true
            });

            resolve();

          }
        );

        childProcess.stderr?.on(
          "data",
          (data: string): void => {

            const trimmedOutput: string = data.trim();

            if (trimmedOutput.startsWith("npm notice")) {
              Logger.logGeneric(trimmedOutput);
            }


            /* [ Approach ] The errored output will be processed in an on ended callback. */

          }
        );

      }
    );

  }

  public async replaceSymlinkifiedDependenciesWithPublishedOnes(
    {
      distributionTag,
      npmToken
    }: Readonly<{
      distributionTag?: string;
      npmToken: string;
    }>
  ): Promise<void> {

    if (isUndefined(this.metadataFile.content.version)) {
      Logger.throwErrorWithFormattedMessage({
        errorInstance: new InvalidExternalDataError({
          mentionToExpectedData: `package.json at ${ this.rootDirectoryAbsolutePath }`,
          customMessage: "The \"version\" field is required to work with dependencies inside the monorepo."
        }),
        title: InvalidExternalDataError.localization.defaultTitle,
        occurrenceLocation: "package.replaceSymlinkifiedDependenciesWithPublishedOnes(compoundParameter)"
      });
    }


    const namesOfPackagesWhichMayBeAmongPeerDependencies: Set<string> = new Set();

    /* [ Theory ] No need to symlinkify thus desymlinkify the peer dependencies during the preparation for production. */
    for (const packageName of this.internalDependencies.keys()) {

      if (isNotUndefined(this.metadataFile.content.dependencies?.[packageName])) {
        this.metadataFile.content.dependencies[packageName] = this.metadataFile.content.version;
        namesOfPackagesWhichMayBeAmongPeerDependencies.add(packageName);
      }

      if (isNotUndefined(this.metadataFile.content.devDependencies?.[packageName])) {
        this.metadataFile.content.devDependencies[packageName] = this.metadataFile.content.version;
        namesOfPackagesWhichMayBeAmongPeerDependencies.add(packageName);
      }

    }

    for (const nameOfPackageWhichMayBeAmongPeerDependencies of namesOfPackagesWhichMayBeAmongPeerDependencies) {

      if (isNotUndefined(this.metadataFile.content.peerDependencies?.[nameOfPackageWhichMayBeAmongPeerDependencies])) {

        this.metadataFile.content.peerDependencies[nameOfPackageWhichMayBeAmongPeerDependencies] =
            this.metadataFile.content.version;

      }

    }

    await this.metadataFile.save();


    Logger.logInfo({
      title: "Replacing the symlinks with published packages",
      description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
      compactLayout: true
    });

    Logger.logInfo({
      title: "Deleting of the outdated node_modules and package-lock.json ...",
      description:
          "Need to delete the node_modules directory and package-lock.json file to guarantee the installation of " +
            "just published dependency from the npm repository instead of the local one."
    });


    /* [ Theory: npm ]
     * If just to run the "npm install", previously symlinked dependencies will NOT be installed from the npm, thus
     *   the symlinks will be kept what does not match to the intended behavior of "@yamato-daiwa/monorepo-helper".
     * To replace the symlinks with files installed from the npm registry, both "package-lock.json" and "node_modules"
     *   must be deleted (checked for npm v 10.9.0).
     * For some cases, it is enough to delete the "package-lock.json" and only symlinked "node_modules", but the
     *   removing of whole "node_modules" is more safe.  */
    await Promise.all([
      FilesAndDirectoriesDeleter.rimraf(
        Path.join(this.rootDirectoryAbsolutePath, "package-lock.json")
      ),
     FilesAndDirectoriesDeleter.rimraf(
        Path.join(this.rootDirectoryAbsolutePath, "node_modules")
      )
    ]);


    let dependenciesInstallationAttemptsCount: number = 1;

    do {

      try {

        /* eslint-disable no-await-in-loop --
         * Normally there must be only one iteration of sequential asynchronous actions.
         * The parallel is algorithmically unacceptable here. * */
        await this.clearNPM_Cache();

        await this.installDependenciesWhichRequired();

        break;

      } catch (error: unknown) {

        if (error instanceof Error && error.message.includes("ETARGET")) {

          dependenciesInstallationAttemptsCount++;

          Logger.logInfo({
            title: "Need another dependencies installation attempt",
            description:
                "One or more dependencies not found, but it may be because the newest data is not available yet in npm. " +
                `Retrying after ${ Package.PACKAGE_DEPENDENCIES_REINSTALLATION_ATTEMPT_WAITING__SECONDS } seconds...`
          });

          await new NodeJS_Timer({ period__seconds: 5 }).
              countDown({ asynchronousCompletion: Timer.AsynchronousCompletions.promise });

          /* eslint-enable no-await-in-loop */

          continue;

        }


        throw error;

      }

    } while (dependenciesInstallationAttemptsCount !== Package.PACKAGE_DEPENDENCIES_INSTALLATION_ATTEMPTS_LIMIT);

    await this.auditAndFixVulnerabilitiesWhichPossible();

    ChildProcess.exec(
      "git add package-lock.json",
      {
        cwd: this.rootDirectoryAbsolutePath,
        encoding: "utf-8"
      }
    );

    await this.executeProductionBuilding();

    await this.publish({ distributionTag, npmToken });

  }


  /* ┅┅┅ Public ┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅ */
  private async clearNPM_Cache(): Promise<void> {

    Logger.logInfo({
      title: "Clearing of the npm cache ...",
      description:
          "Need to clear the npm cache to guarantee the installation of just published dependency from the npm " +
            "repository instead of the local one."
    });

    /* [ Theory ] `npm cache verify` does not work.  */
    return new Promise<void>(
      (resolve: () => void, reject: (error: ChildProcess.ExecException) => void): void => {
        ChildProcess.exec(
          "npm cache clean --force",
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8"
          },
          (error: ChildProcess.ExecException | null): void => {

            if (isNotNull(error)) {

              Logger.logErrorLikeMessage({
                title: "The error has occurred during the cleaning of the npm cache",
                description:
                    `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).\n` +
                    error.message,
                compactLayout: true
              });

              reject(error);
              return;

            }


            resolve();

          }
        );
      }
    );
  }

}


namespace Package {

  export type InternalDependencies = Map<Dependency.Name, Dependency.PathRelativeToCurrentProject>;

  export namespace Dependency {
    export type Name = string;
    export type PathRelativeToCurrentProject = string;
  }

}


export default Package;
