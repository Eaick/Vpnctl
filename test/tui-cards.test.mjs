import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import { buildNodeCardLines, buildOverviewCardLines } from '../src/lib/tui-cards.mjs';

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
    assert.match(title.segments.find((segment) => segment.tone === 'selected').text, /▶ /);
    assert.ok(!title.text.includes('光标'));
    assert.ok(!title.segments.find((segment) => segment.text.includes(selectedId === 'left' ? '右侧节点' : '左侧节点')).text.includes('▶'));
    assert.match(cardLines[0].segments.find((segment) => segment.tone === 'selected').text, /^╔═/);
  }
});

test('current node and cursor remain distinct without relying on colour', () => {
  const items = [
    { id: 'current', label: '正在使用', protocolLabel: 'SS', delayLabel: '50ms', isCurrent: true },
    { id: 'cursor', label: '待选择', protocolLabel: 'VLESS', delayLabel: '--', isCurrent: false }
  ];
  const separate = buildNodeCardLines({ title: '节点', items, selectedId: 'cursor', width: 80, height: 7 });
  assert.ok(separate.some((line) => line.text.includes('▶ 待选择')));
  assert.ok(separate.some((line) => line.segments?.some((segment) => segment.tone === 'active' && segment.text.includes('● 使用中'))));
  assert.match(separate[1].segments[0].text, /^┏━/);

  const combined = buildNodeCardLines({ title: '节点', items, selectedId: 'current', width: 80, height: 7 });
  assert.ok(combined.some((line) => line.text.includes('▶ 正在使用')));
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
