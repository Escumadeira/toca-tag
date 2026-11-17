// TOCA tag - banco de dados (SQLite embutido no Node.js, sem instalar nada).
// Tudo fica em dados/toca.db. Só o que mudou é gravado, dentro de uma transação:
// ou a gravação entra inteira, ou não entra nada. Uma cópia de segurança é feita todo dia.
const fs = require("fs"), path = require("path");

const COLS = ["students", "classes", "sessions", "auth", "just", "courses"];
const KINDS = ["users", "tenants", "logins", "alunos"];

function abrir(DATA_DIR) {
  if (process.env.TOCA_SEM_BANCO) return null;
  let DatabaseSync;
  const aviso = process.emitWarning;
  try {
    process.emitWarning = (w, ...a) => { if (String(w && w.message || w).includes("SQLite")) return; aviso.call(process, w, ...a); };
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (e) { return null; } // Node antigo: o servidor continua com os arquivos JSON
  finally { setTimeout(() => { process.emitWarning = aviso; }, 0); }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const FILE = path.join(DATA_DIR, "toca.db"), BACKUPS = path.join(DATA_DIR, "backups");
  const db = new DatabaseSync(FILE);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS sys(kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(kind,id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS docs(tenant TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(tenant,col,id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS photos(tenant TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(tenant,id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS logs(seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, id TEXT NOT NULL, at INTEGER, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS logs_tenant ON logs(tenant, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS logs_id ON logs(tenant, id);`);
  const ok = db.prepare("PRAGMA quick_check").get();
  if (!ok || Object.values(ok)[0] !== "ok") throw new Error("O banco de dados dados/toca.db está danificado. Restaure a cópia mais recente da pasta dados/backups.");

  // Todas as consultas são preparadas: nenhum texto vindo de fora vira comando SQL.
  const q = {
    metaGet: db.prepare("SELECT v FROM meta WHERE k=?"), metaSet: db.prepare("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"),
    sysAll: db.prepare("SELECT kind,id,json FROM sys"), sysPut: db.prepare("INSERT INTO sys(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json"), sysDel: db.prepare("DELETE FROM sys WHERE kind=? AND id=?"),
    docAll: db.prepare("SELECT col,id,json FROM docs WHERE tenant=?"), docPut: db.prepare("INSERT INTO docs(tenant,col,id,json) VALUES(?,?,?,?) ON CONFLICT(tenant,col,id) DO UPDATE SET json=excluded.json"), docDel: db.prepare("DELETE FROM docs WHERE tenant=? AND col=? AND id=?"),
    phAll: db.prepare("SELECT id,data FROM photos WHERE tenant=?"), phPut: db.prepare("INSERT INTO photos(tenant,id,data) VALUES(?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET data=excluded.data"), phDel: db.prepare("DELETE FROM photos WHERE tenant=? AND id=?"),
    logAll: db.prepare("SELECT json FROM logs WHERE tenant=? ORDER BY seq"), logPut: db.prepare("INSERT OR IGNORE INTO logs(tenant,id,at,json) VALUES(?,?,?,?)"), logDel: db.prepare("DELETE FROM logs WHERE tenant=? AND id=?"),
    wipeDocs: db.prepare("DELETE FROM docs WHERE tenant=?"), wipePh: db.prepare("DELETE FROM photos WHERE tenant=?"), wipeLogs: db.prepare("DELETE FROM logs WHERE tenant=?"),
  };
  function tx(fn) { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { try { db.exec("ROLLBACK"); } catch (x) { /* nada aberto */ } throw e; } }

  // O que já está gravado, para só gravar a diferença.
  const sysSeen = Object.fromEntries(KINDS.map(k => [k, new Map()]));
  const seen = new Map(); // instituição -> { docs: {col: Map(id->json)}, refs: Map(id->objeto) (justificativas), photos: Map, logs: Set, settings: json }
  const stateOf = tid => { if (!seen.has(tid)) seen.set(tid, { docs: Object.fromEntries(COLS.map(c => [c, new Map()])), refs: new Map(), photos: new Map(), logs: new Set(), settings: null }); return seen.get(tid); };

  function loadSys() {
    const sys = { users: {}, tenants: {}, logins: {}, alunos: {} };
    for (const r of q.sysAll.all()) if (sys[r.kind]) { sys[r.kind][r.id] = JSON.parse(r.json); sysSeen[r.kind].set(r.id, r.json); }
    return sys;
  }
  function saveSys(sys) {
    tx(() => {
      for (const kind of KINDS) {
        const cur = sys[kind] || {}, old = sysSeen[kind];
        for (const [id, v] of Object.entries(cur)) { const j = JSON.stringify(v); if (old.get(id) !== j) { q.sysPut.run(kind, id, j); old.set(id, j); } }
        for (const id of [...old.keys()]) if (!(id in cur)) { q.sysDel.run(kind, id); old.delete(id); }
      }
    });
  }
  function loadTenant(tid) {
    const d = { students: {}, classes: {}, sessions: {}, auth: {}, settings: {}, just: {}, courses: {}, logs: [] }, st = stateOf(tid);
    for (const r of q.docAll.all(tid)) {
      if (r.col === "settings") { d.settings = JSON.parse(r.json); st.settings = r.json; continue; }
      if (!d[r.col]) continue;
      d[r.col][r.id] = JSON.parse(r.json); st.docs[r.col].set(r.id, r.json);
      if (r.col === "just") st.refs.set(r.id, d.just[r.id]);
    }
    for (const r of q.phAll.all(tid)) if (d.students[r.id]) { d.students[r.id].photo = r.data; st.photos.set(r.id, r.data); }
    for (const s of Object.values(d.students)) if (s.photo === undefined) s.photo = "";
    for (const r of q.logAll.all(tid)) { const l = JSON.parse(r.json); d.logs.push(l); st.logs.add(l.id); }
    return d;
  }
  function saveTenant(tid, d) {
    const st = stateOf(tid);
    tx(() => {
      for (const col of COLS) {
        const cur = d[col] || {}, old = st.docs[col];
        for (const [id, v] of Object.entries(cur)) {
          let j;
          if (col === "students") { // a foto vai para uma tabela própria: é grande e muda pouco
            const { photo, ...rest } = v; j = JSON.stringify(rest);
            const ph = photo || "";
            if ((st.photos.get(id) || "") !== ph) { if (ph) { q.phPut.run(tid, id, ph); st.photos.set(id, ph); } else { q.phDel.run(tid, id); st.photos.delete(id); } }
          } else if (col === "just") { // justificativa nunca é alterada no lugar: o mesmo objeto é o mesmo conteúdo
            if (st.refs.get(id) === v) continue;
            j = JSON.stringify(v); st.refs.set(id, v);
          } else j = JSON.stringify(v);
          if (old.get(id) !== j) { q.docPut.run(tid, col, id, j); old.set(id, j); }
        }
        for (const id of [...old.keys()]) if (!(id in cur)) {
          q.docDel.run(tid, col, id); old.delete(id);
          if (col === "students") { q.phDel.run(tid, id); st.photos.delete(id); }
          if (col === "just") st.refs.delete(id);
        }
      }
      const sj = JSON.stringify(d.settings || {});
      if (st.settings !== sj) { q.docPut.run(tid, "settings", "settings", sj); st.settings = sj; }
      const now = new Set();
      for (const l of d.logs || []) { now.add(l.id); if (!st.logs.has(l.id)) { q.logPut.run(tid, String(l.id), l.at || 0, JSON.stringify(l)); st.logs.add(l.id); } }
      if (st.logs.size > now.size) for (const id of [...st.logs]) if (!now.has(id)) { q.logDel.run(tid, String(id)); st.logs.delete(id); }
    });
  }
  function deleteTenant(tid) { tx(() => { q.wipeDocs.run(tid); q.wipePh.run(tid); q.wipeLogs.run(tid); }); seen.delete(tid); }

  // Primeira vez com o banco: traz os dados dos arquivos JSON antigos e guarda os originais em dados/json-antigo.
  function migrarJson() {
    if (q.metaGet.get("migrado")) return null;
    const sysFile = path.join(DATA_DIR, "sistema.json");
    if (!fs.existsSync(sysFile)) { q.metaSet.run("migrado", new Date().toISOString() + " (instalação nova)"); return null; }
    const j = JSON.parse(fs.readFileSync(sysFile, "utf8"));
    const sys = { users: j.users || {}, tenants: j.tenants || {}, logins: j.logins || {}, alunos: j.alunos || {} };
    const files = fs.readdirSync(DATA_DIR).filter(f => /^inst-[A-Za-z0-9_-]+\.json$/.test(f));
    const tenants = files.map(f => {
      const t = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")), d = { students: {}, classes: {}, sessions: {}, auth: {}, settings: {}, just: {}, courses: {}, logs: [] };
      for (const c of [...COLS, "settings"]) if (t[c] && typeof t[c] === "object") d[c] = t[c];
      if (Array.isArray(t.logs)) d.logs = t.logs.filter(l => l && l.id);
      return [f.slice(5, -5), d];
    });
    saveSys(sys); for (const [tid, d] of tenants) saveTenant(tid, d);
    q.metaSet.run("migrado", new Date().toISOString());
    const old = path.join(DATA_DIR, "json-antigo"); fs.mkdirSync(old, { recursive: true });
    for (const f of ["sistema.json", ...files]) try { fs.renameSync(path.join(DATA_DIR, f), path.join(old, f)); } catch (e) { /* fica onde está */ }
    for (const k of KINDS) sysSeen[k].clear(); seen.clear(); // recarrega do banco, que agora é a fonte dos dados
    return { instituicoes: tenants.length, alunos: tenants.reduce((n, [, d]) => n + Object.keys(d.students).length, 0) };
  }

  // Cópia de segurança completa do banco, uma por dia; ficam as 14 mais recentes.
  function backup() {
    try {
      fs.mkdirSync(BACKUPS, { recursive: true });
      const dia = new Date().toISOString().slice(0, 10), file = path.join(BACKUPS, "toca-" + dia + ".db");
      if (fs.existsSync(file)) return null;
      db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
      const all = fs.readdirSync(BACKUPS).filter(f => /^toca-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const f of all.slice(0, Math.max(0, all.length - 14))) try { fs.unlinkSync(path.join(BACKUPS, f)); } catch (e) { /* tenta de novo amanhã */ }
      return file;
    } catch (e) { console.error("Não foi possível fazer a cópia de segurança do banco:", e.message); return null; }
  }
  function fechar() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close(); } catch (e) { /* já fechado */ } }

  const migracao = migrarJson();
  return { arquivo: FILE, migracao, loadSys, saveSys, loadTenant, saveTenant, deleteTenant, backup, fechar };
}

module.exports = { abrir };
