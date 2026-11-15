import type Package from "../Package";
import LineReader from "node:readline/promises";
import SemanticVersioner from "semver";
import { Logger, InvalidExternalDataError, isNull } from "@yamato-daiwa/es-extensions";


export default abstract class VersionSetter {

  public static async setVersionAndSwitchMonorepoToLocalDevelopmentMode(
    packages: ReadonlyArray<Package>
  ): Promise<void> {

    const lineReader: LineReader.Interface =
        LineReader.createInterface({
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


    for (const internalPackage of packages) {

      /* eslint-disable-next-line no-await-in-loop --
      * If no `node_modules` currently installed even in one package, the installation may take some time.
      * And, the parallel installation of all or majority of node_modules may cause the freezing. */
      await internalPackage.
          setVersion(inputtedVersion).
          symlinkifyDependencies().
          savePackageJSON_File();

    }

    await Promise.all(
      packages.map(
        async (internalPackage: Package): Promise<void> => {
          await internalPackage.installDependenciesWhichRequired();
          await internalPackage.auditAndFixVulnerabilitiesWhichPossible();
        }
      )
    );

  }

}
