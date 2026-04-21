import fs from 'node:fs/promises';
import path from 'node:path';
import { createConfig } from './config.mjs';
import { getLegacyCandidateRoots } from './runtime.mjs';
import {
  initializeRuntimeWithOptions,
  saveInstallState
} from './install.mjs';
import {
  ensureSubscriptionStore,
  importSubscriptions,
  loadSubscriptions,
  writeManagedConfig
} from './subscriptions.mjs';

async function readJson(filepath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filepath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

function buildLegacyPaths(root) {
  return {
    root,
    installFile: path.join(root, 'install.json'),
    subscriptionsFile: path.join(root, 'data', 'subscriptions.json')
  };
}

function normalizeLegacySubscriptions(items = []) {
  return items
    .filter((item) => item && item.source)
    .map((item) => ({
      type: item.type === 'local' ? 'local' : 'remote',
      source: item.source,
      displayName: item.displayName || '',
      contentHash: item.contentHash || '',
      lastSyncedAt: item.lastSyncedAt || '',
      enabled: item.enabled !== false,
      nodes: Array.isArray(item.nodes) ? item.nodes.map((node) => ({
        name: String(node?.name || '').trim(),
        protocol: String(node?.protocol || 'unknown').trim() || 'unknown'
      })).filter((node) => node.name) : [],
      nodeNames: Array.isArray(item.nodeNames) ? [...item.nodeNames] : [],
      nodeCount: Number(item.nodeCount || 0),
      syncStatus: item.syncStatus || 'pending',
      syncError: item.syncError || ''
    }));
}

export async function detectOldInstall() {
  for (const root of getLegacyCandidateRoots()) {
    const paths = buildLegacyPaths(root);
    if (!await fileExists(paths.installFile)) continue;

    const installState = await readJson(paths.installFile, null);
    const subscriptions = await readJson(paths.subscriptionsFile, []);

    return {
      root,
      installState,
      subscriptions
    };
  }

  return null;
}

export async function backupMigrationState(currentConfig = createConfig()) {
  const backupDir = path.join(
    currentConfig.paths.migrationDir,
    `migration-${Date.now()}`
  );
  await fs.mkdir(backupDir, { recursive: true });

  const artifacts = [];
  for (const file of [currentConfig.installFile, currentConfig.subscriptionsFile]) {
    if (!await fileExists(file)) continue;
    const target = path.join(backupDir, path.basename(file));
    await fs.copyFile(file, target);
    artifacts.push(target);
  }

  return { backupDir, artifacts };
}

export async function migrateOldInstall({
  mode = 'user',
  skipDownload = false
} = {}) {
  const legacy = await detectOldInstall();
  if (!legacy) {
    throw new Error('No vpnctl Old installation was detected.');
  }

  const legacyPorts = legacy.installState?.ports || {};
  const runtime = await initializeRuntimeWithOptions({
    mode,
    skipDownload,
    ports: legacyPorts,
    theme: legacy.installState?.theme,
    defaultGroup: legacy.installState?.defaultGroup
  });
  const currentConfig = createConfig(mode);
  const backup = await backupMigrationState(currentConfig);

  await ensureSubscriptionStore(currentConfig);
  const imported = await importSubscriptions(
    normalizeLegacySubscriptions(legacy.subscriptions),
    currentConfig
  );

  const nextState = {
    ...(currentConfig.installState || runtime.installState),
    defaultGroup: legacy.installState?.defaultGroup || currentConfig.defaultGroup,
    theme: legacy.installState?.theme || currentConfig.theme,
    portSource: 'migrated',
    shellIntegration: currentConfig.installState?.shellIntegration || { bashrc: false, bashrcPath: '', codexWrapper: false },
    migration: {
      status: 'migrated',
      sourcePath: legacy.root,
      migratedAt: new Date().toISOString()
    },
    legacyMihomoBin: legacy.installState?.mihomoBin || '',
    legacyRoot: legacy.root
  };

  await saveInstallState(currentConfig, nextState);
  await writeManagedConfig(currentConfig);

  const report = {
    mode,
    sourcePath: legacy.root,
    importedSubscriptions: imported.imported.length,
    skippedSubscriptions: imported.skipped.length,
    backupDir: backup.backupDir,
    migratedAt: new Date().toISOString()
  };

  const reportFile = path.join(backup.backupDir, 'migration-report.json');
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');

  return {
    runtime,
    legacy,
    report,
    reportFile
  };
}

export async function summarizeMigrationState(currentConfig = createConfig()) {
  const legacy = await detectOldInstall();
  const subscriptions = await loadSubscriptions(currentConfig);
  return {
    oldInstallDetected: Boolean(legacy),
    migrationStatus: currentConfig.migration?.status || 'none',
    sourcePath: currentConfig.migration?.sourcePath || legacy?.root || '',
    subscriptionCount: subscriptions.length
  };
}
