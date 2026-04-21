import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLayoutMode,
  getProviderPaneWidth,
  truncateText,
  filterItems,
  filterNodesByProtocol,
  getVisibleWindow,
  getStatusDensity
} from '../src/lib/tui-layout.mjs';

test('layout mode follows width breakpoints', () => {
  assert.equal(getLayoutMode(80), 'single');
  assert.equal(getLayoutMode(100), 'compact');
  assert.equal(getLayoutMode(140), 'split');
});

test('provider pane width follows layout mode', () => {
  assert.equal(getProviderPaneWidth(80), 80);
  assert.equal(getProviderPaneWidth(100), 24);
  assert.equal(getProviderPaneWidth(140), 32);
});

test('truncateText adds ellipsis when width is limited', () => {
  assert.equal(truncateText('abcdefghijkl', 6), 'abcde…');
  assert.equal(truncateText('abc', 6), 'abc');
});

test('filterItems matches case-insensitive label text', () => {
  const items = [
    { id: '1', label: 'Japan 01' },
    { id: '2', label: '香港 02' },
    { id: '3', label: 'US 03' }
  ];

  assert.deepEqual(
    filterItems(items, 'ja').map((item) => item.id),
    ['1']
  );
  assert.deepEqual(
    filterItems(items, '香港').map((item) => item.id),
    ['2']
  );
});

test('filterNodesByProtocol keeps all for all and filters exact protocol', () => {
  const items = [
    { id: '1', label: 'Japan 01', protocol: 'vless' },
    { id: '2', label: '香港 02', protocol: 'trojan' },
    { id: '3', label: 'US 03', protocol: 'vless' }
  ];

  assert.deepEqual(filterNodesByProtocol(items, 'all').map((item) => item.id), ['1', '2', '3']);
  assert.deepEqual(filterNodesByProtocol(items, 'vless').map((item) => item.id), ['1', '3']);
});

test('getVisibleWindow keeps selected row inside viewport', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: String(index), label: String(index) }));
  const windowed = getVisibleWindow(items, 7, 4);

  assert.equal(windowed.start, 5);
  assert.equal(windowed.items.length, 4);
  assert.deepEqual(windowed.items.map((item) => item.id), ['5', '6', '7', '8']);
});

test('status density becomes compact on short terminals', () => {
  assert.equal(getStatusDensity(20), 'compact');
  assert.equal(getStatusDensity(24), 'compact');
  assert.equal(getStatusDensity(26), 'full');
});
