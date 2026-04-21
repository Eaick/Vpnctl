import test from 'node:test';
import assert from 'node:assert/strict';
import { getMihomoInstallHint } from '../src/lib/prereq.mjs';

test('install hint contains mihomo binary guidance', () => {
  const hint = getMihomoInstallHint();
  assert.match(hint, /mihomo/i);
  assert.match(hint, /(vpnctl init|vpnctl dev init|MIHOMO_BIN)/);
});

test('install hint reminds user about mix mode and default ports', () => {
  const hint = getMihomoInstallHint();
  assert.match(hint, /(mix|mixed)/i);
  assert.match(hint, /(7890|9090)/);
});
