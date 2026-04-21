import fs from 'node:fs/promises';
import { createConfig } from './lib/config.mjs';
import { info, ok, warn, title, printJson } from './lib/render.mjs';
import {
  buildShellExports,
  installShellIntegration,
  uninstallShellIntegration,
  printShellIntegration,
  detectShellIntegration
} from './lib/shell.mjs';
import { ensureMihomoInstalled, getMihomoInstallHint } from './lib/prereq.mjs';
import {
  probeConfiguredPortPlan,
  listBusyEndpoints,
  findAvailablePortPlan,
  buildPortEnvSnippet,
  getPortSourceLabel
} from './lib/ports.mjs';
import {
  getVersion,
  getGroups,
  getGroupByName,
  getCurrentNode,
  chooseNode,
  testProxyDelay,
  switchByCountry,
  isApiAlive
} from './lib/mihomo.mjs';
import {
  readPid,
  isPidAlive,
  startDetached,
  stopByPid,
  removePidFile,
  tailLogHint,
  fileExists
} from './lib/process.mjs';
import {
  initializeRuntimeWithOptions,
  cleanSandboxRuntime,
  summarizeRuntime,
  setConfiguredPorts
} from './lib/install.mjs';
import {
  loadSubscriptions,
  addSubscriptionFromUrl,
  addSubscriptionFromFile,
  activateSubscription,
  removeSubscription,
  syncSubscriptions,
  writeManagedConfig
} from './lib/subscriptions.mjs';
import {
  migrateOldInstall,
  detectOldInstall,
  summarizeMigrationState
} from './lib/migration.mjs';
import { listKnownRuntimeLocks } from './lib/runtime-lock.mjs';
import { formatInitProgressLine } from './lib/init-progress.mjs';
import { applyManagedConfigToRuntime } from './lib/runtime-apply.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePortArgs({ httpPort, socksPort, apiPort } = {}) {
  return {
    ...(httpPort ? { http: Number(httpPort) } : {}),
    ...(socksPort ? { socks: Number(socksPort) } : {}),
    ...(apiPort ? { api: Number(apiPort) } : {})
  };
}

async function buildPortConflictMessage(currentConfig, { apiAlive = false } = {}) {
  const probed = await probeConfiguredPortPlan(currentConfig);
  const busy = listBusyEndpoints(probed);
  if (busy.length === 0 || apiAlive) return '';

  const lines = ['Configured ports are busy:'];
  for (const endpoint of busy) {
    lines.push(`- ${endpoint.name}: ${endpoint.host}:${endpoint.port}`);
  }

  const recommended = await findAvailablePortPlan(currentConfig, {
    maxOffset: currentConfig.mode === 'dev' ? 8 : 5
  });

  if (recommended) {
    lines.push('');
    lines.push('Recommended free ports:');
    lines.push(buildPortEnvSnippet(recommended));
  } else {
    lines.push('');
    lines.push('No automatic port recommendation found.');
  }

  return lines.join('\n');
}

function renderSubscriptionLine(item) {
  const synced = item.lastSyncedAt || 'never';
  return `- ${item.displayName} | ${item.enabled ? 'active' : 'resting'} | ${item.type} | ${item.id} | nodes:${item.nodeCount || 0} | sync:${item.syncStatus || 'pending'} | updated:${synced}`;
}

async function writeAndApply(currentConfig) {
  await writeManagedConfig(currentConfig);
  return applyManagedConfigToRuntime(currentConfig);
}

export async function cmdInit({
  mode = 'user',
  skipDownload = false,
  httpPort,
  socksPort,
  apiPort
} = {}) {
  title(mode === 'dev' ? 'Initialize VPNCTL sandbox' : 'Initialize VPNCTL');
  const seenSteps = new Set();
  const result = await initializeRuntimeWithOptions({
    mode,
    skipDownload,
    ports: normalizePortArgs({ httpPort, socksPort, apiPort }),
    onProgress(step) {
      if (step.status === 'done' || step.status === 'failed') {
        console.log(formatInitProgressLine(step));
      } else if (step.status === 'running' && !seenSteps.has(step.id)) {
        seenSteps.add(step.id);
        console.log(formatInitProgressLine(step));
      }
    }
  });

  console.log(`mode: ${result.config.mode}`);
  console.log(`root: ${result.config.paths.root}`);
  console.log(`mihomo bin: ${result.config.mihomoBin}`);
  console.log(`config file: ${result.config.generatedConfigFile}`);
  console.log(`subscriptions: ${result.config.subscriptionsFile}`);
  console.log(`log file: ${result.config.logFile}`);
  console.log(`port source: ${getPortSourceLabel(result.config.portSource)}`);
  console.log('');
  console.log(result.portSnippet);

  if (result.downloaded) {
    ok(`mihomo installed: ${result.assetName}`);
  } else {
    warn('mihomo download skipped; a placeholder binary was created.');
  }
}

