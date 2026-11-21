import Package from "./Package";
import type Configuration from "./Configuration";

import DependenciesInstaller from "./Executors/DependenciesInstaller";
import VersionSetter from "./Executors/VersionSetter";
import Publisher from "./Executors/Publisher";
import DependenciesUpdater from "./Executors/DependenciesUpdater";
import TasksExecutor from "./Executors/TasksExecutor";

import {
  isUndefined,
  Logger,
  RawObjectDataProcessor,
  removeArrayElementsByIndexes
} from "@yamato-daiwa/es-extensions";
import {
  ConsoleApplicationLogger,
  ObjectDataFilesProcessor,
  ImprovedPath,
  FileNotFoundError
} from "@yamato-daiwa/es-extensions-nodejs";


abstract class ConsoleLineInterface {

   private static readonly subtaskPropertiesSpecification: RawObjectDataProcessor.PropertiesSpecification =

      {

        $directory: {
          newName: "directory",
          type: String,
          isUndefinedForbidden: true,
          isNullForbidden: true,
          minimalCharactersCount: 1
        },

        $npmScript: {
          newName: "npmScript",
          type: String,
          isUndefinedForbidden: false,
          isNullForbidden: true,
          minimalCharactersCount: 1
        },

        $command: {
          newName: "command",
          type: String,
          isUndefinedForbidden: false,
          isNullForbidden: true,
          minimalCharactersCount: 1
        },

        $YDNSR_Script: {
          newName: "YDNSR_Script",
          type: String,
          isUndefinedForbidden: false,
          isNullForbidden: true,
          minimalCharactersCount: 1
        },

        $templateVariables: {
          newName: "templateVariables",
          type: Object,
          properties: {},
          undefinedValueSubstitution: {},
          nullValueSubstitution: {}
        },

        $environmentVariables: {
          newName: "environmentVariables",
          type: RawObjectDataProcessor.ValuesTypesIDs.associativeArray,
          undefinedValueSubstitution: {},
          nullValueSubstitution: {},
          areUndefinedTypeValuesForbidden: true,
          areNullTypeValuesForbidden: true,
          value: {
            type: RawObjectDataProcessor.ValuesTypesIDs.polymorphic,
            alternatives: [
              {
                type: String,
                minimalCharactersCount: 1
              },
              {
                type: Number,
                numbersSet: RawObjectDataProcessor.NumbersSets.anyRealNumber,
                isNaN_Forbidden: true
              },
              { type: Boolean }
            ]
          }
        },

        $mustProceedEvenIfFail: {
          newName: "mustProceedEvenIfFail",
          type: Boolean,
          undefinedValueSubstitution: false,
          isNullForbidden: true
        },

        $mustFinishExecutionIfSucceeded: {
          newName: "mustFinishExecutionIfSucceeded",
          type: Boolean,
          undefinedValueSubstitution: false,
          isNullForbidden: true
        }

      };


  private static readonly seriesItemPropertiesSpecification: RawObjectDataProcessor.FixedSchemaObjectValueSpecification =

      {
        type: Object,
        possibleSchemas: {

          conditionals: {

            parallel: {

              actualIf:
                  (
                    { rawData__currentObjectDepth }:
                        RawObjectDataProcessor.ConditionAssociatedWithProperty.Predicate.Parameter
                  ): boolean =>
                      "$parallel" in rawData__currentObjectDepth,

              properties: {

                $parallel: {

                  newName: "parallel",
                  type: Array,
                  isUndefinedForbidden: true,
                  isNullForbidden: true,
                  areUndefinedElementsForbidden: true,
                  areNullElementsForbidden: true,

                  element: {

                    type: Object,
                    possibleSchemas: {

                      conditionals: {

                        series: {

                          actualIf:
                            (
                              { rawData__currentObjectDepth }:
                                  RawObjectDataProcessor.ConditionAssociatedWithProperty.Predicate.Parameter
                            ): boolean =>
                                "$series" in rawData__currentObjectDepth,

                          properties: {

                            $series: {

                              type: Array,
                              isUndefinedForbidden: true,
                              isNullForbidden: true,
                              areUndefinedElementsForbidden: true,
                              areNullElementsForbidden: true,

                              get element(): RawObjectDataProcessor.FixedSchemaObjectValueSpecification {
                                return ConsoleLineInterface.seriesItemPropertiesSpecification;
                              }

                            }

                          }

                        }

                      },

                      default: ConsoleLineInterface.subtaskPropertiesSpecification

                    }

                  }

                }

              }

            }

          },

          default: ConsoleLineInterface.subtaskPropertiesSpecification

        }
      };

  private static readonly parallelItemPropertiesSpecification: RawObjectDataProcessor.FixedSchemaObjectValueSpecification =

