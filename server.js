require("./licenca.js").proteger(); // trava: o TOCA tag só roda no computador autorizado (ver licenca.js)
// TOCA tag - servidor para várias instituições (faculdades e escolas).
// Não precisa instalar nada além do Node.js. Uso: node server.js (ou iniciar.bat)
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");

const FIRST_PORT = Number(process.env.PORT) || 4321;
let PORT = FIRST_PORT;
const PUB = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "dados");
const SYS_FILE = path.join(DATA_DIR, "sistema.json");
const COLS = ["students", "classes", "sessions"];
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const DAY = 86400000;

/* ---------- armazenamento ----------
   dados/toca.db   banco de dados SQLite com tudo: contas, instituições, alunos, turmas, chamadas e registro (ver banco.js)
   dados/backups   uma cópia de segurança do banco por dia
   Se o Node.js for antigo e não tiver o SQLite embutido, o servidor continua com os arquivos JSON de antes. */
let store = null;
try { store = require("./banco.js").abrir(DATA_DIR); }
catch (e) { console.error("\n  ATENÇÃO: não foi possível abrir o banco de dados (" + e.message + ").\n  O servidor vai usar os arquivos JSON nesta execução.\n"); store = null; }
let sys = { users: {}, tenants: {}, logins: {}, alunos: {} };
if (store) sys = store.loadSys();
else try { const j = JSON.parse(fs.readFileSync(SYS_FILE, "utf8")); sys = { users: j.users || {}, tenants: j.tenants || {}, logins: j.logins || {}, alunos: j.alunos || {} }; } catch (e) { /* primeiro uso */ }
// Os códigos de sessão ficam guardados só como resumo (SHA-256): quem copiar o banco não consegue entrar com eles.
const tk = t => crypto.createHash("sha256").update(String(t)).digest("base64url");
const tenantData = new Map();
const tFile = id => path.join(DATA_DIR, "inst-" + id + ".json");
const norm0 = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
function tdata(id) {
  if (!tenantData.has(id)) {
    let d = { students: {}, classes: {}, sessions: {}, auth: {}, settings: {}, just: {}, courses: {}, logs: [] }; // auth: senha e e-mail de cada aluno; just: justificativas; courses: cursos cadastrados; logs: registro
    if (store) d = store.loadTenant(id);
    else try { const j = JSON.parse(fs.readFileSync(tFile(id), "utf8")); for (const c of [...COLS, "auth", "settings", "just", "courses"]) if (j[c] && typeof j[c] === "object") d[c] = j[c]; if (Array.isArray(j.logs)) d.logs = j.logs; } catch (e) { /* instituição nova */ }
    tenantData.set(id, d);
    if (!d.settings.coursesInit) { // primeira vez: os cursos já digitados nos alunos viram a lista de cursos, juntando grafias diferentes ("ADM" e "Adm")
      const groups = new Map();
      for (const s of Object.values(d.students)) { const c = String(s.course || "").trim(); if (!c) continue; const k = norm0(c), g = groups.get(k) || new Map(); g.set(c, (g.get(c) || 0) + 1); groups.set(k, g); }
      const have = new Set(Object.values(d.courses).map(c => norm0(c.name)));
      for (const [k, g] of groups) {
        const name = [...g.entries()].sort((a, b) => b[1] - a[1])[0][0];
        if (!have.has(k)) d.courses[crypto.randomBytes(9).toString("base64url")] = { name };
        const canon = (Object.values(d.courses).find(c => norm0(c.name) === k) || { name }).name;
        for (const s of Object.values(d.students)) if (norm0(s.course) === k && s.course !== canon) s.course = canon;
      }
      d.settings.coursesInit = true; saveTenant(id);
    }
  }
  return tenantData.get(id);
}
const timers = {}, pending = {};
function writeSoon(key, run) {
  clearTimeout(timers[key]); pending[key] = run;
  timers[key] = setTimeout(() => { delete pending[key]; try { run(); } catch (e) { console.error("Erro ao salvar " + key + ":", e.message); } }, 150);
}
const writeJson = (file, obj) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(obj)); fs.renameSync(file + ".tmp", file); };
function saveSys() { writeSoon("sistema", () => store ? store.saveSys(sys) : writeJson(SYS_FILE, sys)); }
function saveTenant(id) { writeSoon("inst-" + id, () => store ? store.saveTenant(id, tdata(id)) : writeJson(tFile(id), tdata(id))); }
{ let n = 0; for (const kind of ["logins", "alunos"]) for (const k of Object.keys(sys[kind])) if (k.length !== 43) { sys[kind][tk(k)] = sys[kind][k]; delete sys[kind][k]; n++; } if (n) saveSys(); }
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(1));
// Ao desligar ou reiniciar, grava o que ainda estava na fila.
process.on("exit", () => { for (const [k, run] of Object.entries(pending)) { try { run(); } catch (e) { console.error("Erro ao salvar " + k + ":", e.message); } } if (store) store.fechar(); });
if (store) { store.backup(); setInterval(() => store.backup(), 6 * 3600000).unref(); }
try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, "estado.txt"), "Armazenamento: " + (store ? "banco de dados SQLite (dados/toca.db)" : "arquivos JSON (Node.js sem SQLite embutido)") + "\r\nNode.js: " + process.version + "\r\nIniciado em: " + new Date().toISOString() + (store && store.migracao ? "\r\nMigração dos arquivos JSON: " + store.migracao.instituicoes + " instituição(ões), " + store.migracao.alunos + " aluno(s). Originais em dados/json-antigo." : "") + "\r\n"); } catch (e) { /* só informativo */ }

