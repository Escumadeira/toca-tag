// TOCA tag - cartão do aluno na Carteira da Apple e na Carteira do Google.
// Só funciona depois de preencher a pasta "carteira" (veja carteira/COMO-ATIVAR.txt).
const fs = require("fs"), path = require("path"), crypto = require("crypto"), zlib = require("zlib");

const DIR = path.join(__dirname, "carteira");
const A = f => path.join(DIR, "apple", f), G = f => path.join(DIR, "google", f);
const has = f => { try { return fs.statSync(f).size > 0; } catch (e) { return false; } };
function cfg() { try { return JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8")); } catch (e) { return {}; } }

function appleReady() { const c = cfg().apple || {}; return !!(c.passTypeIdentifier && c.teamIdentifier && has(A("pass.pem")) && has(A("pass.key")) && has(A("wwdr.pem"))); }
function googleReady() { const c = cfg().google || {}; return !!(c.issuerId && has(G("service-account.json"))); }
function status() {
  const c = cfg();
  return { apple: appleReady(), google: googleReady(),
    appleNfc: appleReady() && !!(c.apple.nfc && c.apple.nfc.encryptionPublicKey),
    googleNfc: googleReady() && !!(c.google.smartTap && (c.google.smartTap.redemptionIssuers || []).length) };
}

/* ---------- zip sem compressão (o .pkpass é um zip) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { if (zlib.crc32) return zlib.crc32(buf); let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, "utf8"), crc = crc32(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* ---------- Apple Wallet (.pkpass) ---------- */
function applePass(info) {
  const forge = require("./lib/forge.cjs"), c = cfg().apple;
  const pass = {
    formatVersion: 1, passTypeIdentifier: c.passTypeIdentifier, teamIdentifier: c.teamIdentifier,
    organizationName: c.organizationName || "TOCA tag", serialNumber: info.serial, description: "Cartão de presença TOCA tag",
    logoText: info.tenantName, foregroundColor: "rgb(36,26,8)", backgroundColor: "rgb(220,184,114)", labelColor: "rgb(96,70,28)",
    generic: {
      primaryFields: [{ key: "nome", label: "ALUNO", value: info.name }],
      secondaryFields: [{ key: "ra", label: info.raLabel.toUpperCase(), value: info.ra }].concat(info.course ? [{ key: "curso", label: info.courseLabel.toUpperCase(), value: info.course }] : []),
      backFields: [{ key: "uso", label: "Como usar", value: "Mostre o QR code ao professor na hora da chamada. Este cartão é pessoal." }]
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: info.payload, messageEncoding: "iso-8859-1", altText: info.raLabel + " " + info.ra }]
  };
  // NFC: só tem efeito com o certificado NFC da Apple e um leitor compatível (VAS).
  if (c.nfc && c.nfc.encryptionPublicKey) pass.nfc = { message: info.payload, encryptionPublicKey: c.nfc.encryptionPublicKey };

  const files = [["pass.json", Buffer.from(JSON.stringify(pass), "utf8")]];
  for (const f of ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png"]) if (has(A("modelo/" + f))) files.push([f, fs.readFileSync(A("modelo/" + f))]);
  const manifest = {}; for (const [n, d] of files) manifest[n] = crypto.createHash("sha1").update(d).digest("hex");
  const mbuf = Buffer.from(JSON.stringify(manifest), "utf8");

  const cert = forge.pki.certificateFromPem(fs.readFileSync(A("pass.pem"), "utf8"));
  const wwdr = forge.pki.certificateFromPem(fs.readFileSync(A("wwdr.pem"), "utf8"));
  const keyPem = fs.readFileSync(A("pass.key"), "utf8");
  const key = c.keyPassword ? forge.pki.decryptRsaPrivateKey(keyPem, c.keyPassword) : forge.pki.privateKeyFromPem(keyPem);
  if (!key) throw new Error("Não foi possível abrir a chave do certificado da Apple (senha incorreta?).");
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(mbuf.toString("binary"));
  p7.addCertificate(cert); p7.addCertificate(wwdr);
  p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [
    { type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() }] });
  p7.sign({ detached: true });
  const sig = Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), "binary");
  return zip([...files, ["manifest.json", mbuf], ["signature", sig]]);
}

/* ---------- Google Wallet (link "Adicionar à Carteira") ---------- */
const b64 = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function googleLink(info) {
  const c = cfg().google, sa = JSON.parse(fs.readFileSync(G("service-account.json"), "utf8"));
  const txt = v => ({ defaultValue: { language: "pt-BR", value: String(v) } });
  const classId = c.issuerId + "." + (c.classSuffix || "tocatag_aluno");
  const cls = { id: classId };
  const obj = {
    id: c.issuerId + "." + info.serial.replace(/[^A-Za-z0-9._-]/g, "_"), classId, state: "ACTIVE", hexBackgroundColor: "#dcb872",
    cardTitle: txt(info.tenantName), subheader: txt("Aluno"), header: txt(info.name),
    barcode: { type: "QR_CODE", value: info.payload, alternateText: info.raLabel + " " + info.ra },
    textModulesData: [{ id: "ra", header: info.raLabel, body: String(info.ra) }].concat(info.course ? [{ id: "curso", header: info.courseLabel, body: String(info.course) }] : [])
  };
  if (c.logoUrl) obj.logo = { sourceUri: { uri: c.logoUrl }, contentDescription: txt("TOCA tag") };
  // NFC (Smart Tap): só tem efeito com um leitor Smart Tap certificado.
  if (c.smartTap && (c.smartTap.redemptionIssuers || []).length) { cls.enableSmartTap = true; cls.redemptionIssuers = c.smartTap.redemptionIssuers; obj.smartTapRedemptionValue = info.payload; }
  const claims = { iss: sa.client_email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now() / 1000), origins: c.origins || [], payload: { genericClasses: [cls], genericObjects: [obj] } };
  const head = b64({ alg: "RS256", typ: "JWT" }) + "." + b64(claims);
  const sig = crypto.createSign("RSA-SHA256").update(head).sign(sa.private_key).toString("base64url");
  return "https://pay.google.com/gp/v/save/" + head + "." + sig;
}

module.exports = { status, appleReady, googleReady, applePass, googleLink };
