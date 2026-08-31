#!/usr/bin/env node

import { runCli } from './cli.js';

const systemChromiumPath = process.env.SITEPULL_SYSTEM_CHROMIUM?.trim();

process.exitCode = await runCli(process.argv, {
  ...(systemChromiumPath === undefined || systemChromiumPath === ''
    ? {}
    : {
        chromiumExecutablePath: systemChromiumPath,
        parseEnvironment: {
          defaultEngine: 'chromium',
          supportedEngines: ['chromium'],
        },
      }),
});