export async function cmdUpgrade({
  mode = 'user',
  skipDownload = false
} = {}) {
  title('Upgrade from vpnctl Old');
  const result = await migrateOldInstall({ mode, skipDownload });
  ok(`legacy root: ${result.report.sourcePath}`);
  ok(`imported subscriptions: ${result.report.importedSubscriptions}`);
  ok(`migration report: ${result.reportFile}`);
}

export async function cmdMigrateOld(options = {}) {
  await cmdUpgrade(options);
}

export async function cmdDevClean() {
  title('Clean dev sandbox');
  const root = await cleanSandboxRuntime();
  ok(`sandbox removed: ${root}`);
}

export async function cmdStart() {
  const currentConfig = createConfig();
  title(`Start mihomo (${currentConfig.mode})`);
  await ensureMihomoInstalled();
  await ensureSubscriptionStore(currentConfig);
  await writeManagedConfig(currentConfig);

  const pid = await readPid();
  const apiAlive = await isApiAlive();
  const pidAlive = await isPidAlive(pid);

  if (apiAlive && pidAlive) {
    ok(`mihomo already running with pid=${pid}`);
    return;
  }

  if (apiAlive && !pidAlive) {
    warn('mihomo API is responding but pid file is stale.');
    return;
  }

  const portConflictMessage = await buildPortConflictMessage(currentConfig, { apiAlive });
  if (portConflictMessage) {
    throw new Error(portConflictMessage);
  }

  const newPid = await startDetached();
  await sleep(1200);

  if (await isApiAlive()) {
    ok(`mihomo started with pid=${newPid}`);
  } else {
    warn(`mihomo did not become ready. Check logs: ${await tailLogHint()}`);
  }
}

export async function cmdStop() {
  title('Stop mihomo');
  const pid = await readPid();
  if (!pid) {
    warn('No pid file found.');
    return;
  }

  const alive = await isPidAlive(pid);
  if (!alive) {
    warn('pid file exists but process is not alive. Removing stale pid file.');
    await removePidFile();
    return;
  }

  await stopByPid(pid, { force: false });
  await sleep(800);

  if (await isPidAlive(pid)) {
    warn('SIGTERM did not stop mihomo. Escalating to SIGKILL.');
    await stopByPid(pid, { force: true });
    await sleep(300);
  }

  await removePidFile();
  ok(`mihomo stopped: pid=${pid}`);
}

export async function cmdRestart() {
  await cmdStop();
  await cmdStart();
}

export async function cmdStatus() {
  const currentConfig = createConfig();
  title('Runtime status');
  const subscriptions = await loadSubscriptions(currentConfig);
  const apiAlive = await isApiAlive();
  const pid = await readPid();
  const pidAlive = await isPidAlive(pid);

  console.log(`mode: ${currentConfig.mode}`);
  console.log(`initialized: ${currentConfig.isInitialized}`);
  console.log(`api alive: ${apiAlive}`);
  console.log(`pid: ${pid || 'none'}`);
  console.log(`pid alive: ${pidAlive}`);
  console.log(`default group: ${currentConfig.defaultGroup}`);
  console.log(`http proxy: ${currentConfig.httpProxy}`);
  console.log(`socks proxy: ${currentConfig.socksProxy}`);
  console.log(`port source: ${getPortSourceLabel(currentConfig.portSource)}`);
  console.log(`subscriptions: ${subscriptions.length}`);

  if (apiAlive) {
    const version = await getVersion();
    console.log(`version: ${JSON.stringify(version)}`);
    const current = await getCurrentNode(currentConfig.defaultGroup);
    console.log(`current node: ${current || 'none'}`);
  }
}

export async function cmdGroups() {
  title('Proxy groups');
  const groups = await getGroups();
  for (const group of groups) {
    console.log(`- ${group.name} | current: ${group.now || 'none'} | candidates: ${group.all?.length || 0}`);
  }
}

