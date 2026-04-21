import { getTheme } from './theme.mjs';

const FALLBACK_BANNER = [
  ' _    ______  _   __ _______ __ ',
  '| |  / / __ \\| | / // ____// / ',
  '| | / / /_/ /| |/ // /    / /  ',
  '| |/ / ____/ |   // /___ / /___',
  '|___/_/      |_|_| \\____//____/'
];

function canUseColor() {
  return process.env.NO_COLOR !== '1';
}

export async function getBrandBanner(themeName = 'gemini') {
  const previousForceColor = process.env.FORCE_COLOR;
  const injectedForceColor = canUseColor() && !previousForceColor;

  try {
    if (injectedForceColor) {
      process.env.FORCE_COLOR = '3';
    }

    const { default: cfonts } = await import('cfonts');
    const theme = getTheme(themeName);
    const result = cfonts.render('VPNCTL', {
      font: 'block',
      align: 'left',
      background: 'transparent',
      letterSpacing: 1,
      lineHeight: 1,
      space: false,
      gradient: canUseColor() ? theme.bannerGradient : false,
      transitionGradient: canUseColor() ? Boolean(theme.bannerTransitionGradient) : false
    });

    return result.string.replace(/\r\n/g, '\n').trimEnd();
  } catch {
    return FALLBACK_BANNER.join('\n');
  } finally {
    if (injectedForceColor) {
      delete process.env.FORCE_COLOR;
    }
  }
}

export async function getBrandHelpBlock(themeName = 'gemini') {
  const banner = await getBrandBanner(themeName);
  return `${banner}\nFast lanes. Calm terminal.`;
}
