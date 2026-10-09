import { getVisibleWindow, padText } from './tui-layout.mjs';

export function getNodeCardColumns(width) {
  return Math.max(1, Math.min(4, Math.floor((width + 1) / 33)));
}

export function moveNodeCardSelection(items, selectedId, direction, width, { compact = false } = {}) {
  if (!items.length) return null;
  const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const columns = compact ? 1 : getNodeCardColumns(width);
  if (direction === 'up' && index < columns) return items[index].id;
  if (direction === 'down' && Math.floor(index / columns) === Math.floor((items.length - 1) / columns)) return items[index].id;
  const step = direction === 'up' ? -columns : direction === 'down' ? columns : direction === 'left' ? -1 : 1;
  return items[Math.max(0, Math.min(items.length - 1, index + step))].id;
}

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

export function buildNodeCardLines({ title, items, selectedId, width, height, emptyText, notices = [], noticesExpanded = false, currentNodeLabel }) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const columns = getNodeCardColumns(safeWidth);
  const lines = [{ text: padText(title, safeWidth), tone: 'accent' }];
  if (currentNodeLabel !== undefined && safeHeight >= 8) {
    lines.push({ text: padText(`当前使用：${currentNodeLabel || '未选择'} · Enter 切换节点`, safeWidth), tone: 'active' });
  }
  if (notices.length && safeHeight >= 10) {
    const limit = noticesExpanded ? Math.max(1, Math.floor((safeHeight - 8) / 2)) : 1;
    const shown = notices.slice(0, limit);
    lines.push({ text: padText(`订阅提示 (${notices.length}) · v ${noticesExpanded ? '收起' : '展开'} · 只读`, safeWidth), tone: 'accent' });
    for (const notice of shown) lines.push({ text: padText(notice, safeWidth), tone: 'dim' });
    if (shown.length < notices.length && noticesExpanded) {
      lines.push({ text: padText(`另有 ${notices.length - shown.length} 条提示，终端加高可查看更多`, safeWidth), tone: 'dim' });
    }
  }
  const bodyHeight = safeHeight - lines.length;
  if (bodyHeight < 5 || safeWidth < 12) {
    const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
    for (const item of getVisibleWindow(items, index, bodyHeight).items.slice(0, Math.max(0, bodyHeight))) {
      lines.push({
        text: padText(`${item.id === selectedId ? '►' : ' '} ${item.isCurrent ? '● ' : ''}${item.label} · ${item.protocolLabel} · ${item.delayLabel}`, safeWidth),
        tone: item.id === selectedId ? 'selected' : item.isCurrent ? 'active' : 'normal'
      });
    }
    if (!items.length && bodyHeight > 0) lines.push({ text: padText(emptyText, safeWidth), tone: 'dim' });
    while (lines.length < safeHeight) lines.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
    return lines.slice(0, safeHeight);
  }
  const rows = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const visibleRows = Math.max(1, Math.floor((bodyHeight + 1) / 6));
  const windowed = getVisibleWindow(rows, Math.floor(selectedIndex / columns), visibleRows);

  if (!items.length) {
    lines.push({ text: padText(emptyText, safeWidth), tone: 'dim' });
  } else {
    for (const row of windowed.items) {
      const cards = row.map((item) => ({
        title: `${item.id === selectedId ? '► ' : ''}${item.label}`,
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
