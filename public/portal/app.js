var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod2) => function __require2() {
  try {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  } catch (e) {
    throw mod2 = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

// (disabled):crypto
var require_crypto = __commonJS({
  "(disabled):crypto"() {
  }
});

// node_modules/@hpke/common/esm/src/errors.js
var HpkeError = class extends Error {
  constructor(e) {
    let message;
    if (e instanceof Error) {
      message = e.message;
    } else if (typeof e === "string") {
      message = e;
    } else {
      message = "";
    }
    super(message);
    this.name = this.constructor.name;
  }
};
var InvalidParamError = class extends HpkeError {
};
var SerializeError = class extends HpkeError {
};
var DeserializeError = class extends HpkeError {
};
var EncapError = class extends HpkeError {
};
var DecapError = class extends HpkeError {
};
var ExportError = class extends HpkeError {
};
var SealError = class extends HpkeError {
};
var OpenError = class extends HpkeError {
};
var MessageLimitReachedError = class extends HpkeError {
};
var DeriveKeyPairError = class extends HpkeError {
};
var NotSupportedError = class extends HpkeError {
};

// node_modules/@hpke/common/esm/_dnt.shims.js
var dntGlobals = {};
var dntGlobalThis = createMergeProxy(globalThis, dntGlobals);
function createMergeProxy(baseObj, extObj) {
  return new Proxy(baseObj, {
    get(_target, prop, _receiver) {
      if (prop in extObj) {
        return extObj[prop];
      } else {
        return baseObj[prop];
      }
    },
    set(_target, prop, value) {
      if (prop in extObj) {
        delete extObj[prop];
      }
      baseObj[prop] = value;
      return true;
    },
    deleteProperty(_target, prop) {
      let success = false;
      if (prop in extObj) {
        delete extObj[prop];
        success = true;
      }
      if (prop in baseObj) {
        delete baseObj[prop];
        success = true;
      }
      return success;
    },
    ownKeys(_target) {
      const baseKeys = Reflect.ownKeys(baseObj);
      const extKeys = Reflect.ownKeys(extObj);
      const extKeysSet = new Set(extKeys);
      return [...baseKeys.filter((k) => !extKeysSet.has(k)), ...extKeys];
    },
    defineProperty(_target, prop, desc) {
      if (prop in extObj) {
        delete extObj[prop];
      }
      Reflect.defineProperty(baseObj, prop, desc);
      return true;
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (prop in extObj) {
        return Reflect.getOwnPropertyDescriptor(extObj, prop);
      } else {
        return Reflect.getOwnPropertyDescriptor(baseObj, prop);
      }
    },
    has(_target, prop) {
      return prop in extObj || prop in baseObj;
    }
  });
}

// node_modules/@hpke/common/esm/src/algorithm.js
async function loadSubtleCrypto() {
  if (dntGlobalThis !== void 0 && globalThis.crypto !== void 0) {
    return globalThis.crypto.subtle;
  }
  try {
    const { webcrypto } = await Promise.resolve().then(() => __toESM(require_crypto(), 1));
    return webcrypto.subtle;
  } catch (e) {
    throw new NotSupportedError(e);
  }
}
var NativeAlgorithm = class {
  constructor() {
    Object.defineProperty(this, "_api", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
  }
  async _setup() {
    if (this._api !== void 0) {
      return;
    }
    this._api = await loadSubtleCrypto();
  }
};

// node_modules/@hpke/common/esm/src/consts.js
var INPUT_LENGTH_LIMIT = 8192;
var INFO_LENGTH_LIMIT = 268435456;
var MINIMUM_PSK_LENGTH = 32;
var EMPTY = /* @__PURE__ */ new Uint8Array(0);
var N_0 = 0n;
var N_1 = 1n;
var N_2 = 2n;

// node_modules/@hpke/common/esm/src/interfaces/kemInterface.js
var SUITE_ID_HEADER_KEM = /* @__PURE__ */ new Uint8Array([
  75,
  69,
  77,
  0,
  0
]);

// node_modules/@hpke/common/esm/src/utils/misc.js
var isCryptoKeyPair = (x) => typeof x === "object" && x !== null && typeof x.privateKey === "object" && typeof x.publicKey === "object";
function i2Osp(n, w) {
  if (w <= 0) {
    throw new Error("i2Osp: too small size");
  }
  if (n >= 256 ** w) {
    throw new Error("i2Osp: too large integer");
  }
  const ret = new Uint8Array(w);
  for (let i = 0; i < w && n; i++) {
    ret[w - (i + 1)] = n % 256;
    n = Math.floor(n / 256);
  }
  return ret;
}
function concat(...parts) {
  let len = 0;
  for (const p of parts)
    len += p.length;
  const ret = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    ret.set(p, offset);
    offset += p.length;
  }
  return ret;
}
function base64UrlToBytes(v) {
  const base64 = v.replace(/-/g, "+").replace(/_/g, "/");
  const byteString = atob(base64);
  const ret = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ret[i] = byteString.charCodeAt(i);
  }
  return ret;
}
var _cryptoApi;
function getCrypto() {
  if (_cryptoApi)
    return _cryptoApi;
  if (typeof dntGlobalThis !== "undefined" && globalThis.crypto !== void 0) {
    _cryptoApi = globalThis.crypto;
    return _cryptoApi;
  }
  try {
    if (typeof __require === "function") {
      const { webcrypto } = require_crypto();
      _cryptoApi = webcrypto;
      return _cryptoApi;
    }
  } catch {
  }
  throw new Error("crypto.getRandomValues must be defined");
}
async function loadCrypto() {
  try {
    return getCrypto();
  } catch {
    try {
      const { webcrypto } = await Promise.resolve().then(() => __toESM(require_crypto(), 1));
      _cryptoApi = webcrypto;
      return _cryptoApi;
    } catch (_e) {
      throw new Error("failed to load Crypto");
    }
  }
}
function xor(a, b) {
  if (a.byteLength !== b.byteLength) {
    throw new Error("xor: different length inputs");
  }
  const buf = new Uint8Array(a.byteLength);
  for (let i = 0; i < a.byteLength; i++) {
    buf[i] = a[i] ^ b[i];
  }
  return buf;
}

// node_modules/@hpke/common/esm/src/kdfs/hkdf.js
var HPKE_VERSION = /* @__PURE__ */ new Uint8Array([
  72,
  80,
  75,
  69,
  45,
  118,
  49
]);
function toUint8Array(input) {
  return new Uint8Array(toArrayBuffer(input));
}
function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer;
  }
  return new Uint8Array(input).slice().buffer;
}
var HkdfNative = class extends NativeAlgorithm {
  /**
   * Uses WebCrypto HMAC for salts of any length when no callback is supplied.
   * Prefer omitting the callback and its JavaScript HMAC/SHA-2 imports to reduce
   * bundle size. Empty salts are normalized to hashSize zero bytes.
   *
   * @param fallbackExtract Optional legacy callback, taking precedence over
   * WebCrypto for nonempty salts whose length differs from hashSize.
   * Empty and hash-sized salts always use WebCrypto.
   */
  constructor(fallbackExtract) {
    super();
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 1
    });
    Object.defineProperty(this, "hashSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "_suiteId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: EMPTY
    });
    Object.defineProperty(this, "algHash", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        name: "HMAC",
        hash: "SHA-256",
        length: 256
      }
    });
    Object.defineProperty(this, "_fallbackExtract", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._fallbackExtract = fallbackExtract;
  }
  init(suiteId) {
    this._suiteId = suiteId;
  }
  buildLabeledIkm(label, ikm) {
    this._checkInit();
    return concat(HPKE_VERSION, this._suiteId, label, ikm);
  }
  buildLabeledInfo(label, info, len) {
    this._checkInit();
    return concat(
      // I2OSP(len, 2)
      new Uint8Array([len >> 8, len]),
      HPKE_VERSION,
      this._suiteId,
      label,
      info
    );
  }
  async extract(salt, ikm) {
    await this._setup();
    const saltBuf = salt.byteLength === 0 ? new ArrayBuffer(this.hashSize) : toArrayBuffer(salt);
    const ikmBuf = toArrayBuffer(ikm);
    if (saltBuf.byteLength !== this.hashSize && this._fallbackExtract !== void 0) {
      return this._fallbackExtract(new Uint8Array(saltBuf), new Uint8Array(ikmBuf)).buffer;
    }
    const key = await this._api.importKey("raw", saltBuf, { name: this.algHash.name, hash: this.algHash.hash }, false, [
      "sign"
    ]);
    return await this._api.sign("HMAC", key, ikmBuf);
  }
  async expand(prk, info, len) {
    await this._setup();
    if (len > 255 * this.hashSize) {
      throw new Error("Entropy limit reached");
    }
    const prkBuf = toArrayBuffer(prk);
    const key = await this._api.importKey("raw", prkBuf, this.algHash, false, [
      "sign"
    ]);
    const okm = new Uint8Array(len);
    let prev = EMPTY;
    const mid = toUint8Array(info);
    for (let counter = 1, offset = 0; offset < okm.length; counter++) {
      const input = new Uint8Array(prev.length + mid.length + 1);
      input.set(prev);
      input.set(mid, prev.length);
      input[input.length - 1] = counter;
      prev = new Uint8Array(await this._api.sign("HMAC", key, input));
      const block = prev.subarray(0, Math.min(prev.length, okm.length - offset));
      okm.set(block, offset);
      offset += block.length;
    }
    return okm.buffer;
  }
  async extractAndExpand(salt, ikm, info, len) {
    await this._setup();
    const ikmBuf = toArrayBuffer(ikm);
    const baseKey = await this._api.importKey("raw", ikmBuf, "HKDF", false, ["deriveBits"]);
    return await this._api.deriveBits({
      name: "HKDF",
      hash: this.algHash.hash,
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info)
    }, baseKey, len * 8);
  }
  async labeledExtract(salt, label, ikm) {
    return await this.extract(salt, this.buildLabeledIkm(label, ikm));
  }
  async labeledExpand(prk, label, info, len) {
    return await this.expand(prk, this.buildLabeledInfo(label, info, len), len);
  }
  _checkInit() {
    if (this._suiteId === EMPTY) {
      throw new Error("Not initialized. Call init()");
    }
  }
};
var HkdfSha256Native = class extends HkdfNative {
  constructor() {
    super(...arguments);
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 1
    });
    Object.defineProperty(this, "hashSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "algHash", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        name: "HMAC",
        hash: "SHA-256",
        length: 256
      }
    });
  }
};

