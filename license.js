/**
 * ILI Correlation Workbench — License Manager (clean rewrite)
 *
 * Store format (license.dat):
 *   Line 1: base64url(rawKey)
 *   Line 2: base64(AES-256-GCM encrypted JSON)
 * Encryption key = SHA-256(rawKey + '|' + machineId)
 */

const crypto = require('crypto');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');

let _app;
try { _app = require('electron').app; } catch { _app = null; }

const HMAC_SECRET = '116bc03d66b49a302bbb6e4ae5030ae284bd411d6fcbda221728fb9bb3261c52';

function storePath() {
  let base = _app ? _app.getPath('userData') : path.join(os.homedir(), '.ili-workbench');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'license.dat');
}

function getMachineId() {
  const nics = os.networkInterfaces() || {};
  const macs = Object.values(nics).flat()
    .filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
    .map(n => n.mac).sort().join(',');
  return crypto.createHash('sha256')
    .update([os.hostname(), os.platform(), os.arch(), (os.cpus()[0]||{}).model||'', macs].join('|'))
    .digest('hex');
}

function sign(payload) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
}

function parseAndValidateKey(rawKey) {
  try {
    const clean = rawKey.trim().replace(/\s+/g, '');
    const dot   = clean.lastIndexOf('.');
    if (dot < 0) return { ok: false, error: 'Invalid key format.' };
    const payload  = clean.substring(0, dot);
    const sig      = clean.substring(dot + 1);
    const expected = sign(payload);
    if (sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: false, error: 'Invalid license key — please check and try again.' };
    }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.expiry && data.expiry !== 'never' && new Date(data.expiry) < new Date()) {
      return { ok: false, error: `License expired on ${data.expiry}.` };
    }
    return { ok: true, data };
  } catch(e) {
    return { ok: false, error: 'Could not parse license key: ' + e.message };
  }
}

function encKey(rawKey, machineId) {
  return crypto.createHash('sha256').update(rawKey + '|' + machineId).digest();
}

function encryptStore(obj, rawKey, machineId) {
  const key = encKey(rawKey, machineId);
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptStore(b64, rawKey, machineId) {
  try {
    const key = encKey(rawKey, machineId);
    const buf = Buffer.from(b64, 'base64');
    const d   = crypto.createDecipheriv('aes-256-gcm', key, buf.slice(0,12));
    d.setAuthTag(buf.slice(12,28));
    return JSON.parse(d.update(buf.slice(28)) + d.final('utf8'));
  } catch { return null; }
}

function validateKey(rawKey) {
  return parseAndValidateKey(rawKey);
}

function activateLicense(rawKey) {
  const { ok, data, error } = parseAndValidateKey(rawKey);
  if (!ok) return { ok: false, error };
  const machineId = getMachineId();
  try {
    const blob   = encryptStore({ rawKey, machineId, activatedAt: new Date().toISOString(), ...data }, rawKey, machineId);
    const header = Buffer.from(rawKey, 'utf8').toString('base64url');
    fs.writeFileSync(storePath(), header + '\n' + blob, 'utf8');
    return { ok: true, data };
  } catch(e) {
    return { ok: false, error: 'Could not save license: ' + e.message };
  }
}

function checkLicense() {
  const sp = storePath();
  if (!fs.existsSync(sp)) {
    return { ok: false, reason: 'not_activated', error: 'No license found. Please enter your license key.' };
  }
  let raw;
  try { raw = fs.readFileSync(sp, 'utf8').trim(); }
  catch { return { ok: false, reason: 'tampered', error: 'License file could not be read.' }; }

  const lines = raw.split('\n');
  if (lines.length < 2) {
    return { ok: false, reason: 'tampered', error: 'License file corrupted. Please re-activate.' };
  }
  let rawKey;
  try { rawKey = Buffer.from(lines[0].trim(), 'base64url').toString('utf8'); }
  catch { return { ok: false, reason: 'tampered', error: 'License file corrupted. Please re-activate.' }; }

  // Validate signature & expiry
  const keyCheck = parseAndValidateKey(rawKey);
  if (!keyCheck.ok) return { ok: false, reason: 'expired', error: keyCheck.error };

  // Check machine binding
  const machineId = getMachineId();
  const store     = decryptStore(lines[1].trim(), rawKey, machineId);
  if (!store) {
    return { ok: false, reason: 'machine_mismatch',
      error: 'This license is activated on a different machine.\nContact C-Squared to transfer your license.' };
  }

  return { ok: true, reason: 'ok', data: keyCheck.data };
}

function deactivateLicense() {
  try { fs.unlinkSync(storePath()); } catch {}
}

function getLicenseInfo() {
  return checkLicense();
}

module.exports = { checkLicense, activateLicense, deactivateLicense, validateKey, getLicenseInfo, getMachineId };
