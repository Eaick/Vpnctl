import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable, PassThrough } from 'node:stream';
import React from 'react';
import { Box, Text, render } from 'ink';
import stringWidth from 'string-width';
import { buildNodeCardLines, buildOverviewCardLines, getNodeCardColumns, moveNodeCardSelection } from '../src/lib/tui-cards.mjs';

const nodes = Array.from({ length: 16 }, (_, index) => ({
  id: `node-${index}`,
  label: `新加坡节点 ${index}`,
  protocolLabel: 'VLESS',
  delayLabel: `${index + 20}ms`,
  isCurrent: index === 15
}));

test('node cards keep the selected node visible at common terminal widths', () => {
  for (const width of [46, 80, 110]) {
    const lines = buildNodeCardLines({
      title: '节点', items: nodes, selectedId: 'node-15', width, height: 18, emptyText: '无节点'
    });
    assert.equal(lines.length, 18);
    assert.ok(lines.some((line) => line.text.includes('新加坡节点 15')));
    assert.ok(lines.some((line) => line.text.includes('VLESS')));
    assert.ok(lines.some((line) => line.text.includes('35ms')));
    assert.ok(lines.every((line) => stringWidth(line.text) <= width));
  }
});

test('only the cursor card is highlighted, not its row neighbour', () => {
  for (const selectedId of ['left', 'right']) {
    const lines = buildNodeCardLines({
      title: '节点',
      items: [
        { id: 'left', label: '左侧节点', protocolLabel: 'SS', delayLabel: '--' },
        { id: 'right', label: '右侧节点', protocolLabel: 'VLESS', delayLabel: '42ms' }
      ],
      selectedId, width: 80, height: 7, emptyText: '无节点'
    });
    const cardLines = lines.filter((line) => line.segments);
    assert.equal(cardLines.length, 5);
    for (const line of cardLines) {
      assert.equal(line.tone, 'normal');
      assert.equal(line.segments.filter((segment) => segment.tone === 'selected').length, 1);
      assert.equal(line.segments.map((segment) => segment.text).join(''), line.text);
      assert.equal(stringWidth(line.text), 80);
    }
    const title = cardLines[1];
    assert.match(title.segments.find((segment) => segment.tone === 'selected').text, /► /);
    assert.ok(!title.text.includes('光标'));
    assert.ok(!title.segments.find((segment) => segment.text.includes(selectedId === 'left' ? '右侧节点' : '左侧节点')).text.includes('►'));
    assert.match(cardLines[0].segments.find((segment) => segment.tone === 'selected').text, /^╔═/);
  }
});

test('current node and cursor remain distinct without relying on colour', () => {
  const items = [
    { id: 'current', label: '正在使用', protocolLabel: 'SS', delayLabel: '50ms', isCurrent: true },
    { id: 'cursor', label: '待选择', protocolLabel: 'VLESS', delayLabel: '--', isCurrent: false }
  ];
  const separate = buildNodeCardLines({ title: '节点', items, selectedId: 'cursor', width: 80, height: 7 });
  assert.ok(separate.some((line) => line.text.includes('► 待选择')));
  assert.ok(separate.some((line) => line.segments?.some((segment) => segment.tone === 'active' && segment.text.includes('● 使用中'))));
  assert.match(separate[1].segments[0].text, /^┏━/);

  const combined = buildNodeCardLines({ title: '节点', items, selectedId: 'current', width: 80, height: 7 });
  assert.ok(combined.some((line) => line.text.includes('► 正在使用')));
  assert.ok(combined.some((line) => line.segments?.some((segment) => segment.tone === 'selected' && segment.text.includes('● 使用中'))));
});

test('card segment widths stay aligned in a single column and incomplete last row', () => {
  for (const width of [12, 46, 73, 80, 111]) {
    const lines = buildNodeCardLines({ title: '节点', items: nodes.slice(0, 3), selectedId: 'node-2', width, height: 18 });
    for (const line of lines) {
      assert.equal(stringWidth(line.text), width);
      if (line.segments) {
        assert.equal(line.segments.map((segment) => segment.text).join(''), line.text);
      }
    }
  }
});

test('overview cards scroll without exceeding a narrow or short panel', () => {
  const cards = Array.from({ length: 6 }, (_, index) => ({ title: `卡片 ${index}`, lines: ['状态', '信息'] }));
  for (const width of [50, 78, 115]) {
    const first = buildOverviewCardLines({ cards, width, height: 12 });
    const last = buildOverviewCardLines({ cards, width, height: 12, offset: 999 });
    assert.equal(first.lines.length, 12);
    assert.equal(last.lines.length, 12);
    assert.ok(first.maxScroll > 0);
    assert.ok(last.lines.some((line) => line.text.includes('卡片 5')));
    assert.ok(last.lines.every((line) => stringWidth(line.text) <= width));
  }
});

