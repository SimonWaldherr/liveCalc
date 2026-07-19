'use strict';

const fs = require('node:fs');

/**
 * Load simple KEY=value entries without adding a runtime dependency. Values
 * already present in process.env always win, so deployment platforms can use
 * their own secret management unchanged.
 */
function loadEnvFile(filePath, target) {
  const env = target || process.env;
  if (!filePath || !fs.existsSync(filePath)) return [];

  const loaded = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;

    const key = match[1];
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s+#/);
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
    }

    if (env[key] === undefined) {
      env[key] = value;
      loaded.push(key);
    }
  });

  return loaded;
}

module.exports = { loadEnvFile };