// node_modules/@hpke/common/esm/src/kems/dhkem.js
var LABEL_EAE_PRK = /* @__PURE__ */ new Uint8Array([
  101,
  97,
  101,
  95,
  112,
  114,
  107
]);
var LABEL_SHARED_SECRET = /* @__PURE__ */ new Uint8Array([
  115,
  104,
  97,
  114,
  101,
  100,
  95,
  115,
  101,
  99,
  114,
  101,
  116
]);
var Dhkem = class {
  constructor(id, prim, kdf) {
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "secretSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "encSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "publicKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "privateKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "_prim", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_kdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.id = id;
    this._prim = prim;
    this._kdf = kdf;
    const suiteId = new Uint8Array(SUITE_ID_HEADER_KEM);
    suiteId.set(i2Osp(this.id, 2), 3);
    this._kdf.init(suiteId);
  }
  async serializePublicKey(key) {
    return await this._prim.serializePublicKey(key);
  }
  async deserializePublicKey(key) {
    return await this._prim.deserializePublicKey(toArrayBuffer(key));
  }
  async serializePrivateKey(key) {
    return await this._prim.serializePrivateKey(key);
  }
  async deserializePrivateKey(key) {
    return await this._prim.deserializePrivateKey(toArrayBuffer(key));
  }
  async importKey(format, key, isPublic = true) {
    return await this._prim.importKey(format, key, isPublic);
  }
  async generateKeyPair() {
    return await this._prim.generateKeyPair();
  }
  async deriveKeyPair(ikm) {
    const rawIkm = toArrayBuffer(ikm);
    if (rawIkm.byteLength > INPUT_LENGTH_LIMIT) {
      throw new InvalidParamError("Too long ikm");
    }
    return await this._prim.deriveKeyPair(rawIkm);
  }
  async encap(params) {
    let ke;
    if (params.ekm === void 0) {
      ke = await this.generateKeyPair();
    } else if (isCryptoKeyPair(params.ekm)) {
      ke = params.ekm;
    } else {
      ke = await this.deriveKeyPair(params.ekm);
    }
    const enc = await this._prim.serializePublicKey(ke.publicKey);
    const pkrm = await this._prim.serializePublicKey(params.recipientPublicKey);
    let dh = EMPTY;
    let dh1 = EMPTY;
    let dh2 = EMPTY;
    try {
      dh1 = new Uint8Array(await this._prim.dh(ke.privateKey, params.recipientPublicKey));
      dh = dh1;
      let pksm = EMPTY;
      if (params.senderKey !== void 0) {
        const sks = isCryptoKeyPair(params.senderKey) ? params.senderKey.privateKey : params.senderKey;
        dh2 = new Uint8Array(await this._prim.dh(sks, params.recipientPublicKey));
        dh = concat(dh1, dh2);
        dh1.fill(0);
        dh2.fill(0);
        const pks = isCryptoKeyPair(params.senderKey) ? params.senderKey.publicKey : await this._prim.derivePublicKey(params.senderKey);
        pksm = new Uint8Array(await this._prim.serializePublicKey(pks));
      }
      const kemContext = concat(new Uint8Array(enc), new Uint8Array(pkrm), pksm);
      const sharedSecret = await this._generateSharedSecret(dh, kemContext);
      return {
        enc,
        sharedSecret
      };
    } catch (e) {
      throw new EncapError(e);
    } finally {
      dh.fill(0);
      dh1.fill(0);
      dh2.fill(0);
    }
  }
  async decap(params) {
    const enc = toArrayBuffer(params.enc);
    const pke = await this._prim.deserializePublicKey(enc);
    const skr = isCryptoKeyPair(params.recipientKey) ? params.recipientKey.privateKey : params.recipientKey;
    const pkr = isCryptoKeyPair(params.recipientKey) ? params.recipientKey.publicKey : await this._prim.derivePublicKey(params.recipientKey);
    const pkrm = await this._prim.serializePublicKey(pkr);
    let dh = EMPTY;
    let dh1 = EMPTY;
    let dh2 = EMPTY;
    try {
      dh1 = new Uint8Array(await this._prim.dh(skr, pke));
      dh = dh1;
      let pksm = EMPTY;
      if (params.senderPublicKey !== void 0) {
        dh2 = new Uint8Array(await this._prim.dh(skr, params.senderPublicKey));
        dh = concat(dh1, dh2);
        dh1.fill(0);
        dh2.fill(0);
        pksm = new Uint8Array(await this._prim.serializePublicKey(params.senderPublicKey));
      }
      const kemContext = concat(new Uint8Array(enc), new Uint8Array(pkrm), pksm);
      return await this._generateSharedSecret(dh, kemContext);
    } catch (e) {
      throw new DecapError(e);
    } finally {
      dh.fill(0);
      dh1.fill(0);
      dh2.fill(0);
    }
  }
  async _generateSharedSecret(dh, kemContext) {
    const labeledIkm = this._kdf.buildLabeledIkm(LABEL_EAE_PRK, dh);
    try {
      const labeledInfo = this._kdf.buildLabeledInfo(LABEL_SHARED_SECRET, kemContext, this.secretSize);
      return await this._kdf.extractAndExpand(EMPTY, labeledIkm, labeledInfo, this.secretSize);
    } finally {
      labeledIkm.fill(0);
    }
  }
};

// node_modules/@hpke/common/esm/src/interfaces/dhkemPrimitives.js
var KEM_USAGES = ["deriveBits"];
var LABEL_DKP_PRK = /* @__PURE__ */ new Uint8Array([
  100,
  107,
  112,
  95,
  112,
  114,
  107
]);
var LABEL_SK = /* @__PURE__ */ new Uint8Array([115, 107]);

// node_modules/@hpke/common/esm/src/xCryptoKey.js
var XCryptoKey = class {
  constructor(name, key, type, usages = []) {
    Object.defineProperty(this, "key", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "type", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "extractable", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: true
    });
    Object.defineProperty(this, "algorithm", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "usages", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.key = key;
    this.type = type;
    this.algorithm = { name };
    this.usages = usages;
    if (type === "public") {
      this.usages = [];
    }
  }
};

// node_modules/@hpke/common/esm/src/kems/dhkemPrimitives/xCurve.js
var XCurveDhkemPrimitives = class {
  constructor(algName, keySize, curve, hkdf) {
    Object.defineProperty(this, "_algName", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_curve", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_hkdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nPk", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_nSk", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._algName = algName;
    this._nPk = keySize;
    this._nSk = keySize;
    this._curve = curve;
    this._hkdf = hkdf;
  }
  serializePublicKey(key) {
    try {
      return Promise.resolve(key.key.buffer);
    } catch (e) {
      return Promise.reject(new SerializeError(e));
    }
  }
  async deserializePublicKey(key) {
    try {
      return await this._importRawKey(toArrayBuffer(key), true);
    } catch (e) {
      throw new DeserializeError(e);
    }
  }
  serializePrivateKey(key) {
    try {
      return Promise.resolve(key.key.buffer);
    } catch (e) {
      return Promise.reject(new SerializeError(e));
    }
  }
  async deserializePrivateKey(key) {
    try {
      return await this._importRawKey(toArrayBuffer(key), false);
    } catch (e) {
      throw new DeserializeError(e);
    }
  }
  async importKey(format, key, isPublic) {
    try {
      if (format === "raw") {
        return await this._importRawKey(key, isPublic);
      }
      if (key instanceof ArrayBuffer) {
        throw new Error("Invalid jwk key format");
      }
      return await this._importJWK(key, isPublic);
    } catch (e) {
      throw new DeserializeError(e);
    }
  }
  async generateKeyPair() {
    try {
      let rawSk;
      try {
        rawSk = this._curve.utils.randomSecretKey();
      } catch {
        const cryptoApi = await loadCrypto();
        const fallbackRawSk = new Uint8Array(this._nSk);
        cryptoApi.getRandomValues(fallbackRawSk);
        rawSk = fallbackRawSk;
      }
      const sk = new XCryptoKey(this._algName, rawSk, "private", KEM_USAGES);
      const rawPk = this._curve.getPublicKey(rawSk);
      const pk = new XCryptoKey(this._algName, rawPk, "public");
      return { publicKey: pk, privateKey: sk };
    } catch (e) {
      throw new NotSupportedError(e);
    }
  }
  async deriveKeyPair(ikm) {
    try {
      const rawIkm = toArrayBuffer(ikm);
      const dkpPrk = await this._hkdf.labeledExtract(EMPTY.buffer, LABEL_DKP_PRK, new Uint8Array(rawIkm));
      const rawSk = await this._hkdf.labeledExpand(dkpPrk, LABEL_SK, EMPTY, this._nSk);
      const sk = new XCryptoKey(this._algName, new Uint8Array(rawSk), "private", KEM_USAGES);
      return {
        privateKey: sk,
        publicKey: await this.derivePublicKey(sk)
      };
    } catch (e) {
      throw new DeriveKeyPairError(e);
    }
  }
  derivePublicKey(key) {
    try {
      const pk = this._curve.getPublicKey(key.key);
      return Promise.resolve(new XCryptoKey(this._algName, pk, "public"));
    } catch (e) {
      return Promise.reject(new DeserializeError(e));
    }
  }
  dh(sk, pk) {
    try {
      return Promise.resolve(this._curve.getSharedSecret(sk.key, pk.key).buffer);
    } catch (e) {
      return Promise.reject(new SerializeError(e));
    }
  }
  _importRawKey(key, isPublic) {
    return new Promise((resolve, reject) => {
      if (isPublic && key.byteLength !== this._nPk) {
        reject(new Error("Invalid length of the key"));
      }
      if (!isPublic && key.byteLength !== this._nSk) {
        reject(new Error("Invalid length of the key"));
      }
      resolve(new XCryptoKey(this._algName, new Uint8Array(key), isPublic ? "public" : "private", isPublic ? [] : KEM_USAGES));
    });
  }
  _importJWK(key, isPublic) {
    return new Promise((resolve, reject) => {
      if (key.kty !== "OKP") {
        reject(new Error(`Invalid kty: ${key.kty}`));
      }
      if (key.crv !== this._algName) {
        reject(new Error(`Invalid crv: ${key.crv}`));
      }
      if (isPublic) {
        if (typeof key.d !== "undefined") {
          reject(new Error("Invalid key: `d` should not be set"));
        }
        if (typeof key.x !== "string") {
          reject(new Error("Invalid key: `x` not found"));
        }
        resolve(new XCryptoKey(this._algName, base64UrlToBytes(key.x), "public"));
      } else {
        if (typeof key.d !== "string") {
          reject(new Error("Invalid key: `d` not found"));
        }
        resolve(new XCryptoKey(this._algName, base64UrlToBytes(key.d), "private", KEM_USAGES));
      }
    });
  }
};

// node_modules/@hpke/common/esm/src/utils/noble.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n, title = "") {
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new Error(`${prefix}expected integer >0, got ${n}`);
  }
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function abignumer(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new Error("positive bigint expected, got " + n);
  } else
    anumber(n);
  return n;
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
var _endianTestBuffer = /* @__PURE__ */ new Uint32Array([287454020]);
var _endianTestBytes = /* @__PURE__ */ new Uint8Array(_endianTestBuffer.buffer);
var isLE = _endianTestBytes[0] === 68;
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  let result = N_0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = result << 8n | BigInt(bytes[i]);
  }
  return result;
}
function numberToBytesLE(n, len) {
  anumber(len);
  let v = BigInt(abignumer(n));
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== N_0)
    throw new Error("number too large");
  return result;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
