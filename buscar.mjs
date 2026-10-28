// Busca vagas em todas as fontes, pontua, (opcionalmente) analisa com IA e salva.
// Uso: node buscar.mjs [--sem-ia] [--notificar]
import { pathToFileURL } from "node:url";
import { coletarTudo } from "./src/fontes.mjs";
import { avaliar, calcularChance, normalizar } from "./src/filtro.mjs";
import { carregar, salvar, carregarConfig } from "./src/db.mjs";

const MANTER = new Set(["interessante", "aplicada", "entrevista"]);

export async function executarBusca({ semIA = false, log = console.log } = {}) {
  const config = carregarConfig();
  const db = carregar();
  const agora = new Date().toISOString();

  log("Coletando vagas...");
  db.ultimas_coletas ??= {};
  const { vagas, erros } = await coletarTudo(config.fontes, log, db.ultimas_coletas);
  const idsNovos = [];

  // Remove duplicadas: mesma URL, ou mesmo título + empresa anunciado em mais de um lugar
  // (fica a cópia mais antiga, que é a data real de publicação).
  vagas.sort((a, b) => new Date(a.data) - new Date(b.data));
  const vistos = new Set();
  let novas = 0;
  let aprovadas = 0;
  for (const v of vagas) {
    const chaveTitulo = `${normalizar(v.titulo).replace(/\W+/g, " ").trim()}|${normalizar(v.empresa)}`;
    if (vistos.has(v.url) || vistos.has(chaveTitulo)) continue;
    vistos.add(v.url);
    vistos.add(chaveTitulo);
    const av = avaliar(v, config);
    const antiga = db.vagas[v.id];
    if (av.descartada && !antiga) continue;
    if (!antiga) {
      novas++;
      idsNovos.push(v.id);
    }
    if (!av.descartada) aprovadas++;
    db.vagas[v.id] = {
      ...v,
      ...av,
      status: antiga?.status ?? "nova",
      ia: antiga?.ia ?? null,
      primeira_vez: antiga?.primeira_vez ?? agora,
      visto_em: agora,
    };
  }

  // Limpa vagas antigas que não aparecem mais (exceto as que você está acompanhando).
  for (const [id, v] of Object.entries(db.vagas)) {
    const dias = (Date.now() - new Date(v.visto_em).getTime()) / 86400000;
    if (dias > 30 && !MANTER.has(v.status)) delete db.vagas[id];
  }

  db.ultima_busca = agora;
  db.erros = erros;
  salvar(db);
  log(`\n${vagas.length} vagas coletadas, ${aprovadas} passaram no filtro, ${novas} novas.`);

  if (!semIA && config.ia.ativo) await analisarPendentes(db, config, log);

  // Vagas novas desta busca, com chance já calculada (maior primeiro): usadas na notificação.
  const novasVagas = idsNovos
    .map((id) => db.vagas[id])
    .filter(Boolean)
    .map((v) => ({ ...v, ...calcularChance(v, config) }))
    .sort((a, b) => b.chance - a.chance);
  return { db, novas: novasVagas };
}

/** Notifica no Windows as vagas novas que passam da chance mínima configurada. */
export async function avisarNovas(novas, config, log = console.log) {
  const auto = config.automatico ?? {};
  if (auto.notificar === false) return;
  const boas = novas.filter((v) => v.chance >= (auto.notificar_chance_min ?? 0));
  if (!boas.length) return;
  const { notificarVagasNovas } = await import("./src/notificar.mjs");
  await notificarVagasNovas(boas, config.painel?.porta ?? 4321);
  log(`Notificação enviada: ${boas.length} vaga(s) nova(s) com chance ≥ ${auto.notificar_chance_min ?? 0}%.`);
}

export async function analisarPendentes(db, config, log = console.log) {
  const { iaDisponivel, analisarVaga, descreverErro } = await import("./src/ia.mjs");
  if (!iaDisponivel()) {
    log("\nIA (opcional) desligada: sem credencial da Anthropic. A busca funciona normalmente; para ativar notas e cartas, defina ANTHROPIC_API_KEY.");
    return;
  }
  // Prioriza as vagas mais frescas e aderentes: são as que mais valem uma carta caprichada agora.
  const fila = Object.values(db.vagas)
    .filter((v) => !v.descartada && !v.ia && v.status !== "descartada" && v.nota >= config.ia.nota_minima_para_analisar)
    .sort((a, b) => calcularChance(b, config).chance - calcularChance(a, config).chance)
    .slice(0, config.ia.max_por_execucao);
  if (!fila.length) return;
  log(`\nAnalisando ${fila.length} vagas com IA (${config.ia.modelo})...`);
  for (const v of fila) {
    try {
      v.ia = await analisarVaga(v, v, config);
      log(`  ${v.ia.nota ?? "?"}/10  ${v.titulo.slice(0, 70)}`);
    } catch (e) {
      log(`  erro em "${v.titulo.slice(0, 50)}": ${descreverErro(e)}`);
      // Erro específico da vaga (400) segue para a próxima; credencial, limite ou rede param tudo.
      if (e?.status !== 400) break;
    }
    salvar(db);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db, novas } = await executarBusca({ semIA: process.argv.includes("--sem-ia") });
  const config = carregarConfig();
  if (process.argv.includes("--notificar")) await avisarNovas(novas, config);
  const top = Object.values(db.vagas)
    .filter((v) => !v.descartada && v.status === "nova")
    .map((v) => ({ v, c: calcularChance(v, config) }))
    .sort((a, b) => b.c.chance - a.c.chance)
    .slice(0, 12);
  if (top.length) {
    console.log("\nMaiores chances de retorno agora (chance | publicada há | aderência):");
    for (const { v, c } of top) {
      const idade = c.horas < 48 ? `${Math.round(c.horas)}h` : `${Math.round(c.horas / 24)}d`;
      console.log(`  ${String(c.chance).padStart(3)}% | ${idade.padStart(4)} | ${String(c.aderencia).padStart(3)}  ${v.titulo.slice(0, 70)}  (${v.fonte})`);
    }
  }
  console.log("\nAbra o painel com:  npm run painel");
}
