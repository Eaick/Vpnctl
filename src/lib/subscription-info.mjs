import stringWidth from 'string-width';
import { padText } from './tui-layout.mjs';

export function parseSubscriptionUserinfo(header, sampledAt = new Date().toISOString()) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const info = { source: 'subscription-userinfo', sampledAt };
  for (const part of header.split(';')) {
    const match = part.trim().match(/^(upload|download|total|expire)\s*=\s*(\d+(?:\.\d+)?)$/i);
    if (!match) continue;
    const value = Math.trunc(Number(match[2]));
    if (Number.isSafeInteger(value) && value >= 0) info[match[1].toLowerCase()] = value;
  }
  return Object.keys(info).length > 2 ? info : null;
}

export function subscriptionDetailLines(subscription, width) {
  if (!subscription?.subscriptionInfo) return [];
  const rows = ['─'.repeat(Math.max(1, width))];
  for (const paragraph of subscriptionInfoLines(subscription)) {
    let row = '';
    for (const char of paragraph) {
      if (row && stringWidth(row + char) > width) { rows.push(row); row = ''; }
      row += char;
    }
    rows.push(row);
  }
  return rows.map(text => ({ text: padText(text, width), tone: 'dim' }));
}

const bytes = value => value === undefined ? '未提供' : `${(value / 1024 ** 3).toFixed(2)} GiB`;
export function subscriptionInfoLines(subscription) {
  const info = subscription?.subscriptionInfo;
  if (!info) return [];
  const used = info.upload !== undefined && info.download !== undefined ? info.upload + info.download : undefined;
  const total = info.total > 0 ? info.total : undefined;
  const remaining = used !== undefined && total !== undefined ? Math.max(0, total - used) : undefined;
  const ratio = remaining === undefined ? null : Math.max(0, Math.min(1, remaining / total));
  return [
    `流量：已用 ${bytes(used)} / 总量 ${bytes(total)} · 剩余 ${bytes(remaining)}`,
    ...(ratio === null ? [] : [`[${'#'.repeat(Math.round(ratio * 12))}${'-'.repeat(12 - Math.round(ratio * 12))}] ${(ratio * 100).toFixed(1)}% 剩余`]),
    `到期：${info.expire > 0 && info.expire <= 8640000000000 / 1000 ? new Date(info.expire * 1000).toISOString().slice(0, 10) : '未提供有效到期时间'}`,
    `采样：${info.sampledAt} · ${subscription.syncStatus === 'failed' ? '同步失败，旧数据' : info.stale ? '本次未取得响应头，旧数据' : '非实时额度'}`
  ];
}