function isPosBig(n) {
  return typeof n === "bigint" && N_0 <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max)) {
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
}
function randomBytes(bytesLength = 32) {
  return getCrypto().getRandomValues(new Uint8Array(bytesLength));
}

// node_modules/@hpke/common/esm/src/curve/modular.js
function mod(a, b) {
  const result = a % b;
  return result >= N_0 ? result : b + result;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > N_0) {
    res *= res;
    res %= modulo;
  }
  return res;
}

// node_modules/@hpke/common/esm/src/curve/curve.js
function createKeygen(randomSecretKey2, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey2(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@hpke/common/esm/src/curve/montgomery.js
function cmask(P2, swap) {
  return P2 + swap - (swap >> N_1 << N_1);
}
function cswap(P2) {
  const offset = 6n * P2;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P2;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts(curve) {
  if (!curve || typeof curve !== "object") {
    throw new Error("expected valid options object");
  }
  for (const name of ["adjustScalarBytes", "powPminus2"]) {
    const current = typeof curve[name];
    if (current !== "function") {
      throw new Error(`param "${name}" is invalid: expected function, got ${current}`);
    }
  }
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P: P2, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand || randomBytes;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P2);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? 9n : 5n;
  const a24 = is25519 ? 121665n : 39081n;
  const minScalar = is25519 ? N_2 ** 254n : N_2 ** 447n;
  const maxAdded = is25519 ? 8n * N_2 ** 251n - N_1 : 4n * N_2 ** 445n - N_1;
  const maxScalar = minScalar + maxAdded + N_1;
  const modP = (n) => mod(n, P2);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  const uMask = is25519 ? (N_1 << 255n) - N_1 : N_0;
  function decodeU(u) {
    abytes(u, fieldLen, "uCoordinate");
    let n = bytesToNumberLE(u);
    if (is25519)
      n &= uMask;
    return modP(n);
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(copyBytes(abytes(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    N_0,
    N_1,
    P2 - N_1,
    325606250916557431795983626356110631294008115727848805560023387167927233504n,
    39382357235489614581723060781553021112529911719440698176882885853963445705823n
  ] : [N_0, N_1, P2 - N_1]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU)) {
      throw new Error("invalid private or public key received");
    }
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === N_0)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const GuDecoded = modP(Gu);
  function scalarMultBase(scalar) {
    const pu = montgomeryLadder(GuDecoded, decodeScalar(scalar));
    if (pu === N_0)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, N_0, P2);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = N_1;
    let z_2 = N_0;
    let x_3 = u;
    let z_3 = N_1;
    const kx = k ^ k >> N_1;
    for (let t = montgomeryBits - 1; t >= 0; t--) {
      const mask2 = cmask(P2, kx >> BigInt(t));
      ({ x_2, x_3 } = swap(mask2, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask2, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C2 = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C2 * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + a24 * E));
    }
    const mask = cmask(P2, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey2 = (seed) => {
    if (seed === void 0) {
      seed = randomBytes_(fieldLen);
    }
    abytes(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey: randomSecretKey2 };
  return Object.freeze({
    keygen: createKeygen(randomSecretKey2, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// node_modules/@hpke/common/esm/src/curve/x25519.js
var _1n = 1n;
var _2n = 2n;
var _3n = 3n;
var _5n = 5n;
var ed25519_CURVE_p = 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn;
function ed25519_pow_2_252_3(x) {
  const _10n = 10n;
  const _20n = 20n;
  const _40n = 40n;
  const _80n = 80n;
  const P2 = ed25519_CURVE_p;
  const x2 = x * x % P2;
  const b2 = x2 * x % P2;
  const b4 = pow2(b2, _2n, P2) * b2 % P2;
  const b5 = pow2(b4, _1n, P2) * x % P2;
  const b10 = pow2(b5, _5n, P2) * b5 % P2;
  const b20 = pow2(b10, _10n, P2) * b10 % P2;
  const b40 = pow2(b20, _20n, P2) * b20 % P2;
  const b80 = pow2(b40, _40n, P2) * b40 % P2;
  const b160 = pow2(b80, _80n, P2) * b80 % P2;
  const b240 = pow2(b160, _80n, P2) * b80 % P2;
  const b250 = pow2(b240, _10n, P2) * b10 % P2;
  const pow_p_5_8 = pow2(b250, _2n, P2) * x % P2;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var x25519 = /* @__PURE__ */ (() => {
  const P2 = ed25519_CURVE_p;
  return montgomery({
    P: P2,
    type: "x25519",
    powPminus2: (x) => {
      const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
      return mod(pow2(pow_p_5_8, _3n, P2) * b2, P2);
    },
    adjustScalarBytes
  });
})();

// node_modules/@hpke/chacha20poly1305/esm/src/chacha/utils.js
function wrapCipher(constructor) {
  function wrappedCipher(key, nonce, AAD) {
    abytes(key, void 0, "key");
    if (!isLE) {
      throw new Error("Non little-endian hardware is not yet supported");
    }
    abytes(nonce, 12, "nonce");
    if (AAD !== void 0)
      abytes(AAD, void 0, "AAD");
    const cipher = constructor(key, nonce, AAD);
    let called = false;
    return {
      encrypt(data, output) {
        if (called) {
          throw new Error("cannot encrypt() twice with same key + nonce");
        }
        called = true;
        abytes(data);
        if (output !== void 0)
          abytes(output, void 0, "output");
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes(data);
        if (data.length < 16) {
          throw new Error('"ciphertext" expected length bigger than tagLength=16');
        }
        if (output !== void 0)
          abytes(output, void 0, "output");
        return cipher.decrypt(data, output);
      }
    };
  }
  return Object.assign(wrappedCipher, {
    blockSize: 64,
    nonceLength: 12,
    tagLength: 16
  });
}
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  if (out.length !== expectedLength) {
    throw new Error('"output" expected Uint8Array of length ' + expectedLength + ", got: " + out.length);
  }
  if (onlyAligned && !isAligned32(out)) {
    throw new Error("invalid output, must be aligned");
  }
  return out;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}

// node_modules/@hpke/chacha20poly1305/esm/src/chacha/_arx.js
var sigma32_32 = Uint32Array.of(1634760805, 857760878, 2036477234, 1797285236);
function rotl(a, b) {
  return a << b | a >>> 32 - b;
}
var BLOCK_LEN = 64;
var BLOCK_LEN32 = 16;
var MAX_COUNTER = 2 ** 32 - 1;
var U32_EMPTY = Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter) {
  const len = data.length;
  const block = new Uint8Array(BLOCK_LEN);
  const b32 = u32(block);
  const isAligned = isAligned32(data) && isAligned32(output);
  const d32 = isAligned ? u32(data) : U32_EMPTY;
  const o32 = isAligned ? u32(output) : U32_EMPTY;
  for (let pos = 0; pos < len; counter++) {
    core(sigma, key, nonce, b32, counter, 20);
    if (counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const take = Math.min(BLOCK_LEN, len - pos);
    if (isAligned && take === BLOCK_LEN) {
      const pos32 = pos / 4;
      if (pos % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let j = 0, posj; j < BLOCK_LEN32; j++) {
        posj = pos32 + j;
        o32[posj] = d32[posj] ^ b32[j];
      }
      pos += BLOCK_LEN;
      continue;
    }
    for (let j = 0, posj; j < take; j++) {
      posj = pos + j;
      output[posj] = data[posj] ^ block[j];
    }
    pos += take;
  }
}
function createCipher(core) {
  if (typeof core !== "function")
    throw new Error("core must be a function");
  return (key, nonce, data, output, counter = 0) => {
    abytes(key, 32, "arx key");
    abytes(nonce, 12, "nonce");
    abytes(data, void 0, "data");
    const len = data.length;
    if (output === void 0)
      output = new Uint8Array(len);
    abytes(output, void 0, "output");
    if (!Number.isSafeInteger(counter) || counter < 0 || counter >= MAX_COUNTER) {
      throw new Error("arx: counter overflow");
    }
    if (output.length < len) {
      throw new Error(`arx: output (${output.length}) is shorter than data (${len})`);
    }
    const keyCopy = copyBytes(key);
    const nonceCopy = isAligned32(nonce) ? void 0 : copyBytes(nonce);
    const k32 = u32(keyCopy);
    runCipher(core, sigma32_32, k32, u32(nonceCopy ?? nonce), data, output, counter);
    clean(keyCopy);
    if (nonceCopy)
      clean(nonceCopy);
    return output;
  };
}

// node_modules/@hpke/chacha20poly1305/esm/src/chacha/_poly1305.js
function u8to16(a, i) {
  return a[i++] & 255 | (a[i++] & 255) << 8;
}
var Poly1305 = class {
  // Can be speed-up using BigUint64Array, at the cost of complexity
  constructor(key) {
    Object.defineProperty(this, "buffer", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Uint8Array(16)
    });
    Object.defineProperty(this, "r", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Uint16Array(10)
    });
    Object.defineProperty(this, "r5", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Uint16Array(10)
    });
    Object.defineProperty(this, "h", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Uint16Array(10)
    });
    Object.defineProperty(this, "pad", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Uint16Array(8)
    });
    Object.defineProperty(this, "pos", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0
    });
    Object.defineProperty(this, "finished", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false
    });
    key = copyBytes(abytes(key, 32, "key"));
    const t0 = u8to16(key, 0);
    const t1 = u8to16(key, 2);
    const t2 = u8to16(key, 4);
    const t3 = u8to16(key, 6);
    const t4 = u8to16(key, 8);
    const t5 = u8to16(key, 10);
    const t6 = u8to16(key, 12);
    const t7 = u8to16(key, 14);
    this.r[0] = t0 & 8191;
    this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
    this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
    this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
    this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
    this.r[5] = t4 >>> 1 & 8190;
    this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
    this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
    this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
    this.r[9] = t7 >>> 5 & 127;
    for (let i = 0; i < 10; i++)
      this.r5[i] = 5 * this.r[i];
    for (let i = 0; i < 8; i++)
      this.pad[i] = u8to16(key, 16 + 2 * i);
  }
  process(data, offset, isLast = false) {
    const hibit = isLast ? 0 : 1 << 11;
    const { h: h2, r, r5: s } = this;
    const r0 = r[0], r1 = r[1], r2 = r[2], r3 = r[3], r4 = r[4], rr5 = r[5], r6 = r[6], r7 = r[7], r8 = r[8], r9 = r[9];
    const s1 = s[1], s2 = s[2], s3 = s[3], s4 = s[4], s5 = s[5], s6 = s[6], s7 = s[7], s8 = s[8], s9 = s[9];
    const t0 = u8to16(data, offset + 0);
    const t1 = u8to16(data, offset + 2);
    const t2 = u8to16(data, offset + 4);
    const t3 = u8to16(data, offset + 6);
    const t4 = u8to16(data, offset + 8);
    const t5 = u8to16(data, offset + 10);
    const t6 = u8to16(data, offset + 12);
    const t7 = u8to16(data, offset + 14);
    const h0 = h2[0] + (t0 & 8191);
    const h1 = h2[1] + ((t0 >>> 13 | t1 << 3) & 8191);
    const h22 = h2[2] + ((t1 >>> 10 | t2 << 6) & 8191);
    const h3 = h2[3] + ((t2 >>> 7 | t3 << 9) & 8191);
    const h4 = h2[4] + ((t3 >>> 4 | t4 << 12) & 8191);
    const h5 = h2[5] + (t4 >>> 1 & 8191);
    const h6 = h2[6] + ((t4 >>> 14 | t5 << 2) & 8191);
    const h7 = h2[7] + ((t5 >>> 11 | t6 << 5) & 8191);
    const h8 = h2[8] + ((t6 >>> 8 | t7 << 8) & 8191);
    const h9 = h2[9] + (t7 >>> 5 | hibit);
    let c = 0;
    let d0 = c + h0 * r0 + h1 * s9 + h22 * s8 + h3 * s7 + h4 * s6;
    c = d0 >>> 13;
    d0 &= 8191;
    d0 += h5 * s5 + h6 * s4 + h7 * s3 + h8 * s2 + h9 * s1;
    c += d0 >>> 13;
    d0 &= 8191;
    let d1 = c + h0 * r1 + h1 * r0 + h22 * s9 + h3 * s8 + h4 * s7;
    c = d1 >>> 13;
    d1 &= 8191;
    d1 += h5 * s6 + h6 * s5 + h7 * s4 + h8 * s3 + h9 * s2;
    c += d1 >>> 13;
    d1 &= 8191;
    let d2 = c + h0 * r2 + h1 * r1 + h22 * r0 + h3 * s9 + h4 * s8;
    c = d2 >>> 13;
    d2 &= 8191;
    d2 += h5 * s7 + h6 * s6 + h7 * s5 + h8 * s4 + h9 * s3;
    c += d2 >>> 13;
    d2 &= 8191;
    let d3 = c + h0 * r3 + h1 * r2 + h22 * r1 + h3 * r0 + h4 * s9;
    c = d3 >>> 13;
    d3 &= 8191;
    d3 += h5 * s8 + h6 * s7 + h7 * s6 + h8 * s5 + h9 * s4;
    c += d3 >>> 13;
    d3 &= 8191;
    let d4 = c + h0 * r4 + h1 * r3 + h22 * r2 + h3 * r1 + h4 * r0;
    c = d4 >>> 13;
    d4 &= 8191;
    d4 += h5 * s9 + h6 * s8 + h7 * s7 + h8 * s6 + h9 * s5;
    c += d4 >>> 13;
    d4 &= 8191;
    let d5 = c + h0 * rr5 + h1 * r4 + h22 * r3 + h3 * r2 + h4 * r1;
    c = d5 >>> 13;
    d5 &= 8191;
    d5 += h5 * r0 + h6 * s9 + h7 * s8 + h8 * s7 + h9 * s6;
    c += d5 >>> 13;
    d5 &= 8191;
    let d6 = c + h0 * r6 + h1 * rr5 + h22 * r4 + h3 * r3 + h4 * r2;
    c = d6 >>> 13;
    d6 &= 8191;
    d6 += h5 * r1 + h6 * r0 + h7 * s9 + h8 * s8 + h9 * s7;
    c += d6 >>> 13;
    d6 &= 8191;
    let d7 = c + h0 * r7 + h1 * r6 + h22 * rr5 + h3 * r4 + h4 * r3;
    c = d7 >>> 13;
    d7 &= 8191;
    d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * s9 + h9 * s8;
    c += d7 >>> 13;
    d7 &= 8191;
    let d8 = c + h0 * r8 + h1 * r7 + h22 * r6 + h3 * rr5 + h4 * r4;
    c = d8 >>> 13;
    d8 &= 8191;
    d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * s9;
    c += d8 >>> 13;
    d8 &= 8191;
    let d9 = c + h0 * r9 + h1 * r8 + h22 * r7 + h3 * r6 + h4 * rr5;
    c = d9 >>> 13;
    d9 &= 8191;
    d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
    c += d9 >>> 13;
    d9 &= 8191;
    c = (c << 2) + c | 0;
    c = c + d0 | 0;
    d0 = c & 8191;
    c = c >>> 13;
    d1 += c;
    h2[0] = d0;
    h2[1] = d1;
    h2[2] = d2;
    h2[3] = d3;
    h2[4] = d4;
    h2[5] = d5;
    h2[6] = d6;
    h2[7] = d7;
    h2[8] = d8;
    h2[9] = d9;
  }
  finalize() {
    const { h: h2, pad } = this;
    const g = new Uint16Array(10);
    let c = h2[1] >>> 13;
    h2[1] &= 8191;
    for (let i = 2; i < 10; i++) {
      h2[i] += c;
      c = h2[i] >>> 13;
      h2[i] &= 8191;
    }
    h2[0] += c * 5;
    c = h2[0] >>> 13;
    h2[0] &= 8191;
    h2[1] += c;
    c = h2[1] >>> 13;
    h2[1] &= 8191;
    h2[2] += c;
    g[0] = h2[0] + 5;
    c = g[0] >>> 13;
    g[0] &= 8191;
    for (let i = 1; i < 10; i++) {
      g[i] = h2[i] + c;
      c = g[i] >>> 13;
      g[i] &= 8191;
    }
    g[9] -= 1 << 13;
    let mask = (c ^ 1) - 1;
    for (let i = 0; i < 10; i++)
      g[i] &= mask;
    mask = ~mask;
    for (let i = 0; i < 10; i++)
      h2[i] = h2[i] & mask | g[i];
    h2[0] = (h2[0] | h2[1] << 13) & 65535;
    h2[1] = (h2[1] >>> 3 | h2[2] << 10) & 65535;
    h2[2] = (h2[2] >>> 6 | h2[3] << 7) & 65535;
    h2[3] = (h2[3] >>> 9 | h2[4] << 4) & 65535;
    h2[4] = (h2[4] >>> 12 | h2[5] << 1 | h2[6] << 14) & 65535;
    h2[5] = (h2[6] >>> 2 | h2[7] << 11) & 65535;
    h2[6] = (h2[7] >>> 5 | h2[8] << 8) & 65535;
    h2[7] = (h2[8] >>> 8 | h2[9] << 5) & 65535;
    let f = h2[0] + pad[0];
    h2[0] = f & 65535;
    for (let i = 1; i < 8; i++) {
      f = (h2[i] + pad[i] | 0) + (f >>> 16) | 0;
      h2[i] = f & 65535;
    }
    clean(g);
  }
  update(data) {
    this.assertActive();
    const { buffer } = this;
    const blockLen = 16;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(data, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(buffer, 0, false);
        this.pos = 0;
      }
    }
    return this;
  }
  destroy() {
    clean(this.h, this.r, this.r5, this.buffer, this.pad);
  }
  assertActive() {
    if (this.finished)
      throw new Error("Hash#digest() has already been called");
  }
  digest() {
    this.assertActive();
    this.finished = true;
    const { buffer, h: h2 } = this;
    let { pos } = this;
    if (pos) {
      buffer[pos++] = 1;
      for (; pos < 16; pos++)
        buffer[pos] = 0;
      this.process(buffer, 0, true);
    }
    this.finalize();
    let opos = 0;
    for (let i = 0; i < 8; i++) {
      buffer[opos++] = h2[i] >>> 0;
      buffer[opos++] = h2[i] >>> 8;
    }
    const res = buffer.slice();
    this.destroy();
    return res;
  }
};

