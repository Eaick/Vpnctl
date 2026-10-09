const NOTICE_PATTERNS = [
  /^剩余(?:流量)?\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:[KMGT]i?B|[KMGT]|字节)/i,
  /^(?:套餐到期|到期时间|距离下次重置剩余)\s*[:：]?\s*\d/,
  /^邀请返佣\s*\d+(?:\.\d+)?\s*%/,
  /^有问题重新从网站获取订阅$/,
  /^请关注网站首页的公告信息$/,
  /^最新网址\s*[:：]?\s*https?:\/\//i
];

export function isNodeNotice(node) {
  const label = String(node?.label ?? node?.name ?? '').trim();
  return NOTICE_PATTERNS.some((pattern) => pattern.test(label));
}

export function getSelectableNodes(provider) {
  // 仅分离显示用途的条目，不改写内核中的节点名或订阅内容。
  return (provider?.nodes || []).filter((node) => !isNodeNotice(node));
}

export function getNodeNotices(provider, subscriptions = []) {
  if (!provider) return [];
  const subscription = subscriptions.find((item) => item.displayName === provider.label);
  const notices = [...(subscription?.nodes || []), ...(provider.nodes || [])]
    .filter(isNodeNotice)
    .map((node) => String(node.label ?? node.name).trim());
  return [...new Set(notices)];
}
