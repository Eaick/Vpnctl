import { stdin as input, stdout as output } from 'node:process';
import { getBrandBanner } from './lib/brand.mjs';
import { createConfig } from './lib/config.mjs';

async function maybeShowSplash(outputStream) {
  if (!outputStream.isTTY || process.env.CI || process.env.VPNCTL_NO_SPLASH === '1') return;

  const banner = await getBrandBanner(createConfig().theme);
  outputStream.write('\x1b[2J\x1b[H');
  outputStream.write(`${banner}\nFast lanes. Calm terminal.\n`);
  await new Promise((resolve) => setTimeout(resolve, 650));
  outputStream.write('\x1b[2J\x1b[H');
}

export async function runTui() {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('tui 需要交互式终端');
  }

  await maybeShowSplash(output);

  const React = await import('react');
  const { render } = await import('ink');
  const { default: App } = await import('./ui/App.jsx');

  const app = render(React.createElement(App, {}), {
    exitOnCtrlC: true
  });

  await app.waitUntilExit();
}
