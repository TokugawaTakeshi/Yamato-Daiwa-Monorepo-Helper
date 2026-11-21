I read the current publishing code (`Source/Executors/Publisher.ts` and `Source/Package.ts`) and changed nothing. Here is the design I suggest.

# Publishing YDMH monorepos through GitHub Actions with trusted publishing (OIDC)

## 1. YDMH doesn't need to hand control to GitHub Actions and take it back

Trusted publishing doesn't authenticate a YAML step. It authenticates the whole job of one registered workflow file. Inside that job, GitHub sets two environment variables (`ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`). Any `npm publish` running in that job, including one started as a child process by YDMH, uses them to get a short-lived publish token from npm. Each `npm publish` call gets its own token, so a long chain of publishes in one job works.

So GitHub Actions is only the place where YDMH runs. YDMH keeps everything it does now: the dependency graph, ordering, swapping `../../foo` for `1.2.3`, deleting `node_modules` and `package-lock.json`, cleaning the cache, reinstalling, rebuilding and publishing.

```
[You] GitHub GUI → Actions → "Publish" → Run workflow   (the only manual step)
          │
          ▼
   GitHub-hosted runner (one job, id-token: write)
     checkout → setup Node/npm → npx ydmh publish --ci
          │
          └─ YDMH: build all (local links) → publish leaves
                   → for each next level: wait until visible on npm → swap path→version
                   → rm node_modules + lock → npm cache clean → npm install → build → npm publish
```

The swapped `package.json` files exist only in the runner's throwaway workspace. The repository keeps the relative paths, which matches your "no dependency hosting" model.

## 2. One-time setup

**On npmjs.com, for every package:** open Settings → Trusted publishing → GitHub Actions, and enter:
- the owner (`TokugawaTakeshi`)
- the repository
- the workflow file name, e.g. `publish.yml`
- optionally an environment name, e.g. `npm-publish`

Every package in the monorepo can point to the same repository and workflow file. As far as I know, the package must already exist before you can configure this, so a brand-new package needs one manual first publish (with 2FA or staged publishing). After that, you can set "Require 2FA and disallow tokens" on the package.

**In every `package.json`:** the `repository` field must match the GitHub repository exactly. Trusted publishing creates provenance automatically, and provenance checking rejects a mismatch. For a monorepo, add `directory`:
```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/<owner>/<repo>.git",
  "directory": "Packages/Foo"
}
```

**Tool requirements:**
- npm CLI 11.5.1 or newer
- Node 22.14 or newer (you already require Node 24)
- a GitHub-hosted runner; self-hosted runners weren't supported for trusted publishing at my last check

## 3. The workflow file (`.github/workflows/publish.yml` in the target monorepo)

```yaml
name: Publish

on:
  workflow_dispatch:            # Manual start only: the "Run workflow" button
    inputs:
      distributionTag:          # Optional; filled in before start, so it isn't a prompt
        description: "npm dist-tag"
        type: string
        default: "latest"
        required: false

concurrency:                    # Never two publishing runs at once
  group: npm-publish
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write               # Required for OIDC

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm-publish    # Optional: restrict to master; do NOT add required reviewers
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          registry-url: "https://registry.npmjs.org"
          # No "cache: npm": it would fight the deliberate cache cleaning

      - run: npm install --global npm@latest      # Make sure npm is 11.5.1 or newer

      - run: npm ci                                # Root deps, including YDMH as a devDependency

      - run: npx ydmh publish --ci --tag "${{ inputs.distributionTag }}"
        # No NPM_TOKEN here: an injected token would be used instead of OIDC
```

The version is read from each `package.json`, as you wanted. Your local flow becomes:
1. Run `ydmh version`.
2. Commit and push.
3. Click Run workflow.

## 4. Changes YDMH needs (from reading the current code)

