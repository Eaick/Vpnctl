import { getVisibleWindow, padText } from './tui-layout.mjs';

function cardColumns(width) {
  return width >= 72 ? 2 : 1;
}

function renderCard(card, width) {
  const inner = Math.max(1, width - 2);
  const border = card.isSelected
    ? ['╔', '═', '╗', '║', '╚', '╝']
    : card.isCurrent
      ? ['┏', '━', '┓', '┃', '┗', '┛']
      : ['╭', '─', '╮', '│', '╰', '╯'];
  const top = `${border[0]}${border[1].repeat(inner)}${border[2]}`;
  const bottom = `${border[4]}${border[1].repeat(inner)}${border[5]}`;
  const content = [card.title, ...card.lines].slice(0, 3);
  while (content.length < 3) content.push('');
  return [top, ...content.map((line) => `${border[3]}${padText(line, inner)}${border[3]}`), bottom];
}

function renderGridRow(cards, width, columns) {
  const cardWidth = Math.max(12, Math.floor((width - columns + 1) / columns));
  const rendered = cards.map((card) => renderCard(card, cardWidth));
  return Array.from({ length: 5 }, (_, line) => {
    const segments = [];
    for (let index = 0; index < rendered.length; index += 1) {
      if (index) segments.push({ text: ' ', tone: 'normal' });
      segments.push({ text: rendered[index][line], tone: cards[index].tone || 'normal' });
    }
    const content = segments.map((segment) => segment.text).join('');
    const text = padText(content, width);
    segments.push({ text: text.slice(content.length), tone: 'normal' });
    return { text, tone: 'normal', segments };
  });
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
        title: `${item.id === selectedId ? '▶ 光标 ' : ''}${item.label}`,
        lines: [`${item.isCurrent ? '● 使用中 · ' : ''}协议 ${item.protocolLabel}`, `延迟 ${item.delayLabel}`],
        isSelected: item.id === selectedId,
        isCurrent: item.isCurrent,
        tone: item.id === selectedId ? 'selected' : item.isCurrent ? 'active' : 'normal'
      }));
      lines.push(...renderGridRow(cards, safeWidth, columns));
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
    body.push(...renderGridRow(cards.slice(index, index + columns), safeWidth, columns));
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
