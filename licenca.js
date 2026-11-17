// TOCA tag - trava de computador.
// O app só roda no computador autorizado. Em qualquer outro, ele se recusa a iniciar.
// Como o código é aberto, isto impede a cópia casual; não impede quem souber editar o código.
const crypto = require("crypto"), fs = require("fs"), path = require("path"), os = require("os");
const { execSync } = require("child_process");

// Identificador estável deste computador. No Windows usa o MachineGuid (não muda ao
// reinstalar o app nem ao trocar de pasta). Em outros sistemas, usa nome + placa de rede.
function idDoComputador() {
let id = "";
if (process.platform === "win32") {
for (const via of [
'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid /reg:64',
]) {
try { const m = execSync(via, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/MachineGuid\s+REG_SZ\s+([A-Za-z0-9-]+)/i); if (m) { id = "win:" + m[1].toLowerCase(); break; } } catch (e) { /* tenta a proxima */ }
}
}
if (!id) {
const macs = Object.values(os.networkInterfaces()).flat().filter(n => n && !n.internal && n.mac && n.mac !== "00:00:00:00:00:00").map(n => n.mac.toLowerCase()).sort();
id = "sys:" + os.hostname().toLowerCase() + "|" + os.platform() + "|" + (macs[0] || "");
}
return id;
}

// Hash do identificador. O arquivo de trava guarda so o hash, nunca o identificador em si.
const impressao = () => crypto.createHash("sha256").update("TOCA-tag-v1|" + idDoComputador()).digest("hex");

// Verifica a trava. Chamado logo no inicio do servidor.
function proteger() {
const DATA_DIR = path.join(__dirname, "dados"), LOCK = path.join(DATA_DIR, "maquina.lock");
const AUTORIZA = path.join(DATA_DIR, "autorizar-este-computador.txt"); // criar este arquivo autoriza o computador atual, uma unica vez
const atual = impressao();
let lock = null;
try { lock = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (e) { /* ainda nao travado */ }

if (lock && lock.maquina) {
if (lock.maquina === atual) return; // computador autorizado: segue
recusar("Este computador nao e o autorizado para rodar o TOCA tag.",
"O app foi travado em outra maquina. Para mudar de computador, apague dados/maquina.lock no computador autorizado e autorize o novo.");
}

// Ainda sem trava: so trava se o dono autorizou explicitamente, criando o arquivo de autorizacao.
if (fs.existsSync(AUTORIZA)) {
try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LOCK, JSON.stringify({ maquina: atual, em: new Date().toISOString() }, null, 2)); fs.unlinkSync(AUTORIZA); } catch (e) { recusar("Nao foi possivel gravar a trava do computador.", e.message); }
console.log("  TOCA tag travado neste computador. So aqui ele vai rodar.");
return;
}

recusar("O TOCA tag ainda nao foi autorizado neste computador.",
"Se este e o seu computador, crie um arquivo vazio chamado autorizar-este-computador.txt dentro da pasta dados e inicie de novo.");
}

function recusar(motivo, detalhe) {
console.error("\n  " + motivo + (detalhe ? "\n  " + detalhe : "") + "\n");
process.exit(1); // o iniciar.bat para aqui, sem reiniciar em laco
}

module.exports = { proteger, impressao };