/* ---------- contas ---------- */
const newId = () => crypto.randomBytes(9).toString("base64url");
function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString("hex"); return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString("hex") }; }
function checkPw(u, pw) { const h = hashPw(pw, u.salt).hash; return h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash)); }
const normLogin = s => String(s || "").trim().toLowerCase();
const findUser = login => Object.entries(sys.users).find(([, u]) => u.login === login);
const hasAdmin = () => Object.values(sys.users).some(u => u.role === "admin");
const pubUser = (id, u) => ({ id, name: u.name, login: u.login, role: u.role, ...(u.weakPw ? { weakPw: true } : {}) });
// Permissões da secretaria: o responsável (quem contratou) pode tudo e decide o que cada funcionário vê e altera em cada aba.
const TABS = ["alunos", "turmas", "freq", "logins", "equipe", "logs"];
const TABNAME = { alunos: "Alunos", turmas: "Turmas", freq: "Chamadas e relatórios", logins: "Professores", equipe: "Secretaria", logs: "Registro" };
const LVNAME = { edit: "pode alterar", view: "só ver", none: "sem acesso" };
function ownerId(tid) {
  const t = sys.tenants[tid]; if (!t) return null;
  const o = t.ownerId && sys.users[t.ownerId];
  if (o && o.tenantId === tid && o.role === "secretaria") return t.ownerId;
  const f = Object.entries(sys.users).find(([, u]) => u.tenantId === tid && u.role === "secretaria"); // o primeiro login da secretaria é o de quem contratou
  if (f) { t.ownerId = f[0]; saveSys(); }
  return f ? f[0] : null;
}
function permsOf(id, u) {
  if (!u || u.role !== "secretaria") return null;
  const own = ownerId(u.tenantId) === id, o = {};
  for (const k of TABS) { const v = (u.perms || {})[k]; o[k] = own ? "edit" : ["edit", "view", "none"].includes(v) ? v : "edit"; }
  if (!own) { if (o.equipe === "edit") o.equipe = "view"; if (o.logs === "edit") o.logs = "view"; } // só o responsável mexe na equipe; o registro é só leitura
  return o;
}
const cleanPerms = b => { const o = {}; for (const k of TABS) o[k] = ["edit", "view", "none"].includes((b || {})[k]) ? b[k] : "edit"; if (o.equipe === "edit") o.equipe = "view"; if (o.logs === "edit") o.logs = "view"; return o; };
const permsText = o => TABS.map(k => TABNAME[k] + ": " + LVNAME[o[k]]).join("; ");
const pubStaff = (id, u) => u.role === "secretaria" ? { ...pubUser(id, u), owner: ownerId(u.tenantId) === id, perms: permsOf(id, u) } : pubUser(id, u);
const appV = () => { try { return String(Math.round(fs.statSync(path.join(PUB, "app.html")).mtimeMs)); } catch (e) { return ""; } }; // muda quando o aplicativo é atualizado: as telas abertas se recarregam
const openMode = (d, cid, mode) => { for (const se of Object.values(d.sessions)) if (se.classId === cid && !se.endedAt && se.mode !== mode) se.mode = mode; }; // chamada aberta acompanha a leitura da turma
const pubTenant = (id, t) => ({ id, name: t.name, type: t.type, code: t.code, active: t.active !== false });
// Senhas: tamanho mínimo e recusa das mais fáceis de adivinhar.
const WEAK = new Set(["123456", "1234567", "12345678", "123456789", "1234567890", "654321", "87654321", "000000", "111111", "112233", "121212", "123123", "12341234", "senha", "senha123", "senha1234", "password", "password1", "qwerty", "qwerty123", "admin", "admin123", "abc123", "abc12345", "mudar123", "toca123", "toca1234", "tocatag", "tocatag1", "iloveyou"]);
function pwProblem(pw, login, min) {
  pw = String(pw || "");
  if (pw.length < min) return "A senha precisa ter pelo menos " + min + " caracteres.";
  if (pw.length > 200) return "A senha é longa demais.";
  if (WEAK.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw) || (login && pw.toLowerCase() === String(login).toLowerCase())) return "Essa senha é fácil demais de adivinhar. Escolha outra.";
  return null;
}
const dropLogins = (userId, keep) => { for (const [k, v] of Object.entries(sys.logins)) if (v.userId === userId && k !== keep) delete sys.logins[k]; }; // encerra as sessões abertas de uma conta
function validAccount(b, needPw) {
  const name = String(b.name || "").trim(), login = normLogin(b.login), pw = String(b.password || "");
  if (!name) return "Informe o nome.";
  if (!/^[a-z0-9._@-]{3,60}$/.test(login)) return "O login deve ter de 3 a 60 caracteres: letras, números, ponto, hífen ou @.";
  if (needPw) return pwProblem(pw, login, 8);
  return null;
}
function auth(req) {
  const m = /(?:^|;\s*)toca=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "");
  const s = m && sys.logins[tk(m[1])];
  if (!s || s.exp < Date.now()) return null;
  const u = sys.users[s.userId]; if (!u) return null;
  return { token: m[1], id: s.userId, ...u };
}
function startLogin(res, userId) {
  const token = crypto.randomBytes(24).toString("base64url");
  for (const [k, v] of Object.entries(sys.logins)) if (v.exp < Date.now()) delete sys.logins[k];
  sys.logins[tk(token)] = { userId, exp: Date.now() + 30 * DAY }; saveSys();
  res.setHeader("Set-Cookie", "toca=" + token + "; Path=/; HttpOnly; SameSite=Lax" + (isHttps(res.req) ? "; Secure" : "") + "; Max-Age=" + 30 * 86400);
}
/* ---------- proteção contra abuso ---------- */
const isHttps = req => !!req && (req.headers["x-forwarded-proto"] === "https" || /"scheme":"https"/.test(req.headers["cf-visitor"] || ""));
// Pelo túnel da Cloudflare todo pedido chega de 127.0.0.1; o endereço de quem acessa vem no cabeçalho CF-Connecting-IP.
function clientIp(req) {
  const sock = req.socket.remoteAddress || "", local = sock === "127.0.0.1" || sock === "::1" || sock === "::ffff:127.0.0.1", cf = String(req.headers["cf-connecting-ip"] || "").trim();
  return local && /^[0-9a-fA-F:.]{3,45}$/.test(cf) ? cf : sock;
}
const fails = new Map(); // tentativas erradas por endereço: 8 em um minuto
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 8 && Date.now() - f.t < 60000; }
function failed(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 60000) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }
const locks = new Map(); // tentativas erradas por conta: 10 em 15 minutos bloqueiam a conta por 15 minutos
function locked(key) { const l = locks.get(key); return !!(l && l.until > Date.now()); }
function wrongPw(key) { const now = Date.now(); let l = locks.get(key); if (!l || now - l.t > 15 * 60000) l = { n: 0, t: now, until: 0 }; l.n++; if (l.n >= 10) l.until = now + 15 * 60000; locks.set(key, l); }
const hits = new Map(); // volume de pedidos por endereço
function flood(ip, bucket, max) { const k = bucket + ip, now = Date.now(), f = hits.get(k); if (!f || now - f.t > 60000) { hits.set(k, { n: 1, t: now }); return false; } return ++f.n > max; }
setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (now - f.t > 60000) fails.delete(k); for (const [k, f] of hits) if (now - f.t > 60000) hits.delete(k); for (const [k, l] of locks) if (now - l.t > 30 * 60000) locks.delete(k); }, 60000).unref();
const ORIGENS = new Set(["tocatag.net", "www.tocatag.net", ...String(process.env.TOCA_ORIGENS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)]);
function secHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (isHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=15552000");
}
// Limpeza do que chega do navegador: só os campos conhecidos, com tipo e tamanho conferidos.
const str = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const okId = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
const tsNum = v => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 4102444800000 ? Math.round(v) : null);
const okPhoto = v => typeof v === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 400000;
function cleanRules(r) {
  r = r && typeof r === "object" ? r : {};
  const num = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : def; };
  return { hours: !!r.hours, unit: r.unit === "t" ? "t" : "p", pMin: num(r.pMin, 1, 100, 75), parMin: num(r.parMin, 1, 100, 25), pT: num(r.pT, 1, 720, 60), parT: num(r.parT, 1, 720, 15) };
}

/* ---------- avisos ao vivo ---------- */
const clients = new Set();
function notify(key) { for (const c of clients) if (c.key === key) c.res.write("data: mudou\n\n"); }
setInterval(() => { for (const c of clients) c.res.write(": ping\n\n"); }, 25000);