1. **Pass the full environment to child processes. This is the change that would block OIDC.** `Package.publish()` calls `ChildProcess.exec("npm publish", { env: { NPM_TOKEN: npmToken } })` (`Source/Package.ts:399`). That replaces the whole environment, so `PATH`, `HOME` and the two `ACTIONS_ID_TOKEN_*` variables are lost and npm can't do OIDC. It must be `env: { ...process.env, ...(token ? { NPM_TOKEN: token } : {}) }`.

2. **Make the token optional.** `Publisher.switchMonorepoToProductionModeAndPublish()` stops when there's no `NPM_TOKEN` and no `.env` file. In CI/OIDC mode it should skip the token entirely. Detect that mode with `process.env.GITHUB_ACTIONS === "true"` or a `--ci` flag.

3. **Never prompt in CI.** The dist-tag prompt (`Publisher.ts`, `lineReader.question(...)`) has no terminal to read from on a runner; at best it gets an empty answer, at worst the job hangs. Take the tag from `--tag` or an environment variable. If any prompt would still be needed in CI mode, fail immediately.

4. **Wait for availability explicitly.** Today, waiting means retrying `npm install` on `ETARGET`. A cleaner approach is to poll after each publish, before touching dependents:
   ```
   npm view <name>@<version> version --prefer-online
   ```
   Poll every N seconds until it returns the version, with an overall timeout. Keep the existing `ETARGET` retry as a second safety net. There's also a mismatch to fix: the log says it retries after `PACKAGE_DEPENDENCIES_REINSTALLATION_ATTEMPT_WAITING__SECONDS` (60 s), but the timer actually uses `period__seconds: 5` (`Package.ts`, around line 583).

5. **Publish in full dependency order.** As I read `Publisher.ts`, it publishes the packages with no internal dependencies, then calls `replaceSymlinkifiedDependenciesWithPublishedOnes()` on their direct dependents only. That method publishes the dependent but doesn't continue to its own dependents. Two cases look unsafe:
   - **Chains:** with C → B → A, C may never be published.
   - **Multiple dependencies:** a package that depends on both A and B (where B depends on A) can be processed as a dependent of A before B is published.

   A topological ordering by levels (Kahn's algorithm) fixes both. Publish level 0, wait until it's visible, then swap, reinstall, build and publish level 1, and so on. Packages within the same level can run in parallel.

6. **Make re-runs safe.** If the job fails halfway, clicking Run workflow again should continue where it stopped. YDMH already skips "You cannot publish over the previously published versions". Ideally it would check up front with `npm view name@version` and log a "will publish / already published" plan before starting.

7. **Git side effects.** `git add package-lock.json` is pointless on the runner; it's harmless, but skip it in CI. If you want tags or GitHub Releases, push them at the end, which needs `permissions: contents: write`.

8. **Cache cleaning.** `npm cache clean --force` on a fresh runner costs almost nothing, so keep it. Combined with `--prefer-online` it rules out stale registry metadata.

## 5. Optional extras

- **Start from the terminal:** `ydmh publish --remote` could call `gh workflow run publish.yml` and then `gh run watch`. That feels like handing control over and getting it back, but it's only a convenience; the GitHub GUI start you asked for still works.
- **Local fallback:** keep the current token-based local publishing until January 2027. After that, `npm stage publish` (your option 1) is a fallback for when GitHub is unavailable.
- **One job per package instead:** YDMH could generate the workflow YAML with one job per package, chained with `needs:` to follow the dependency graph. That shows the graph in the GUI, but every job starts on a clean runner (checkout and install again), and the YAML must be regenerated whenever the graph changes. I'd stay with the single job that runs YDMH.

## Summary

1. Add one manually started workflow with `id-token: write`.
2. Register that workflow as the trusted publisher on every package.
3. Make YDMH non-interactive in CI.
4. Pass `process.env` through to `npm publish`.
5. Publish in topological levels, waiting for each to appear on npm.

After the button click, nothing asks the user anything.
