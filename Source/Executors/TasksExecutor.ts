import type Configuration from "../Configuration";
import { isNotUndefined, splitString } from "@yamato-daiwa/es-extensions";
import ChildProcess from "node:child_process";
import {ImprovedPath} from "@yamato-daiwa/es-extensions-nodejs";


export default abstract class TasksExecutor {

  private static targetMonorepoRootDirectoryAbsolutePath: string;

  public static async execute(
    {
      targetTask,
      targetMonorepoRootDirectoryAbsolutePath
    }:
        Readonly<{
          targetTask: Configuration.SubtasksSet;
          targetMonorepoRootDirectoryAbsolutePath: string;
        }>

  ): Promise<void> {

    TasksExecutor.targetMonorepoRootDirectoryAbsolutePath = targetMonorepoRootDirectoryAbsolutePath;

    if ("series" in targetTask) {
      await TasksExecutor.runSeries(targetTask.series);
      return;
    }


    await TasksExecutor.runParallel(targetTask.parallel);

  }


  private static async runSeries(
    subtasks: ReadonlyArray<Configuration.Subtask | Configuration.ParallelDefinition>
  ): Promise<void> {

    /* eslint-disable no-await-in-loop --
     * The following subtasks are intended to be executed sequentially. */
    for (const subtask of subtasks) {

      if ("parallel" in subtask) {
        await TasksExecutor.runParallel(subtask.parallel);
        continue;
      }


      const workDirectoryAbsolutePath: string =
          ImprovedPath.joinPathSegments([
            TasksExecutor.targetMonorepoRootDirectoryAbsolutePath,
            subtask.directory
          ]);

      if (isNotUndefined(subtask.npmScript)) {
        await TasksExecutor.executeNpmScript(subtask.npmScript, workDirectoryAbsolutePath);
        continue;
      }


      if (isNotUndefined(subtask.command)) {
        await TasksExecutor.runCommand(subtask.command);
      }

    }
    /* eslint-enable no-await-in-loop */

  }

  private static async runParallel(
    subtasks: ReadonlyArray<Configuration.Subtask | Configuration.SeriesDefinition>
  ): Promise<void> {

    await Promise.all(
      subtasks.map(
        async (subtask: Configuration.Subtask | Configuration.SeriesDefinition): Promise<void> => {

          if ("series" in subtask) {
            return TasksExecutor.runSeries(subtask.series);
          }


          const workDirectoryAbsolutePath: string =
              ImprovedPath.joinPathSegments([
                TasksExecutor.targetMonorepoRootDirectoryAbsolutePath,
                subtask.directory
              ]);

          if (isNotUndefined(subtask.npmScript)) {
            return TasksExecutor.executeNpmScript(subtask.npmScript, workDirectoryAbsolutePath);
          }


          if (isNotUndefined(subtask.command)) {
            return TasksExecutor.runCommand(subtask.command);
          }

        }
      )
    );

  }

  private static async executeNpmScript(
    npmScript: string,
    workDirectoryAbsolutePath: string
  ): Promise<void> {

    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {

        const childProcess: ChildProcess.ChildProcess =

            ChildProcess.spawn(
              "npm",
              [ "run", npmScript.trim() ],
              {

                cwd: workDirectoryAbsolutePath,

                env: {

                  /* eslint-disable-next-line n/no-process-env -- Need to keep the default environment variables. */
                  ...process.env,

                  /* [ Theory ] Actual for Node.js util.inspect, Chalk, Jest, Vite, etc. */
                  FORCE_COLOR: "1",

                  /* [ Theory ] Actual for Unix/BSD tools. */
                  CLICOLOR_FORCE: "1",

                  NPM_CONFIG_COLOR: "always"

                }
              }
            );

        childProcess.stdout?.on(
          "data",
          (chunk: Buffer): void => {
            process.stdout.write(chunk);
          }
        );

        childProcess.on("error", reject);

        childProcess.stderr?.on(
          "data",
          (data: unknown): void => {
            console.log("STDERR");
            console.error(`stderr: ${ data }`);
          }
        );

        childProcess.on("close", resolve);

      }
    );

  }

  private static async runCommand(consoleCommand: string): Promise<void> {

    const preProcessedConsoleCommand: string = consoleCommand.trim();
    const commandTerms: ReadonlyArray<string> = splitString(preProcessedConsoleCommand, " ");

    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {

        const childProcess: ChildProcess.ChildProcess =

            ChildProcess.spawn(
              commandTerms[0],
              commandTerms.slice(1),
              {
                env: {

                  /* eslint-disable-next-line n/no-process-env -- Need to keep the default environment variables. */
                  ...process.env,

                  /* [ Theory ] Actual for Node.js util.inspect, Chalk, Jest, Vite, etc. */
                  FORCE_COLOR: "1",

                  /* [ Theory ] Actual for Unix/BSD tools. */
                  CLICOLOR_FORCE: "1",

                  NPM_CONFIG_COLOR: "always"

                }
              }
            );


        childProcess.stdout?.on(
          "data",
          (chunk: Buffer): void => {
            process.stdout.write(chunk);
          }
        );

        childProcess.on("error", reject);

        // childProcess.stderr?.on(
        //   "data",
        //   (data: unknown): void => {
        //     console.log("STDERR");
        //     console.error(`stderr: ${ data }`);
        //   }
        // );

        childProcess.on("close", resolve);

      }
    );

  }

}
