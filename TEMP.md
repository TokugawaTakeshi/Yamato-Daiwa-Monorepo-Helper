Configured authentication: JetBrains

## Why none of the three listeners fire

The cause is `stdio: "inherit"` at `Source/index.ts:420`.

- **`stdout` / `stderr`**: with `"inherit"`, the child writes straight to your process's terminal file descriptors. No pipe is created, so `childProcess.stdout` and `childProcess.stderr` are `null`. Because you used `?.`, the `.on("data", …)` calls silently do nothing.
- **`"message"`**: this event only fires over an IPC channel, which you get from `ChildProcess.fork()` or an `"ipc"` entry in `stdio`, and only when the child calls `process.send()`. ncu never calls `process.send()`, so this event will never fire for it.

## The catch: `--interactive` needs a TTY

You can't simply switch to `stdio: "pipe"`. Once ncu's stdout is a pipe instead of a terminal:
- `process.stdout.isTTY` is false in the child, so colours turn off.
- The interactive checkbox prompt may render badly or not work at all, because its arrow-key redraw relies on terminal control.
- You become responsible for echoing everything to the user yourself.

## Options, from most to least recommended

**1. Call ncu as a library instead of spawning it.** This is the cleanest if what you want is the *result*.
```ts
import * as ncu from "npm-check-updates";

const upgraded = await ncu.run({
  cwd: internalPackage.rootDirectoryAbsolutePath,
  packageFile: "package.json",
  interactive: true,   // or false + your own prompt
  upgrade: true
});
// upgraded: { "some-package": "^2.0.0", ... }
```
You get structured data back and don't have to parse any text.

**2. Split it into two steps.** First run ncu without `--interactive` and with `--jsonUpgraded` (stdout piped), and parse the JSON. Then show your own prompt (e.g. with `@inquirer/prompts`) and apply the choices.

**3. Keep stdin as a terminal and pipe only the output** (`stdio: ["inherit", "pipe", "pipe"]`), then forward each chunk:
```ts
childProcess.stdout?.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);          // keep the user seeing it
  collected += chunk.toString();        // and capture it
});
```
Add `env: { ...process.env, FORCE_COLOR: "1" }` to keep the colours. The interactive prompt may still misbehave because the child's stdout is not a TTY, so treat this as fragile.

**4. Use a pseudo-terminal (`node-pty`).** The child thinks it's in a real terminal, so the interactive UI works fully, and you still receive every byte through `pty.onData(...)`. The downsides are a native dependency (it needs prebuilt binaries on Windows) and raw output full of ANSI escape codes that you'd have to strip before parsing.

What do you actually need from the output? If it's "which packages were upgraded", option 1 is the right choice. If you need to watch the live interactive session as it happens, use option 4. I haven't changed any code.