/* ---------- http ---------- */
function send(res, code, body, type) {
  if (typeof body === "object" && !Buffer.isBuffer(body)) body = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(body);
}
const fail = (res, code, msg) => send(res, code, { erro: msg });
function readBody(req, max, allowForm) {
  return new Promise((ok, bad) => {
    let size = 0; const parts = [];
    req.on("data", d => { size += d.length; if (size > (max || 600000)) { bad(new Error("grande")); req.destroy(); } else parts.push(d); });
    req.on("end", () => { try { const raw = Buffer.concat(parts).toString("utf8"), form = /x-www-form-urlencoded/.test(req.headers["content-type"] || "");
      if (parts.length && form && !allowForm) throw new Error("tipo");
      const j = !parts.length ? {} : form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw, (k, v) => (k === "__proto__" ? undefined : v)); if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("x"); ok(j); } catch (e) { bad(e); } });
    req.on("error", bad);
  });
}
// Aluno: entra com nome da instituição + RA/matrícula (+ senha, depois que cria uma) e recebe um token.
const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
function tenantByName(name) {
  const k = norm(name), code = String(name || "").trim().toUpperCase();
  return k ? Object.entries(sys.tenants).find(([, t]) => t.active !== false && (norm(t.name) === k || t.code === code)) : null;
}
function studentByName(body) {
  const te = tenantByName(body.inst), ra = String(body.ra || "").trim().toLowerCase(), d = te && tdata(te[0]);
  const se = d && ra && Object.entries(d.students).find(([, x]) => String(x.ra).toLowerCase() === ra);
  return se ? { tid: te[0], t: te[1], d, sid: se[0], st: se[1] } : null;
}
function studentByToken(tok) {
  const a = tok && sys.alunos[tk(tok)]; if (!a || a.exp < Date.now()) return null;
  const t = sys.tenants[a.tid]; if (!t || t.active === false) return null;
  const d = tdata(a.tid), st = d.students[a.sid];
  return st ? { tid: a.tid, t, d, sid: a.sid, st } : null;
}
// Justificativa sem os anexos (para listas); os anexos vão só quando alguém abre a justificativa.
const justMeta = j => j ? { text: j.text || "", images: (j.images || []).length, signedName: j.signedName || "", by: j.by || "", at: j.at || 0 } : null;
function addLog(d, entry) { d.logs.push({ id: newId(), at: Date.now(), ...entry }); if (d.logs.length > 10000) d.logs.splice(0, d.logs.length - 10000); }
function alunoPayload(f, token) {
  ensureCard(f);
  const { d, sid, st } = f, cls = Array.isArray(st.classIds) ? st.classIds : [], au = d.auth[sid] || {};
  const hist = Object.entries(d.sessions).filter(([, x]) => cls.includes(x.classId)).sort((a, b) => (b[1].startedAt || 0) - (a[1].startedAt || 0)).slice(0, 600)
    .map(([id, x]) => ({ id, classId: x.classId, className: x.className, mode: x.mode, startedAt: x.startedAt, endedAt: x.endedAt, record: (x.records || {})[sid] || null, just: justMeta(d.just[id + "/" + sid]), rules: (d.classes[x.classId] || {}).rules || null }));
  return { token, tenant: { name: f.t.name, type: f.t.type }, student: { id: sid, name: st.name, ra: st.ra, course: st.course, cardUid: st.cardUid, photo: st.photo },
    card: st.photo ? { code: st.cardCode, qr: "TOCA1." + sid + "." + st.walletKey } : null, sessions: hist, logs: d.logs.filter(l => l.studentId === sid && (l.type === "horario" || l.type === "justificativa")).slice(-60).reverse(), settings: d.settings || {}, wallet: require("./carteira").status(), hasPassword: !!au.hash, email: au.email || "" };
}
const resetCodes = new Map(); // código de recuperação por aluno, vale 15 minutos
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const maskEmail = e => e.replace(/^(.).*(@.*)$/, "$1***$2");
// Cartão do aluno: um QR code e um número de 6 dígitos, fixos. Só mudam quando o aluno pede.
function ensureCard(f, novo) {
  if (!novo && f.st.walletKey && f.st.cardCode) return;
  f.st.walletKey = crypto.randomBytes(12).toString("base64url");
  const used = new Set(Object.values(f.d.students).map(x => x.cardCode));
  let code; do { code = String(crypto.randomInt(0, 1000000)).padStart(6, "0"); } while (used.has(code));
  f.st.cardCode = code; saveTenant(f.tid); notify(f.tid);
}
function walletInfo(f) {
  ensureCard(f);
  const escola = f.t.type === "escola";
  return { serial: f.tid + "-" + f.sid, payload: "TOCA1." + f.sid + "." + f.st.walletKey, tenantName: f.t.name, name: f.st.name, ra: f.st.ra, course: f.st.course,
    raLabel: escola ? "Matrícula" : "RA", courseLabel: escola ? "Série" : "Curso" };
}
function tenantSummary(id, t) {
  const d = tdata(id), us = Object.entries(sys.users).filter(([, u]) => u.tenantId === id);
  return { ...pubTenant(id, t), createdAt: t.createdAt, students: Object.keys(d.students).length, classes: Object.keys(d.classes).length, sessions: Object.keys(d.sessions).length,
    professors: us.filter(([, u]) => u.role === "professor").length, staff: us.filter(([, u]) => u.role === "secretaria").map(([uid, u]) => pubUser(uid, u)) };
}