test('node card columns adapt independently of the unchanged overview layout', () => {
  assert.deepEqual([30, 65, 98, 131, 200].map(getNodeCardColumns), [1, 2, 3, 4, 4]);
  const lines = buildNodeCardLines({ title: '节点', items: nodes, selectedId: 'node-2', width: 110, height: 7 });
  assert.equal(lines[1].segments.filter((segment) => segment.text.includes('╭') || segment.text.includes('╔')).length, 3);
});

test('node card arrows move by the same columns rendered and clamp at the ends', () => {
  assert.equal(moveNodeCardSelection(nodes, 'node-1', 'down', 110), 'node-4');
  assert.equal(moveNodeCardSelection(nodes, 'node-4', 'up', 110), 'node-1');
  assert.equal(moveNodeCardSelection(nodes, 'node-4', 'left', 110), 'node-3');
  assert.equal(moveNodeCardSelection(nodes, 'node-4', 'right', 110), 'node-5');
  assert.equal(moveNodeCardSelection(nodes, 'node-0', 'up', 110), 'node-0');
  assert.equal(moveNodeCardSelection(nodes, 'node-2', 'up', 110), 'node-2');
  assert.equal(moveNodeCardSelection(nodes, 'node-15', 'down', 110), 'node-15');
  assert.equal(moveNodeCardSelection(nodes.slice(0, 15), 'node-13', 'down', 110), 'node-13');
  assert.equal(moveNodeCardSelection(nodes, 'node-4', 'down', 110, { compact: true }), 'node-5');
  assert.equal(moveNodeCardSelection([], null, 'right', 80), null);
});

test('read-only subscription notices and current node stay separate from highlighted cards', () => {
  const notices = ['剩余: 26.98 GB, 到期: 2026-11-15', '邀请返佣40%', '请关注网站首页的公告信息'];
  const lines = buildNodeCardLines({
    title: '节点', items: nodes, selectedId: 'node-15', width: 110, height: 20,
    notices, noticesExpanded: true, currentNodeLabel: '新加坡节点 15'
  });
  assert.ok(lines.some((line) => line.text.includes('当前使用：新加坡节点 15')));
  assert.ok(lines.some((line) => line.text.includes('只读')));
  for (const notice of notices) {
    const line = lines.find((item) => item.text.includes(notice));
    assert.ok(line);
    assert.equal(line.tone, 'dim');
    assert.equal(line.segments, undefined);
  }
  assert.ok(lines.some((line) => line.segments?.some((segment) => segment.text.includes('► 新加坡节点 15'))));
});

test('node panels fit tiny heights and widths while keeping the selected item visible', () => {
  for (const width of [4, 12, 46, 65, 98, 131]) {
    for (const height of [2, 3, 5, 6, 7, 8, 10, 12, 18]) {
      const lines = buildNodeCardLines({
        title: '节点', items: nodes, selectedId: 'node-15', width, height,
        notices: ['剩余流量 99GB', '套餐到期 2026-12-01', '邀请返佣40%', '请关注网站首页的公告信息'],
        noticesExpanded: true, currentNodeLabel: '新加坡节点 15'
      });
      assert.equal(lines.length, height);
      assert.ok(lines.every((line) => stringWidth(line.text) === width));
      assert.ok(lines.some((line) => line.tone === 'selected' || line.segments?.some((segment) => segment.tone === 'selected')));
      for (const line of lines.filter((line) => line.segments)) {
        assert.equal(line.segments.map((segment) => segment.text).join(''), line.text);
      }
    }
  }
});

test('actual Ink node panels keep the cursor and card borders within terminal bounds', async () => {
  const items = nodes.map((node, index) => ({ ...node, label: `🇭🇰 香港节点 ${index}` }));
  for (const [width, height] of [[80, 22], [100, 22], [140, 22], [190, 22], [80, 7], [80, 4]]) {
    const chunks = [];
    const stdout = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk.toString()); callback(); } });
    stdout.columns = width;
    stdout.isTTY = false;
    const lines = buildNodeCardLines({
      title: '节点', items, selectedId: 'node-15', width: width - 4, height: height - 2,
      notices: ['剩余流量 99GB', '套餐到期 2026-12-01'], noticesExpanded: true, currentNodeLabel: '🇭🇰 香港节点 15'
    });
    const panel = React.createElement(Box, { width, height, flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
      lines.map((line, index) => React.createElement(Text, { key: index }, line.segments
        ? line.segments.map((segment, segmentIndex) => React.createElement(Text, { key: segmentIndex }, segment.text))
        : line.text)));
    const app = render(panel, { stdout, stdin: new PassThrough(), stderr: stdout, debug: true, patchConsole: false, exitOnCtrlC: false });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const frame = chunks.at(-1).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trimEnd().split('\n');
      assert.equal(frame.length, height);
      assert.ok(frame.every((line) => stringWidth(line) <= width), `${width}x${height}: overflow`);
      assert.ok(frame.some((line) => line.includes('►') && line.includes('香港节点 15')), `${width}x${height}: hidden cursor`);
    } finally {
      app.unmount();
      app.cleanup();
    }
  }
});
