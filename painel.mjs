// Painel local: http://127.0.0.1:4321 — lista as vagas ordenadas pela chance de retorno,
// com link para a vaga, o currículo indicado, a carta (se houver IA) e o controle de status.
// Uso: node painel.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { carregar, salvar, carregarConfig, STATUS, RESPOSTAS, POS_APLICACAO, RAIZ } from "./src/db.mjs";
import { calcularChance, avaliar } from "./src/filtro.mjs";
import { executarBusca, avisarNovas } from "./buscar.mjs";
import { GRUPOS, carregarPerfil, salvarPerfil } from "./src/perfil.mjs";
import { regrasDoPerfil, textosDoKit } from "./src/compartilhado.mjs";

const config = carregarConfig();
const PORTA = Number(process.env.PORTA) || config.painel?.porta || 4321;
let buscando = false;
const iaConfigurada = (await import("./src/ia.mjs")).credencialConfigurada();
let logBusca = [];

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function lerCorpo(req) {
  return new Promise((ok, erro) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch (e) {
        erro(e);
      }
    });
  });
}

/** Só serve arquivos listados no config (nada de caminho arbitrário). */
function curriculosPermitidos() {
  const nomes = new Set();
  for (const porIdioma of Object.values(config.curriculos)) for (const n of Object.values(porIdioma)) nomes.add(n);
  return nomes;
}

/** Muda o status de uma vaga. Retorna mensagem de erro ou null. */
function mudarStatus(id, status) {
  if (!STATUS.includes(status)) return "status inválido";
  const db = carregar();
  const v = db.vagas[id];
  if (!v) return "vaga não encontrada";
  const agora = new Date().toISOString();
  v.status = status;
  v[`em_${status}`] = agora;
  // Fotografia do momento da candidatura: é o que permite medir se aplicar cedo dá mais retorno.
  if (POS_APLICACAO.includes(status) && !v.aplicada_em) {
    const c = calcularChance(v, config);
    v.aplicada_em = agora;
    v.horas_ao_aplicar = c.horas;
    v.chance_ao_aplicar = c.chance;
    v.aderencia_ao_aplicar = c.aderencia;
  }
  if (RESPOSTAS.includes(status) && !v.retorno_em) v.retorno_em = agora;
  salvar(db);
  return null;
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(RAIZ, "src", "painel.html")));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/vagas") {
      const db = carregar();
      const agora = Date.now();
      // Vagas que você já marcou continuam visíveis mesmo se a heurística as descartar depois.
      const vagas = Object.values(db.vagas)
        .filter((v) => !v.descartada || v.status !== "nova")
        .map((v) => ({ ...v, descricao: v.descricao.slice(0, 6000), ...calcularChance(v, config, agora) }))
        .sort((a, b) => b.chance - a.chance);
      json(res, 200, { vagas, ultima_busca: db.ultima_busca, erros: db.erros ?? [], status: STATUS, respostas: RESPOSTAS, pos_aplicacao: POS_APLICACAO, buscando, log: logBusca, ia_configurada: iaConfigurada, proxima_busca: proximaBusca });
      return;
    }
    if (req.method === "GET" && url.pathname === "/compartilhado.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(fs.readFileSync(path.join(RAIZ, "src", "compartilhado.mjs")));
      return;
    }
    const m = url.pathname.match(/^\/api\/vagas\/(.+)\/status$/);
    if (req.method === "POST" && m) {
      const { status } = await lerCorpo(req);
      const erro = mudarStatus(decodeURIComponent(m[1]), status);
      return erro ? json(res, 400, { erro }) : json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/api/buscas-manuais") {
      // Links de busca prontos (você abre e navega); nada é raspado desses sites.
      const sites = (config.buscas_manuais ?? []).map((s) => ({
        site: s.site,
        links: s.termos.map((q) => ({ busca: q, url: s.url.replace("{q}", encodeURIComponent(q)) })),
      }));
      return json(res, 200, { sites });
    }
    if (req.method === "POST" && url.pathname === "/api/vagas/manual") {
      const b = await lerCorpo(req);
      if (!b.texto?.trim() || !b.url?.trim()) return json(res, 400, { erro: "Cole pelo menos o link e o texto do post." });
      const horas = Math.max(0, Number(b.horas) || 0);
      const texto = String(b.texto).slice(0, 12000);
      const vaga = {
        id: `manual:${Buffer.from(b.url.trim()).toString("base64url").slice(-40)}`,
        fonte: b.fonte?.trim() || "LinkedIn (post)",
        titulo: (b.titulo?.trim() || texto.split("\n").find((l) => l.trim())?.trim() || "Vaga do LinkedIn").slice(0, 140),
        empresa: b.empresa?.trim() ?? "",
        url: b.url.trim(),
        descricao: texto,
        tags: [],
        local: "",
        remoto: b.remoto !== false,
        data: new Date(Date.now() - horas * 3600000).toISOString(),
      };
      const av = avaliar(vaga, config);
      const db = carregar();
      const agora = new Date().toISOString();
      // Você escolheu a vaga: entra mesmo que a heurística descarte, mas o motivo fica visível.
      db.vagas[vaga.id] = {
        ...vaga, ...av, descartada: false,
        motivos: av.descartada ? [`⚠ o filtro descartaria: ${av.motivo_descartada}`, ...av.motivos] : av.motivos,
        papel: av.papel ?? "fullstack",
        curriculo: av.curriculo ?? config.curriculos.fullstack[av.idioma],
        status: db.vagas[vaga.id]?.status ?? "nova", ia: null, primeira_vez: agora, visto_em: agora, manual: true,
      };
      salvar(db);
      // Vaga que você já aplicou fora do painel (ex.: já te chamaram): registra a candidatura e o retorno.
      if (b.status && b.status !== "nova") {
        if (POS_APLICACAO.includes(b.status) && b.status !== "aplicada") mudarStatus(vaga.id, "aplicada");
        const erro = mudarStatus(vaga.id, b.status);
        if (erro) return json(res, 400, { erro });
      }
      const salva = carregar().vagas[vaga.id];
      return json(res, 200, { ok: true, vaga: { ...salva, ...calcularChance(salva, config) } });
    }
    const ap = url.pathname.match(/^\/api\/vagas\/(.+)\/aplicar$/);
    if (req.method === "POST" && ap) {
      const v = carregar().vagas[decodeURIComponent(ap[1])];
      if (!v) return json(res, 404, { erro: "vaga não encontrada" });
      const perfil = carregarPerfil();
      const dados = { regras: regrasDoPerfil(GRUPOS, perfil), textos: textosDoKit(v, perfil) };
      try {
        const { abrirCandidatura } = await import("./src/aplicar.mjs");
        const { url: aberta, campos } = await abrirCandidatura(v, dados, (id) => mudarStatus(id, "aplicada"));
        if (v.status === "nova") mudarStatus(v.id, "interessante");
        return json(res, 200, { ok: true, url: aberta, campos });
      } catch (e) {
        const semEdge = /executable|msedge|channel/i.test(e.message);
        return json(res, 500, { erro: semEdge ? "Não encontrei o Microsoft Edge instalado." : e.message.split("\n")[0] });
      }
    }
    if (url.pathname === "/api/perfil") {
      if (req.method === "GET") return json(res, 200, { grupos: GRUPOS, valores: carregarPerfil() });
      if (req.method === "POST") return json(res, 200, { valores: salvarPerfil(await lerCorpo(req)) });
    }
    if (req.method === "POST" && url.pathname === "/api/buscar") {
      rodarBusca({ semIA: url.searchParams.get("ia") === "0", automatica: false });
      json(res, 202, { buscando: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/testar-notificacao") {
      const { notificar } = await import("./src/notificar.mjs");
      const ok = await notificar({
        titulo: "Busca de Vagas — teste",
        linhas: ["As notificações estão funcionando ✓", "Clique para abrir o painel"],
        abrir: `http://127.0.0.1:${PORTA}/`,
        botoes: [{ rotulo: "Abrir painel", url: `http://127.0.0.1:${PORTA}/` }],
      });
      return json(res, 200, { ok });
    }
    const cv = url.pathname.match(/^\/cv\/(.+)$/);
    if (req.method === "GET" && cv) {
      const nome = decodeURIComponent(cv[1]);
      if (!curriculosPermitidos().has(nome)) return json(res, 404, { erro: "currículo não configurado" });
      const arq = path.join(config.pasta_curriculos, nome);
      const tipo = nome.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      res.writeHead(200, { "Content-Type": tipo, "Content-Disposition": `inline; filename="${nome}"` });
      fs.createReadStream(arq).pipe(res);
      return;
    }
    json(res, 404, { erro: "não encontrado" });
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
});

