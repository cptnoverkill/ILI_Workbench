#!/usr/bin/env node
/**
 * ILI Correlation Workbench — License Key Generator
 * 
 * Run by C-Squared ONLY to generate license keys for customers.
 * Keep HMAC_SECRET private — anyone with it can forge keys.
 * 
 * Usage:
 *   node generate-key.js --name "John Smith" --email "john@company.com"
 *   node generate-key.js --name "John Smith" --email "john@company.com" --expiry 2027-12-31
 *   node generate-key.js --list   (show all issued keys from the log)
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── MUST MATCH THE SECRET IN license.js ──────────────────────────────────────
const HMAC_SECRET = '116bc03d66b49a302bbb6e4ae5030ae284bd411d6fcbda221728fb9bb3261c52';
const LOG_FILE    = path.join(__dirname, 'issued-keys.log');

function signPayload(payload) {
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('base64url');
}

function generateKey({ name, email, expiry = 'never' }) {
  if (!name || !email) {
    console.error('Error: --name and --email are required');
    process.exit(1);
  }

  const data = {
    name,
    email,
    expiry,
    issued: new Date().toISOString().split('T')[0],
  };

  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig     = signPayload(payload);
  const key     = payload + '.' + sig;

  // Format with dashes for readability: AAAA.BBBB-CCCC-DDDD-EEEE (not implemented
  // here for simplicity — the key is already a single opaque string)

  return { key, data };
}

function listKeys() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No keys issued yet.');
    return;
  }
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  ${lines.length} license(s) issued`);
  console.log(`${'─'.repeat(80)}`);
  lines.forEach((line, i) => {
    try {
      const entry = JSON.parse(line);
      console.log(`\n  #${i + 1}  ${entry.data.name} <${entry.data.email}>`);
      console.log(`       Issued:  ${entry.data.issued}`);
      console.log(`       Expiry:  ${entry.data.expiry}`);
      console.log(`       Key:     ${entry.key.substring(0, 40)}...`);
    } catch {
      console.log(`  #${i + 1}  [unparseable entry]`);
    }
  });
  console.log(`\n${'─'.repeat(80)}\n`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--list')) {
  listKeys();
  process.exit(0);
}

const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const name   = get('--name');
const email  = get('--email');
const expiry = get('--expiry') || 'never';

if (!name || !email) {
  console.log(`
Usage:
  node generate-key.js --name "Full Name" --email "user@company.com"
  node generate-key.js --name "Full Name" --email "user@company.com" --expiry 2027-12-31
  node generate-key.js --list
`);
  process.exit(1);
}

const { key, data } = generateKey({ name, email, expiry });

// Log to file
const logEntry = JSON.stringify({ key, data, generatedAt: new Date().toISOString() });
fs.appendFileSync(LOG_FILE, logEntry + '\n');

console.log(`
${'═'.repeat(60)}
  ILI Correlation Workbench — License Key
${'═'.repeat(60)}

  Name:    ${data.name}
  Email:   ${data.email}
  Issued:  ${data.issued}
  Expiry:  ${data.expiry}

  LICENSE KEY:

  ${key}

${'═'.repeat(60)}
  Send the key above to the user.
  Key logged to: ${LOG_FILE}
${'═'.repeat(60)}
`);
