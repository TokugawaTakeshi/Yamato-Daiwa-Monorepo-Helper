import ChildProcess from "child_process";
import PackageJSON from "@npmcli/package-json";
import {
  isNonEmptyString,
  isUndefined,
  isNotUndefined,
  isNotNull,
  Logger,
  InvalidExternalDataError
} from "@yamato-daiwa/es-extensions";
import { ImprovedPath } from "@yamato-daiwa/es-extensions-nodejs";
import * as FilesAndDirectoriesDeleter from "rimraf";
import Path from "path";


class Package {

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

    /* [ Theory ] No need to symlinkify the peer dependencies during preparation to production. */
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

  public async installDependenciesWhichRequired(): Promise<void> {

    Logger.logInfo({
      title: "Installing dependencies",
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
          (error: ChildProcess.ExecException | null, stdout: string): void => {

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

            /* eslint-disable-next-line no-console -- The output of "npm install" should be displaying as is. */
            console.log(stdout);

            resolve();

          }
        );

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
        ChildProcess.exec(
          `npm run "${ this.productionBuildingScript }"`,
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8"
          },
          (error: ChildProcess.ExecException | null, stdout: string): void => {

            if (isNotNull(error)) {

              Logger.logErrorLikeMessage({
                title: "Production building, error occurred",
                description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
                compactLayout: true
              });

              reject(error);
              return;

            }


            Logger.logSuccess({
              title: "Production Building Complete",
              description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
              compactLayout: true
            });

            /* eslint-disable-next-line no-console -- The output of "npm install" should be displaying as is. */
            console.log(stdout);

            resolve();

          }
        );

      }
    );

  }

  public async publish(): Promise<void> {

    Logger.logInfo({
      title: "Publishing",
      description: this.rootDirectoryPathRelativeToMonorepoRoot,
      compactLayout: true
    });

    return new Promise<void>(
      (resolve: () => void, reject: (error: ChildProcess.ExecException) => void): void => {

        const childProcess: ChildProcess.ChildProcess = ChildProcess.exec(
          "npm publish",
          {
            cwd: this.rootDirectoryAbsolutePath,
            encoding: "utf-8"
          },
          (error: ChildProcess.ExecException | null, stdout: string): void => {

            if (isNotNull(error)) {

              if (error.message.includes("You cannot publish over the previously published versions")) {

                Logger.logWarning({
                  title: "Already published, skipping",
                  description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`
                });

                resolve();

                return;

              }


              Logger.logErrorLikeMessage({
                title: "Publishing, error occurred",
                description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
                compactLayout: true
              });

              reject(error);
              return;

            }


            Logger.logSuccess({
              title: "Published",
              description:
                  `${ this.rootDirectoryPathRelativeToMonorepoRoot }, version ${ this.metadataFile.content.version }`
            });

            /* eslint-disable-next-line no-console -- The output of "npm install" should be displaying as is. */
            console.log(stdout);

            resolve();

          }
        );


        /* [ Theory ] There is a significant output even with no errors */
        childProcess.stderr?.on(
          "data",
          (data: string): void => {

            /* eslint-disable-next-line no-console -- The data should be output as is, preserving the formatting if any. */
            console.error(data);

          }
        );

      }
    );

  }

  public async replaceSymlinkifiedDependenciesWithPublishedOnes(): Promise<void> {

    if (isUndefined(this.metadataFile.content.version)) {
      Logger.throwErrorWithFormattedMessage({
        errorInstance: new InvalidExternalDataError({
          mentionToExpectedData: `package.json at ${ this.rootDirectoryAbsolutePath }`,
          customMessage: "The \"version\" field is required to work with dependencies inside the monorepo."
        }),
        title: InvalidExternalDataError.localization.defaultTitle,
        occurrenceLocation: "package.replaceSymlinkifiedDependenciesWithPublishedOnes()"
      });
    }


    const namesOfPackagesWhichMayBeAmongPeerDependencies: Set<string> = new Set();

    /* [ Theory ] No need to symlinkify thus desymlinkify the peer dependencies during the preparation to production. */
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
      title: "Replacing the symlinks with published packages...",
      description: this.rootDirectoryPathRelativeToMonorepoRoot,
      compactLayout: true
    });

    /* [ Theory : npm ]
     * If just to run the "npm install", previously symlinkified dependencies will NOT be installed from the npm, thus
     *   the symlinks will be kept what does not match to intended behavior of "@yamato-daiwa/monorepo-helper".
     * To replace the symlinks with files installed from npm registry, both "package-lock.json" and "node_modules" must be
     *   deleted (checked for npm v 10.9.0).
     * For some cases, it is enough to delete the "package-lock.json" and only symlinkified "node_modules", but the
     *   removing of whole "node_modules" if safer.  */
    await Promise.all([
      FilesAndDirectoriesDeleter.rimraf(
        Path.join(this.rootDirectoryAbsolutePath, "package-lock.json")
      ),
     FilesAndDirectoriesDeleter.rimraf(
        Path.join(this.rootDirectoryAbsolutePath, "node_modules")
      )
    ]);

    ChildProcess.exec(
      "npm cache verify",
      {
        cwd: this.rootDirectoryAbsolutePath,
        encoding: "utf-8"
      },
      (error: ChildProcess.ExecException | null, stdout: string, stderr: string): void => {

        if (isNotNull(error)) {

          Logger.logErrorLikeMessage({
            title: "The error has occurred during the refreshing of npm cache",
            description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
            compactLayout: true
          });

          console.error(stderr);

        }

        /* eslint-disable-next-line no-console -- The output of "npm install" should be displaying as is. */
        console.log(stdout);

      }
    );


    await this.installDependenciesWhichRequired();

    ChildProcess.exec(
      "git add package-lock.json",
      {
        cwd: this.rootDirectoryAbsolutePath,
        encoding: "utf-8"
      },
      (error: ChildProcess.ExecException | null, stdout: string): void => {

        if (isNotNull(error)) {
          Logger.logErrorLikeMessage({
            title: "Dependencies installation, error occurred",
            description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
            compactLayout: true
          });
        }


        Logger.logSuccess({
          title: "Dependencies has been installed",
          description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
          compactLayout: true
        });

        /* eslint-disable-next-line no-console -- The output of "npm install" should be displaying as is. */
        console.log(stdout);

      }
    );

    await this.executeProductionBuilding();

    ChildProcess.exec(
      "npm publish",
      {
        cwd: this.rootDirectoryAbsolutePath,
        encoding: "utf-8"
      },
      (error: ChildProcess.ExecException | null, stdout: string): void => {

        if (isNotNull(error)) {
          Logger.logErrorLikeMessage({
            title: "Publishing, error occurred",
            description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot }).`,
            compactLayout: true
          });
        }


        Logger.logSuccess({
          title: "Publishing successful",
          description: `at "${ this.name }" (${ this.rootDirectoryPathRelativeToMonorepoRoot })`,
          compactLayout: true
        });

        /* eslint-disable-next-line no-console -- The output of "npm install" should be displaying as is. */
        console.log(stdout);

      }
    );

  }

  public async savePackageJSON_File(): Promise<void> {
    return this.metadataFile.save();
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