// node_modules/@hpke/chacha20poly1305/esm/src/chacha/chacha.js
function chachaCore(s, k, n, out, cnt, rounds = 20) {
  const y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0; r < rounds; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
var chacha20 = /* @__PURE__ */ createCipher(chachaCore);
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
function computeTag(_fn, key, nonce, ciphertext, AAD) {
  abytes(key, 32, "arx key");
  const authKeyBuf = new Uint8Array(64);
  const authKey32 = u32(authKeyBuf);
  const k = copyBytes(key);
  const k32 = u32(k);
  let nonceCopy;
  if (!isAligned32(nonce))
    nonceCopy = copyBytes(nonce);
  const n32 = u32(nonceCopy ?? nonce);
  chachaCore(sigma32_32, k32, n32, authKey32, 0, 20);
  const authKey = authKeyBuf.subarray(0, 32);
  const lengths = new Uint8Array(16);
  const lview = createView(lengths);
  lview.setBigUint64(0, BigInt(AAD ? AAD.length : 0), true);
  lview.setBigUint64(8, BigInt(ciphertext.length), true);
  const h2 = new Poly1305(authKey);
  if (AAD) {
    h2.update(AAD);
    const leftover2 = AAD.length % 16;
    if (leftover2)
      h2.update(ZEROS16.subarray(leftover2));
  }
  h2.update(ciphertext);
  const leftover = ciphertext.length % 16;
  if (leftover)
    h2.update(ZEROS16.subarray(leftover));
  h2.update(lengths);
  const res = h2.digest();
  clean(authKey32, k, lengths);
  if (nonceCopy)
    clean(nonceCopy);
  return res;
}
var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
  const tagLength = 16;
  return {
    encrypt(plaintext, output) {
      const plength = plaintext.length;
      output = getOutput(plength + tagLength, output, false);
      output.set(plaintext);
      const oPlain = output.subarray(0, -tagLength);
      xorStream(key, nonce, oPlain, oPlain, 1);
      const tag = computeTag(xorStream, key, nonce, oPlain, AAD);
      output.set(tag, plength);
      clean(tag);
      return output;
    },
    decrypt(ciphertext, output) {
      output = getOutput(ciphertext.length - tagLength, output, false);
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = computeTag(xorStream, key, nonce, data, AAD);
      if (!equalBytes(passedTag, tag))
        throw new Error("invalid tag");
      output.set(ciphertext.subarray(0, -tagLength));
      xorStream(key, nonce, output, output, 1);
      clean(tag);
      return output;
    }
  };
};
var chacha20poly1305 = /* @__PURE__ */ wrapCipher(_poly1305_aead(chacha20));

