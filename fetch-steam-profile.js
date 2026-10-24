const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { guardCode } = require('./app/crypto.js');

const DATA = path.join(__dirname, 'data', 'steam-bot-management.json');
const PROXY_FILE = path.join(__dirname, 'proxy.local.json');
const BASE = 'https://api.steampowered.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 4);
const LIMIT = Number(process.env.FETCH_LIMIT || 0);

const proxy = loadIpRoyal();
let writeChain = Promise.resolve();

function loadIpRoyal() {
  if (!fs.existsSync(PROXY_FILE)) {
    throw new Error('请复制 proxy.example.json 为 proxy.local.json，并填入代理账号');
  }
  const config = JSON.parse(fs.readFileSync(PROXY_FILE, 'utf8'));
  for (const name of ['host', 'port', 'username', 'password']) {
    if (!config[name]) throw new Error('proxy.local.json 缺少 ' + name);
  }
  return config;
}

function proxyPassword() {
  return proxy.password;
}

function request(session, method, url, headers, body) {
  const args = [
    '--compressed', '--silent', '--show-error', '--max-time', '35',
    '--proxy', proxy.host + ':' + proxy.port,
    '--proxy-user', proxy.username + ':' + proxyPassword(),
    '-w', '\n%{http_code}',
    '-X', method,
    url,
  ];
  Object.entries(headers || {}).forEach(([name, value]) => {
    args.push('-H', name + ': ' + value);
  });
  if (body != null) args.push('--data', body);
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) {
        const where = url.split('?')[0].split('/').slice(-2).join('/');
        reject(new Error(where + ' ' + (stderr.trim() || ('curl exit ' + code))));
        return;
      }
      const split = stdout.lastIndexOf('\n');
      const text = split >= 0 ? stdout.slice(0, split) : stdout;
      const status = Number(split >= 0 ? stdout.slice(split + 1).trim() : 0);
      if (status !== 200) {
        reject(new Error(method + ' ' + status + ' ' + text.slice(0, 180)));
        return;
      }
      resolve(text);
    });
  });
}

function rsaEncrypt(password, modHex, expHex) {
  const key = crypto.createPublicKey({
    key: { kty: 'RSA', n: hexToBase64Url(modHex), e: hexToBase64Url(expHex) },
    format: 'jwk',
  });
  return crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8')
  ).toString('base64');
}

function hexToBase64Url(hex) {
  return Buffer.from(hex, 'hex').toString('base64url');
}

function waitFreshWindow() {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left >= 8) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, (left + 1) * 1000));
}

async function login(account) {
  await waitFreshWindow();
  const session = 'r' + account.id + 'x' + Date.now().toString(36);
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const rsaText = await request(
    session,
    'GET',
    BASE + '/IAuthenticationService/GetPasswordRSAPublicKey/v1/?account_name=' + encodeURIComponent(account.username),
    headers
  );
  const rsa = JSON.parse(rsaText).response;
  const timestamp = (rsaText.match(/"timestamp"\s*:\s*"?(\d+)"?/) || [])[1];
  if (!timestamp) throw new Error('RSA 响应没有 timestamp');
  const encryptedPassword = rsaEncrypt(account.password, rsa.publickey_mod, rsa.publickey_exp);
  const code = guardCode(account.sharedSecret);
  const input = {
    device_friendly_name: UA,
    account_name: account.username,
    encrypted_password: encryptedPassword,
    remember_login: true,
    persistence: 1,
    website_id: 'Community',
    guard_data: '',
    language: 6,
    device_details: { device_friendly_name: UA, platform_type: 2 },
    platform_type: 2,
    steam_guard_code: code,
    code_type: 3,
  };
  const inputJson = JSON.stringify(input).slice(0, -1) + ',"encryption_timestamp":' + timestamp + '}';
  const body = 'input_json=' + encodeURIComponent(inputJson);
  const beginText = await request(session, 'POST', BASE + '/IAuthenticationService/BeginAuthSessionViaCredentials/v1/', {
    ...headers,
    'Content-Type': 'application/x-www-form-urlencoded',
  }, body);
  const begin = JSON.parse(beginText).response || {};
  let steamId = begin.steamid || '';
  const clientId = begin.client_id;
  const requestId = begin.request_id;
  if (!steamId) throw new Error('登录没有返回 steamid');

  const needsDevice = Array.isArray(begin.allowed_confirmations)
    && begin.allowed_confirmations.some((item) => item.confirmation_type === 3);
  if (needsDevice && clientId) {
    await request(session, 'POST', BASE + '/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1/', {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
    }, 'client_id=' + clientId
      + '&steamid=' + steamId
      + '&code=' + encodeURIComponent(code)
      + '&code_type=3');
  }

  let refreshToken = '';
  if (clientId && requestId) {
    const interval = Math.min(Math.max(Number(begin.interval) || 2, 1), 5);
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      const pollText = await request(session, 'POST', BASE + '/IAuthenticationService/PollAuthSessionStatus/v1/', {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      }, 'client_id=' + clientId + '&request_id=' + encodeURIComponent(requestId));
      const poll = JSON.parse(pollText).response || {};
      if (poll.steamid) steamId = poll.steamid;
      if (poll.refresh_token) refreshToken = poll.refresh_token;
      if (poll.refresh_token) break;
    }
  }

  let persona = '';
  if (refreshToken) {
    try {
      persona = await fetchPersona(session, steamId, refreshToken);
    } catch (error) {
      console.log('#' + account.id + ' 昵称失败 ' + error.message);
    }
  }
  return { steamId, persona };
}

