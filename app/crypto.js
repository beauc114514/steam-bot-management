const CHARSET = '23456789BCDFGHJKMNPQRTVWXY';

function guardCode(sharedSecretBase64) {
  const secret = Uint8Array.from(atob(sharedSecretBase64), (ch) => ch.charCodeAt(0));
  const time = Math.floor(Date.now() / 1000 / 30);
  const timeBytes = new Uint8Array(8);
  let value = time;
  for (let i = 7; i >= 0; i -= 1) {
    timeBytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  const hash = hmacSha1(secret, timeBytes);
  const offset = hash[hash.length - 1] & 0x0f;
  let full = ((hash[offset] & 0x7f) << 24)
    | ((hash[offset + 1] & 0xff) << 16)
    | ((hash[offset + 2] & 0xff) << 8)
    | (hash[offset + 3] & 0xff);
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += CHARSET[full % CHARSET.length];
    full = Math.floor(full / CHARSET.length);
  }
  return code;
}

function hmacSha1(key, message) {
  const block = 64;
  let usedKey = key;
  if (usedKey.length > block) usedKey = sha1(usedKey);
  const padded = new Uint8Array(block);
  padded.set(usedKey);
  const oKey = new Uint8Array(block);
  const iKey = new Uint8Array(block);
  for (let i = 0; i < block; i += 1) {
    oKey[i] = padded[i] ^ 0x5c;
    iKey[i] = padded[i] ^ 0x36;
  }
  const inner = new Uint8Array(block + message.length);
  inner.set(iKey);
  inner.set(message, block);
  const innerHash = sha1(inner);
  const outer = new Uint8Array(block + innerHash.length);
  outer.set(oKey);
  outer.set(innerHash, block);
  return sha1(outer);
}

function sha1(bytes) {
  const bitLength = bytes.length * 8;
  const withOne = bytes.length + 1;
  const zeroCount = (56 - (withOne % 64) + 64) % 64;
  const data = new Uint8Array(bytes.length + 1 + zeroCount + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 4, bitLength >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | ((~b) & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { guardCode };
}