async function api(req, res, p) {
  const M = req.method, ip = clientIp(req);
  if (!["GET", "POST", "PUT", "DELETE"].includes(M)) return fail(res, 405, "Método não permitido.");
  if (/(^|\/)(__proto__|constructor|prototype)(\/|$)/.test(p)) return fail(res, 400, "Endereço inválido.");
  if (flood(ip, "api:", 1500)) return fail(res, 429, "Muitos pedidos em pouco tempo. Aguarde um minuto.");
  if (M !== "GET") { // pedidos que alteram dados só valem vindos das páginas do próprio TOCA tag
    const o = req.headers.origin; let oh = ""; if (o) { try { oh = new URL(o).host.toLowerCase(); } catch (e) { oh = "?"; } }
    if ((o && oh !== String(req.headers.host || "").toLowerCase() && !ORIGENS.has(oh.replace(/:\d+$/, ""))) || req.headers["sec-fetch-site"] === "cross-site") return fail(res, 403, "Pedido recusado: ele não veio de uma página do TOCA tag.");
  }
  let body = {};
  if (M === "POST" || M === "PUT") { try { body = await readBody(req, /\/justificativa\//.test(p) ? 6000000 : 600000, p.startsWith("wallet/")); } catch (e) { return fail(res, 400, "Dados inválidos ou grandes demais."); } }
  const me = auth(req);

  if (p === "me" && M === "GET") {
    if (!hasAdmin()) return send(res, 200, { setup: true });
    if (!me) return send(res, 200, { user: null });
    const t = me.tenantId && sys.tenants[me.tenantId];
    if (me.tenantId && (!t || t.active === false)) return send(res, 200, { user: null, aviso: "O acesso desta instituição está suspenso. Fale com a TOCA." });
    return send(res, 200, { user: pubStaff(me.id, me), tenant: t ? pubTenant(me.tenantId, t) : null });
  }
  if (p === "setup" && M === "POST") {
    if (hasAdmin()) return fail(res, 403, "O administrador já foi criado.");
    const e = validAccount(body, true); if (e) return fail(res, 400, e);
    const id = newId(); sys.users[id] = { name: body.name.trim(), login: normLogin(body.login), role: "admin", ...hashPw(body.password) };
    startLogin(res, id); return send(res, 200, { ok: true });
  }
  if (p === "login" && M === "POST") {
    if (tooMany(ip)) return fail(res, 429, "Muitas tentativas. Aguarde um minuto.");
    const lg = normLogin(body.login), f = findUser(lg);
    if (f && locked("u:" + lg)) return fail(res, 429, "Muitas tentativas erradas neste login. Aguarde 15 minutos ou peça para redefinirem sua senha.");
    if (!f || !checkPw(f[1], String(body.password || "").slice(0, 200))) {
      failed(ip);
      if (f) { wrongPw("u:" + lg); const ft = f[1].tenantId && sys.tenants[f[1].tenantId]; if (ft) { addLog(tdata(f[1].tenantId), { type: "acesso", action: "falhou", by: f[1].name, byRole: f[1].role, text: "Tentativa de entrar com senha errada" + (locked("u:" + lg) ? ". Login bloqueado por 15 minutos." : ".") }); saveTenant(f[1].tenantId); } }
      return fail(res, 401, "Login ou senha incorretos.");
    }
    locks.delete("u:" + lg);
    if (pwProblem(body.password, lg, 8)) f[1].weakPw = true; else delete f[1].weakPw; // senha fraca: a tela pede para trocar
    const t = f[1].tenantId && sys.tenants[f[1].tenantId];
    if (f[1].tenantId && (!t || t.active === false)) return fail(res, 403, "O acesso desta instituição está suspenso. Fale com a TOCA.");
    if (t) { addLog(tdata(f[1].tenantId), { type: "acesso", action: "entrou", by: f[1].name, byRole: f[1].role, text: "Entrou no sistema." }); saveTenant(f[1].tenantId); }
    startLogin(res, f[0]); return send(res, 200, { ok: true });
  }
  if (p === "logout" && M === "POST") {
    if (me) { delete sys.logins[tk(me.token)]; saveSys(); }
    res.setHeader("Set-Cookie", "toca=; Path=/; HttpOnly; SameSite=Lax" + (isHttps(req) ? "; Secure" : "") + "; Max-Age=0"); return send(res, 200, { ok: true });
  }
  if (p === "instituicoes" && M === "GET") return send(res, 200, { nomes: Object.values(sys.tenants).filter(t => t.active !== false).map(t => t.name).sort((a, b) => a.localeCompare(b, "pt-BR")) });
  if (p === "aluno/entrar" && M === "POST") {
    if (tooMany(ip) || flood(ip, "aluno:", 90)) return fail(res, 429, "Muitas tentativas. Aguarde um minuto.");
    const f = studentByName(body);
    if (!f) { failed(ip); return fail(res, 404, "Não encontramos esse aluno. Confira o nome da instituição e a matrícula."); }
    const au = f.d.auth[f.sid], lk = "a:" + f.tid + "/" + f.sid;
    if (au && au.hash) {
      if (!body.password) return send(res, 401, { erro: "Digite sua senha.", precisaSenha: true });
      if (locked(lk)) return fail(res, 429, "Muitas tentativas erradas. Aguarde 15 minutos ou procure a secretaria.");
      if (!checkPw(au, String(body.password).slice(0, 200))) { failed(ip); wrongPw(lk); return send(res, 401, { erro: "Senha incorreta.", precisaSenha: true }); }
      locks.delete(lk);
    }
    const token = crypto.randomBytes(24).toString("base64url");
    for (const [k, v] of Object.entries(sys.alunos)) if (v.exp < Date.now()) delete sys.alunos[k];
    sys.alunos[tk(token)] = { tid: f.tid, sid: f.sid, exp: Date.now() + 30 * DAY }; saveSys();
    return send(res, 200, alunoPayload(f, token));
  }
  if (p === "aluno" && M === "POST") {
    const f = studentByToken(body.token);
    if (!f) return fail(res, 401, "Entre de novo para abrir seu cartão.");
    return send(res, 200, alunoPayload(f, String(body.token)));
  }
  if (p === "aluno/foto" && M === "POST") { // o aluno envia a própria foto 3x4, uma única vez
    const f = studentByToken(body.token);
    if (!f) return fail(res, 401, "Entre de novo para abrir seu cartão.");
    if (f.st.photo) return fail(res, 400, "Seu cadastro já tem foto. Para trocar, procure a secretaria.");
    const photo = String(body.photo || "");
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 300000) return fail(res, 400, "Não foi possível usar essa imagem. Tente outra foto.");
    f.st.photo = photo; f.st.photoBy = "aluno"; f.st.updatedAt = Date.now();
    addLog(f.d, { type: "aluno", action: "foto", by: f.st.name, byRole: "aluno", subject: f.st.name, text: "O aluno enviou a própria foto 3x4." });
    saveTenant(f.tid); notify(f.tid); return send(res, 200, alunoPayload(f, String(body.token)));
  }
  if (p === "aluno/justificativa" && M === "POST") { // o aluno abre a justificativa de uma falta dele, com os anexos
    const f = studentByToken(body.token);
    if (!f) return fail(res, 401, "Entre de novo para abrir seu cartão.");
    const j = f.d.just[String(body.sessionId || "") + "/" + f.sid];
    return j ? send(res, 200, j) : fail(res, 404, "Justificativa não encontrada.");
  }
  if (p === "aluno/senha" && M === "POST") { // cria ou troca a senha e o e-mail de recuperação
    const f = studentByToken(body.token);
    if (!f) return fail(res, 401, "Entre de novo para abrir seu cartão.");
    const au = f.d.auth[f.sid] || {}, pw = String(body.password || ""), email = String(body.email || "").trim().toLowerCase();
    if (au.hash && !checkPw(au, body.current || "")) return fail(res, 400, "A senha atual não confere.");
    if (email && !validEmail(email)) return fail(res, 400, "Confira o e-mail de recuperação.");
    if (!au.hash || pw) { const e = pwProblem(pw, f.st.ra, 6); if (e) return fail(res, 400, e); }
    f.d.auth[f.sid] = { ...au, ...(pw ? hashPw(pw) : {}), email };
    addLog(f.d, { type: "aluno", action: "senha", by: f.st.name, byRole: "aluno", subject: f.st.name, text: au.hash ? (pw ? "O aluno trocou a própria senha." : "O aluno alterou o e-mail de recuperação.") : "O aluno criou a senha do cartão." });
    saveTenant(f.tid); notify(f.tid); return send(res, 200, { ok: true, hasPassword: true, email });
  }
  if (p === "aluno/recuperar" && M === "POST") { // envia o código de recuperação por e-mail
    if (tooMany(ip)) return fail(res, 429, "Muitas tentativas. Aguarde um minuto.");
    const f = studentByName(body);
    if (!f) { failed(ip); return fail(res, 404, "Não encontramos esse aluno. Confira o nome da instituição e a matrícula."); }
    const au = f.d.auth[f.sid] || {}, mail = require("./email");
    if (!au.hash) return fail(res, 400, "Este cadastro ainda não tem senha. Entre só com a instituição e a matrícula.");
    if (!au.email) return fail(res, 400, "Este cadastro não tem e-mail de recuperação. Peça à secretaria para redefinir sua senha.");
    if (!mail.ready()) return fail(res, 503, "O envio de e-mail não está ativo. Peça à secretaria para redefinir sua senha.");
    failed(ip); // cada pedido conta como tentativa, para não virar disparo de e-mails
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    resetCodes.set(f.tid + "/" + f.sid, { codigo, exp: Date.now() + 15 * 60000, tries: 0 });
    try { await mail.send(au.email, "Código para trocar sua senha do TOCA tag", "Olá, " + f.st.name + ".\n\nSeu código para criar uma nova senha no TOCA tag é: " + codigo + "\n\nEle vale por 15 minutos. Se você não pediu, ignore este e-mail.\n"); }
    catch (e) { console.error("E-mail:", e.message); return fail(res, 502, "Não foi possível enviar o e-mail agora. Tente de novo ou procure a secretaria."); }
    return send(res, 200, { ok: true, email: maskEmail(au.email) });
  }
  if (p === "aluno/redefinir" && M === "POST") {
    if (tooMany(ip)) return fail(res, 429, "Muitas tentativas. Aguarde um minuto.");
    const f = studentByName(body), k = f && f.tid + "/" + f.sid, rc = k && resetCodes.get(k);
    if (!rc || rc.exp < Date.now()) return fail(res, 400, "Código vencido. Peça um novo código.");
    if (String(body.codigo || "").trim() !== rc.codigo) { failed(ip); if (++rc.tries >= 5) resetCodes.delete(k); return fail(res, 400, "Código incorreto."); }
    { const e = pwProblem(body.password, f.st.ra, 6); if (e) return fail(res, 400, e); }
    f.d.auth[f.sid] = { ...(f.d.auth[f.sid] || {}), ...hashPw(body.password) }; resetCodes.delete(k);
    for (const [t, v] of Object.entries(sys.alunos)) if (v.tid === f.tid && v.sid === f.sid) delete sys.alunos[t];
    saveSys(); saveTenant(f.tid); return send(res, 200, { ok: true });
  }
  if (p === "wallet/qr" && M === "POST") { // QR code fixo do aluno, para ele mesmo criar o cartão na Carteira do celular
    const f = studentByToken(body.token);
    if (!f) return fail(res, 401, "Entre de novo para abrir seu cartão.");
    if (!f.st.photo) return fail(res, 400, "Envie sua foto 3x4 para liberar o cartão.");
    ensureCard(f, !!body.novo); // com "novo", o QR code e o número antigos deixam de valer
    if (body.novo) { addLog(f.d, { type: "aluno", action: "codigo", by: f.st.name, byRole: "aluno", subject: f.st.name, text: "O aluno gerou um novo código e QR code do cartão." }); saveTenant(f.tid); }
    return send(res, 200, { payload: walletInfo(f).payload, code: f.st.cardCode });
  }
  if ((p === "wallet/apple" || p === "wallet/google") && M === "POST") { // cartão na Carteira
    if (tooMany(ip)) return fail(res, 429, "Muitas tentativas. Aguarde um minuto.");
    const w = require("./carteira"), apple = p === "wallet/apple";
    if (apple ? !w.appleReady() : !w.googleReady()) return fail(res, 503, "A Carteira " + (apple ? "da Apple" : "do Google") + " ainda não foi configurada neste servidor.");
    const f = studentByToken(body.token);
    if (!f) return fail(res, 401, "Entre de novo para abrir seu cartão.");
    if (!f.st.photo) return fail(res, 400, "Envie sua foto 3x4 para liberar o cartão.");
    try {
      if (!apple) return send(res, 200, { url: w.googleLink(walletInfo(f)) });
      const buf = w.applePass(walletInfo(f));
      res.writeHead(200, { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": 'attachment; filename="tocatag.pkpass"', "Cache-Control": "no-store" }); return res.end(buf);
    } catch (e) { console.error("Carteira:", e.message); return fail(res, 500, "Não foi possível gerar o cartão da Carteira. Veja a janela do servidor."); }
  }

  if (!me) return fail(res, 401, "Entre com seu login para continuar.");

  if (p === "me/password" && M === "PUT") {
    if (locked("u:" + me.login)) return fail(res, 429, "Muitas tentativas erradas. Aguarde 15 minutos.");
    if (!checkPw(me, String(body.current || "").slice(0, 200))) { wrongPw("u:" + me.login); return fail(res, 400, "A senha atual não confere."); }
    { const e = pwProblem(body.password, me.login, 8); if (e) return fail(res, 400, e); }
    Object.assign(sys.users[me.id], hashPw(body.password)); delete sys.users[me.id].weakPw;
    dropLogins(me.id, tk(me.token)); // as outras sessões desta conta são encerradas
    if (me.tenantId) { addLog(tdata(me.tenantId), { type: "acesso", action: "senha", by: me.name, byRole: me.role, text: "Trocou a própria senha." }); saveTenant(me.tenantId); }
    saveSys(); return send(res, 200, { ok: true });
  }
  if (p === "events" && M === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    let mine = 0; for (const x of clients) if (x.uid === me.id) mine++;
    if (mine >= 12 || clients.size >= 3000) { res.end(); return; }
    res.write(": ok\n\n"); const c = { key: me.role === "admin" ? "admin" : me.tenantId, res, uid: me.id }; clients.add(c); req.on("close", () => clients.delete(c)); return;
  }

  /* ----- painel do administrador ----- */
  if (p.startsWith("admin/")) {
    if (me.role !== "admin") return fail(res, 403, "Área restrita ao administrador.");
    if (p === "admin/tenants" && M === "GET") return send(res, 200, { tenants: Object.entries(sys.tenants).map(([id, t]) => tenantSummary(id, t)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) });
    if (p === "admin/tenants" && M === "POST") {
      const name = String(body.name || "").trim(), type = body.type === "escola" ? "escola" : "faculdade";
      if (!name) return fail(res, 400, "Informe o nome da instituição.");
      if (Object.values(sys.tenants).some(t => norm(t.name) === norm(name))) return fail(res, 400, "Já existe uma instituição com esse nome. Os alunos entram pelo nome, então ele precisa ser único.");
      let code; do { code = "I" + crypto.randomBytes(4).toString("hex").toUpperCase(); } while (Object.values(sys.tenants).some(t => t.code === code)); // identificador interno
      const e = validAccount({ name: body.userName, login: body.login, password: body.password }, true); if (e) return fail(res, 400, e);
      if (findUser(normLogin(body.login))) return fail(res, 400, "Esse login já está em uso.");
      const id = newId(); sys.tenants[id] = { name, type, code, active: true, createdAt: Date.now() };
      sys.users[newId()] = { name: String(body.userName).trim(), login: normLogin(body.login), role: "secretaria", tenantId: id, ...hashPw(body.password) };
      saveSys(); saveTenant(id); notify("admin"); return send(res, 200, { id });
    }
    let m = p.match(/^admin\/tenants\/([A-Za-z0-9_-]+)$/);
    if (m && sys.tenants[m[1]]) {
      const id = m[1], t = sys.tenants[id];
      if (M === "PUT") {
        if (body.name !== undefined) { const n = String(body.name).trim(); if (!n) return fail(res, 400, "Informe o nome da instituição.");
          if (Object.entries(sys.tenants).some(([oid, o]) => oid !== id && norm(o.name) === norm(n))) return fail(res, 400, "Já existe uma instituição com esse nome."); t.name = n; }
        if (body.type !== undefined) t.type = body.type === "escola" ? "escola" : "faculdade";
        if (body.active !== undefined) t.active = !!body.active;
        saveSys(); notify("admin"); notify(id); return send(res, 200, { ok: true });
      }
      if (M === "DELETE") {
        for (const [uid, u] of Object.entries(sys.users)) if (u.tenantId === id) delete sys.users[uid];
        for (const [k, v] of Object.entries(sys.logins)) if (!sys.users[v.userId]) delete sys.logins[k];
        for (const [k, v] of Object.entries(sys.alunos)) if (v.tid === id) delete sys.alunos[k];
        delete sys.tenants[id]; tenantData.delete(id); clearTimeout(timers["inst-" + id]); delete pending["inst-" + id];
        if (store) store.deleteTenant(id); else try { fs.unlinkSync(tFile(id)); } catch (e) { /* já não existia */ }
        saveSys(); notify("admin"); return send(res, 200, { ok: true });
      }
    }
    m = p.match(/^admin\/users\/([A-Za-z0-9_-]+)$/);
    if (m && sys.users[m[1]] && M === "PUT") {
      { const e = pwProblem(body.password, sys.users[m[1]].login, 8); if (e) return fail(res, 400, e); }
      Object.assign(sys.users[m[1]], hashPw(body.password)); delete sys.users[m[1]].weakPw; dropLogins(m[1]); locks.delete("u:" + sys.users[m[1]].login); saveSys(); return send(res, 200, { ok: true });
    }
    return fail(res, 404, "Não encontrado.");
  }

  /* ----- dados de uma instituição ----- */
  const tid = me.tenantId, t = tid && sys.tenants[tid];
  if (!t) return fail(res, 403, "Esta conta não pertence a uma instituição.");
  if (t.active === false) return fail(res, 403, "O acesso desta instituição está suspenso. Fale com a TOCA.");
  const staff = me.role === "secretaria", d = tdata(tid);
  const perms = permsOf(me.id, me), owner = staff && ownerId(tid) === me.id;
  const can = (tab, lv) => staff && (lv === "view" ? perms[tab] !== "none" : perms[tab] === "edit");
  const noPerm = tab => fail(res, 403, "Seu login não tem permissão para alterar a aba " + TABNAME[tab] + ". Fale com o responsável pela instituição.");
  const log = (type, action, text, extra) => addLog(d, { type, action, text, by: me.name, byRole: me.role, ...(extra || {}) });

  if (p === "data" && M === "GET") {
    const us = Object.entries(sys.users).filter(([, u]) => u.tenantId === tid).map(([id, u]) => pubStaff(id, u));
    const comSenha = {}; if (staff) for (const [sid, a] of Object.entries(d.auth)) if (a.hash) comSenha[sid] = true;
    return send(res, 200, { students: d.students, classes: d.classes, sessions: d.sessions, users: staff && can("equipe", "view") ? us : us.filter(u => u.role === "professor" || u.id === me.id), alunoSenha: comSenha, settings: d.settings || {},
      me: pubStaff(me.id, me), courses: d.courses,
      v: appV(),
      just: can("freq", "view") || !staff ? Object.fromEntries(Object.entries(d.just).map(([k, j]) => [k, justMeta(j)])) : {}, logs: can("logs", "view") ? d.logs.slice(-3000).reverse() : [] });
  }
  if (p === "settings" && M === "PUT") { // regras de presença da instituição
    if (!staff) return fail(res, 403, "Só a secretaria pode mudar as regras de presença.");
    if (!can("turmas", "edit")) return noPerm("turmas");
    const n = (v, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(100, Math.max(1, Math.round(x))) : def; };
    const pMin = n(body.pMin, 75), parMin = Math.min(n(body.parMin, 25), pMin);
    d.settings = { hours: !!body.hours, pMin, parMin };
    saveTenant(tid); notify(tid); return send(res, 200, { ok: true, settings: d.settings });
  }
  // A secretaria corrige horários de entrada e saída; cada mudança fica registrada.
  let m = p.match(/^sessions\/([A-Za-z0-9_-]{1,64})\/horarios$/);
  if (m && M === "POST") {
    const se = d.sessions[m[1]]; if (!se) return fail(res, 404, "Chamada não encontrada.");
    if (staff) { if (!can("freq", "edit")) return noPerm("freq"); }
    else { // o professor ajusta as aulas já encerradas das turmas dele
      const c = d.classes[se.classId];
      if (c && c.professorId && c.professorId !== me.id) return fail(res, 403, "Esta aula é de outro professor.");
      if (!se.endedAt) return fail(res, 400, "Esta chamada ainda está aberta. Use a tela da chamada para marcar ou desfazer presenças.");
    }
    const ts = v => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    se.records = se.records || {}; let n = 0;
    for (const c of Array.isArray(body.changes) ? body.changes.slice(0, 500) : []) {
      const sid = String(c.studentId || ""), st = d.students[sid]; if (!st) continue;
      const old = se.records[sid] || {}, tin = ts(c.in), tout = ts(c.out);
      if (tin && tout && tout < tin) return fail(res, 400, "A saída de " + st.name + " está antes da entrada.");
      if ((old.in || null) === tin && (old.out || null) === tout) continue;
      const reason = String(c.reason || "").trim().slice(0, 500);
      if (!tin && !tout && !reason) return fail(res, 400, "Escreva o motivo para retirar o horário de " + st.name + ".");
      if (!tin && !tout) delete se.records[sid]; else { const r = { manual: true }; if (tin) r.in = tin; if (tout) r.out = tout; se.records[sid] = r; }
      addLog(d, { type: "horario", by: me.name, byRole: me.role, sessionId: m[1], className: se.className, sessionStart: se.startedAt, studentId: sid, studentName: st.name, before: { in: old.in || null, out: old.out || null }, after: { in: tin, out: tout }, ...(reason ? { reason } : {}) });
      n++;
    }
    if (n) { saveTenant(tid); notify(tid); }
    return send(res, 200, { ok: true, changed: n });
  }
  // Justificativa de falta: observação, imagens anexas e assinatura de quem registrou.
  m = p.match(/^sessions\/([A-Za-z0-9_-]{1,64})\/justificativa\/([A-Za-z0-9_-]{1,64})$/);
  if (m) {
    const se = d.sessions[m[1]], st = d.students[m[2]], key = m[1] + "/" + m[2];
    if (!se || !st) return fail(res, 404, "Aula ou aluno não encontrado.");
    if (staff) { if (!can("freq", M === "GET" ? "view" : "edit")) return noPerm("freq"); }
    else { // o professor justifica faltas das aulas das turmas dele
      const c = d.classes[se.classId];
      if (c && c.professorId && c.professorId !== me.id) return fail(res, 403, "Esta aula é de outro professor.");
      if (M === "DELETE" && d.just[key] && d.just[key].by !== me.name) return fail(res, 403, "Esta justificativa foi registrada por outra pessoa. Só ela ou a secretaria pode remover.");
    }
    const base = { sessionId: m[1], className: se.className, sessionStart: se.startedAt, studentId: m[2], studentName: st.name, by: me.name, byRole: me.role };
    if (M === "GET") return d.just[key] ? send(res, 200, d.just[key]) : fail(res, 404, "Justificativa não encontrada.");
    if (M === "DELETE") {
      if (d.just[key]) { delete d.just[key]; addLog(d, { type: "justificativa", action: "removida", ...base }); saveTenant(tid); notify(tid); }
      return send(res, 200, { ok: true });
    }
    if (M === "PUT") {
      const img = v => typeof v === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v);
      const text = String(body.text || "").trim().slice(0, 4000), images = (Array.isArray(body.images) ? body.images : []).filter(img).slice(0, 4);
      const signedName = String(body.signedName || "").trim().slice(0, 120);
      if (!text && !images.length) return fail(res, 400, "Escreva uma observação ou anexe pelo menos uma imagem.");
      if (!img(body.signature) || body.signature.length > 400000) return fail(res, 400, "Falta a assinatura do responsável.");
      if (!signedName) return fail(res, 400, "Informe o nome de quem assina.");
      const novo = !d.just[key];
      d.just[key] = { text, images, signature: body.signature, signedName, by: me.name, at: Date.now() };
      addLog(d, { type: "justificativa", action: novo ? "registrada" : "alterada", note: text.slice(0, 200), images: images.length, signedName, ...base });
      saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
    }
  }
  m = p.match(/^students\/([A-Za-z0-9_-]{1,64})\/senha$/);
  if (m && M === "DELETE") { // a secretaria apaga a senha; o aluno cria outra no próximo acesso
    if (!staff) return fail(res, 403, "Só a secretaria pode redefinir a senha do aluno.");
    if (!can("alunos", "edit")) return noPerm("alunos");
    log("aluno", "senha", "Redefiniu a senha do aluno " + ((d.students[m[1]] || {}).name || "") + ".", { subject: (d.students[m[1]] || {}).name || "" });
    delete d.auth[m[1]]; for (const [k, v] of Object.entries(sys.alunos)) if (v.tid === tid && v.sid === m[1]) delete sys.alunos[k];
    saveSys(); saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
  }
  // O professor ajusta a leitura e a regra de presença da turma, quando a secretaria liberou isso na turma.
  m = p.match(/^classes\/([A-Za-z0-9_-]{1,64})\/regras$/);
  if (m && M === "PUT") {
    const c = d.classes[m[1]]; if (!c) return fail(res, 404, "Turma não encontrada.");
    if (!staff && !c.profEdit) return fail(res, 403, "A secretaria definiu a presença desta turma. Só ela pode mudar.");
    if (!staff && c.professorId && c.professorId !== me.id) return fail(res, 403, "Esta turma é de outro professor.");
    if (staff && !can("turmas", "edit")) return noPerm("turmas");
    const rules = cleanRules(body.rules);
    if (rules.unit === "t" ? rules.parT > rules.pT : rules.parMin > rules.pMin) return fail(res, 400, "O mínimo de parcial não pode ser maior que o de presente.");
    if (["entrada", "saida", "ambas"].includes(body.mode)) { c.mode = body.mode; openMode(d, m[1], c.mode); }
    if (body.confirm !== undefined) { if (body.confirm) c.confirm = true; else delete c.confirm; }
    c.rules = rules; log("turma", "presenca", "Mudou a leitura e a regra de presença da turma " + c.name + ".", { subject: c.name }); saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
  }
  // Cursos (ou séries): a secretaria cadastra antes, e o aluno só pode ter um curso da lista.
  m = p.match(/^courses(?:\/([A-Za-z0-9_-]{1,64}))?$/);
  if (m) {
    const cw = (sys.tenants[tid] || {}).type === "escola" ? "série" : "curso";
    if (!staff) return fail(res, 403, "Só a secretaria pode alterar a lista.");
    if (!can("alunos", "edit")) return noPerm("alunos");
    const nome = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80), dup = id => Object.entries(d.courses).some(([k, c]) => k !== id && norm0(c.name) === norm0(nome));
    if (M === "POST" && !m[1]) {
      if (!nome) return fail(res, 400, "Informe o nome.");
      if (dup(null)) return fail(res, 400, "Já existe " + (cw === "série" ? "uma série" : "um curso") + " com esse nome.");
      const cid = newId(); d.courses[cid] = { name: nome };
      log("curso", "criado", "Cadastrou " + (cw === "série" ? "a série " : "o curso ") + nome + ".", { subject: nome }); saveTenant(tid); notify(tid); return send(res, 200, { ok: true, id: cid });
    }
    const c = m[1] && d.courses[m[1]]; if (!c) return fail(res, 404, "Não encontrado.");
    const using = Object.values(d.students).filter(s => norm0(s.course) === norm0(c.name));
    if (M === "PUT") {
      if (!nome) return fail(res, 400, "Informe o nome.");
      if (dup(m[1])) return fail(res, 400, "Já existe " + (cw === "série" ? "uma série" : "um curso") + " com esse nome.");
      if (nome !== c.name) { log("curso", "alterado", "Renomeou " + (cw === "série" ? "a série " : "o curso ") + c.name + " para " + nome + (using.length ? " (" + using.length + " aluno(s) atualizados)." : "."), { subject: nome });
        for (const s of using) { s.course = nome; s.updatedAt = Date.now(); } c.name = nome; }
      saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
    }
    if (M === "DELETE") {
      if (using.length) return fail(res, 400, "Há " + using.length + " aluno(s) " + (cw === "série" ? "nesta série" : "neste curso") + ". Troque " + (cw === "série" ? "a série" : "o curso") + " deles antes de excluir.");
      log("curso", "excluido", "Excluiu " + (cw === "série" ? "a série " : "o curso ") + c.name + ".", { subject: c.name });
      delete d.courses[m[1]]; saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
    }
  }
  // Encerrar uma chamada em aberto: o professor da turma ou a secretaria.
  m = p.match(/^sessions\/([A-Za-z0-9_-]{1,64})\/encerrar$/);
  if (m && M === "POST") {
    const se = d.sessions[m[1]]; if (!se) return fail(res, 404, "Chamada não encontrada.");
    if (staff) { if (!can("freq", "edit")) return noPerm("freq"); }
    else { const c = d.classes[se.classId]; if (c && c.professorId && c.professorId !== me.id) return fail(res, 403, "Esta turma é de outro professor."); }
    if (!se.endedAt) { se.endedAt = Date.now(); log("chamada", "encerrada", "Encerrou a chamada de " + (se.className || "Turma") + ".", { subject: se.className || "Turma", sessionId: m[1] }); saveTenant(tid); notify(tid); }
    return send(res, 200, { ok: true });
  }
  m = p.match(/^(students|classes|sessions)\/([A-Za-z0-9_-]{1,64})$/);
  if (m) {
    const [, col, id] = m;
    if (col !== "sessions" && !staff) return fail(res, 403, "Só a secretaria pode alterar alunos e turmas.");
    const tab = col === "students" ? "alunos" : col === "classes" ? "turmas" : "freq", old = d[col][id];
    if (col !== "sessions" && !can(tab, "edit")) return noPerm(tab);
    const diff = (a, b, names) => Object.keys(names).filter(k => JSON.stringify(a[k] === undefined ? null : a[k]) !== JSON.stringify(b[k] === undefined ? null : b[k])).map(k => names[k]);
    if (M === "PUT") {
      // Só entram os campos conhecidos, já conferidos. O que o servidor controla (código do cartão, quem fez a chamada, início) não vem do navegador.
      const MODES = ["entrada", "saida", "ambas"];
      if (col === "students") {
        const name = str(body.name, 120), ra = str(body.ra, 40), photo = body.photo ? String(body.photo) : "";
        if (!name) return fail(res, 400, "Informe o nome do aluno.");
        if (!ra) return fail(res, 400, "Informe a matrícula do aluno.");
        if (Object.entries(d.students).some(([k, s]) => k !== id && String(s.ra || "").toLowerCase() === ra.toLowerCase())) return fail(res, 400, "Já existe um aluno com essa matrícula.");
        if (photo && photo !== (old && old.photo) && !okPhoto(photo)) return fail(res, 400, "Não foi possível usar essa imagem. Tente outra foto.");
        body = { name, ra, course: str(body.course, 80), cardUid: str(body.cardUid, 64), photo,
          classIds: Array.isArray(body.classIds) ? [...new Set(body.classIds.filter(c => okId(c) && d.classes[c]))] : [], updatedAt: Date.now(),
          ...(old && old.walletKey ? { walletKey: old.walletKey, cardCode: old.cardCode } : {}),
          ...(photo ? { photoBy: old && old.photo === photo ? old.photoBy || "secretaria" : "secretaria" } : {}) };
      } else if (col === "classes") {
        const name = str(body.name, 120); if (!name) return fail(res, 400, "Informe o nome da turma.");
        const pu = okId(body.professorId) && sys.users[body.professorId], pid = pu && pu.tenantId === tid && pu.role === "professor" ? body.professorId : "";
        const rules = body.rules ? cleanRules(body.rules) : old && old.rules;
        body = { name, professorId: pid, professor: pid ? pu.name : "", room: str(body.room, 60), mode: MODES.includes(body.mode) ? body.mode : "entrada", ...(rules ? { rules } : {}), profEdit: !!body.profEdit, ...(body.confirm ? { confirm: true } : {}) };
      } else {
        const c = d.classes[old ? old.classId : body.classId];
        if (!old && !c) return fail(res, 400, "Turma não encontrada.");
        if (staff) return fail(res, 403, "Quem abre e conduz a chamada é o professor. A secretaria acompanha as chamadas em aberto e ajusta pela lista da aula.");
        if (!staff) {
          if (c && c.professorId && c.professorId !== me.id) return fail(res, 403, "Esta turma é de outro professor.");
          if (old && old.endedAt) return fail(res, 403, "Esta chamada já foi encerrada. Para ajustar, abra a aula em Aulas anteriores.");
        } else if (old && old.endedAt && !can("freq", "edit")) return noPerm("freq");
        const aeIn = tsNum(body.autoEnd);
        const recs = {};
        if (body.records && typeof body.records === "object") for (const [sid, r] of Object.entries(body.records)) {
          if (!okId(sid) || !d.students[sid] || !r || typeof r !== "object") continue;
          const i = tsNum(r.in), o = tsNum(r.out); if (!i && !o) continue;
          recs[sid] = { ...(i ? { in: i } : {}), ...(o ? { out: o } : {}), ...(r.manual ? { manual: true } : {}) };
        }
        body = { classId: old ? old.classId : body.classId, className: (c && c.name) || (old && old.className) || "Turma", mode: MODES.includes(body.mode) ? body.mode : (old && old.mode) || "entrada",
          by: old ? old.by : me.name, startedAt: old ? old.startedAt : tsNum(body.startedAt) || Date.now(), endedAt: body.endedAt == null ? null : tsNum(body.endedAt), records: recs };
        // Encerramento automático: o professor define ao abrir a chamada (de 1 minuto a 12 horas depois do início).
        const ae = old ? old.autoEnd : aeIn;
        if (ae && (old || (ae > body.startedAt + 59000 && ae <= body.startedAt + 12 * 3600000))) body.autoEnd = ae;
        if (old ? old.confirm : !!(c && c.confirm)) body.confirm = true; // o professor confere a foto e confirma cada leitura antes de registrar
      }
      if (col === "students") {
        const cn = String(body.course || "").trim();
        if (cn) { const hit = Object.values(d.courses).find(c => norm0(c.name) === norm0(cn));
          if (!hit) return fail(res, 400, ((sys.tenants[tid] || {}).type === "escola" ? "A série" : "O curso") + " “" + cn + "” não está cadastrado. Cadastre em Alunos, no botão " + ((sys.tenants[tid] || {}).type === "escola" ? "Séries" : "Cursos") + ", e escolha na lista.");
          body.course = hit.name; }
        const ch = old ? diff(old, body, { name: "nome", ra: "matrícula", course: "curso", cardUid: "cartão", photo: "foto", classIds: "turmas" }) : [];
        if (!old) log("aluno", "criado", "Cadastrou o aluno " + (body.name || "") + (body.ra ? " (" + body.ra + ")" : "") + ".", { subject: body.name || "" });
        else if (ch.length) log("aluno", "alterado", "Alterou o cadastro de " + (body.name || old.name || "") + ": " + ch.join(", ") + ".", { subject: body.name || old.name || "" });
      } else if (col === "classes") {
        const ch = old ? diff(old, body, { name: "nome", professorId: "professor", room: "sala", mode: "leitura do cartão", rules: "regra de presença", profEdit: "quem define a presença", confirm: "confirmação do professor na leitura" }) : [];
        if (!old) log("turma", "criada", "Criou a turma " + (body.name || "") + ".", { subject: body.name || "" });
        if (old && old.mode !== body.mode && ["entrada", "saida", "ambas"].includes(body.mode)) openMode(d, id, body.mode);
        if (old && ch.length) log("turma", "alterada", "Alterou a turma " + (body.name || old.name || "") + ": " + ch.join(", ") + ".", { subject: body.name || old.name || "" });
      } else {
        const cn = body.className || (old && old.className) || "Turma", ex = { subject: cn, sessionId: id };
        if (!old) log("chamada", "iniciada", "Iniciou a chamada de " + cn + ".", ex);
        else {
          if (!old.endedAt && body.endedAt) log("chamada", "encerrada", "Encerrou a chamada de " + cn + ".", ex);
          if (old.endedAt && !body.endedAt) log("chamada", "reaberta", "Reabriu a chamada de " + cn + ".", ex);
          const a = old.records || {}, b = body.records || {}, nm = s => (d.students[s] || {}).name || "aluno", hm = v => new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
          for (const s of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const x = a[s], y = b[s], e2 = { ...ex, studentName: nm(s) };
            if (!y) { if (x) log("presenca", "desfeita", "Desfez a presença de " + nm(s) + " em " + cn + ".", e2); continue; }
            const how = y.manual ? "manualmente" : "pela leitura do cartão";
            if (y.in && (!x || x.in !== y.in)) log("presenca", "entrada", "Entrada de " + nm(s) + " em " + cn + " às " + hm(y.in) + ", " + how + ".", e2);
            if (y.out && (!x || x.out !== y.out)) log("presenca", "saida", "Saída de " + nm(s) + " em " + cn + " às " + hm(y.out) + ", " + how + ".", e2);
            if (x && ((x.in && !y.in) || (x.out && !y.out))) log("presenca", "desfeita", "Desfez " + (x.out && !y.out ? "a saída" : "a entrada") + " de " + nm(s) + " em " + cn + ".", e2);
          }
        }
      }
      d[col][id] = body; saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
    }
    if (M === "DELETE") { if (!staff) return fail(res, 403, "Só a secretaria pode excluir.");
      if (!can(tab, "edit")) return noPerm(tab);
      if (old) log(col === "students" ? "aluno" : col === "classes" ? "turma" : "chamada", "excluido", col === "students" ? "Excluiu o aluno " + (old.name || "") + "." : col === "classes" ? "Excluiu a turma " + (old.name || "") + "." : "Excluiu a chamada de " + (old.className || "Turma") + " de " + new Date(old.startedAt || 0).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) + ".", { subject: old.name || old.className || "" });
      delete d[col][id]; if (col === "students") delete d.auth[id];
      if (col === "sessions") for (const k of Object.keys(d.just)) if (k.startsWith(id + "/")) delete d.just[k];
      saveTenant(tid); notify(tid); return send(res, 200, { ok: true }); }
  }
  if (p === "users" && M === "POST") {
    if (!staff) return fail(res, 403, "Só a secretaria pode criar logins.");
    const sec = body.role === "secretaria";
    if (sec ? !owner : !can("logins", "edit")) return sec ? fail(res, 403, "Só o responsável pela instituição pode adicionar pessoas na secretaria.") : noPerm("logins");
    const e = validAccount(body, true); if (e) return fail(res, 400, e);
    if (findUser(normLogin(body.login))) return fail(res, 400, "Esse login já está em uso.");
    const uid = newId();
    sys.users[uid] = { name: body.name.trim(), login: normLogin(body.login), role: sec ? "secretaria" : "professor", tenantId: tid, ...(sec ? { perms: cleanPerms(body.perms) } : {}), ...hashPw(body.password) };
    log(sec ? "equipe" : "professor", "criado", sec ? "Adicionou " + body.name.trim() + " na secretaria. Permissões: " + permsText(sys.users[uid].perms) + "." : "Cadastrou o professor " + body.name.trim() + ".", { subject: body.name.trim() });
    saveSys(); saveTenant(tid); notify(tid); notify("admin"); return send(res, 200, { ok: true, id: uid });
  }
  m = p.match(/^users\/([A-Za-z0-9_-]+)$/);
  if (m && sys.users[m[1]] && sys.users[m[1]].tenantId === tid) {
    if (!staff) return fail(res, 403, "Só a secretaria pode alterar logins.");
    const u = sys.users[m[1]], sec = u.role === "secretaria";
    if (sec ? !owner : !can("logins", "edit")) return sec ? fail(res, 403, "Só o responsável pela instituição pode alterar a equipe da secretaria.") : noPerm("logins");
    if (M === "PUT") {
      const what = [];
      if (body.name !== undefined) { const n = String(body.name).trim(); if (!n) return fail(res, 400, "Informe o nome."); if (n !== u.name) what.push("nome"); u.name = n; }
      if (body.password) { const e = pwProblem(body.password, u.login, 8); if (e) return fail(res, 400, e); Object.assign(u, hashPw(body.password)); delete u.weakPw; dropLogins(m[1]); locks.delete("u:" + u.login); what.push("senha"); }
      if (what.length) log(sec ? "equipe" : "professor", "alterado", "Alterou o login de " + u.name + ": " + what.join(", ") + ".", { subject: u.name });
      if (sec && body.perms && m[1] !== ownerId(tid)) { const np = cleanPerms(body.perms), before = permsOf(m[1], u);
        if (JSON.stringify(np) !== JSON.stringify(before)) { u.perms = np; log("equipe", "permissoes", "Mudou as permissões de " + u.name + ". " + permsText(np) + ".", { subject: u.name }); } }
      saveSys(); saveTenant(tid); notify(tid); return send(res, 200, { ok: true });
    }
    if (M === "DELETE") {
      if (m[1] === me.id) return fail(res, 400, "Você não pode excluir o próprio login.");
      if (m[1] === ownerId(tid)) return fail(res, 400, "O login do responsável pela instituição não pode ser excluído.");
      log(sec ? "equipe" : "professor", "excluido", "Excluiu o login de " + u.name + (sec ? " (secretaria)." : " (professor)."), { subject: u.name });
      delete sys.users[m[1]]; for (const [k, v] of Object.entries(sys.logins)) if (v.userId === m[1]) delete sys.logins[k];
      saveSys(); saveTenant(tid); notify(tid); notify("admin"); return send(res, 200, { ok: true });
    }
  }
  return fail(res, 404, "Não encontrado.");
}

const server = http.createServer((req, res) => {
  secHeaders(req, res);
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (e) { return send(res, 400, "Endereço inválido", "text/plain; charset=utf-8"); }
  if (p.startsWith("/api/")) return api(req, res, p.slice(5)).catch(e => { console.error(e); if (!res.headersSent) fail(res, 500, "Erro no servidor."); });
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Método não permitido", "text/plain; charset=utf-8");
  const file = path.normalize(path.join(PUB, p === "/" ? "index.html" : p));
  if (!file.startsWith(PUB + path.sep)) return send(res, 403, "Proibido", "text/plain");
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "Não encontrado", "text/plain; charset=utf-8");
    send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});

