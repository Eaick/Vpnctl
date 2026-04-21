#!/usr/bin/env node
import { fail } from './lib/render.mjs';
import { getBrandHelpBlock } from './lib/brand.mjs';
import { formatCliHelpText } from './lib/help.mjs';
import { createConfig } from './lib/config.mjs';

async function printHelp() {
  const config = createConfig();
  const brand = await getBrandHelpBlock(config.theme);
  console.log(`${brand}\n\n${formatCliHelpText()}`);
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'tui';
  const rest = args.slice(1);
  const flags = parseFlags(rest);
  if (flags.theme) process.env.VPNCTL_THEME = flags.theme;

  if (command === 'dev') {
    process.env.VPNCTL_MODE = 'dev';
  }

  const {
    cmdInit,
    cmdUpgrade,
    cmdMigrateOld,
    cmdDevClean,
    cmdStart,
    cmdStop,
    cmdRestart,
    cmdStatus,
    cmdGroups,
    cmdSwitch,
    cmdSwitchCountry,
    cmdDelay,
    cmdEnv,
    cmdDoctor,
    cmdAddSub,
    cmdListSubs,
    cmdSync,
    cmdRemoveSub,
    cmdConfigSetPorts,
    cmdShellInstall,
    cmdShellUninstall,
    cmdShellPrint
  } = await import('./commands.mjs');
  const { runMenu } = await import('./menu.mjs');
  const { runTui } = await import('./tui.mjs');

  if (
    command === 'help'
    || command === '--help'
    || command === '-h'
    || flags.help
  ) {
    await printHelp();
    return;
  }

  const initArgs = {
    skipDownload: Boolean(flags['skip-download']),
    httpPort: flags['http-port'],
    socksPort: flags['socks-port'],
    apiPort: flags['api-port']
  };

  if (command === 'tui') await runTui();
  else if (command === 'menu') await runMenu();
  else if (command === 'init') await cmdInit({ mode: 'user', ...initArgs });
  else if (command === 'upgrade') await cmdUpgrade({ mode: process.env.VPNCTL_MODE || 'user', skipDownload: Boolean(flags['skip-download']) });
  else if (command === 'migrate-old') await cmdMigrateOld({ mode: process.env.VPNCTL_MODE || 'user', skipDownload: Boolean(flags['skip-download']) });
  else if (command === 'dev') {
    const subcommand = rest[0];
    if (subcommand === 'init') {
      await cmdInit({ mode: 'dev', ...initArgs });
    } else if (subcommand === 'clean') {
      await cmdDevClean();
    } else {
      throw new Error('dev only supports init / clean');
    }
  } else if (command === 'config') {
    const subcommand = rest[0];
    if (subcommand === 'set-ports') {
      await cmdConfigSetPorts({
        http: flags.http,
        socks: flags.socks,
        api: flags.api
      });
    } else {
      throw new Error('config only supports set-ports');
    }
  } else if (command === 'shell') {
    const subcommand = rest[0];
    if (subcommand === 'install') {
      await cmdShellInstall({ bashrcPath: flags['bashrc-path'] });
    } else if (subcommand === 'uninstall') {
      await cmdShellUninstall({ bashrcPath: flags['bashrc-path'] });
    } else if (subcommand === 'print') {
      await cmdShellPrint({ shell: flags.shell || 'bash' });
    } else {
      throw new Error('shell only supports install / uninstall / print');
    }
  } else if (command === 'start') await cmdStart();
  else if (command === 'stop') await cmdStop();
  else if (command === 'restart') await cmdRestart();
  else if (command === 'status') await cmdStatus();
  else if (command === 'groups') await cmdGroups();
  else if (command === 'add-sub') {
    await cmdAddSub({ url: flags.url, file: flags.file, name: flags.name });
  } else if (command === 'list-subs') {
    await cmdListSubs();
  } else if (command === 'sync') {
    await cmdSync({ id: flags.id });
  } else if (command === 'remove-sub') {
    await cmdRemoveSub({ id: flags.id });
  } else if (command === 'switch') {
    if (!flags.group || !flags.node) {
      throw new Error('switch requires --group and --node');
    }
    await cmdSwitch(flags.group, flags.node);
  } else if (command === 'switch-country') {
    const keyword = rest.find((item) => !item.startsWith('--'));
    if (!keyword) throw new Error('switch-country requires a keyword');
    await cmdSwitchCountry(keyword, flags.group);
  } else if (command === 'delay') {
    await cmdDelay(flags);
  } else if (command === 'env') {
    await cmdEnv({ shell: flags.shell || 'bash', quiet: Boolean(flags.quiet) });
  } else if (command === 'doctor') {
    await cmdDoctor();
  } else {
    await printHelp();
    throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  fail(error.message || String(error));
  process.exit(1);
});
