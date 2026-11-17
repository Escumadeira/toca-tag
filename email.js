// TOCA tag - envio de e-mail (recuperação de senha do aluno).
// Só funciona depois de preencher email/config.json (veja email/COMO-ATIVAR.txt).
const fs = require("fs"), path = require("path"), tls = require("tls"), net = require("net"), os = require("os"), crypto = require("crypto");

function cfg() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "email", "config.json"), "utf8")); } catch (e) { return {}; } }
function ready() { const c = cfg(); return !!(c.host && c.user && c.pass && c.from); }

const b64 = s => Buffer.from(String(s), "utf8").toString("base64");
const word = s => /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?=";
const clean = s => String(s).replace(/[\r\n<>]/g, "");

// Conversa SMTP mínima: porta 465 (TLS direto) ou 587 (STARTTLS). Sempre com TLS e login.
function send(to, subject, text) {
  const c = cfg(), port = Number(c.port) || 465;
  return new Promise((ok, bad) => {
    let sock, buf = "", waiting = null, done = false;
    const finish = err => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} err ? bad(err) : ok(); };
    const timer = setTimeout(() => finish(new Error("O servidor de e-mail não respondeu.")), 20000);
    const onData = chunk => {
      buf += chunk.toString("utf8");
      for (;;) {
        const m = /^(?:\d{3}-[^\r\n]*\r?\n)*(\d{3}) [^\r\n]*\r?\n/.exec(buf);
        if (!m) return;
        buf = buf.slice(m[0].length);
        const w = waiting; waiting = null; if (w) w(Number(m[1]), m[0]);
      }
    };
    const wire = s => { sock = s; s.on("data", onData); s.on("error", e => finish(new Error("Falha na conexão com o servidor de e-mail: " + e.message))); };
    const reply = () => new Promise(r => { waiting = r; });
    const cmd = async (line, want) => {
      if (line !== null) sock.write(line + "\r\n");
      const code = (await reply());
      if (!want.includes(code)) throw new Error("O servidor de e-mail recusou o envio (código " + code + ").");
    };
    const from = clean(c.from), rcpt = clean(to), host = os.hostname().replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
    const msg = [
      "From: " + word(c.fromName || "TOCA tag") + " <" + from + ">", "To: <" + rcpt + ">", "Subject: " + word(subject),
      "Date: " + new Date().toUTCString().replace("GMT", "+0000"), "Message-ID: <" + crypto.randomBytes(12).toString("hex") + "@" + (from.split("@")[1] || "tocatag") + ">",
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "",
      b64(text).replace(/(.{76})/g, "$1\r\n")
    ].join("\r\n");
    const talk = async () => {
      await cmd(null, [220]);
      await cmd("EHLO " + host, [250]);
      if (port !== 465) {
        await cmd("STARTTLS", [220]);
        sock.removeAllListeners("data");
        await new Promise((r, x) => { const s = tls.connect({ socket: sock, servername: c.host }, r); s.on("error", x); wire(s); });
        await cmd("EHLO " + host, [250]);
      }
      await cmd("AUTH LOGIN", [334]); await cmd(b64(c.user), [334]); await cmd(b64(c.pass), [235]);
      await cmd("MAIL FROM:<" + from + ">", [250]); await cmd("RCPT TO:<" + rcpt + ">", [250, 251]);
      await cmd("DATA", [354]); await cmd(msg + "\r\n.", [250]);
      sock.write("QUIT\r\n");
    };
    const start = () => talk().then(() => finish(), finish);
    if (port === 465) wire(tls.connect({ host: c.host, port, servername: c.host }, start));
    else { wire(net.connect({ host: c.host, port })); start(); }
  });
}

module.exports = { ready, send };