servidor.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`O painel já está aberto em http://127.0.0.1:${PORTA} (feche a outra janela do terminal para reiniciar).`);
    if (!process.argv.includes("--sem-abrir")) exec(`start "" "http://127.0.0.1:${PORTA}"`);
    process.exit(0);
  }
  throw e;
});

// ---------------------------------------------------------------- busca automática
const AUTO = config.automatico ?? {};
let proximaBusca = null;

function rodarBusca({ semIA, automatica }) {
  if (buscando) return;
  buscando = true;
  logBusca = [`${automatica ? "Busca automática" : "Busca"} às ${new Date().toLocaleTimeString("pt-BR")}`];
  const log = (l) => logBusca.push(l);
  executarBusca({ semIA: semIA || !iaConfigurada, log })
    // Só notifica nas buscas automáticas: na manual você já está olhando o painel.
    .then(({ novas }) => (automatica ? avisarNovas(novas, config, log) : null))
    .catch((e) => log(`ERRO: ${e.message}`))
    .finally(() => {
      buscando = false;
      agendarProxima();
    });
}

function agendarProxima() {
  if (!AUTO.ativo) return;
  const ultima = carregar().ultima_busca;
  let t = new Date((ultima ? new Date(ultima).getTime() : 0) + (AUTO.intervalo_min ?? 60) * 60000);
  if (t < new Date()) t = new Date(Date.now() + 15000); // atrasada: busca logo após abrir o painel
  // Fora do horário (ex.: 8h–22h), empurra para o início do próximo período.
  const h = t.getHours();
  if (h < (AUTO.das ?? 0) || h >= (AUTO.ate ?? 24)) {
    if (h >= (AUTO.ate ?? 24)) t.setDate(t.getDate() + 1);
    t.setHours(AUTO.das ?? 0, 0, 0, 0);
  }
  proximaBusca = t;
}

setInterval(() => {
  if (AUTO.ativo && proximaBusca && Date.now() >= proximaBusca.getTime()) rodarBusca({ semIA: false, automatica: true });
}, 20000);

// Escuta só no próprio computador: o painel expõe seus currículos.
servidor.listen(PORTA, "127.0.0.1", () => {
  const endereco = `http://127.0.0.1:${PORTA}`;
  console.log(`Painel em ${endereco}  (Ctrl+C para sair)`);
  agendarProxima();
  if (proximaBusca) console.log(`Busca automática a cada ${AUTO.intervalo_min} min (${AUTO.das}h–${AUTO.ate}h). Próxima: ${proximaBusca.toLocaleString("pt-BR")}`);
  if (!process.argv.includes("--sem-abrir")) exec(`start "" "${endereco}"`);
});
