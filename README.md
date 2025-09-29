# Yamato Daiwa Monorepo Helper ｟ YDMH ｠

The utility for working with monorepos.
The alternative approach to **npm workspaces**, **pnpm**, **yarn workspaces** and **Lerna**.

+ Using symlinks during local development
+ No dependencies hoisting
+ Respects `peerDependencies`
+ Can be used via npm scripts cross-platformly. All options will be asked via dialog mode. 


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


### Local development mode & production mode

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

When the valid version will be inputted,

1. The field `version` will be filled by the inputted version in **package.json** files of all projects,
   managed by **YDMH**.
2. In `dependencies` and `devDependencies` fields, the values of all internal packages managed by
  **YDMH** will be replaced with the relative paths.
3. The `npm install` command will be executed in all packages of monorepo managed by **YDMH**.


### `ydmn publish`

1. Builds all projects. 
   If some project building will be fail, the execution will stop.
   You will need to resolve the cause before rerun `ydmh publish`.
2. Sequentially realizes all packages managed by **YDMH**, herewith once the specific package will be
   realized, in **package.json** files of dependents the symlinks will be replaced with normally installed 
   published package.
