# Yamato Daiwa Monorepo Helper ｟ YDMH ｠

The utility for working with monorepos.
The alternative approach to **npm workspaces**, **pnpm**, **yarn workspaces** and **Lerna**.


## Installation

```
npm i @yamato-daiwa/yamato-daiwa-monorepo-helper -D -E
```

## CLI
### `ydmh install`

Installs the dependencies without modifying (from the YDMH side) of files.
De facto runs `npm install` inside each project under YMMH control.

+ Intended to de run when just checked out the repository and not installed the dependencies yet.
+ If there are internal dependencies inside same monorepo then just running of `ydmh install` may be not enough to
    build the dependents packages — the building of internal dependencies must be executed before build their dependents.
  

### `ydmh version`

Executing the following actions for all packages under control of `ydmh`:

1. Set the specified version in `package.json` via `npm version`
2. Replacing the references to local dependencies with relative pats (e. g `"internal-package": "1.1.0"` will be replaced 
     with something like `"internal-package": "../../internal-package"`).
   It is the one of key differences with `npm workpases`, `yarn workspaces` and Lerna: instead of the dependencies hoisting,
     YDMH creating the relative path based symlinks.
3. Runs `npm install` to complete the switching to local dependencies.

Once done, you can debug the local dependencies running the dependents.

+ You will be prompted which version must be set. 
  Is must the valid version satisfies the `https://www.npmjs.com/package/semver` 


## API & How YDMH Works

Assume that you have the monorepository with internal dependencies.
In root **package.json**, fill the **ydmh** field with references to all packages you want being 
  managed by **YDMH**.
On [@yamato-daiwa/es-extensions](https://www.npmjs.com/package/@yamato-daiwa/es-extensions) example:

```json
{
  "private": true,
  "scripts": {
    "ydmh:version": "ydmh version",
    "ydmh:publsih": "ydmh publish"
  },
  "devDependencies": {
    "@yamato-daiwa/monorepo-helper": "../../YamatoDaiwaMonorepoHelper"
  },
  "ydmh": {
    "packages": [
      {
        "relativePath": "CoreLibrary/Package",
        "productionBuildingScript": "Rebuild Distributable"
      },
      {
        "relativePath": "BrowserJS/Package",
        "productionBuildingScript": "Rebuild Distributable"
      },
      {
        "relativePath": "NodeJS/Package",
        "productionBuildingScript": "Rebuild Distributable"
      }
    ]
  }
}
```


### Local Development Mode & Production Mode

In local mode, the internal dependencies are linked via symlinks.
Herewith, the "peerDependencies" will still refer to published outdated versions because during
  local development it will not cause the problems:

```json
{
  "devDependencies": {
    "@yamato-daiwa/es-extensions": "../../CoreLibrary/Package"
  },
  "peerDependencies": {
    "@yamato-daiwa/es-extensions": "1.8.1"
  }
}
```

### `ydmh version`

Once executed, you will be asked about the new version.
It must be the valid version (satisfies to [`semver.valid()`](https://www.npmjs.com/package/semver)).

Once the valid version will be inputted,

1. The field `version` will be filled by the inputted version in **package.json** files of all projects,
   managed by **YDMH**.
2. In `dependencies` and `devDependencies` fields, the values of all internal packages managed by
  **YDMH** will be replaced with the relative paths.
3. The `npm install` command will be executed in all packages of monorepo managed by **YDMH**.

Additionally, the `npm audit fix` will be executed to automatically resolve the vulnerabilities which possible.


### `ydmn publish`

1. Builds all projects. 
   If some project building will be fail, the execution will stop.
   You will need to resolve the cause before rerun `ydmh publish`.
2. Sequentially realizes all packages managed by **YDMH**, herewith once the specific package will be
   realized, in **package.json** files of dependents the symlinks will be replaced with normally installed 
   published package.

Since the [classic token has been revoked](https://github.blog/changelog/2025-11-05-npm-security-update-classic-token-creation-disabled-and-granular-token-changes/),
  it is required to execute the additional setup to use this command.

1. In your npm account, open the "Access Tokens" page
2. Create the new token ([documentation](https://docs.npmjs.com/creating-and-viewing-access-tokens)). Make sure that:
  1. The token is actual for all packages of your repository
  2. **Bypass 2FA** option is enabled
3. Create the **.env** file in the root of your repository with `NPM_TOKEN` variable.  
   The value of this variable will be the token which you have just created.
4. Add the **.npmrc** file to each project of your monorepo with `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` content. 

Because the tokens have the validity date, they must be updated periodically.
