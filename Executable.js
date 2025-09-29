#!/usr/bin/env node

require("./Build/index.js").
    default.
    interpretAndExecuteConsoleCommand(process.argv);
