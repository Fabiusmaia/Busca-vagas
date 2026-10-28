// Abre a vaga numa janela do Edge controlada pelo programa, chega até o formulário,
// preenche o que reconhece e mostra o kit flutuante. NUNCA clica em enviar.
import path from "node:path";
import { chromium } from "playwright-core";
import { RAIZ } from "./db.mjs";
import { kitCandidatura } from "./compartilhado.mjs";

const PERFIL_NAVEGADOR = path.join(RAIZ, "dados", "navegador");
// Botões/links que levam ao formulário. Não inclui "enviar"/"submit": esses são só seus.
const IR_PARA_FORMULARIO = /^\s*(candidat(ar|e)(-se)?|quero me candidatar|aplicar|inscrever(-se)?|apply( now| for this job| for this position)?|i'?m interested)\s*$/i;

let contexto = null;

async function abrirContexto(aoMarcar, opcoes) {
  if (contexto) return contexto;
  // Perfil próprio do Edge (fica em dados/navegador): você faz login nos sites uma vez e ele lembra.
  contexto = await chromium.launchPersistentContext(opcoes.perfil ?? PERFIL_NAVEGADOR, {
    channel: "msedge",
    headless: opcoes.headless ?? false,
    viewport: null,
    args: ["--start-maximized"],
  });
  contexto.on("close", () => (contexto = null));
  await contexto.exposeBinding("buscaVagasMarcar", (_origem, vagaId) => aoMarcar(vagaId));
  return contexto;
}

async function contarCampos(page) {
  return page
    .locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=search]), textarea")
    .filter({ visible: true })
    .count()
    .catch(() => 0);
}

async function prepararPagina(page, dados) {
  const fonte = `(${kitCandidatura.toString()})(${JSON.stringify(dados)})`;
  // Init script: o kit volta a aparecer em cada etapa/página nova desta aba.
  await page.addInitScript(fonte);
  await page.evaluate(fonte).catch(() => {});
}

/**
 * @param vaga  vaga do banco
 * @param dados { regras, textos } do kit
 * @param aoMarcar callback(vagaId) quando você clica em "Já enviei" no kit
 */
export async function abrirCandidatura(vaga, dados, aoMarcar, opcoes = {}) {
  const ctx = await abrirContexto(aoMarcar, opcoes);
  let page = await ctx.newPage();
  const kit = { ...dados, vagaId: vaga.id, titulo: `${vaga.titulo}${vaga.empresa ? ` — ${vaga.empresa}` : ""}`, atraso: 1500 };
  await page.goto(vaga.url_candidatura || vaga.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);

  // Se a página é só a descrição da vaga, clica no botão de candidatura para chegar ao formulário.
  if ((await contarCampos(page)) < 2) {
    const alvo = page.getByRole("link", { name: IR_PARA_FORMULARIO }).or(page.getByRole("button", { name: IR_PARA_FORMULARIO })).filter({ visible: true }).first();
    if (await alvo.count().catch(() => 0)) {
      const novaAba = ctx.waitForEvent("page", { timeout: 6000 }).catch(() => null);
      await alvo.click({ timeout: 5000 }).catch(() => {});
      const nova = await novaAba;
      if (nova) page = nova;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  await prepararPagina(page, kit);
  await page.bringToFront();
  return { url: page.url(), campos: await contarCampos(page), page };
}

/** Fecha a janela controlada (usado nos testes). */
export async function fecharNavegador() {
  await contexto?.close();
  contexto = null;
}
