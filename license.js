/**
 * ILI Correlation Workbench — License Manager
 * 
 * How it works:
 *  1. A license key encodes: {username, email, expiry, machineId_at_activation}
 *     signed with HMAC-SHA256 using a secret only C-Squared holds.
 *  2. On first launch the user enters their key. The app records the current
 *     machine fingerprint inside the key store (encrypted with the key itself).
 *  3. Every subsequent launch re-derives the machine fingerprint and verifies
 *     it matches what was recorded at activation — binding the license to one machine.
 *  4. No internet required after activation. Tampering with the store invalidates the license.
 */

const crypto = require('crypto');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');

// Safe electron import — license.js may be required outside Electron (e.g. tests)
let _app;
try { _app = require('electron').app; } catch { _app = null; }

// ── Secret shared only between C-Squared's key generator and this binary ────
// CHANGE THIS before distributing — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const HMAC_SECRET = '116bc03d66b49a302bbb6e4ae5030ae284bd411d6fcbda221728fb9bb3261c52';
const APP_VERSION = '0.2.7';

// ── Where the activated license is stored ────────────────────────────────────
function storePath() {
  const base = _app
    ? _app.getPath('userData')
    : path.join(require('os').homedir(), '.ili-workbench');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'license.dat');
}

// ── Machine fingerprint ───────────────────────────────────────────────────────
// Combines several stable hardware identifiers. Not spoofproof (nothing is on
// a desktop OS without a TPM), but sufficient for deterrence + audit.
function getMachineId() {
  const parts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || '',
    os.networkInterfaces()
      ? Object.values(os.networkInterfaces())
          .flat()
          .filter(n => n && !n.internal && n.mac !== '00:00:00:00:00:00')
          .map(n => n.mac)
          .sort()
          .join(',')
      : '',
  ];
  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex');
}

// ── Key format ────────────────────────────────────────────────────────────────
// KEY = Base64( JSON({name, email, expiry, issued}) ) + '.' + HMAC(payload, SECRET)
// expiry: 'never' or ISO date string 'YYYY-MM-DD'

function signPayload(payload) {
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('base64url');
}

function parseKey(rawKey) {
  try {
    const clean = rawKey.trim().replace(/\s+/g, '');
    const dot = clean.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = clean.substring(0, dot);
    const sig     = clean.substring(dot + 1);
    // Verify signature
    const expected = signPayload(payload);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data; // { name, email, expiry, issued }
  } catch {
    return null;
  }
}

function isExpired(data) {
  if (!data.expiry || data.expiry === 'never') return false;
  return new Date(data.expiry) < new Date();
}

// ── Store format (written to disk) ───────────────────────────────────────────
// Encrypted with AES-256-GCM using a key derived from rawKey + machineId.
// Tampering with the file → decryption fails → license invalid.

function deriveEncKey(rawKey, machineId) {
  return crypto
    .createHash('sha256')
    .update(rawKey + '|' + machineId)
    .digest(); // 32 bytes
}

