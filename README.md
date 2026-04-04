# Yamato Daiwa Monorepo Helper ｟ YDMH ｠

The utility for working with monorepos.
The alternative approach to **npm workspaces**, **pnpm**, **yarn workspaces** and **Lerna**.

+ Using symlinks during local development
+ No dependencies hoisting
+ Respects `peerDependencies`
+ Can be used via npm scripts cross-platformly. All options will be asked via dialog mode. 

> ⚠️ **Warning**
> 
> Using this package, be prepared to be cleared of npm cache and deleted of `node_modules` directory and 
>   `package-lock.json` file (off course, they will be replaced with the fresh ones).
> Such behavior is required to guarantee the installation of just published packages from the npm repository during the
>   switching from a local dependency to the published one.
> See [here](https://stackoverflow.com/q/44331005) and [here](https://stackoverflow.com/q/79791086/4818123) for details.


## Installation

```
npm i @yamato-daiwa/yamato-daiwa-monorepo-helper -D -E
```


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
