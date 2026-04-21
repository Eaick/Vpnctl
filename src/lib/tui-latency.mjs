import { getVisibleWindow, resolveSelectedIndex } from './tui-layout.mjs';

export function getVisibleLatencyTargets(nodes, selectedNodeId, viewportHeight, cache = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const selectedIndex = resolveSelectedIndex(nodes, selectedNodeId);
  const windowed = getVisibleWindow(nodes, selectedIndex, viewportHeight);

  return windowed.items
    .filter((node) => typeof cache[node.id] !== 'number')
    .map((node) => node.id);
}