export async function cmdSwitch(group, node) {
  title('Switch node');
  await chooseNode(group, node);
  ok(`${group} -> ${node}`);
}

export async function cmdSwitchCountry(keyword, group = createConfig().defaultGroup) {
  title('Switch by country');
  const result = await switchByCountry(keyword, group);
  ok(`${result.group} -> ${result.node}`);
  info(`matched candidates: ${result.candidates.length}`);
}

export async function cmdDelay({ group, proxy, url, timeout } = {}) {
  const currentConfig = createConfig();
  title('Node delay');
  let target = proxy;

  if (!target && group) {
    target = await getCurrentNode(group);
  }

  if (!target) {
    target = await getCurrentNode(currentConfig.defaultGroup);
  }

  if (!target) {
    throw new Error('No target node selected.');
  }

  const result = await testProxyDelay(target, {
    url: url || 'https://www.gstatic.com/generate_204',
    timeout: timeout ? Number(timeout) : 5000
  });

  ok(`delay tested for ${target}`);
  printJson(result);
}

export async function cmdEnv({ shell = 'bash', quiet = false } = {}) {
  process.stdout.write(await buildShellExports({ shell, quiet }));
}

export async function cmdDoctor() {
  const currentConfig = createConfig();
  title('Doctor');
  const runtime = summarizeRuntime(currentConfig);
  const subscriptions = await loadSubscriptions(currentConfig);
  const apiAlive = await isApiAlive();
  const migration = await summarizeMigrationState(currentConfig);
  const shellIntegration = await detectShellIntegration().catch(() => ({
    installed: false,
    bashrcPath: '',
    codexWrapper: false
  }));
  const runtimeLocks = await listKnownRuntimeLocks();

  console.log(`mode: ${runtime.mode}`);
  console.log(`initialized: ${runtime.initialized}`);
  console.log(`root: ${runtime.root}`);
  console.log(`mihomo bin: ${runtime.mihomoBin}`);
  console.log(`config dir: ${runtime.configDir}`);
  console.log(`data dir: ${runtime.dataDir}`);
  console.log(`mihomo api: ${currentConfig.mihomoApi}`);
  console.log(`log file: ${currentConfig.logFile}`);
  console.log(`pid file: ${currentConfig.pidFile}`);
  console.log(`lock file: ${currentConfig.lockFile}`);
  console.log(`default group: ${currentConfig.defaultGroup}`);
  console.log(`theme: ${currentConfig.theme}`);
  console.log(`http proxy: ${currentConfig.httpProxy}`);
  console.log(`socks proxy: ${currentConfig.socksProxy}`);
  console.log(`subscriptions: ${subscriptions.length}`);
  console.log(`port source: ${getPortSourceLabel(currentConfig.portSource)}`);
  console.log(`shell integration: ${shellIntegration.installed}`);
  console.log(`shell integration path: ${shellIntegration.bashrcPath || 'none'}`);
  console.log(`codex wrapper: ${shellIntegration.codexWrapper}`);
  const sessionReuse = shellIntegration.installed && shellIntegration.codexWrapper
    ? (apiAlive ? 'ready' : 'waiting-for-mihomo')
    : 'not-ready';
  console.log(`session reuse: ${sessionReuse}`);
  console.log(`old install detected: ${migration.oldInstallDetected}`);
  console.log(`migration status: ${migration.migrationStatus}`);
  console.log(`migration source path: ${migration.sourcePath || 'none'}`);
  console.log(`runtime locks: ${runtimeLocks.length}`);
  console.log('latency mode: visible-window');

  const binaryExists = await fileExists(currentConfig.mihomoBin);
  console.log(`binary exists: ${binaryExists}`);
  console.log(`log exists: ${await fileExists(currentConfig.logFile)}`);
  console.log(`api alive: ${apiAlive}`);

  if (!binaryExists) {
    warn(getMihomoInstallHint());
  }

  const probedPorts = await probeConfiguredPortPlan(currentConfig);
  console.log(`api port free: ${probedPorts.api.available}`);
  console.log(`http port free: ${probedPorts.http.available}`);
  console.log(`socks port free: ${probedPorts.socks.available}`);

  const portConflictMessage = await buildPortConflictMessage(currentConfig, { apiAlive });
  if (portConflictMessage) {
    warn(portConflictMessage);
  }

  if (sessionReuse === 'not-ready') {
    warn('Run vpnctl shell install --bashrc on the Linux server, then source ~/.bashrc.');
  } else if (sessionReuse === 'waiting-for-mihomo') {
    warn('Shell integration is ready. Start mihomo in one session first, then other same-account sessions can run codex directly.');
  } else {
    ok('Same-account session reuse is ready. New sessions can run codex directly.');
  }

  for (const lock of runtimeLocks) {
    console.log(`lock: ${lock.mode} | ${lock.root} | http=${lock.ports.http} socks=${lock.ports.socks} api=${lock.ports.api}`);
  }

  for (const item of subscriptions) {
    console.log(renderSubscriptionLine(item));
  }

  const group = await getGroupByName(currentConfig.defaultGroup).catch(() => null);
  console.log(`default group exists: ${Boolean(group)}`);
  if (group) {
    console.log(`current node: ${group.now || 'none'}`);
    console.log(`candidate count: ${group.all?.length || 0}`);
  }

  if (await fileExists(currentConfig.logFile)) {
    const log = await fs.readFile(currentConfig.logFile, 'utf8').catch(() => '');
    const tail = log.split('\n').slice(-20).join('\n');
    console.log('\n--- log tail ---');
    console.log(tail);
  } else {
    warn(`Log file not found. Tail hint: ${await tailLogHint()}`);
  }
}

