import { getVisibleWindow, padText } from './tui-layout.mjs';

function cardColumns(width) {
  return width >= 72 ? 2 : 1;
}

function renderCard(card, width) {
  const inner = Math.max(1, width - 2);
  const top = `╭${'─'.repeat(inner)}╮`;
  const bottom = `╰${'─'.repeat(inner)}╯`;
  const content = [card.title, ...card.lines].slice(0, 3);
  while (content.length < 3) content.push('');
  return [top, ...content.map((line) => `│${padText(line, inner)}│`), bottom];
}

function renderGridRow(cards, width, columns) {
  const cardWidth = Math.max(12, Math.floor((width - columns + 1) / columns));
  const rendered = cards.map((card) => renderCard(card, cardWidth));
  return Array.from({ length: 5 }, (_, line) => padText(rendered.map((item) => item[line]).join(' '), width));
}

export function buildNodeCardLines({ title, items, selectedId, width, height, emptyText }) {
  const safeWidth = Math.max(12, width);
  const safeHeight = Math.max(1, height);
  const columns = cardColumns(safeWidth);
  const rows = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const visibleRows = Math.max(1, Math.floor((safeHeight - 1) / 6));
  const windowed = getVisibleWindow(rows, Math.floor(selectedIndex / columns), visibleRows);
  const lines = [{ text: padText(title, safeWidth), tone: 'accent' }];

  if (!items.length) {
    lines.push({ text: padText(emptyText, safeWidth), tone: 'dim' });
  } else {
    for (const row of windowed.items) {
      const cards = row.map((item) => ({
        title: `${item.id === selectedId ? '›' : ' '} ${item.isCurrent ? '●' : ' '} ${item.label}`,
        lines: [`协议 ${item.protocolLabel}`, `延迟 ${item.delayLabel}`]
      }));
      const tone = row.some((item) => item.id === selectedId) ? 'selected' : 'normal';
      lines.push(...renderGridRow(cards, safeWidth, columns).map((text) => ({ text, tone })));
      lines.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
    }
  }
  while (lines.length < safeHeight) lines.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
  return lines.slice(0, safeHeight);
}

export function buildOverviewCardLines({ cards, width, height, offset = 0 }) {
  const safeWidth = Math.max(12, width);
  const safeHeight = Math.max(1, height);
  const columns = cardColumns(safeWidth);
  const body = [];
  for (let index = 0; index < cards.length; index += columns) {
    body.push(...renderGridRow(cards.slice(index, index + columns), safeWidth, columns).map((text) => ({ text, tone: 'normal' })));
    if (index + columns < cards.length) body.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
  }
  const maxScroll = Math.max(0, body.length - Math.max(0, safeHeight - 1));
  const start = Math.min(Math.max(0, offset), maxScroll);
  const lines = [
    { text: padText(`总览卡片${maxScroll ? ' · ↑↓ 滚动' : ''}`, safeWidth), tone: 'accent' },
    ...body.slice(start, start + safeHeight - 1)
  ];
  while (lines.length < safeHeight) lines.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
  return { lines, maxScroll };
}