function encryptStore(obj, rawKey, machineId) {
  const key = deriveEncKey(rawKey, machineId);
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain  = JSON.stringify(obj);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptStore(b64, rawKey, machineId) {
  try {
    const key = deriveEncKey(rawKey, machineId);
    const buf  = Buffer.from(b64, 'base64');
    const iv   = buf.slice(0, 12);
    const tag  = buf.slice(12, 28);
    const enc  = buf.slice(28);
    const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    return JSON.parse(dec.update(enc) + dec.final('utf8'));
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a raw key string without activating.
 * Returns { ok, data, error }
 */
function validateKey(rawKey) {
  const data = parseKey(rawKey);
  if (!data) return { ok: false, error: 'Invalid license key — please check and try again.' };
  if (isExpired(data)) return { ok: false, error: `License expired on ${data.expiry}.` };
  return { ok: true, data };
}

/**
 * Activate: validate key, bind to this machine, write store.
 * Returns { ok, data, error }
 */
function activateLicense(rawKey) {
  const { ok, data, error } = validateKey(rawKey);
  if (!ok) return { ok: false, error };

  const machineId = getMachineId();
  const store = {
    rawKey,
    machineId,
    activatedAt: new Date().toISOString(),
    name: data.name,
    email: data.email,
    expiry: data.expiry,
  };

  try {
    const encrypted = encryptStore(store, rawKey, machineId);
    fs.writeFileSync(storePath(), encrypted, 'utf8');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: 'Could not write license file: ' + e.message };
  }
}

/**
 * Check license on every launch.
 * Returns { ok, data, error, reason }
 * reason: 'not_activated' | 'machine_mismatch' | 'expired' | 'tampered' | 'ok'
 */
function checkLicense() {
  const sp = storePath();
  if (!fs.existsSync(sp)) {
    return { ok: false, reason: 'not_activated', error: 'No license found. Please enter your license key.' };
  }

  const machineId = getMachineId();
  let b64;
  try { b64 = fs.readFileSync(sp, 'utf8').trim(); } catch {
    return { ok: false, reason: 'tampered', error: 'License file could not be read.' };
  }

  const store = decryptStore(b64, undefined, undefined);
  // We need the rawKey to decrypt — read it from the encrypted blob differently.
  // Actually we stored rawKey inside — so we do a two-pass: try to extract rawKey first.
  // Alternative: store rawKey separately in plain + store = encrypted(rest).
  // Simpler: store = iv|tag|enc where enc = JSON({rawKey, machineId, ...}) and the
  // encryption key is HMAC(rawKey, SECRET) alone (not machine-bound for the outer wrap),
  // then inside we verify machineId matches current.
  // Let's do a cleaner two-layer approach:
  return checkLicenseV2(b64, machineId);
}

function checkLicenseV2(b64, machineId) {
  // The store was written by activateLicense using deriveEncKey(rawKey, machineId).
  // We can't decrypt without the rawKey. So we store a second small plaintext header:
  // line 1: base64url(rawKey) — so we can re-derive the enc key
  // line 2: the encrypted blob
  // Re-read with this assumption:
  const sp = storePath();
  let raw;
  try { raw = fs.readFileSync(sp, 'utf8').trim(); } catch {
    return { ok: false, reason: 'tampered', error: 'License file unreadable.' };
  }

  const lines = raw.split('\n');
  if (lines.length < 2) return { ok: false, reason: 'tampered', error: 'License file corrupted.' };

  let rawKey;
  try { rawKey = Buffer.from(lines[0], 'base64url').toString('utf8'); } catch {
    return { ok: false, reason: 'tampered', error: 'License file corrupted.' };
  }

  const store = decryptStore(lines[1], rawKey, machineId);
  if (!store) {
    // Wrong machine — machineId changed
    return { ok: false, reason: 'machine_mismatch', error: 'This license is activated on a different machine.\nContact C-Squared to transfer your license.' };
  }

  // Validate the key itself is still valid
  const { ok, data, error } = validateKey(rawKey);
  if (!ok) return { ok: false, reason: 'expired', error };

  return { ok: true, reason: 'ok', data };
}

/**
 * Rewrite activateLicense to use the two-line format.
 */
function activateLicenseV2(rawKey) {
  const { ok, data, error } = validateKey(rawKey);
  if (!ok) return { ok: false, error };

  const machineId = getMachineId();
  const store = {
    rawKey,
    machineId,
    activatedAt: new Date().toISOString(),
    name: data.name,
    email: data.email,
    expiry: data.expiry,
  };

  try {
    const encrypted = encryptStore(store, rawKey, machineId);
    const header    = Buffer.from(rawKey, 'utf8').toString('base64url');
    fs.writeFileSync(storePath(), header + '\n' + encrypted, 'utf8');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: 'Could not write license file: ' + e.message };
  }
}

/**
 * Deactivate — remove the license store (allows re-activation on new machine).
 * In practice you'd want C-Squared to do this server-side, but for offline use
 * this lets you manually reset a machine.
 */
function deactivateLicense() {
  try { fs.unlinkSync(storePath()); } catch {}
}

/**
 * Get stored license info without full re-check (for display purposes).
 */
function getLicenseInfo() {
  const result = checkLicense();
  return result;
}

module.exports = {
  checkLicense,
  activateLicense: activateLicenseV2,
  deactivateLicense,
  validateKey,
  getLicenseInfo,
  getMachineId,
};