// node_modules/@hpke/chacha20poly1305/esm/src/chacha20Poly1305.js
var Chacha20Poly1305Context = class {
  constructor(key) {
    Object.defineProperty(this, "_key", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._key = new Uint8Array(toArrayBuffer(key));
  }
  // Keep synchronous validation/encryption errors as Promise rejections.
  // deno-lint-ignore require-await
  async seal(iv, data, aad) {
    return chacha20poly1305(this._key, new Uint8Array(toArrayBuffer(iv)), new Uint8Array(toArrayBuffer(aad))).encrypt(new Uint8Array(toArrayBuffer(data))).buffer;
  }
  // Keep synchronous validation/authentication errors as Promise rejections.
  // deno-lint-ignore require-await
  async open(iv, data, aad) {
    return chacha20poly1305(this._key, new Uint8Array(toArrayBuffer(iv)), new Uint8Array(toArrayBuffer(aad))).decrypt(new Uint8Array(toArrayBuffer(data))).buffer;
  }
};
var Chacha20Poly1305 = class {
  constructor() {
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 3
    });
    Object.defineProperty(this, "keySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "nonceSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 12
    });
    Object.defineProperty(this, "tagSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 16
    });
  }
  createEncryptionContext(key) {
    return new Chacha20Poly1305Context(key);
  }
};

