import type Package from "../Package";
import LineReader from "node:readline/promises";
import {
  ObjectDataFilesProcessor,
  ImprovedPath,
  FileNotFoundError
} from "@yamato-daiwa/es-extensions-nodejs";
import {
  RawObjectDataProcessor,
  Logger,
  emptyStringToUndefined,
  isNonEmptyString
} from "@yamato-daiwa/es-extensions";


export default abstract class Publisher {

  private static readonly namesOfBuiltPackagesWithDependents: Set<string> = new Set();

  public static async switchMonorepoToProductionModeAndPublish(
    {
      packages,
      targetMonorepoRootDirectoryAbsolutePath
    }:
        Readonly<{
          packages: ReadonlyArray<Package>;
          targetMonorepoRootDirectoryAbsolutePath: string;
        }>
  ): Promise<void> {

    let npmToken: string;

    /* eslint-disable n/no-process-env --
     * Actual for environments like remote repositories where the variables are being injected without the ".env" file. */
    if (isNonEmptyString(process.env.NPM_TOKEN)) {

      npmToken = process.env.NPM_TOKEN;
      /* eslint-enable n/no-process-env */

    } else {

      const dotEnvFileAbsolutePath: string =
          ImprovedPath.joinPathSegments([ targetMonorepoRootDirectoryAbsolutePath, ".env" ]);

      try {

        npmToken =

            ObjectDataFilesProcessor.processFile<Readonly<{ NPM_TOKEN: string; }>>({
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

    const lineReader: LineReader.Interface =
        LineReader.createInterface({
          input: process.stdin,
          output: process.stdout
        });

    const distributionTag: string | undefined =
        emptyStringToUndefined(
          (await lineReader.question("Please specify the tag (just press Enter if latest): ")).
              trim()
        );

    lineReader.close();

    const packagesWithoutInternalDependencies: ReadonlyArray<Package> =
        packages.filter(
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
      await Publisher.executeProductionBuildingForDependentsOf(packageWithoutInternalDependencies);

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

  private static async executeProductionBuildingForDependentsOf(packageWithoutInternalDependencies: Package): Promise<void> {

    for (const [ dependentPackageName, dependentPackage ] of packageWithoutInternalDependencies.directInternalDependents) {

      if (Publisher.namesOfBuiltPackagesWithDependents.has(dependentPackageName)) {
        continue;
      }


      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await dependentPackage.executeProductionBuilding();

      Publisher.namesOfBuiltPackagesWithDependents.add(dependentPackageName);

      /* eslint-disable-next-line no-await-in-loop -- May freeze for a large number of projects if run to parallel. */
      await this.executeProductionBuildingForDependentsOf(dependentPackage);

    }

  }

}
