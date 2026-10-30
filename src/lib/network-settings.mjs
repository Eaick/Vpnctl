import { createConfig } from './config.mjs';
import { saveInstallState } from './install.mjs';
import { writeManagedConfig } from './subscriptions.mjs';
import { applyManagedConfigToRuntime } from './runtime-apply.mjs';

export async function setIpv6Enabled(enabled, { confirmed = false, config = createConfig(),
  save = saveInstallState, write = writeManagedConfig, apply = applyManagedConfigToRuntime } = {}) {
  if (!confirmed || typeof enabled !== 'boolean') throw new Error('请确认 IPv6 设置');
  if (!config.installState) throw new Error('请先初始化 VPNCTL');
  const next = { ...config, ipv6: enabled, installState: { ...config.installState, ipv6: enabled } };
  try {
    await save(next, next.installState);
    await write(next);
    await apply(next);
    return { message: `IPv6 已${enabled ? '开启' : '关闭'}；实际连接能力取决于服务器和节点网络。` };
  } catch (error) {
    try { await save(config, config.installState); await write(config); await apply(config); }
    catch { throw new Error('IPv6 设置失败，恢复旧配置也未完成，请检查运行状态', { cause: error }); }
    throw new Error('IPv6 设置失败，已恢复旧配置', { cause: error });
  }
}