async function fetchPersona(session, steamId, refreshToken) {
  const sessionId = crypto.randomBytes(12).toString('hex');
  const finalizeBody = 'nonce=' + encodeURIComponent(refreshToken)
    + '&sessionid=' + sessionId
    + '&redir=' + encodeURIComponent('https://steamcommunity.com/login/home/?goto=');
  const finalizeText = await runCurl([
    '-X', 'POST', '--data', finalizeBody,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'User-Agent: ' + UA,
    '-H', 'Origin: https://steamcommunity.com',
    '-H', 'Referer: https://steamcommunity.com/',
    'https://login.steampowered.com/jwt/finalizelogin',
  ]);
  const finalizedRaw = JSON.parse(finalizeText);
  const finalized = finalizedRaw.response || finalizedRaw;
  const jar = path.join('/tmp', 'steam-cookie-' + steamId + '.txt');
  fs.writeFileSync(jar, '');
  for (const transfer of finalized.transfer_info || []) {
    const params = transfer.params || {};
    const body = 'nonce=' + encodeURIComponent(params.nonce || '')
      + '&auth=' + encodeURIComponent(params.auth || '')
      + '&steamID=' + encodeURIComponent(finalized.steamID || steamId);
    await curlToJar(transfer.url, body, jar);
  }
  const html = await curlFromJar('https://steamcommunity.com/my/', jar);
  fs.rmSync(jar, { force: true });
  return pickPersona(html);
}

function curlToJar(url, body, jar) {
  return runCurl([
    '-c', jar, '-b', jar,
    '-X', 'POST', '--data', body,
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'User-Agent: ' + UA,
    url,
  ]);
}

function curlFromJar(url, jar) {
  return runCurl([
    '--location', '-b', jar,
    '-H', 'User-Agent: ' + UA,
    '-H', 'Accept: text/html',
    url,
  ]);
}

function runCurl(args) {
  const full = [
    '--compressed', '--silent', '--show-error', '--max-time', '30',
    '-w', '\n%{http_code}',
  ].concat(args);
  return new Promise((resolve, reject) => {
    const child = spawn('curl', full, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || ('curl exit ' + code)));
        return;
      }
      const split = stdout.lastIndexOf('\n');
      const text = split >= 0 ? stdout.slice(0, split) : stdout;
      const status = Number(split >= 0 ? stdout.slice(split + 1).trim() : 0);
      if (status !== 200 && status !== 302) {
        reject(new Error(status + ' ' + text.slice(0, 160)));
        return;
      }
      resolve(text);
    });
  });
}

function pickPersona(html) {
  return ((html.match(/playerAvatar[^>]*>\s*<img[^>]*alt="([^"]*)"/) || [])[1]
    || (html.match(/<img[^>]*alt="([^"]*)"[^>]*class="[^"]*playerAvatar/) || [])[1]
    || (html.match(/actual_persona_name">([^<]+)</) || [])[1]
    || (html.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/) || [])[1]
    || '').trim();
}

function requestDirect(url, headers) {
  const args = ['--compressed', '--silent', '--show-error', '--max-time', '20', '-w', '\n%{http_code}', url];
  Object.entries(headers || {}).forEach(([name, value]) => args.push('-H', name + ': ' + value));
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || ('curl exit ' + code)));
        return;
      }
      const split = stdout.lastIndexOf('\n');
      resolve(split >= 0 ? stdout.slice(0, split) : stdout);
    });
  });
}

function saveProfile(id, profile) {
  writeChain = writeChain.then(() => lockUpdate({
    id,
    steamId: profile.steamId,
    persona: profile.persona,
  }));
  return writeChain;
}

function lockUpdate(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', `
import fcntl, json, os, sys
path, raw = sys.argv[1], sys.argv[2]
lock_path = os.path.join(os.path.dirname(path), ".write.lock")
payload = json.loads(raw)
lock = open(lock_path, "a+")
fcntl.flock(lock, fcntl.LOCK_EX)
with open(path, encoding="utf-8") as handle:
    rows = json.load(handle)
for row in rows:
    if row.get("id") == payload["id"]:
        row["steam_id"] = payload["steamId"]
        row["persona_name"] = payload["persona"]
        row.pop("account_name", None)
        break
temp = path + ".tmp"
with open(temp, "w", encoding="utf-8") as handle:
    json.dump(rows, handle, ensure_ascii=False, indent=2)
    handle.write("\\n")
os.replace(temp, path)
fcntl.flock(lock, fcntl.LOCK_UN)
lock.close()
`, DATA, JSON.stringify(payload)], { stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || ('保存失败 ' + code)));
    });
  });
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const pending = rows.filter((row) => !row.steam_id || !row.persona_name).slice(0, LIMIT > 0 ? LIMIT : rows.length);
  console.log('待登录 ' + pending.length + ' 个，并发 ' + CONCURRENCY);
  let cursor = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const row = pending[index];
      const account = {
        id: row.id,
        username: row.steam_account,
        password: row.pass_word,
        sharedSecret: row.shared_secret,
      };
      let profile = null;
      let lastError = null;
      for (let attempt = 0; attempt < 3 && !profile; attempt += 1) {
        try {
          profile = await login(account);
        } catch (error) {
          lastError = error;
        }
      }
      if (!profile) {
        failed += 1;
        console.log('#' + row.id + ' ' + account.username + ' 失败 ' + lastError.message);
        continue;
      }
      try {
        await saveProfile(row.id, profile);
        ok += 1;
        console.log('#' + row.id + ' ' + account.username + ' ' + profile.steamId + ' ' + (profile.persona || '-'));
      } catch (error) {
        failed += 1;
        console.log('#' + row.id + ' ' + account.username + ' 写入失败 ' + error.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  await writeChain;
  console.log('完成 成功 ' + ok + ' 失败 ' + failed);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