      {
        type: Object,
        possibleSchemas: {

          conditionals: {

            series: {

              actualIf:
                  (
                    { rawData__currentObjectDepth }:
                        RawObjectDataProcessor.ConditionAssociatedWithProperty.Predicate.Parameter
                  ): boolean =>
                      "$series" in rawData__currentObjectDepth,

              properties: {

                $series: {

                  newName: "series",
                  type: Array,
                  isUndefinedForbidden: true,
                  isNullForbidden: true,
                  areUndefinedElementsForbidden: true,
                  areNullElementsForbidden: true,

                  element: {

                    type: Object,
                    possibleSchemas: {

                      conditionals: {

                        parallel: {

                          actualIf:
                            (
                              { rawData__currentObjectDepth }:
                                  RawObjectDataProcessor.ConditionAssociatedWithProperty.Predicate.Parameter
                            ): boolean =>
                                "$parallel" in rawData__currentObjectDepth,

                          properties: {

                            $parallel: {

                              type: Array,
                              isUndefinedForbidden: true,
                              isNullForbidden: true,
                              areUndefinedElementsForbidden: true,
                              areNullElementsForbidden: true,

                              get element(): RawObjectDataProcessor.FixedSchemaObjectValueSpecification {
                                return ConsoleLineInterface.parallelItemPropertiesSpecification;
                              }

                            }

                          }

                        }

                      },

                      default: ConsoleLineInterface.subtaskPropertiesSpecification

                    }

                  }

                }

              }

            }

          },

          default: ConsoleLineInterface.subtaskPropertiesSpecification

        }
      };

  private static readonly configurationSpecification: RawObjectDataProcessor.PropertiesSpecification =
      {

        $packages: {

          newName: "packages",
          type: Array,
          isUndefinedForbidden: true,
          isNullForbidden: true,
          areUndefinedElementsForbidden: true,
          areNullElementsForbidden: true,

          element: {

            type: Object,

            properties: {

              $relativePath: {
                newName: "relativePath",
                type: String,
                minimalCharactersCount: 1,
                isUndefinedForbidden: false,
                isNullForbidden: false
              },

              $productionBuildingScript: {
                newName: "productionBuildingScript",
                type: String,
                minimalCharactersCount: 1,
                isUndefinedForbidden: false,
                isNullForbidden: false
              }

            }

          }

        },

        $tasks: {

          newName: "tasks",
          type: RawObjectDataProcessor.ValuesTypesIDs.associativeArray,
          undefinedValueSubstitution: {},
          nullValueSubstitution: {},
          areUndefinedTypeValuesForbidden: true,
          areNullTypeValuesForbidden: true,

          value: {

            type: Object,
            possibleSchemas: {

              conditionals: {

                parallel: {

                  actualIf:
                      (
                        { rawData__currentObjectDepth }:
                            RawObjectDataProcessor.ConditionAssociatedWithProperty.Predicate.Parameter
                      ): boolean =>
                          "$parallel" in rawData__currentObjectDepth,

                  properties: {

                    $parallel: {

                      newName: "parallel",
                      type: Array,
                      isUndefinedForbidden: true,
                      isNullForbidden: true,
                      areUndefinedElementsForbidden: false,
                      areNullElementsForbidden: false,

                      element: ConsoleLineInterface.parallelItemPropertiesSpecification

                    }

                  }

                }

              },

              default: {

                $series: {

                  newName: "series",
                  type: Array,
                  isUndefinedForbidden: true,
                  isNullForbidden: true,
                  areUndefinedElementsForbidden: false,
                  areNullElementsForbidden: false,

                  element: ConsoleLineInterface.seriesItemPropertiesSpecification

                }

              }

            }

          }

        }

      };

  private static readonly targetMonorepoRootDirectoryAbsolutePath: string = process.cwd();
  private static readonly configuration: Configuration =
      ConsoleLineInterface.getConfiguration();


  static {
    Logger.setImplementation(ConsoleApplicationLogger);
  }