// Chamadas com hora marcada para encerrar: o servidor encerra sozinho, mesmo com a tela do professor fechada.
setInterval(() => {
  const now = Date.now();
  for (const tid of Object.keys(sys.tenants)) {
    let d; try { d = tdata(tid); } catch (e) { continue; }
    let n = 0;
    for (const [id, se] of Object.entries(d.sessions)) if (!se.endedAt && se.autoEnd && se.autoEnd <= now) {
      se.endedAt = se.autoEnd; n++;
      addLog(d, { type: "chamada", action: "encerrada", by: "Sistema", byRole: "sistema", subject: se.className || "Turma", sessionId: id, text: "A chamada de " + (se.className || "Turma") + " foi encerrada sozinha, no horário definido pelo professor." });
    }
    if (n) { saveTenant(tid); notify(tid); }
  }
}, 10000).unref();

// Conexões lentas ou penduradas não seguram o servidor.
server.headersTimeout = 20000; server.requestTimeout = 60000; server.keepAliveTimeout = 15000; server.maxHeadersCount = 100;
// Um erro inesperado fica anotado em dados/erros.log e o servidor continua no ar.
const logErr = (kind, e) => { const msg = new Date().toISOString() + " " + kind + ": " + ((e && e.stack) || e) + "\n"; console.error(msg); try { fs.appendFileSync(path.join(DATA_DIR, "erros.log"), msg); } catch (x) { /* sem disco */ } };
process.on("uncaughtException", e => logErr("erro", e));
process.on("unhandledRejection", e => logErr("promessa", e));

