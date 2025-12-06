import Package from "./Package";

import Path from "path";
/* eslint-disable-next-line n/no-unsupported-features/node-builtins -- Has stability 2 "Stable" in Node 22. */
import LineReader from "node:readline/promises";
import SemanticVersioner from "semver";
import {
  Logger,
  InvalidExternalDataError,
  RawObjectDataProcessor,
  removeArrayElementsByIndexes,
  isNull,
  isNonEmptyString,
  emptyStringToUndefined
} from "@yamato-daiwa/es-extensions";
import {
  ConsoleApplicationLogger,
  FileNotFoundError,
  ObjectDataFilesProcessor
} from "@yamato-daiwa/es-extensions-nodejs";


class ConsoleLineInterface {

  /* ━━━ Fields ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  private readonly targetMonorepoRootDirectoryAbsolutePath: string;
  private readonly internalPackages: ReadonlyArray<Package>;
  private readonly namesOfBuiltPackagesWithDependents: Set<string> = new Set();


  /* ━━━ Initialization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  static {
    Logger.setImplementation(ConsoleApplicationLogger);
  }


  public static interpretAndExecuteConsoleCommand(argumentsVector: ReadonlyArray<string>): void {

    const targetMonorepoRootDirectoryAbsolutePath: string = process.cwd();

    ConsoleLineInterface.

        searchAndAnalyzeInternalPackages(targetMonorepoRootDirectoryAbsolutePath).

        then((internalPackages: ReadonlyArray<Package>): void => {

          const selfDataHoldingInstance: ConsoleLineInterface = new ConsoleLineInterface({
            targetMonorepoRootDirectoryAbsolutePath,
            internalPackages
          });

          switch (argumentsVector[2]) {

            case "version": {
              selfDataHoldingInstance.setVersionAndSwitchMonorepoToLocalDevelopmentMode().catch(Logger.logPromiseError);
              break;
            }

            case "publish": {
              selfDataHoldingInstance.switchMonorepoToProductionModeAndPublish().catch(Logger.logPromiseError);
            }

          }

        }).

        catch(Logger.logPromiseError);

  }


  private constructor(
    {
      targetMonorepoRootDirectoryAbsolutePath,
      internalPackages
    }: Readonly<{
      targetMonorepoRootDirectoryAbsolutePath: string;
      internalPackages: ReadonlyArray<Package>;
    }>
  ) {

    this.targetMonorepoRootDirectoryAbsolutePath = targetMonorepoRootDirectoryAbsolutePath;
    this.internalPackages = internalPackages;

    for (const [ internalPackageIndex, internalPackage ] of this.internalPackages.entries()) {

      for (
        const anotherInternalProject of removeArrayElementsByIndexes({
          targetArray: this.internalPackages,
          indexes: [ internalPackageIndex ],
          mutably: false
        }).updatedArray
      ) {

        if (internalPackage.hasDependencyOfAnyTypeWithName(anotherInternalProject.name)) {
          internalPackage.setInternalDependency(anotherInternalProject);
        }

      }

    }

  }


  /* ━━━ Commands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  private async setVersionAndSwitchMonorepoToLocalDevelopmentMode(): Promise<void> {

    const lineReader: LineReader.Interface = LineReader.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    let inputtedVersion: string | null;

    do {

      /* eslint-disable-next-line no-await-in-loop -- No parallel promises algorithmically possible here. */
      inputtedVersion = SemanticVersioner.valid(await lineReader.question("Set new version: "));

