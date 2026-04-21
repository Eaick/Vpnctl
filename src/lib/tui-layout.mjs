import cliTruncate from 'cli-truncate';
import stringWidth from 'string-width';

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function getLayoutMode(width) {
  if (width < 90) return 'single';
  if (width < 120) return 'compact';
  return 'split';
}

export function getProviderPaneWidth(width) {
  const mode = getLayoutMode(width);
  if (mode === 'single') return width;
  if (mode === 'compact') return 24;
  return 32;
}

export function getViewportHeights(height) {
  const top = 5;
  const bottom = 3;
  const middle = Math.max(1, height - top - bottom);

  return { top, middle, bottom };
}

export function truncateText(text, width) {
  const value = String(text ?? '');
  if (width <= 0) return '';
  if (stringWidth(value) <= width) return value;
  if (width === 1) return '.';
  return cliTruncate(value, width, { position: 'end' });
}

export function padText(text, width) {
  const truncated = truncateText(text, width);
  const missingWidth = Math.max(0, width - stringWidth(truncated));
  return `${truncated}${' '.repeat(missingWidth)}`;
}

export function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase();
}

export function filterItems(items, query, labelGetter = (item) => item?.label || '') {
  const normalized = normalizeQuery(query);
  if (!normalized) return items;

  return items.filter((item) => labelGetter(item).toLowerCase().includes(normalized));
}

export function filterNodesByProtocol(items, protocol = 'all') {
  const normalized = normalizeQuery(protocol);
  if (!normalized || normalized === 'all') return items;
  return items.filter((item) => normalizeQuery(item?.protocol) === normalized);
}

export function resolveSelectedIndex(items, selectedId, fallbackIndex = 0) {
  if (!items.length) return 0;
  const index = items.findIndex((item) => item.id === selectedId);
  if (index >= 0) return index;
  return clamp(fallbackIndex, 0, items.length - 1);
}

export function getVisibleWindow(items, selectedIndex, viewportHeight) {
  const safeHeight = Math.max(1, viewportHeight);
  if (items.length <= safeHeight) {
    return { start: 0, end: items.length, items };
  }

  const safeIndex = clamp(selectedIndex, 0, items.length - 1);
  let start = Math.max(0, safeIndex - Math.floor(safeHeight / 2));
  if (start + safeHeight > items.length) {
    start = items.length - safeHeight;
  }

  const end = start + safeHeight;
  return {
    start,
    end,
    items: items.slice(start, end)
  };
}

export function moveSelection(currentIndex, direction, itemCount) {
  if (itemCount <= 0) return 0;
  return clamp(currentIndex + direction, 0, itemCount - 1);
}

export function getStatusDensity(height) {
  return height < 26 ? 'compact' : 'full';
}
