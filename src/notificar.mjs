// Notificação nativa do Windows (toast), sem dependências: usa a API do Windows via PowerShell.
// Botões abrem links (ativação por protocolo), então funcionam mesmo com o painel fechado.
import { execFile } from "node:child_process";

const xmlEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/**
 * @param {{ titulo: string, linhas: string[], abrir: string, botoes?: {rotulo: string, url: string}[] }} n
 */
export function notificar({ titulo, linhas, abrir, botoes = [] }) {
  if (process.platform !== "win32") return Promise.resolve(false);
  // scenario="reminder": aparece mesmo com o "Não perturbe" do Windows 11 (lembretes passam por padrão)
  // e fica na tela até você clicar. Exige pelo menos um botão; por isso sempre há "Fechar".
  if (!botoes.some((b) => b.dispensar)) botoes = [...botoes.slice(0, 2), { rotulo: "Fechar", dispensar: true }];
  const acoes = botoes
    .slice(0, 3)
    .map((b) => b.dispensar
      ? `<action content="${xmlEsc(b.rotulo)}" activationType="system" arguments="dismiss"/>`
      : `<action content="${xmlEsc(b.rotulo)}" activationType="protocol" arguments="${xmlEsc(b.url)}"/>`)
    .join("");
  const xml = `<toast activationType="protocol" launch="${xmlEsc(abrir)}" scenario="reminder">
  <visual><binding template="ToastGeneric">
    <text>${xmlEsc(titulo)}</text>
    ${linhas.slice(0, 2).map((l) => `<text>${xmlEsc(l)}</text>`).join("")}
  </binding></visual>
  <actions>${acoes}</actions>
  <audio src="ms-winsoundevent:Notification.Reminder"/>
</toast>`;
  // AUMID do PowerShell: já registrado em todo Windows, então o toast aparece sem instalar nada.
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(xml, "utf8").toString("base64")}')))
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((ok) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true }, (erro) => ok(!erro));
  });
}

/** Monta e envia o aviso de vagas novas. `vagas` já vem com `chance` calculada, maior primeiro. */
export function notificarVagasNovas(vagas, porta) {
  if (!vagas.length) return Promise.resolve(false);
  const painel = `http://127.0.0.1:${porta}/`;
  const melhor = vagas[0];
  const idade = melhor.horas < 1 ? "agora há pouco" : melhor.horas < 48 ? `há ${Math.round(melhor.horas)}h` : `há ${Math.round(melhor.horas / 24)} dias`;
  return notificar({
    titulo: vagas.length === 1 ? "1 vaga nova com boa chance" : `${vagas.length} vagas novas com boa chance`,
    linhas: [
      `${melhor.chance}% · ${melhor.titulo}`,
      `${melhor.empresa || melhor.fonte} · publicada ${idade}${vagas.length > 1 ? ` · +${vagas.length - 1} no painel` : ""}`,
    ],
    abrir: painel,
    botoes: [
      { rotulo: "Abrir painel", url: painel },
      { rotulo: "Ver a vaga", url: melhor.url },
    ],
  });
}
