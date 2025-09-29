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
  isNull
} from "@yamato-daiwa/es-extensions";
import {
  ConsoleApplicationLogger,
  ObjectDataFilesProcessor
} from "@yamato-daiwa/es-extensions-nodejs";


class ConsoleLineInterface {

  /* ━━━ Fields ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  private readonly internalPackages: ReadonlyArray<Package>;


  /* ━━━ Initialization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  static {
    Logger.setImplementation(ConsoleApplicationLogger);
  }


  public static interpretAndExecuteConsoleCommand(argumentsVector: ReadonlyArray<string>): void {

    const targetMonorepoRootDirectoryAbsolutePath: string = process.cwd();

    ConsoleLineInterface.

        searchAndAnalyzeInternalPackages(targetMonorepoRootDirectoryAbsolutePath).

        then((internalPackages: ReadonlyArray<Package>): void => {

          const selfDataHoldingInstance: ConsoleLineInterface = new ConsoleLineInterface({ internalPackages });

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
      internalPackages
    }: Readonly<{
      internalPackages: ReadonlyArray<Package>;
    }>
  ) {

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

    let inputtedVersion: string | null = null;

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

    await Promise.all(
      this.internalPackages.map(
        async (internalPackage: Package): Promise<void> => internalPackage.
            setVersion(inputtedVersion).
            symlinkifyDependencies().
            savePackageJSON_File()
      )
    );

    await Promise.all(
      this.internalPackages.map(
        async (internalPackage: Package): Promise<void> => internalPackage.installDependenciesWhichRequired()
      )
    );

  }

  private async switchMonorepoToProductionModeAndPublish(): Promise<void> {

    const packagesWithoutInternalDependencies: ReadonlyArray<Package> = this.internalPackages.filter(
      (internalPackage: Package): boolean => internalPackage.internalDependencies.size === 0
    );

    await Promise.all(
      packagesWithoutInternalDependencies.map(
        async (packageWithoutInternalDependencies: Package): Promise<void> =>
            packageWithoutInternalDependencies.executeProductionBuilding()
      )
    );

    const namesOfBuiltPackagesWithDependents: Set<string> = new Set();

    for (const packageWithoutInternalDependencies of packagesWithoutInternalDependencies) {

      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await ConsoleLineInterface.executeProductionBuildForPackage(
        packageWithoutInternalDependencies, namesOfBuiltPackagesWithDependents
      );

    }

    await Promise.all(
      packagesWithoutInternalDependencies.map(
        async (packageWithoutInternalDependencies: Package): Promise<void> =>
            packageWithoutInternalDependencies.publish()
      )
    );


    const namesOfPublishedPackagesWithDependents: Set<string> = new Set();

    for (const packageWithoutInternalDependencies of packagesWithoutInternalDependencies) {

      for (const [ dependentPackageName, dependentPackage ] of packageWithoutInternalDependencies.directInternalDependents) {

        if (namesOfPublishedPackagesWithDependents.has(dependentPackageName)) {
          continue;
        }


        /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
        await dependentPackage.replaceSymlinkifiedDependenciesWithPublishedOnes();

        namesOfPublishedPackagesWithDependents.add(dependentPackageName);

      }

    }

  }

  private static async executeProductionBuildForPackage(
    packageWithoutInternalDependencies: Package,
    namesOfBuiltPackagesWithDependents: Set<string>
  ): Promise<void> {

    for (const [ dependentPackageName, dependentPackage ] of packageWithoutInternalDependencies.directInternalDependents) {

      if (namesOfBuiltPackagesWithDependents.has(dependentPackageName)) {
        continue;
      }


      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await dependentPackage.executeProductionBuilding();

      namesOfBuiltPackagesWithDependents.add(dependentPackageName);

      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await ConsoleLineInterface.executeProductionBuildForPackage(dependentPackage, namesOfBuiltPackagesWithDependents);

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