      if (isNull(inputtedVersion)) {

        Logger.logErrorLikeMessage({
          title: InvalidExternalDataError.localization.defaultTitle,
          description: "Invalid version has been inputted. Please input the valid version."
        });

      }

    } while (isNull(inputtedVersion));

    lineReader.close();


    for (const internalPackage of this.internalPackages) {

      /* eslint-disable-next-line no-await-in-loop --
      * If no `node_modules` currently installed even in one package, the installation may take some time.
      * And, the parallel installation of all or majority of node_modules may cause the freezing. */
      await internalPackage.
          setVersion(inputtedVersion).
          symlinkifyDependencies().
          savePackageJSON_File();

    }

    await Promise.all(
      this.internalPackages.map(
        async (internalPackage: Package): Promise<void> => {
          await internalPackage.installDependenciesWhichRequired();
          await internalPackage.auditAndFixVulnerabilitiesWhichPossible();
        }
      )
    );

  }

  private async switchMonorepoToProductionModeAndPublish(): Promise<void> {

    let npmToken: string;

    /* eslint-disable n/no-process-env --
     * Actual for environments like remote repositories where the variables are being injected without the ".env" file. */
    if (isNonEmptyString(process.env.NPM_TOKEN)) {

      npmToken = process.env.NPM_TOKEN;
      /* eslint-enable n/no-process-env */

    } else {

      const dotEnvFileAbsolutePath: string = Path.join(this.targetMonorepoRootDirectoryAbsolutePath, ".env");

      try {

        npmToken =

            ObjectDataFilesProcessor.processFile<ConsoleLineInterface.RequiredEnvironmentVariables>({
              filePath: dotEnvFileAbsolutePath,
              validDataSpecification: {
                subtype: RawObjectDataProcessor.ObjectSubtypes.fixedSchema,
                nameForLogging: "Root .env file",
                properties: {
                  NPM_TOKEN: {
                    type: String,
                    minimalCharactersCount: 1,
                    isUndefinedForbidden: false,
                    isNullForbidden: false
                  }
                }
              },
              synchronously: true
            }).

            NPM_TOKEN;

      } catch (error: unknown) {

        if (error instanceof FileNotFoundError) {

          Logger.logError({
            errorType: FileNotFoundError.NAME,
            title: FileNotFoundError.localization.defaultTitle,
            description:
                `${ FileNotFoundError.localization.generateDescriptionCommonPart({ filePath: dotEnvFileAbsolutePath }) }\n` +
                "If \"NPM_TOKEN\" environment variable has not been injected, it must be defined in \".env\" file " +
                  "in monorepo root repository.",
            occurrenceLocation: "consoleLineInterface.switchMonorepoToProductionModeAndPublish()",
            caughtError: error
          });

          return;

        }


        Logger.logError({
          errorType: "NPM_TokenNotAvailableError",
          title: "NPM Token not Available",
          description:
              "Failed to retrieve the \"NPM_TOKEN\" environment variable from both `process.env.NPM_TOKEN` and " +
                "\".env\" file in the monorepo root directory.",
          occurrenceLocation: "consoleLineInterface.switchMonorepoToProductionModeAndPublish()",
          caughtError: error
        });

        return;

      }

    }

    const lineReader: LineReader.Interface = LineReader.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const distributionTag: string | undefined =
        emptyStringToUndefined(
          (await lineReader.question("Please specify the tag (just press Enter if latest): ")).
              trim()
        );

    lineReader.close();

    const packagesWithoutInternalDependencies: ReadonlyArray<Package> = this.internalPackages.filter(
      (internalPackage: Package): boolean => internalPackage.internalDependencies.size === 0
    );

    await Promise.all(
      packagesWithoutInternalDependencies.map(
        async (packageWithoutInternalDependencies: Package): Promise<void> =>
            packageWithoutInternalDependencies.executeProductionBuilding()
      )
    );

    for (const packageWithoutInternalDependencies of packagesWithoutInternalDependencies) {

      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await this.executeProductionBuildingForDependentsOf(packageWithoutInternalDependencies);

    }

    await Promise.all(
      packagesWithoutInternalDependencies.map(
        async (packageWithoutInternalDependencies: Package): Promise<void> =>
            packageWithoutInternalDependencies.publish({ distributionTag, npmToken })
      )
    );

    const namesOfPublishedPackagesWithDependents: Set<string> = new Set();

    for (const packageWithoutInternalDependencies of packagesWithoutInternalDependencies) {

      for (const [ dependentPackageName, dependentPackage ] of packageWithoutInternalDependencies.directInternalDependents) {

        if (namesOfPublishedPackagesWithDependents.has(dependentPackageName)) {
          continue;
        }


        /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
        await dependentPackage.replaceSymlinkifiedDependenciesWithPublishedOnes({ distributionTag, npmToken });

        namesOfPublishedPackagesWithDependents.add(dependentPackageName);

      }

    }

  }

  private async executeProductionBuildingForDependentsOf(packageWithoutInternalDependencies: Package): Promise<void> {

    for (const [ dependentPackageName, dependentPackage ] of packageWithoutInternalDependencies.directInternalDependents) {

      if (this.namesOfBuiltPackagesWithDependents.has(dependentPackageName)) {
        continue;
      }


      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await dependentPackage.executeProductionBuilding();

      this.namesOfBuiltPackagesWithDependents.add(dependentPackageName);

      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await this.executeProductionBuildingForDependentsOf(dependentPackage);

    }

  }


  /* ━━━ Auxiliaries ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  private static async searchAndAnalyzeInternalPackages(
    targetMonorepoRootDirectoryAbsolutePath: string
  ): Promise<ReadonlyArray<Package>> {

    const configuration: ConsoleLineInterface.ValidConfigurationFromRootPackageJSON =
        ObjectDataFilesProcessor.processFile<ConsoleLineInterface.ValidConfigurationFromRootPackageJSON>({
          filePath: Path.join(targetMonorepoRootDirectoryAbsolutePath, "package.json"),
          validDataSpecification: {
            subtype: RawObjectDataProcessor.ObjectSubtypes.fixedSchema,
            nameForLogging: "Root package.json",
            properties: {
              ydmh: {
                type: Object,
                isUndefinedForbidden: true,
                isNullForbidden: true,
                properties: {
                  packages: {
                    type: Array,
                    isUndefinedForbidden: true,
                    isNullForbidden: true,
                    areUndefinedElementsForbidden: true,
                    areNullElementsForbidden: true,
                    element: {
                      type: Object,
                      properties: {
                        relativePath: {
                          type: String,
                          minimalCharactersCount: 1,
                          isUndefinedForbidden: false,
                          isNullForbidden: false
                        },
                        productionBuildingScript: {
                          type: String,
                          minimalCharactersCount: 1,
                          isUndefinedForbidden: false,
                          isNullForbidden: false
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          synchronously: true
        });

    return Promise.all(
      configuration.ydmh.packages.map(
        async (packageMetadata: ConsoleLineInterface.ValidConfigurationFromRootPackageJSON.Package): Promise<Package> =>
            Package.capture({
              packageRootDirectoryPathRelativeToMonorepoRoot: packageMetadata.relativePath,
              monorepoRootDirectoryRelativePath: targetMonorepoRootDirectoryAbsolutePath,
              productionBuildingScript: packageMetadata.productionBuildingScript
            })
      )
    );

  }

}


namespace ConsoleLineInterface {

  export type RequiredEnvironmentVariables = Readonly<{
    NPM_TOKEN: string;
  }>;

  export type ValidConfigurationFromRootPackageJSON = Readonly<{
    ydmh: Readonly<{
      packages: ReadonlyArray<ValidConfigurationFromRootPackageJSON.Package>;
    }>;
  }>;

  export namespace ValidConfigurationFromRootPackageJSON {

    export type Package = Readonly<{
      relativePath: string;
      productionBuildingScript: string;
    }>;

  }

}


export default ConsoleLineInterface;
