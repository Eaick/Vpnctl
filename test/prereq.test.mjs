import test from 'node:test';
import assert from 'node:assert/strict';
import { getMihomoInstallHint } from '../src/lib/prereq.mjs';

test('install hint contains mihomo binary guidance', () => {
  const hint = getMihomoInstallHint();
  assert.match(hint, /mihomo/i);
  assert.match(hint, /(vpnctl init|vpnctl dev init|MIHOMO_BIN)/);
});

test('install hint reminds user to avoid default proxy ports when needed', () => {
  const hint = getMihomoInstallHint();
  assert.match(hint, /(7890|7891)/);
});