  public static interpretAndExecuteConsoleCommand(argumentsVector: ReadonlyArray<string>): void {

    ConsoleLineInterface.

        searchAndAnalyzeInternalPackages().

        then(
          async (internalPackages: ReadonlyArray<Package>): Promise<void> => {

            switch (argumentsVector[2]) {

              case "install": {
                await DependenciesInstaller.installInPackages(internalPackages);
                break;
              }

              case "version": {
                await VersionSetter.setVersionAndSwitchMonorepoToLocalDevelopmentMode(internalPackages);
                break;
              }

              case "publish": {

                await Publisher.switchMonorepoToProductionModeAndPublish({
                  packages: internalPackages,
                  targetMonorepoRootDirectoryAbsolutePath: ConsoleLineInterface.targetMonorepoRootDirectoryAbsolutePath
                });

                break;

              }

              case "update": {
                await DependenciesUpdater.checkUpdatesAndInstallSelectedOnes(internalPackages);
                break;
              }

              case "run": {

                const TASK_NAME_ARGUMENTS_VECTOR_ELEMENT_EXPECTED_INDEX: number = 3;
                const targetTaskName: string = argumentsVector[TASK_NAME_ARGUMENTS_VECTOR_ELEMENT_EXPECTED_INDEX];
                const targetTask: Configuration.SubtasksSet | undefined =
                    ConsoleLineInterface.configuration.tasks[targetTaskName];

                if (isUndefined(targetTask)) {
                  Logger.throwErrorWithFormattedMessage({
                    errorType: "UnknownTaskError",
                    title: "Unknown Task",
                    description:
                        `The task "${ targetTaskName }" is not defined in YDMH configuration file. ` +
                        "The defined tasks are:\n" +
                        Object.
                            keys(ConsoleLineInterface.configuration.tasks).
                            map((taskName: string): string => `  ● ${ taskName }`).
                            join("\n"),

                    occurrenceLocation: "ConsoleLineInterface.interpretAndExecuteConsoleCommand(argumentsVector)"
                  });
                }

                await TasksExecutor.execute({
                  targetTask,
                  targetMonorepoRootDirectoryAbsolutePath: ConsoleLineInterface.targetMonorepoRootDirectoryAbsolutePath
                });

              }

            }

          }
        ).

        catch(Logger.logPromiseError);

  }


  /* ━━━ Auxiliaries ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  private static async searchAndAnalyzeInternalPackages(): Promise<ReadonlyArray<Package>> {

    const internalPackages: ReadonlyArray<Package> =

        await Promise.all(
          ConsoleLineInterface.configuration.packages.map(
            async (packageMetadata: Configuration.Package): Promise<Package> =>
                Package.capture({
                  packageRootDirectoryPathRelativeToMonorepoRoot: packageMetadata.relativePath,
                  monorepoRootDirectoryRelativePath: ConsoleLineInterface.targetMonorepoRootDirectoryAbsolutePath,
                  productionBuildingScript: packageMetadata.productionBuildingScript
                })
          )
        );

    for (const [ internalPackageIndex, internalPackage ] of internalPackages.entries()) {

      for (
        const anotherInternalProject of
            removeArrayElementsByIndexes({
              targetArray: internalPackages,
              indexes: [ internalPackageIndex ],
              mutably: false
            }).updatedArray
      ) {

        if (internalPackage.hasDependencyOfAnyTypeWithName(anotherInternalProject.name)) {
          internalPackage.setInternalDependency(anotherInternalProject);
        }

      }

    }

    return internalPackages;

  }

  private static getConfiguration(): Configuration {

    for (
      const configurationPotentialFileAbsolutePath of
          [
            ImprovedPath.joinPathSegments([ ConsoleLineInterface.targetMonorepoRootDirectoryAbsolutePath, "ydmh.yaml" ]),
            ImprovedPath.joinPathSegments([ ConsoleLineInterface.targetMonorepoRootDirectoryAbsolutePath, "ydmh.yml" ])
          ]
    ) {

      try {

        return ObjectDataFilesProcessor.processFile<Configuration>({
          filePath: configurationPotentialFileAbsolutePath,
          validDataSpecification: {
            subtype: RawObjectDataProcessor.ObjectSubtypes.fixedSchema,
            nameForLogging: "YDMH Configuration File",
            properties: ConsoleLineInterface.configurationSpecification
          },
          synchronously: true
        });

      } catch (error: unknown) {

        if (error instanceof FileNotFoundError) {
          continue;
        }


        throw error;

      }

    }


    const { ydmh: configuration }: ConsoleLineInterface.ValidConfigurationFromRootPackageJSON | undefined =

        ObjectDataFilesProcessor.processFile<ConsoleLineInterface.ValidConfigurationFromRootPackageJSON>({
          filePath:
              ImprovedPath.joinPathSegments([ ConsoleLineInterface.targetMonorepoRootDirectoryAbsolutePath, "package.json" ]),
          validDataSpecification: {
            subtype: RawObjectDataProcessor.ObjectSubtypes.fixedSchema,
            nameForLogging: "Root package.json",
            properties: {
              ydmh: {
                type: Object,
                isUndefinedForbidden: true,
                isNullForbidden: true,
                properties: ConsoleLineInterface.configurationSpecification
              }
            }
          },
          synchronously: true
        });

    return configuration;

  }

}


namespace ConsoleLineInterface {

  export type ValidConfigurationFromRootPackageJSON = Readonly<{ ydmh: Configuration; }>;

}


export default ConsoleLineInterface;
