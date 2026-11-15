import type { ReadonlyParsedJSON } from "@yamato-daiwa/es-extensions";


type Configuration =

    Readonly<{
      packages: ReadonlyArray<Configuration.Package>;
      tasks: Readonly<{ [ taskName: string ]: Configuration.SubtasksSet; }>;
    }>;


namespace Configuration {

    export type Package =

        Readonly<{
          relativePath: string;
          productionBuildingScript: string;
        }>;

    export type SubtasksSet = ParallelDefinition | SeriesDefinition;

    export type SeriesDefinition = Readonly<{ series: ReadonlyArray<Subtask | ParallelDefinition>; }>;
    export type ParallelDefinition = Readonly<{ parallel: ReadonlyArray<Subtask | SeriesDefinition>; }>;

    export type Subtask =
        Readonly<{
          directory: string;
          npmScript?: string;
          command?: string;
          YDNSR_Script?: string;
          templateVariables: ReadonlyParsedJSON;
          environmentVariables: Readonly<{ [variableName: string]: string; }>;
          mustProceedEvenIfFail: boolean;
          mustFinishExecutionIfSucceeded: boolean;
        }>;

}


export default Configuration;
