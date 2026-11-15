import type Package from "../Package";


export default abstract class DependenciesInstaller {

  public static async installInPackages(packages: ReadonlyArray<Package>): Promise<void> {

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