// node_modules/@hpke/core/esm/src/exporterContext.js
var LABEL_SEC = new Uint8Array([115, 101, 99]);
var ExporterContextImpl = class {
  constructor(kdf, exporterSecret) {
    Object.defineProperty(this, "exporterSecret", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_kdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._kdf = kdf;
    this.exporterSecret = exporterSecret;
  }
  seal(_data, _aad) {
    return Promise.reject(new NotSupportedError("Not supported"));
  }
  open(_data, _aad) {
    return Promise.reject(new NotSupportedError("Not supported"));
  }
  async export(exporterContext, len) {
    const rawExporterContext = toArrayBuffer(exporterContext);
    if (rawExporterContext.byteLength > INPUT_LENGTH_LIMIT) {
      throw new InvalidParamError("Too long exporter context");
    }
    try {
      return await this._kdf.labeledExpand(this.exporterSecret, LABEL_SEC, new Uint8Array(rawExporterContext), len);
    } catch (e) {
      throw new ExportError(e);
    }
  }
};
var RecipientExporterContextImpl = class extends ExporterContextImpl {
};
var SenderExporterContextImpl = class extends ExporterContextImpl {
  constructor(kdf, exporterSecret, enc) {
    super(kdf, exporterSecret);
    Object.defineProperty(this, "enc", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.enc = enc;
  }
};

// node_modules/@hpke/core/esm/src/encryptionContext.js
var EncryptionContextImpl = class extends ExporterContextImpl {
  constructor(kdf, params) {
    super(kdf, params.exporterSecret);
    Object.defineProperty(this, "_ctx", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this._ctx = {
      key: params.aead.createEncryptionContext(params.key),
      baseNonce: params.baseNonce,
      seq: params.seq
    };
  }
  computeNonce(k) {
    const seqBytes = i2Osp(k.seq, k.baseNonce.byteLength);
    return xor(k.baseNonce, seqBytes).buffer;
  }
  incrementSeq(k) {
    if (k.seq > Number.MAX_SAFE_INTEGER) {
      throw new MessageLimitReachedError("Message limit reached");
    }
    k.seq += 1;
    return;
  }
};

// node_modules/@hpke/core/esm/src/mutex.js
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var _Mutex_locked;
var Mutex = class {
  constructor() {
    _Mutex_locked.set(this, Promise.resolve());
  }
  async lock() {
    let releaseLock;
    const nextLock = new Promise((resolve) => {
      releaseLock = resolve;
    });
    const previousLock = __classPrivateFieldGet(this, _Mutex_locked, "f");
    __classPrivateFieldSet(this, _Mutex_locked, nextLock, "f");
    await previousLock;
    return releaseLock;
  }
};
_Mutex_locked = /* @__PURE__ */ new WeakMap();

// node_modules/@hpke/core/esm/src/recipientContext.js
var __classPrivateFieldGet2 = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet2 = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var _RecipientContextImpl_mutex;
var RecipientContextImpl = class extends EncryptionContextImpl {
  constructor() {
    super(...arguments);
    _RecipientContextImpl_mutex.set(this, void 0);
  }
  async open(data, aad = EMPTY.buffer) {
    __classPrivateFieldSet2(this, _RecipientContextImpl_mutex, __classPrivateFieldGet2(this, _RecipientContextImpl_mutex, "f") ?? new Mutex(), "f");
    const release = await __classPrivateFieldGet2(this, _RecipientContextImpl_mutex, "f").lock();
    let pt;
    try {
      pt = await this._ctx.key.open(this.computeNonce(this._ctx), toArrayBuffer(data), toArrayBuffer(aad));
    } catch (e) {
      throw new OpenError(e);
    } finally {
      release();
    }
    this.incrementSeq(this._ctx);
    return pt;
  }
};
_RecipientContextImpl_mutex = /* @__PURE__ */ new WeakMap();

// node_modules/@hpke/core/esm/src/senderContext.js
var __classPrivateFieldGet3 = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet3 = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var _SenderContextImpl_mutex;
var SenderContextImpl = class extends EncryptionContextImpl {
  constructor(kdf, params, enc) {
    super(kdf, params);
    Object.defineProperty(this, "enc", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    _SenderContextImpl_mutex.set(this, void 0);
    this.enc = enc;
  }
  async seal(data, aad = EMPTY.buffer) {
    __classPrivateFieldSet3(this, _SenderContextImpl_mutex, __classPrivateFieldGet3(this, _SenderContextImpl_mutex, "f") ?? new Mutex(), "f");
    const release = await __classPrivateFieldGet3(this, _SenderContextImpl_mutex, "f").lock();
    let ct;
    try {
      ct = await this._ctx.key.seal(this.computeNonce(this._ctx), toArrayBuffer(data), toArrayBuffer(aad));
    } catch (e) {
      throw new SealError(e);
    } finally {
      release();
    }
    this.incrementSeq(this._ctx);
    return ct;
  }
};
_SenderContextImpl_mutex = /* @__PURE__ */ new WeakMap();

// node_modules/@hpke/core/esm/src/utils.js
function checkAuthSupport(kem) {
  if ("auth" in kem && kem.auth === false) {
    throw new NotSupportedError("Auth and AuthPSK modes are not supported by this KEM");
  }
}

// node_modules/@hpke/core/esm/src/cipherSuiteNative.js
var LABEL_BASE_NONCE = new Uint8Array([
  98,
  97,
  115,
  101,
  95,
  110,
  111,
  110,
  99,
  101
]);
var LABEL_EXP = new Uint8Array([101, 120, 112]);
var LABEL_INFO_HASH = new Uint8Array([
  105,
  110,
  102,
  111,
  95,
  104,
  97,
  115,
  104
]);
var LABEL_KEY = new Uint8Array([107, 101, 121]);
var LABEL_PSK_ID_HASH = new Uint8Array([
  112,
  115,
  107,
  95,
  105,
  100,
  95,
  104,
  97,
  115,
  104
]);
var LABEL_SECRET = new Uint8Array([115, 101, 99, 114, 101, 116]);
var SUITE_ID_HEADER_HPKE = new Uint8Array([
  72,
  80,
  75,
  69,
  0,
  0,
  0,
  0,
  0,
  0
]);
var CipherSuiteNative = class extends NativeAlgorithm {
  /**
   * @param params A set of parameters for building a cipher suite.
   *
   * If the error occurred, throws {@link InvalidParamError}.
   *
   * @throws {@link InvalidParamError}
   */
  constructor(params) {
    super();
    Object.defineProperty(this, "_kem", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_kdf", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_aead", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "_suiteId", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    if (typeof params.kem === "number") {
      throw new InvalidParamError("KemId cannot be used");
    }
    this._kem = params.kem;
    if (typeof params.kdf === "number") {
      throw new InvalidParamError("KdfId cannot be used");
    }
    this._kdf = params.kdf;
    if (typeof params.aead === "number") {
      throw new InvalidParamError("AeadId cannot be used");
    }
    this._aead = params.aead;
    this._suiteId = new Uint8Array(SUITE_ID_HEADER_HPKE);
    this._suiteId.set(i2Osp(this._kem.id, 2), 4);
    this._suiteId.set(i2Osp(this._kdf.id, 2), 6);
    this._suiteId.set(i2Osp(this._aead.id, 2), 8);
    this._kdf.init(this._suiteId);
  }
  /**
   * Gets the KEM context of the ciphersuite.
   */
  get kem() {
    return this._kem;
  }
  /**
   * Gets the KDF context of the ciphersuite.
   */
  get kdf() {
    return this._kdf;
  }
  /**
   * Gets the AEAD context of the ciphersuite.
   */
  get aead() {
    return this._aead;
  }
  /**
   * Creates an encryption context for a sender.
   *
   * If the error occurred, throws {@link DecapError} | {@link ValidationError}.
   *
   * @param params A set of parameters for the sender encryption context.
   * @returns A sender encryption context.
   * @throws {@link NotSupportedError} if the KEM does not support authentication.
   * @throws {@link EncapError}, {@link ValidationError}
   */
  async createSenderContext(params) {
    if (params.senderKey !== void 0) {
      checkAuthSupport(this._kem);
    }
    this._validateInputLength(params);
    await this._setup();
    const dh = await this._kem.encap(params);
    const mode = (params.psk !== void 0 ? 1 : 0) | (params.senderKey !== void 0 ? 2 : 0);
    return await this._keyScheduleS(mode, dh.sharedSecret, dh.enc, params);
  }
  /**
   * Creates an encryption context for a recipient.
   *
   * If the error occurred, throws {@link DecapError}
   * | {@link DeserializeError} | {@link ValidationError}.
   *
   * @param params A set of parameters for the recipient encryption context.
   * @returns A recipient encryption context.
   * @throws {@link NotSupportedError} if the KEM does not support authentication.
   * @throws {@link DecapError}, {@link DeserializeError}, {@link ValidationError}
   */
  async createRecipientContext(params) {
    if (params.senderPublicKey !== void 0) {
      checkAuthSupport(this._kem);
    }
    this._validateInputLength(params);
    await this._setup();
    const sharedSecret = await this._kem.decap(params);
    const mode = (params.psk !== void 0 ? 1 : 0) | (params.senderPublicKey !== void 0 ? 2 : 0);
    return await this._keyScheduleR(mode, sharedSecret, params);
  }
  /**
   * Encrypts a message to a recipient.
   *
   * If the error occurred, throws `EncapError` | `MessageLimitReachedError` | `SealError` | `ValidationError`.
   *
   * @param params A set of parameters for building a sender encryption context.
   * @param pt A plain text as bytes to be encrypted.
   * @param aad Additional authenticated data as bytes fed by an application.
   * @returns A cipher text and an encapsulated key as bytes.
   * @throws {@link EncapError}, {@link MessageLimitReachedError}, {@link SealError}, {@link ValidationError}
   */
  async seal(params, pt, aad = EMPTY.buffer) {
    const ctx = await this.createSenderContext(params);
    return {
      ct: await ctx.seal(pt, aad),
      enc: ctx.enc
    };
  }
  /**
   * Decrypts a message from a sender.
   *
   * If the error occurred, throws `DecapError` | `DeserializeError` | `OpenError` | `ValidationError`.
   *
   * @param params A set of parameters for building a recipient encryption context.
   * @param ct An encrypted text as bytes to be decrypted.
   * @param aad Additional authenticated data as bytes fed by an application.
   * @returns A decrypted plain text as bytes.
   * @throws {@link DecapError}, {@link DeserializeError}, {@link OpenError}, {@link ValidationError}
   */
  async open(params, ct, aad = EMPTY.buffer) {
    const ctx = await this.createRecipientContext(params);
    return await ctx.open(ct, aad);
  }
  // private verifyPskInputs(mode: Mode, params: KeyScheduleParams) {
  //   const gotPsk = (params.psk !== undefined);
  //   const gotPskId = (params.psk !== undefined && params.psk.id.byteLength > 0);
  //   if (gotPsk !== gotPskId) {
  //     throw new Error('Inconsistent PSK inputs');
  //   }
  //   if (gotPsk && (mode === Mode.Base || mode === Mode.Auth)) {
  //     throw new Error('PSK input provided when not needed');
  //   }
  //   if (!gotPsk && (mode === Mode.Psk || mode === Mode.AuthPsk)) {
  //     throw new Error('Missing required PSK input');
  //   }
  //   return;
  // }
  async _keySchedule(mode, sharedSecret, params) {
    const pskId = params.psk === void 0 ? EMPTY : toUint8Array(params.psk.id);
    const pskIdHash = await this._kdf.labeledExtract(EMPTY, LABEL_PSK_ID_HASH, pskId);
    const info = params.info === void 0 ? EMPTY : toUint8Array(params.info);
    const infoHash = await this._kdf.labeledExtract(EMPTY, LABEL_INFO_HASH, info);
    const keyScheduleContext = concat(new Uint8Array([mode]), new Uint8Array(pskIdHash), new Uint8Array(infoHash));
    const psk = params.psk === void 0 ? EMPTY : toUint8Array(params.psk.key);
    const ikm = this._kdf.buildLabeledIkm(LABEL_SECRET, psk);
    const exporterSecretInfo = this._kdf.buildLabeledInfo(LABEL_EXP, keyScheduleContext, this._kdf.hashSize);
    const exporterSecret = await this._kdf.extractAndExpand(sharedSecret, ikm, exporterSecretInfo, this._kdf.hashSize);
    if (this._aead.id === 65535) {
      return { aead: this._aead, exporterSecret };
    }
    const keyInfo = this._kdf.buildLabeledInfo(LABEL_KEY, keyScheduleContext, this._aead.keySize);
    const key = await this._kdf.extractAndExpand(sharedSecret, ikm, keyInfo, this._aead.keySize);
    const baseNonceInfo = this._kdf.buildLabeledInfo(LABEL_BASE_NONCE, keyScheduleContext, this._aead.nonceSize);
    const baseNonce = await this._kdf.extractAndExpand(sharedSecret, ikm, baseNonceInfo, this._aead.nonceSize);
    return {
      aead: this._aead,
      exporterSecret,
      key,
      baseNonce: new Uint8Array(baseNonce),
      seq: 0
    };
  }
  async _keyScheduleS(mode, sharedSecret, enc, params) {
    const res = await this._keySchedule(mode, sharedSecret, params);
    if (res.key === void 0) {
      return new SenderExporterContextImpl(this._kdf, res.exporterSecret, enc);
    }
    return new SenderContextImpl(this._kdf, res, enc);
  }
  async _keyScheduleR(mode, sharedSecret, params) {
    const res = await this._keySchedule(mode, sharedSecret, params);
    if (res.key === void 0) {
      return new RecipientExporterContextImpl(this._kdf, res.exporterSecret);
    }
    return new RecipientContextImpl(this._kdf, res);
  }
  _validateInputLength(params) {
    if (params.info !== void 0 && params.info.byteLength > INFO_LENGTH_LIMIT) {
      throw new InvalidParamError("Too long info");
    }
    if (params.psk !== void 0) {
      if (params.psk.key.byteLength < MINIMUM_PSK_LENGTH) {
        throw new InvalidParamError(`PSK must have at least ${MINIMUM_PSK_LENGTH} bytes`);
      }
      if (params.psk.key.byteLength > INPUT_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long psk.key");
      }
      if (params.psk.id.byteLength > INPUT_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long psk.id");
      }
    }
    return;
  }
};

// node_modules/@hpke/core/esm/src/native.js
var CipherSuite = class extends CipherSuiteNative {
};

// node_modules/@hpke/dhkem-x25519/esm/src/hkdfSha256.js
var HkdfSha2562 = class extends HkdfSha256Native {
};

// node_modules/@hpke/dhkem-x25519/esm/src/dhkemX25519.js
var X25519 = class extends XCurveDhkemPrimitives {
  constructor(hkdf) {
    super("X25519", 32, x25519, hkdf);
  }
  derive(sk, pk) {
    try {
      return Promise.resolve(this._curve.getSharedSecret(sk, pk));
    } catch (e) {
      return Promise.reject(new SerializeError(e));
    }
  }
};
var DhkemX25519HkdfSha256 = class extends Dhkem {
  constructor() {
    const kdf = new HkdfSha2562();
    super(32, new X25519(kdf), kdf);
    Object.defineProperty(this, "id", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "secretSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "encSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "publicKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
    Object.defineProperty(this, "privateKeySize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 32
    });
  }
};

// node_modules/@noble/ed25519/index.js
var ed25519_CURVE = {
  p: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffedn,
  n: 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn,
  h: 8n,
  a: 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffecn,
  d: 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3n,
  Gx: 0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51an,
  Gy: 0x6666666666666666666666666666666666666666666666666666666666666658n
};
var { p: P, n: N, Gx, Gy, a: _a, d: _d, h } = ed25519_CURVE;
var L = 32;
var L2 = 64;
var captureTrace = (...args) => {
  if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(...args);
  }
};
var err = (message = "") => {
  const e = new Error(message);
  captureTrace(e, err);
  throw e;
};
var isBig = (n) => typeof n === "bigint";
var isStr = (s) => typeof s === "string";
var isBytes2 = (a) => a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
var abytes2 = (value, length, title = "") => {
  const bytes = isBytes2(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    err(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
};
var u8n = (len) => new Uint8Array(len);
var u8fr = (buf) => Uint8Array.from(buf);
var padh = (n, pad) => n.toString(16).padStart(pad, "0");
var bytesToHex = (b) => Array.from(abytes2(b)).map((e) => padh(e, 2)).join("");
var C = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
var _ch = (ch) => {
  if (ch >= C._0 && ch <= C._9)
    return ch - C._0;
  if (ch >= C.A && ch <= C.F)
    return ch - (C.A - 10);
  if (ch >= C.a && ch <= C.f)
    return ch - (C.a - 10);
  return;
};
var hexToBytes2 = (hex) => {
  const e = "hex invalid";
  if (!isStr(hex))
    return err(e);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    return err(e);
  const array = u8n(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = _ch(hex.charCodeAt(hi));
    const n2 = _ch(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0)
      return err(e);
    array[ai] = n1 * 16 + n2;
  }
  return array;
};
var cr = () => globalThis?.crypto;
var subtle = () => cr()?.subtle ?? err("crypto.subtle must be defined, consider polyfill");
var concatBytes = (...arrs) => {
  const r = u8n(arrs.reduce((sum, a) => sum + abytes2(a).length, 0));
  let pad = 0;
  arrs.forEach((a) => {
    r.set(a, pad);
    pad += a.length;
  });
  return r;
};
var randomBytes2 = (len = L) => {
  const c = cr();
  return c.getRandomValues(u8n(len));
};
var big = BigInt;
var assertRange = (n, min, max, msg = "bad number: out of range") => isBig(n) && min <= n && n < max ? n : err(msg);
var M = (a, b = P) => {
  const r = a % b;
  return r >= 0n ? r : b + r;
};
var modN = (a) => M(a, N);
var invert = (num, md) => {
  if (num === 0n || md <= 0n)
    err("no inverse n=" + num + " mod=" + md);
  let a = M(num, md), b = md, x = 0n, y = 1n, u = 1n, v = 0n;
  while (a !== 0n) {
    const q = b / a, r = b % a;
    const m = x - u * q, n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  return b === 1n ? M(x, md) : err("no inverse");
};
var apoint = (p) => p instanceof Point ? p : err("Point expected");
var B256 = 2n ** 256n;
var Point = class _Point {
  static BASE;
  static ZERO;
  X;
  Y;
  Z;
  T;
  constructor(X, Y, Z, T) {
    const max = B256;
    this.X = assertRange(X, 0n, max);
    this.Y = assertRange(Y, 0n, max);
    this.Z = assertRange(Z, 1n, max);
    this.T = assertRange(T, 0n, max);
    Object.freeze(this);
  }
  static CURVE() {
    return ed25519_CURVE;
  }
  static fromAffine(p) {
    return new _Point(p.x, p.y, 1n, M(p.x * p.y));
  }
  /** RFC8032 5.1.3: Uint8Array to Point. */
  static fromBytes(hex, zip215 = false) {
    const d = _d;
    const normed = u8fr(abytes2(hex, L));
    const lastByte = hex[31];
    normed[31] = lastByte & ~128;
    const y = bytesToNumLE(normed);
    const max = zip215 ? B256 : P;
    assertRange(y, 0n, max);
    const y2 = M(y * y);
    const u = M(y2 - 1n);
    const v = M(d * y2 + 1n);
    let { isValid, value: x } = uvRatio(u, v);
    if (!isValid)
      err("bad point: y not sqrt");
    const isXOdd = (x & 1n) === 1n;
    const isLastByteOdd = (lastByte & 128) !== 0;
    if (!zip215 && x === 0n && isLastByteOdd)
      err("bad point: x==0, isLastByteOdd");
    if (isLastByteOdd !== isXOdd)
      x = M(-x);
    return new _Point(x, y, 1n, M(x * y));
  }
  static fromHex(hex, zip215) {
    return _Point.fromBytes(hexToBytes2(hex), zip215);
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  /** Checks if the point is valid and on-curve. */
  assertValidity() {
    const a = _a;
    const d = _d;
    const p = this;
    if (p.is0())
      return err("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = M(X * X);
    const Y2 = M(Y * Y);
    const Z2 = M(Z * Z);
    const Z4 = M(Z2 * Z2);
    const aX2 = M(X2 * a);
    const left = M(Z2 * M(aX2 + Y2));
    const right = M(Z4 + M(d * M(X2 * Y2)));
    if (left !== right)
      return err("bad point: equation left != right (1)");
    const XY = M(X * Y);
    const ZT = M(Z * T);
    if (XY !== ZT)
      return err("bad point: equation left != right (2)");
    return this;
  }
  /** Equality check: compare points P&Q. */
  equals(other) {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
    const X1Z2 = M(X1 * Z2);
    const X2Z1 = M(X2 * Z1);
    const Y1Z2 = M(Y1 * Z2);
    const Y2Z1 = M(Y2 * Z1);
    return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
  }
  is0() {
    return this.equals(I);
  }
  /** Flip point over y coordinate. */
  negate() {
    return new _Point(M(-this.X), this.Y, this.Z, M(-this.T));
  }
  /** Point doubling. Complete formula. Cost: `4M + 4S + 1*a + 6add + 1*2`. */
  double() {
    const { X: X1, Y: Y1, Z: Z1 } = this;
    const a = _a;
    const A = M(X1 * X1);
    const B = M(Y1 * Y1);
    const C2 = M(2n * M(Z1 * Z1));
    const D = M(a * A);
    const x1y1 = X1 + Y1;
    const E = M(M(x1y1 * x1y1) - A - B);
    const G2 = D + B;
    const F = G2 - C2;
    const H = D - B;
    const X3 = M(E * F);
    const Y3 = M(G2 * H);
    const T3 = M(E * H);
    const Z3 = M(F * G2);
    return new _Point(X3, Y3, Z3, T3);
  }
  /** Point addition. Complete formula. Cost: `8M + 1*k + 8add + 1*2`. */
  add(other) {
    const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
    const { X: X2, Y: Y2, Z: Z2, T: T2 } = apoint(other);
    const a = _a;
    const d = _d;
    const A = M(X1 * X2);
    const B = M(Y1 * Y2);
    const C2 = M(T1 * d * T2);
    const D = M(Z1 * Z2);
    const E = M((X1 + Y1) * (X2 + Y2) - A - B);
    const F = M(D - C2);
    const G2 = M(D + C2);
    const H = M(B - a * A);
    const X3 = M(E * F);
    const Y3 = M(G2 * H);
    const T3 = M(E * H);
    const Z3 = M(F * G2);
    return new _Point(X3, Y3, Z3, T3);
  }
  subtract(other) {
    return this.add(apoint(other).negate());
  }
  /**
   * Point-by-scalar multiplication. Scalar must be in range 1 <= n < CURVE.n.
   * Uses {@link wNAF} for base point.
   * Uses fake point to mitigate side-channel leakage.
   * @param n scalar by which point is multiplied
   * @param safe safe mode guards against timing attacks; unsafe mode is faster
   */
  multiply(n, safe = true) {
    if (!safe && (n === 0n || this.is0()))
      return I;
    assertRange(n, 1n, N);
    if (n === 1n)
      return this;
    if (this.equals(G))
      return wNAF(n).p;
    let p = I;
    let f = G;
    for (let d = this; n > 0n; d = d.double(), n >>= 1n) {
      if (n & 1n)
        p = p.add(d);
      else if (safe)
        f = f.add(d);
    }
    return p;
  }
  multiplyUnsafe(scalar) {
    return this.multiply(scalar, false);
  }
  /** Convert point to 2d xy affine point. (X, Y, Z) ∋ (x=X/Z, y=Y/Z) */
  toAffine() {
    const { X, Y, Z } = this;
    if (this.equals(I))
      return { x: 0n, y: 1n };
    const iz = invert(Z, P);
    if (M(Z * iz) !== 1n)
      err("invalid inverse");
    const x = M(X * iz);
    const y = M(Y * iz);
    return { x, y };
  }
  toBytes() {
    const { x, y } = this.assertValidity().toAffine();
    const b = numTo32bLE(y);
    b[31] |= x & 1n ? 128 : 0;
    return b;
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  clearCofactor() {
    return this.multiply(big(h), false);
  }
  isSmallOrder() {
    return this.clearCofactor().is0();
  }
  isTorsionFree() {
    let p = this.multiply(N / 2n, false).double();
    if (N % 2n)
      p = p.add(this);
    return p.is0();
  }
};
var G = new Point(Gx, Gy, 1n, M(Gx * Gy));
var I = new Point(0n, 1n, 1n, 0n);
Point.BASE = G;
Point.ZERO = I;
var numTo32bLE = (num) => hexToBytes2(padh(assertRange(num, 0n, B256), L2)).reverse();
var bytesToNumLE = (b) => big("0x" + bytesToHex(u8fr(abytes2(b)).reverse()));
var pow22 = (x, power) => {
  let r = x;
  while (power-- > 0n) {
    r *= r;
    r %= P;
  }
  return r;
};
var pow_2_252_3 = (x) => {
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow22(b2, 2n) * b2 % P;
  const b5 = pow22(b4, 1n) * x % P;
  const b10 = pow22(b5, 5n) * b5 % P;
  const b20 = pow22(b10, 10n) * b10 % P;
  const b40 = pow22(b20, 20n) * b20 % P;
  const b80 = pow22(b40, 40n) * b40 % P;
  const b160 = pow22(b80, 80n) * b80 % P;
  const b240 = pow22(b160, 80n) * b80 % P;
  const b250 = pow22(b240, 10n) * b10 % P;
  const pow_p_5_8 = pow22(b250, 2n) * x % P;
  return { pow_p_5_8, b2 };
};
var RM1 = 0x2b8324804fc1df0b2b4d00993dfbd7a72f431806ad2fe478c4ee1b274a0ea0b0n;
var uvRatio = (u, v) => {
  const v3 = M(v * v * v);
  const v7 = M(v3 * v3 * v);
  const pow = pow_2_252_3(u * v7).pow_p_5_8;
  let x = M(u * v3 * pow);
  const vx2 = M(v * x * x);
  const root1 = x;
  const root2 = M(x * RM1);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === M(-u);
  const noRoot = vx2 === M(-u * RM1);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if ((M(x) & 1n) === 1n)
    x = M(-x);
  return { isValid: useRoot1 || useRoot2, value: x };
};
var modL_LE = (hash) => modN(bytesToNumLE(hash));
var sha512a = (...m) => hashes.sha512Async(concatBytes(...m));
var hash2extK = (hashed) => {
  const head = hashed.slice(0, L);
  head[0] &= 248;
  head[31] &= 127;
  head[31] |= 64;
  const prefix = hashed.slice(L, L2);
  const scalar = modL_LE(head);
  const point = G.multiply(scalar);
  const pointBytes = point.toBytes();
  return { head, prefix, scalar, point, pointBytes };
};
var getExtendedPublicKeyAsync = (secretKey) => sha512a(abytes2(secretKey, L)).then(hash2extK);
var getPublicKeyAsync = (secretKey) => getExtendedPublicKeyAsync(secretKey).then((p) => p.pointBytes);
var hashFinishA = (res) => sha512a(res.hashable).then(res.finish);
var _sign = (e, rBytes, msg) => {
  const { pointBytes: P2, scalar: s } = e;
  const r = modL_LE(rBytes);
  const R = G.multiply(r).toBytes();
  const hashable = concatBytes(R, P2, msg);
  const finish = (hashed) => {
    const S = modN(r + modL_LE(hashed) * s);
    return abytes2(concatBytes(R, numTo32bLE(S)), L2);
  };
  return { hashable, finish };
};
var signAsync = async (message, secretKey) => {
  const m = abytes2(message);
  const e = await getExtendedPublicKeyAsync(secretKey);
  const rBytes = await sha512a(e.prefix, m);
  return hashFinishA(_sign(e, rBytes, m));
};
var defaultVerifyOpts = { zip215: true };
var _verify = (sig, msg, pub, opts = defaultVerifyOpts) => {
  sig = abytes2(sig, L2);
  msg = abytes2(msg);
  pub = abytes2(pub, L);
  const { zip215 } = opts;
  let A;
  let R;
  let s;
  let SB;
  let hashable = Uint8Array.of();
  try {
    A = Point.fromBytes(pub, zip215);
    R = Point.fromBytes(sig.slice(0, L), zip215);
    s = bytesToNumLE(sig.slice(L, L2));
    SB = G.multiply(s, false);
    hashable = concatBytes(R.toBytes(), A.toBytes(), msg);
  } catch (error) {
  }
  const finish = (hashed) => {
    if (SB == null)
      return false;
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = modL_LE(hashed);
    const RkA = R.add(A.multiply(k, false));
    return RkA.add(SB.negate()).clearCofactor().is0();
  };
  return { hashable, finish };
};
var verifyAsync = async (signature, message, publicKey, opts = defaultVerifyOpts) => hashFinishA(_verify(signature, message, publicKey, opts));
var hashes = {
  sha512Async: async (message) => {
    const s = subtle();
    const m = concatBytes(message);
    return u8n(await s.digest("SHA-512", m.buffer));
  },
  sha512: void 0
};
var randomSecretKey = (seed = randomBytes2(L)) => seed;
var keygenAsync = async (seed) => {
  const secretKey = randomSecretKey(seed);
  const publicKey = await getPublicKeyAsync(secretKey);
  return { secretKey, publicKey };
};
var W = 8;
var scalarBits = 256;
var pwindows = Math.ceil(scalarBits / W) + 1;
var pwindowSize = 2 ** (W - 1);
var precompute = () => {
  const points = [];
  let p = G;
  let b = p;
  for (let w = 0; w < pwindows; w++) {
    b = p;
    points.push(b);
    for (let i = 1; i < pwindowSize; i++) {
      b = b.add(p);
      points.push(b);
    }
    p = b.double();
  }
  return points;
};
var Gpows = void 0;
var ctneg = (cnd, p) => {
  const n = p.negate();
  return cnd ? n : p;
};
var wNAF = (n) => {
  const comp = Gpows || (Gpows = precompute());
  let p = I;
  let f = G;
  const pow_2_w = 2 ** W;
  const maxNum = pow_2_w;
  const mask = big(pow_2_w - 1);
  const shiftBy = big(W);
  for (let w = 0; w < pwindows; w++) {
    let wbits = Number(n & mask);
    n >>= shiftBy;
    if (wbits > pwindowSize) {
      wbits -= maxNum;
      n += 1n;
    }
    const off = w * pwindowSize;
    const offF = off;
    const offP = off + Math.abs(wbits) - 1;
    const isEven = w % 2 !== 0;
    const isNeg = wbits < 0;
    if (wbits === 0) {
      f = f.add(ctneg(isEven, comp[offF]));
    } else {
      p = p.add(ctneg(isNeg, comp[offP]));
    }
  }
  if (n !== 0n)
    err("invalid wnaf");
  return { p, f };
};

// src/protocol.ts
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function agentIdFromSigningKey(signingPublicKey) {
  const key = fromBase64url(signingPublicKey);
  if (key.byteLength !== 32) throw new Error("an Ed25519 public key must be 32 bytes");
  return `at1_${signingPublicKey}`;
}
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
function authMessage(action, agentId, timestamp, payload) {
  return new TextEncoder().encode(`${action}
${agentId}
${timestamp}
${stableJson(payload)}`);
}
function envelopeAad(envelope) {
  return new TextEncoder().encode(stableJson({
    ...envelope.version === 2 ? { protocol: "agent-talk/typed-direct", version: 2 } : {},
    id: envelope.id,
    senderId: envelope.senderId,
    recipientId: envelope.recipientId,
    createdAt: envelope.createdAt
  }));
}

// src/auth.ts
async function signRequestWithKey(secretKey, agentId, action, timestamp, payload) {
  return base64url(await signAsync(authMessage(action, agentId, timestamp, payload), fromBase64url(secretKey)));
}
async function verifyRequest(signingPublicKey, action, agentId, timestamp, payload, signature) {
  try {
    return await verifyAsync(fromBase64url(signature), authMessage(action, agentId, timestamp, payload), fromBase64url(signingPublicKey), { zip215: false });
  } catch {
    return false;
  }
}

// src/validation.ts
var CLOCK_SKEW = 5 * 6e4;

// src/crypto.ts
var suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha2562(),
  aead: new Chacha20Poly1305()
});
async function createLocalIdentity() {
  const signing = await keygenAsync();
  const encryption = await suite.kem.generateKeyPair();
  return {
    signingPublicKey: base64url(signing.publicKey),
    signingSecretKey: base64url(signing.secretKey),
    encryptionPublicKey: base64url(new Uint8Array(await suite.kem.serializePublicKey(encryption.publicKey))),
    encryptionSecretKey: base64url(new Uint8Array(await suite.kem.serializePrivateKey(encryption.privateKey))),
    agentId: agentIdFromSigningKey(base64url(signing.publicKey))
  };
}
async function signRequest(identity, action, timestamp, payload) {
  return signRequestWithKey(identity.signingSecretKey, identity.agentId, action, timestamp, payload);
}
async function openBytes(identity, sender, envelope) {
  if (envelope.recipientId !== identity.agentId || envelope.senderId !== sender.agentId) throw new Error("envelope route mismatch");
  const recipientKey = await suite.kem.deserializePrivateKey(fromBase64url(identity.encryptionSecretKey));
  const senderPublicKey = await suite.kem.deserializePublicKey(fromBase64url(sender.encryptionPublicKey));
  const context = await suite.createRecipientContext({ recipientKey, senderPublicKey, enc: fromBase64url(envelope.enc) });
  return context.open(fromBase64url(envelope.ciphertext), envelopeAad(envelope));
}
async function openOwnerCopy(identity, sender, envelope) {
  if (envelope.version !== 1) throw new Error("Expected an owner copy envelope.");
  const bytes = await openBytes(identity, sender, envelope);
  if (bytes.byteLength === 0 || bytes.byteLength > 9e4) throw new Error("Invalid owner copy size.");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

// portal/pairing.ts
function validate(request, now) {
  if (Object.keys(request).sort().join(",") !== "accountId,agentId,device,expiresAt,nonce" || Object.keys(request.device).sort().join(",") !== "agentId,encryptionPublicKey,signingPublicKey" || !/^at1_[A-Za-z0-9_-]{43}$/.test(request.agentId) || !/^[1-9][0-9]{0,19}$/.test(request.accountId) || !/^[A-Za-z0-9_-]{43}$/.test(request.nonce) || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now || request.expiresAt > now + 5 * 6e4 || agentIdFromSigningKey(request.device.signingPublicKey) !== request.device.agentId || fromBase64url(request.device.encryptionPublicKey).length !== 32) {
    throw new Error("Invalid or expired pairing request.");
  }
}
async function verifyPairing(approval, expectedAccount, pinnedAgent, now = Date.now()) {
  const { request, signature } = approval;
  validate(request, now);
  if (request.accountId !== expectedAccount || request.agentId !== pinnedAgent.agentId || agentIdFromSigningKey(pinnedAgent.signingPublicKey) !== pinnedAgent.agentId || approval.agent.agentId !== pinnedAgent.agentId || approval.agent.signingPublicKey !== pinnedAgent.signingPublicKey || fromBase64url(approval.agent.encryptionPublicKey).length !== 32 || !await verifyRequest(
    pinnedAgent.signingPublicKey,
    "owner-device-identity-v1",
    pinnedAgent.agentId,
    String(request.expiresAt),
    { request, agent: approval.agent },
    approval.identitySignature
  ) || !await verifyRequest(
    pinnedAgent.signingPublicKey,
    "owner-device-pairing-v1",
    pinnedAgent.agentId,
    String(request.expiresAt),
    request,
    signature
  )) {
    throw new Error("Pairing approval does not match the account and pinned agent.");
  }
}

// portal/browser.ts
var element = (id) => document.getElementById(id);
var status = element("status");
var accountId = "";
var pending;
var selectionVersion = 0;
function database() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("agent-talk-owner-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("devices");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}
async function deviceRecord(agentId, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("devices", value ? "readwrite" : "readonly");
      const store = transaction.objectStore("devices");
      const request = value ? store.put(value, accountId + ":" + agentId) : store.get(accountId + ":" + agentId);
      let result;
      request.onsuccess = () => {
        if (!value) result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
async function api(path, body, extraHeaders = {}) {
  const response = await fetch(path, {
    method: body === void 0 ? "GET" : "POST",
    headers: body === void 0 ? extraHeaders : { "content-type": "application/json", ...extraHeaders },
    ...body === void 0 ? {} : { body: JSON.stringify(body) },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error"
  });
  if (!response.ok) throw new Error("The request failed (" + response.status + ").");
  return response.json();
}
function run(action) {
  return () => {
    void action().catch((error) => {
      status.textContent = error instanceof Error ? error.message : "Request failed.";
    });
  };
}
async function listAgents() {
  const { agents } = await api("/agents");
  const container = element("agents");
  container.replaceChildren();
  for (const entry of agents) {
    const button = document.createElement("button");
    button.textContent = entry.agentId;
    button.addEventListener("click", run(() => readAgent(entry.agentId)));
    container.append(button);
    const record = await deviceRecord(entry.agentId);
    if (record && entry.devices.some((device) => device.agentId === record.device.agentId)) {
      const revoke = document.createElement("button");
      revoke.textContent = "Revoke this browser";
      revoke.addEventListener("click", run(async () => {
        if (!window.confirm("Revoke this browser's access to agent " + entry.agentId + "?")) return;
        selectionVersion++;
        element("messages").replaceChildren();
        await api("/device/revoke", { agentId: entry.agentId, deviceId: record.device.agentId });
        status.textContent = "Browser access revoked.";
        await listAgents();
      }));
      container.append(revoke);
    }
  }
}
async function readAgent(agentId) {
  const selection = ++selectionVersion;
  const container = element("messages");
  container.replaceChildren();
  const record = await deviceRecord(agentId);
  if (!record?.agent) throw new Error("Pair this browser with the agent before reading.");
  const body = { agentId, deviceId: record.device.agentId, nonce: base64url(crypto.getRandomValues(new Uint8Array(32))) };
  const timestamp = String(Date.now());
  const signature = await signRequest(record.device, "owner-copy-read-v1", timestamp, { ...body, accountId });
  const { copies } = await api("/copy/read", body, { "x-device-timestamp": timestamp, "x-device-signature": signature });
  const threads = /* @__PURE__ */ new Map();
  for (const copy of copies) {
    const message = JSON.parse(await openOwnerCopy(record.device, record.agent, copy));
    if (typeof message.text !== "string" || typeof message.senderId !== "string" || typeof message.receivedAt !== "number") throw new Error("Invalid encrypted message.");
    const threadId = typeof message.direct?.threadId === "string" ? message.direct.threadId : "Other messages";
    const thread = typeof message.groupId === "string" ? "Group " + message.groupId + " \xB7 " + threadId : threadId;
    const entries = threads.get(thread) ?? [];
    entries.push({ text: message.text, senderId: message.senderId, time: message.receivedAt });
    threads.set(thread, entries);
  }
  const fragment = document.createDocumentFragment();
  for (const [thread, entries] of threads) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = thread === "Other messages" ? thread : "Thread " + thread;
    section.append(heading);
    entries.sort((left, right) => left.time - right.time);
    for (const entry of entries) {
      const article = document.createElement("article");
      const label = document.createElement("strong");
      label.textContent = entry.senderId === agentId ? "Your agent" : entry.senderId;
      const text = document.createElement("p");
      text.textContent = entry.text;
      article.append(label, text);
      section.append(article);
    }
    fragment.append(section);
  }
  if (selection !== selectionVersion) return;
  container.replaceChildren(fragment);
  status.textContent = "Messages loaded.";
}
element("login").onclick = run(async () => {
  const { url } = await api("/auth/login", {});
  const target = new URL(url);
  if (target.origin !== "https://github.com" || target.pathname !== "/login/oauth/authorize") throw new Error("Invalid login destination.");
  location.assign(target.href);
});
element("logout").onclick = run(async () => {
  selectionVersion++;
  element("messages").replaceChildren();
  await api("/auth/logout", {});
  location.reload();
});
element("start-pairing").onclick = run(async () => {
  const agentId = element("agent-id").value.trim();
  const existing = await deviceRecord(agentId);
  const device = existing?.device ?? await createLocalIdentity();
  const identity = { agentId: device.agentId, signingPublicKey: device.signingPublicKey, encryptionPublicKey: device.encryptionPublicKey };
  const { request } = await api("/pairing/start", { agentId, device: identity });
  await deviceRecord(agentId, { device, ...existing?.agent && { agent: existing.agent } });
  pending = { request, device };
  element("pair-request").value = JSON.stringify(request);
  status.textContent = "Request created. Ask the agent owner to approve it.";
});
element("complete-pairing").onclick = run(async () => {
  if (!pending) throw new Error("Create a pairing request first.");
  const approval = JSON.parse(element("pair-approval").value);
  if (JSON.stringify(approval.request) !== JSON.stringify(pending.request)) throw new Error("The approval does not match this request.");
  const agentId = pending.request.agentId;
  await verifyPairing(approval, accountId, { agentId, signingPublicKey: agentId.slice(4), encryptionPublicKey: "" });
  await api("/pairing/complete", { approval });
  await deviceRecord(agentId, { device: pending.device, agent: approval.agent });
  pending = void 0;
  status.textContent = "Device paired.";
  await listAgents();
});
element("deny-pairing").onclick = run(async () => {
  if (pending) await api("/pairing/deny", { nonce: pending.request.nonce });
  pending = void 0;
  element("pair-request").value = "";
  status.textContent = "Pairing cancelled.";
});
void (async () => {
  try {
    const account = await api("/auth/account");
    accountId = account.accountId;
    element("owner").hidden = false;
    status.textContent = "Signed in to GitHub account " + accountId + ".";
    await listAgents();
  } catch {
    element("login").hidden = false;
    status.textContent = "Sign in to continue.";
  }
})();
/*! Bundled license information:

@hpke/common/esm/src/curve/modular.js:
@hpke/common/esm/src/curve/montgomery.js:
@hpke/common/esm/src/curve/x25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/ed25519/index.js:
  (*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) *)
*/
