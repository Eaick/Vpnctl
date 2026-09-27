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
