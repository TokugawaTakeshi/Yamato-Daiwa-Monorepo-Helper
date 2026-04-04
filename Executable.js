#!/usr/bin/env node

require("./Distributable/index.js").
    default.
    interpretAndExecuteConsoleCommand(process.argv);
