#!/usr/bin/env node

import { cliRuntimeFromEnvironment, runCli } from './cli.js';

process.exitCode = await runCli(process.argv, cliRuntimeFromEnvironment());
