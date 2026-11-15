import type Package from "../Package";
import ChildProcess from "node:child_process";
import { ImprovedPath } from "@yamato-daiwa/es-extensions-nodejs";


export default abstract class DependenciesUpdater {

  private static readonly npmCheckUpdatesScriptAbsolutePath: string =
    ImprovedPath.joinPathSegments([
      __dirname,
      "..",
      "node_modules/npm-check-updates/build/cli.js"
    ]);


  public static async checkUpdatesAndInstallSelectedOnes(
    packages: ReadonlyArray<Package>
  ): Promise<void> {

    for (const internalPackage of packages) {

      /* eslint-disable-next-line no-await-in-loop -- A user can work with single session. */
      await DependenciesUpdater.checkUpdatesInPackage(internalPackage);

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

  private static async checkUpdatesInPackage(internalPackage: Package): Promise<void> {
    return new Promise<void>(
      (resolve: () => void): void => {

        const childProcess: ChildProcess.ChildProcess =
            ChildProcess.spawn(
              "node",
              [
                DependenciesUpdater.npmCheckUpdatesScriptAbsolutePath,
                "--interactive"
              ],
              {
                stdio: "inherit",
                cwd: internalPackage.rootDirectoryAbsolutePath
              }
            );

        // childProcess.on("message", (data: ChildProcess.Serializable) => {
        //   console.log("MESSAGE");
        //   console.log(`message: ${ data.toString() }`);
        // });
        //
        // childProcess.stdout?.on("data", (data: unknown) => {
        //   console.log("STDOUT");
        //   console.log(`stdout: ${ data }`);
        // });
        //
        // childProcess.stderr?.on("data", (data: unknown) => {
        //   console.log("STDERR");
        //   console.error(`stderr: ${ data }`);
        // });

        childProcess.on(
          "close",
          resolve
        );

      }
    );

  }

}
