import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

function rewriteImportSpecifiers(code) {
  return code
    .replace(/(from\s+['"][^'"]+)\.(mjs|jsx)(['"])/g, '$1.js$3')
    .replace(/(import\s*\(\s*['"][^'"]+)\.(mjs|jsx)(['"]\s*\))/g, '$1.js$3');
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function ensureParent(filepath) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
}

async function buildFile(filepath) {
  const relativePath = path.relative(srcDir, filepath);
  const outputRelativePath = relativePath.replace(/\.(mjs|jsx)$/i, '.js');
  const outputPath = path.join(distDir, outputRelativePath);
  const source = await fs.readFile(filepath, 'utf8');
  const shebang = source.startsWith('#!') ? source.split('\n')[0] : '';
  const body = shebang ? source.slice(shebang.length + 1) : source;
  const extension = path.extname(filepath).toLowerCase();

  let code = rewriteImportSpecifiers(body);
  if (extension === '.jsx') {
    const transformed = await transformAsync(code, {
      filename: filepath,
      configFile: path.join(rootDir, 'babel.config.json'),
      babelrc: false
    });
    code = transformed?.code || '';
  }

  await ensureParent(outputPath);
  await fs.writeFile(outputPath, shebang ? `${shebang}\n${code}\n` : `${code}\n`, 'utf8');

  if (shebang) {
    await fs.chmod(outputPath, 0o755);
  }
}

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  const files = await collectFiles(srcDir);
  const buildable = files.filter((filepath) => ['.mjs', '.js', '.jsx'].includes(path.extname(filepath).toLowerCase()));

  for (const filepath of buildable) {
    await buildFile(filepath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