export async function cmdAddSub({ url, file, name } = {}) {
  const currentConfig = createConfig();
  title('Add subscription');
  await ensureSubscriptionStore(currentConfig);

  let created = null;
  if (url) {
    created = await addSubscriptionFromUrl(url, name, currentConfig);
  } else if (file) {
    created = await addSubscriptionFromFile(file, name, currentConfig);
  } else {
    throw new Error('add-sub requires --url or --file');
  }

  const applied = await writeAndApply(currentConfig);
  ok(`${created.displayName} (${created.id})`);
  info(applied.message);
}

export async function cmdListSubs() {
  const currentConfig = createConfig();
  title('Subscriptions');
  const subscriptions = await loadSubscriptions(currentConfig);
  if (!subscriptions.length) {
    warn('No subscriptions found. Use vpnctl add-sub.');
    return;
  }

  for (const item of subscriptions) {
    console.log(renderSubscriptionLine(item));
  }
}

export async function cmdSync({ id } = {}) {
  const currentConfig = createConfig();
  title('Sync subscriptions');
  const results = await syncSubscriptions({ id }, currentConfig);
  const applied = await applyManagedConfigToRuntime(currentConfig);
  if (!results.length) {
    warn('No enabled subscriptions to sync.');
    return;
  }
  for (const item of results) {
    if (item.ok) {
      ok(`${item.displayName} | nodes ${item.nodeCount}`);
    } else {
      warn(`${item.displayName} | ${item.error}`);
    }
  }
  info(applied.message);
}

export async function cmdRemoveSub({ id } = {}) {
  if (!id) throw new Error('remove-sub requires --id');
  title('Remove subscription');
  const currentConfig = createConfig();
  const removed = await removeSubscription(id, currentConfig);
  const applied = await writeAndApply(currentConfig);
  ok(`${removed.displayName} (${removed.id})`);
  info(applied.message);
}

export async function cmdConfigSetPorts({ http, socks, api } = {}) {
  title('Set ports');
  const result = await setConfiguredPorts({
    ports: {
      ...(http ? { http } : {}),
      ...(socks ? { socks } : {}),
      ...(api ? { api } : {})
    },
    reason: 'custom'
  });
  await writeManagedConfig(result.config);
  console.log(`port source: ${getPortSourceLabel(result.portSource)}`);
  console.log(result.portSnippet);
}

export async function cmdShellInstall({ bashrcPath } = {}) {
  title('Install bash integration');
  const result = await installShellIntegration({
    bashrcPath
  });
  ok(`bashrc updated: ${result.bashrcPath}`);
  info('same-account sessions can now run codex directly and reuse a running VPN');
}

export async function cmdShellUninstall({ bashrcPath } = {}) {
  title('Remove bash integration');
  const result = await uninstallShellIntegration({
    bashrcPath
  });
  ok(`bashrc cleaned: ${result.bashrcPath}`);
}

export async function cmdShellPrint({ shell = 'bash' } = {}) {
  process.stdout.write(`${await printShellIntegration({ shell })}\n`);
}

export async function cmdDetectOld() {
  const legacy = await detectOldInstall();
  printJson(legacy || {});
}