// Se a porta estiver ocupada por outro programa, tenta a seguinte.
server.on("error", e => {
  if (e.code === "EADDRINUSE" && process.env.TOCA_PORTA_FIXA) { console.error("\n  A porta " + PORT + " está ocupada por outro programa.\n  O túnel do domínio aponta para ela: feche o outro programa e abra o iniciar.bat de novo.\n"); process.exit(1); }
  else if (e.code === "EADDRINUSE" && PORT < FIRST_PORT + 30) { PORT++; server.listen(PORT, "0.0.0.0"); }
  else { console.error("Não foi possível iniciar o servidor:", e.message); process.exit(1); }
});
server.on("listening", () => {
  const url = "http://localhost:" + PORT;
  console.log("\n  TOCA tag está no ar.\n");
  console.log("  Neste computador:   " + url);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === "IPv4" && !n.internal) console.log("  Na rede:            http://" + n.address + ":" + PORT);
  console.log("\n  Os dados ficam em: " + DATA_DIR);
  if (process.env.TUNNEL_TOKEN) console.log("  Pela internet:      https://tocatag.net (pelo túnel da Cloudflare)");
  if (!hasAdmin()) console.log("  Primeiro uso: abra " + url + "/app.html e crie a conta de administrador.");
  console.log("  Para desligar, feche esta janela.\n");
  if (process.platform === "win32" && !process.env.TOCA_SEM_NAVEGADOR)
    require("child_process").exec('start "" "' + url + (hasAdmin() ? "" : "/app.html") + '"');
});
server.listen(PORT, "0.0.0.0");

// Reinício a pedido: quando aparece o arquivo reiniciar.flag nesta pasta, o servidor
// salva o que falta e sai com código 0; o iniciar.bat liga de novo em seguida.
const FLAG = path.join(__dirname, "reiniciar.flag");
try { fs.unlinkSync(FLAG); } catch (e) { /* não havia pedido pendente */ }
setInterval(() => {
  if (!fs.existsSync(FLAG)) return;
  try { fs.unlinkSync(FLAG); } catch (e) { return; }
  console.log("\n  Reinício pedido. Desligando para ligar de novo...");
  setTimeout(() => process.exit(0), 600);
}, 2000);
