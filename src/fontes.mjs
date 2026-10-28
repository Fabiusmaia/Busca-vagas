// Coletores de vagas. Só usa páginas e APIs públicas, sem login, em baixa frequência
// (APIs/JSON, RSS, sitemaps e HTML/JSON-LD de portais). Cada coletor devolve vagas no formato normalizado:
// { id, fonte, titulo, empresa, url, descricao, tags[], local, remoto, data, idioma? }

import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./db.mjs";

const UA = "busca-vagas-pessoal/1.0 (uso pessoal, baixa frequencia)";

async function getJSON(url, headers = {}) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}

async function getTexto(url, headers = {}) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", ...headers },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

/** Lê o JSON-LD JobPosting de uma página de vaga (padrão do Google for Jobs). */
function jobPosting(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].includes("JobPosting")) continue;
    try {
      // Alguns sites põem quebras de linha cruas dentro das strings, o que o JSON.parse rejeita.
      const j = JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, " "));
      const p = [j, ...(j["@graph"] ?? [])].find((x) => x?.["@type"] === "JobPosting");
      if (p) return p;
    } catch {}
  }
  return null;
}

/**
 * Cache de detalhes por fonte (dados/cache-<nome>.json). Fontes cuja listagem não traz a data
 * precisam abrir cada vaga; com o cache, só as vagas novas custam uma requisição.
 */
function cacheDetalhes(nome) {
  const arquivo = path.join(RAIZ, "dados", `cache-${nome}.json`);
  let dados = {};
  try {
    dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {}
  const agora = Date.now();
  return {
    async obter(chave, carregar) {
      if (dados[chave]) {
        dados[chave].visto = agora;
        return dados[chave].v;
      }
      const v = await carregar();
      dados[chave] = { v, visto: agora };
      return v;
    },
    salvar() {
      for (const [k, e] of Object.entries(dados)) if (agora - e.visto > 30 * 86400000) delete dados[k];
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      fs.writeFileSync(arquivo, JSON.stringify(dados));
    },
  };
}

/** Roda fn em cada item, no máximo n por vez (para não martelar o site). Itens com erro ficam null. */
async function emLotes(itens, n, fn) {
  const out = new Array(itens.length).fill(null);
  let i = 0;
  let falha = null;
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (i < itens.length) {
        const k = i++;
        try {
          out[k] = await fn(itens[k]);
        } catch (e) {
          falha ??= e.message;
        }
      }
    }),
  );
  out.falha = falha;
  return out;
}

const ENTIDADES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };

export function textoLimpo(html) {
  if (!html) return "";
  let s = String(html);
  // Greenhouse manda o HTML já escapado (&lt;p&gt;), então decodifica antes de remover as tags.
  for (let i = 0; i < 2; i++) s = s.replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/g, (m) => ENTIDADES[m] ?? m);
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- GitHub
// Repositórios da comunidade brasileira onde cada issue é uma vaga.
// Sem token, o GitHub permite 60 requisições/hora. Guardamos o ETag de cada página: quando nada
// mudou, ele responde 304 e essa resposta NÃO conta no limite.
const CACHE_GH = path.join(RAIZ, "dados", "cache-github.json");

function lerCacheGH() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_GH, "utf8"));
  } catch {
    return {};
  }
}

async function getGitHub(url, cache) {
  const headers = { "User-Agent": UA, Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (cache[url]?.etag) headers["If-None-Match"] = cache[url].etag;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  if (r.status === 304) return cache[url].dados;
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers.get("x-ratelimit-reset"));
    const quando = reset ? new Date(reset * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "em até 1h";
    const erro = new Error(`limite do GitHub atingido; libera às ${quando} (ou defina GITHUB_TOKEN para 5.000/h)`);
    erro.limite = true;
    throw erro;
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  const dados = await r.json();
  const etag = r.headers.get("etag");
  if (etag) cache[url] = { etag, dados };
  return dados;
}

async function github(cfg) {
  const cache = lerCacheGH();
  const out = [];
  const falhas = [];
  for (const repo of cfg.repos) {
   try {
    for (let page = 1; page <= (cfg.paginas ?? 1); page++) {
      const issues = await getGitHub(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`, cache);
      for (const i of issues) {
        if (i.pull_request) continue;
        const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name));
        const texto = `${i.title} ${labels.join(" ")}`.toLowerCase();
        out.push({
          id: `gh:${repo}#${i.number}`,
          fonte: `GitHub ${repo}`,
          titulo: i.title,
          empresa: empresaDoTitulo(i.title),
          url: i.html_url,
          descricao: (i.body ?? "").slice(0, 12000),
          tags: labels,
          local: "",
          remoto: /remot|remote|home ?office|anywhere/.test(texto),
          data: i.created_at,
          idioma: "pt",
        });
      }
      if (issues.length < 100) break;
    }
   } catch (e) {
    falhas.push(`${repo}: ${e.message}`);
    if (e.limite) break; // sem cota, os próximos repositórios também falhariam
   }
  }
  fs.mkdirSync(path.dirname(CACHE_GH), { recursive: true });
  fs.writeFileSync(CACHE_GH, JSON.stringify(cache));
  if (!out.length && falhas.length) throw new Error(falhas[0]);
  if (falhas.length) out.aviso = falhas[0];
  return out;
}

function empresaDoTitulo(t) {
  // Padrões comuns: "[Remoto] Dev Fullstack na Empresa X", "Dev Backend - Empresa X", "Dev @ Empresa"
  const m = t.match(/(?:\s(?:na|no|at|@)\s|\s[-–|]\s)([^[\]()\-–|@]+)$/i);
  return m ? m[1].trim() : "";
}

// ---------------------------------------------------------------- Remotive
// Termos: no máximo ~4 chamadas por dia e sempre linkar a vaga original no Remotive.
async function remotive() {
  const j = await getJSON("https://remotive.com/api/remote-jobs?category=software-dev");
  return j.jobs.map((v) => ({
    id: `remotive:${v.id}`,
    fonte: "Remotive",
    titulo: v.title,
    empresa: v.company_name,
    url: v.url,
    descricao: textoLimpo(v.description).slice(0, 12000),
    tags: v.tags ?? [],
    local: v.candidate_required_location ?? "",
    remoto: true,
    data: v.publication_date,
  }));
}

// ---------------------------------------------------------------- RemoteOK
// Termos: citar o RemoteOK como fonte e linkar a vaga original.
async function remoteok() {
  const j = await getJSON("https://remoteok.com/api");
  return j
    .filter((v) => v && v.id && v.position)
    .map((v) => ({
      id: `remoteok:${v.id}`,
      fonte: "RemoteOK",
      titulo: v.position,
      empresa: v.company ?? "",
      url: v.url,
      descricao: textoLimpo(v.description).slice(0, 12000),
      tags: v.tags ?? [],
      local: v.location ?? "",
      remoto: true,
      data: v.date,
    }));
}

// ---------------------------------------------------------------- Arbeitnow
async function arbeitnow() {
  const out = [];
  for (let page = 1; page <= 2; page++) {
    const j = await getJSON(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    for (const v of j.data) {
      if (!v.remote) continue;
      out.push({
        id: `arbeitnow:${v.slug}`,
        fonte: "Arbeitnow",
        titulo: v.title,
        empresa: v.company_name,
        url: v.url,
        descricao: textoLimpo(v.description).slice(0, 12000),
        tags: v.tags ?? [],
        local: v.location ?? "",
        remoto: true,
        data: new Date(v.created_at * 1000).toISOString(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Greenhouse / Lever
// Páginas de carreira públicas de empresas específicas (lista em config.json).
async function greenhouse(cfg) {
  const out = [];
  for (const emp of cfg.empresas) {
    const j = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${emp}/jobs?content=true`);
    for (const v of j.jobs) {
      const local = v.location?.name ?? "";
      out.push({
        id: `greenhouse:${emp}:${v.id}`,
        fonte: `Greenhouse (${emp})`,
        titulo: v.title,
        empresa: v.company_name ?? emp,
        url: v.absolute_url,
        descricao: textoLimpo(v.content).slice(0, 12000),
        tags: [],
        local,
        remoto: /remot|anywhere|home/i.test(`${local} ${v.title}`),
        data: v.first_published ?? v.updated_at,
      });
    }
  }
  return out;
}

async function lever(cfg) {
  const out = [];
  for (const emp of cfg.empresas) {
    const j = await getJSON(`https://api.lever.co/v0/postings/${emp}?mode=json`);
    for (const v of j) {
      const local = v.categories?.location ?? "";
      out.push({
        id: `lever:${emp}:${v.id}`,
        fonte: `Lever (${emp})`,
        titulo: v.text,
        empresa: emp,
        url: v.hostedUrl,
        descricao: (v.descriptionPlain ?? textoLimpo(v.description)).slice(0, 12000),
        tags: [v.categories?.team, v.categories?.commitment].filter(Boolean),
        local,
        remoto: v.workplaceType === "remote" || /remot|anywhere/i.test(local),
        data: new Date(v.createdAt).toISOString(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Remotar (vagas remotas no Brasil)
// API usada pelo próprio site (não documentada). Atualiza em minutos: é a fonte mais fresca para BR.
async function remotar(cfg) {
  const out = [];
  const vistos = new Set();
  // Busca por termos de dev (o feed geral mistura todas as áreas); cada busca vem da mais recente.
  for (const termo of cfg.buscas ?? ["desenvolvedor"]) {
   for (let page = 1; page <= (cfg.paginas ?? 2); page++) {
    const j = await getJSON(`https://api.remotar.com.br/jobs?page=${page}&search=${encodeURIComponent(termo)}`);
    for (const v of j.data) {
      if (v.expired || v.active === false || vistos.has(v.id)) continue;
      vistos.add(v.id);
      out.push({
        id: `remotar:${v.id}`,
        fonte: "Remotar",
        titulo: v.title,
        empresa: v.companyDisplayName || v.company?.name || "",
        url: `https://remotar.com.br/job/${v.id}`,
        url_candidatura: v.externalLink || null,
        descricao: textoLimpo(`${v.subtitle ?? ""} ${v.description ?? ""}`).slice(0, 12000),
        tags: (v.jobTags ?? v.tags ?? []).map((t) => t.name ?? t).filter((t) => typeof t === "string"),
        local: [v.city, v.state].filter(Boolean).join("/"),
        remoto: v.type === "remote",
        data: v.createdAt,
        idioma: "pt",
      });
    }
    if (page >= j.meta.last_page) break;
   }
  }
  return out;
}

// ---------------------------------------------------------------- Himalayas
async function himalayas(cfg) {
  const out = [];
  for (let offset = 0; offset < (cfg.limite ?? 100); offset += 20) {
    const j = await getJSON(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`);
    for (const v of j.jobs) {
      const restr = v.locationRestrictions ?? [];
      out.push({
        id: `himalayas:${v.guid}`,
        fonte: "Himalayas",
        titulo: v.title,
        empresa: v.companyName,
        url: v.applicationLink || v.guid,
        descricao: textoLimpo(v.description).slice(0, 12000),
        tags: [...(v.categories ?? []), ...(v.seniority ?? [])],
        local: restr.join(", "),
        remoto: true,
        data: new Date(v.pubDate * 1000).toISOString(),
      });
    }
    if (j.jobs.length < 20) break;
  }
  return out;
}

// ---------------------------------------------------------------- Jobicy
async function jobicy() {
  const j = await getJSON("https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev");
  return (j.jobs ?? []).map((v) => ({
    id: `jobicy:${v.id}`,
    fonte: "Jobicy",
    titulo: v.jobTitle,
    empresa: v.companyName,
    url: v.url,
    descricao: textoLimpo(v.jobDescription).slice(0, 12000),
    tags: [...(v.jobIndustry ?? []), v.jobLevel].filter(Boolean),
    local: v.jobGeo === "Anywhere" ? "" : v.jobGeo ?? "",
    remoto: true,
    data: v.pubDate,
  }));
}

// ---------------------------------------------------------------- Working Nomads
async function workingnomads() {
  const j = await getJSON("https://www.workingnomads.com/api/exposed_jobs/");
  return j
    .filter((v) => v.category_name === "Development")
    .map((v) => ({
      id: `workingnomads:${v.url}`,
      fonte: "Working Nomads",
      titulo: v.title,
      empresa: v.company_name,
      url: v.url,
      descricao: textoLimpo(v.description).slice(0, 12000),
      tags: String(v.tags ?? "").split(",").filter(Boolean),
      local: v.location ?? "",
      remoto: true,
      data: v.pub_date,
    }));
}

// ---------------------------------------------------------------- We Work Remotely (RSS)
function campoRss(item, tag) {
  const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
}

async function weworkremotely(cfg) {
  const out = [];
  for (const cat of cfg.categorias) {
    const r = await fetch(`https://weworkremotely.com/categories/${cat}.rss`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} em WWR ${cat}`);
    const xml = await r.text();
    for (const item of xml.split("<item>").slice(1)) {
      const tituloCompleto = textoLimpo(campoRss(item, "title"));
      const i = tituloCompleto.indexOf(": ");
      const link = campoRss(item, "link") || campoRss(item, "guid");
      out.push({
        id: `wwr:${link}`,
        fonte: "We Work Remotely",
        titulo: i > 0 ? tituloCompleto.slice(i + 2) : tituloCompleto,
        empresa: i > 0 ? tituloCompleto.slice(0, i) : "",
        url: link,
        descricao: textoLimpo(campoRss(item, "description")).slice(0, 12000),
        tags: textoLimpo(campoRss(item, "skills")).split(",").map((s) => s.trim()).filter(Boolean),
        local: textoLimpo(campoRss(item, "region")).replace(/anywhere in the world/i, ""),
        remoto: true,
        data: new Date(campoRss(item, "pubDate")).toISOString(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Programathor (HTML)
// A listagem não traz a data: ela vem do JSON-LD da página da vaga (só abre as remotas, com cache).
async function programathor(cfg) {
  const cache = cacheDetalhes("programathor");
  const cards = [];
  for (let page = 1; page <= (cfg.paginas ?? 2); page++) {
    const html = await getTexto(`https://programathor.com.br/jobs/page/${page}`);
    for (const bloco of html.split(/<div class="cell-list[ "]/).slice(1)) {
      const link = bloco.match(/href="(\/jobs\/(\d+)[^"]*)"/);
      const titulo = bloco.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (!link || !titulo) continue;
      const infos = [...bloco.matchAll(/<i class='[^']*'><\/i>([^<]+)<\/span>/g)].map((m) => textoLimpo(m[1]));
      cards.push({
        id: link[2],
        url: `https://programathor.com.br${link[1]}`,
        titulo: textoLimpo(titulo[1].replace(/<span class="new-label">[\s\S]*?<\/span>/, "")),
        empresa: infos[0] ?? "",
        local: infos[1] ?? "",
        tags: [...infos.slice(2), ...[...bloco.matchAll(/class='tag-list[^']*'>([^<]+)</g)].map((m) => textoLimpo(m[1]))],
      });
    }
  }
  const remotas = cards.filter((c) => /remoto/i.test(c.local));
  const detalhes = await emLotes(remotas, 3, (c) =>
    cache.obter(c.id, async () => {
      const p = jobPosting(await getTexto(c.url));
      return p && { data: p.datePosted, descricao: textoLimpo(p.description).slice(0, 12000) };
    }),
  );
  cache.salvar();
  const out = [];
  remotas.forEach((c, i) => {
    const d = detalhes[i];
    if (!d?.data) return;
    out.push({
      id: `programathor:${c.id}`,
      fonte: "Programathor",
      titulo: c.titulo,
      empresa: c.empresa,
      url: c.url,
      descricao: d.descricao,
      tags: c.tags,
      local: "",
      remoto: true,
      data: new Date(`${d.data}T12:00:00-03:00`).toISOString(),
      idioma: "pt",
    });
  });
  if (detalhes.falha) out.aviso = detalhes.falha;
  return out;
}

// ---------------------------------------------------------------- Nerdin (HTML)
// A listagem traz a data exata (<time datetime>); a descrição completa vem do JSON-LD da vaga (com cache).
async function nerdin(cfg) {
  const cache = cacheDetalhes("nerdin");
  const out = [];
  for (const lista of cfg.listas ?? ["vagas-home-office.php"]) {
    for (let page = 1; page <= (cfg.paginas ?? 2); page++) {
      const html = await getTexto(`https://www.nerdin.com.br/${lista}?pagina=${page}`);
      for (const bloco of html.split('<div class="vaga-card"').slice(1)) {
        const href = bloco.match(/data-href="([^"]+)"/)?.[1];
        const data = bloco.match(/<time datetime="([^"]+)"/)?.[1];
        if (!href || !data) continue;
        const campo = (re) => textoLimpo(bloco.match(re)?.[1] ?? "");
        const resumo = campo(/class="vaga-resumo-linha">([\s\S]*?)<\/p>/);
        const local = campo(/class="vaga-local-linha">([\s\S]*?)<\/div>/);
        out.push({
          id: `nerdin:${href.match(/-(\d+)\.php/)?.[1] ?? href}`,
          fonte: "Nerdin",
          titulo: campo(/class="vaga-titulo">([\s\S]*?)(?:<span|<\/h3>)/),
          empresa: campo(/class="vaga-empresa-nome">([\s\S]*?)<\/span>/),
          url: `https://www.nerdin.com.br/${href}`,
          descricao: resumo,
          tags: [...bloco.matchAll(/class="hashtag">\s*#([^<]+)</g)].map((m) => m[1].trim()),
          local: "",
          remoto: /home office|remot/i.test(`${resumo} ${local}`),
          data: new Date(data).toISOString(),
          idioma: "pt",
        });
      }
    }
  }
  const remotas = out.filter((v) => v.remoto);
  const detalhes = await emLotes(remotas, 3, (v) =>
    cache.obter(v.id, async () => textoLimpo(jobPosting(await getTexto(v.url))?.description).slice(0, 12000)),
  );
  cache.salvar();
  remotas.forEach((v, i) => {
    if (detalhes[i]) v.descricao = `${v.descricao} ${detalhes[i]}`;
  });
  if (detalhes.falha) out.aviso = detalhes.falha;
  return out;
}

// ---------------------------------------------------------------- Sólides (portal vagas.solides.com.br)
// Página Next.js: os dados das vagas vêm embutidos no HTML (payload "initialData" do React).
function initialDataNext(html) {
  let rsc = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) rsc += JSON.parse(m[1]);
  const ini = rsc.indexOf('{"initialData":');
  if (ini < 0) return null;
  // Recorta o objeto JSON balanceado a partir de "{"initialData":".
  let prof = 0, str = false, esc = false;
  for (let k = ini; k < rsc.length; k++) {
    const c = rsc[k];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") prof++;
    else if (c === "}" && !--prof) {
      const dados = JSON.parse(rsc.slice(ini, k + 1)).initialData;
      // Textos longos vêm como referência ("$4c") para um bloco "4c:T<tamanho em bytes hex>,<texto>",
      // às vezes colado no fim do texto anterior (sem quebra de linha).
      const texto = (ref) => {
        const m = typeof ref === "string" && ref.match(/^\$([0-9a-f]+)$/);
        if (!m) return ref;
        const cab = rsc.match(new RegExp(`(?<![0-9a-f])${m[1]}:T([0-9a-f]+),`));
        if (!cab) return "";
        const inicio = cab.index + cab[0].length;
        return Buffer.from(rsc.slice(inicio, inicio + parseInt(cab[1], 16))).subarray(0, parseInt(cab[1], 16)).toString();
      };
      for (const v of dados?.data ?? []) v.description = texto(v.description);
      return dados;
    }
  }
  return null;
}

async function solides(cfg) {
  const out = [];
  for (let page = 1; page <= (cfg.paginas ?? 3); page++) {
    const j = initialDataNext(await getTexto(`https://vagas.solides.com.br/vagas/area/tecnologia/remoto?page=${page}`));
    if (!j) throw new Error("formato da página da Sólides mudou (sem initialData)");
    for (const v of j.data) {
      out.push({
        id: `solides:${v.id}`,
        fonte: "Sólides",
        titulo: v.title.trim(),
        empresa: v.companyName ?? "",
        url: `https://${v.slug}.vagas.solides.com.br/vaga/${v.id}`,
        descricao: textoLimpo(v.description).slice(0, 12000),
        tags: [...(v.hardSkills ?? []), ...(v.seniority ?? []), ...(v.recruitmentContractType ?? [])].map((t) => t.name ?? t).filter((t) => typeof t === "string"),
        local: "",
        remoto: v.jobType === "remoto" || v.homeOffice === true,
        data: new Date(`${v.createdAt}T12:00:00-03:00`).toISOString(),
        idioma: "pt",
      });
    }
    if (page >= j.totalPages) break;
  }
  return out;
}

// ---------------------------------------------------------------- Coodesh (sitemap + JSON-LD)
// A API de listagem pede sessão; usamos o sitemap público de vagas (indicado no robots.txt)
// e abrimos só as atualizadas recentemente, com cache.
async function coodesh(cfg) {
  const cache = cacheDetalhes("coodesh");
  const xml = await getTexto("https://coodesh.com/sitemaps/jobs.xml");
  const limite = Date.now() - (cfg.dias ?? 7) * 86400000;
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .filter((m) => new Date(m[2]).getTime() >= limite)
    .map((m) => m[1]);
  const detalhes = await emLotes(urls, 3, (url) =>
    cache.obter(url, async () => {
      const html = await getTexto(url);
      const p = jobPosting(html);
      if (!p) return null;
      const end = p.jobLocation?.address ?? {};
      const descricao = textoLimpo(p.description);
      return {
        titulo: p.title,
        empresa: p.hiringOrganization?.name ?? "",
        data: p.datePosted,
        descricao: descricao.slice(0, 12000),
        local: [end.addressLocality, end.addressCountry].filter(Boolean).join(", "),
        remoto:
          !/h[ií]brid|hybrid|presencial|on-?site/i.test(p.title) &&
          (p.jobLocationType === "TELECOMMUTE" || /\bremot[oe]|home office/i.test(`${p.title} ${descricao.slice(0, 3000)}`)),
      };
    }),
  );
  cache.salvar();
  const out = [];
  urls.forEach((url, i) => {
    const d = detalhes[i];
    if (!d?.data) return;
    out.push({
      id: `coodesh:${url.match(/-(\d+)$/)?.[1] ?? url}`,
      fonte: "Coodesh",
      titulo: d.titulo,
      empresa: d.empresa,
      url,
      descricao: d.descricao,
      tags: [],
      local: d.remoto ? "" : d.local,
      remoto: d.remoto,
      data: new Date(`${d.data.slice(0, 10)}T12:00:00-03:00`).toISOString(),
    });
  });
  if (detalhes.falha) out.aviso = detalhes.falha;
  return out;
}

// ---------------------------------------------------------------- Recrutei (portal empregos.recrutei.com.br)
// A busca só mostra a idade relativa ("Publicada há 3 horas"). Para as remotas, a data exata e a
// descrição vêm do JSON-LD da vaga (com cache); a idade relativa fica de reserva.
function dataRelativa(texto) {
  const t = texto.toLowerCase();
  if (/hoje|agora/.test(t)) return new Date();
  if (/ontem/.test(t)) return new Date(Date.now() - 86400000);
  const m = t.match(/(\d+|um|uma)\s+(minuto|hora|dia|semana|m[eê]s|meses|ano)/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const unidade = { minuto: 60e3, hora: 3600e3, dia: 86400e3, semana: 7 * 86400e3, ano: 365 * 86400e3 }[m[2]] ?? 30 * 86400e3;
  return new Date(Date.now() - n * unidade);
}

async function recrutei(cfg) {
  const cache = cacheDetalhes("recrutei");
  const out = [];
  const vistos = new Set();
  for (const termo of cfg.buscas ?? ["desenvolvedor"]) {
    for (let page = 1; page <= (cfg.paginas ?? 1); page++) {
      const html = await getTexto(`https://empregos.recrutei.com.br/busca?keyword=${encodeURIComponent(termo)}&page=${page}`);
      const blocos = html.split('<article class="d2-card d2-jobrow">').slice(1);
      for (const bloco of blocos) {
        const a = bloco.match(/class="d2-jobrow__title">\s*<a href="([^"?]+)[^"]*"\s*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        const id = a[1].match(/\/(\d+)-[^/]*$/)?.[1] ?? a[1];
        if (vistos.has(id)) continue;
        vistos.add(id);
        const meta = textoLimpo(bloco.match(/class="d2-jobrow__meta">([\s\S]*?)<\/p>/)?.[1] ?? "");
        const badges = [...bloco.matchAll(/class="d2-badge[^"]*">([^<]+)</g)].map((m) => textoLimpo(m[1])).filter(Boolean);
        const data = dataRelativa(bloco.match(/Publicada ([^<]+)/)?.[1] ?? "");
        if (!data) continue;
        const [empresa, ...local] = meta.split(" · ");
        const remoto = badges.some((b) => /remot|home office/i.test(b));
        out.push({
          id: `recrutei:${id}`,
          fonte: "Recrutei",
          titulo: textoLimpo(a[2]),
          empresa: empresa ?? "",
          url: a[1],
          descricao: [meta, ...badges].join(" · "),
          tags: badges,
          local: remoto ? "" : local.join(" "),
          remoto,
          data: data.toISOString(),
          idioma: "pt",
        });
      }
      if (blocos.length < 15) break;
    }
  }
  // Só abre as remotas publicadas há até ~2 semanas (as outras o filtro descartaria de qualquer jeito).
  const abrir = out.filter((v) => v.remoto && Date.now() - new Date(v.data) < 15 * 86400000);
  const detalhes = await emLotes(abrir, 3, (v) =>
    cache.obter(v.id, async () => {
      const p = jobPosting(await getTexto(v.url));
      return p && { data: p.datePosted, descricao: textoLimpo(p.description).slice(0, 12000) };
    }),
  );
  cache.salvar();
  abrir.forEach((v, i) => {
    const d = detalhes[i];
    if (!d) return;
    if (d.data && !isNaN(new Date(d.data))) v.data = new Date(d.data).toISOString();
    if (d.descricao) v.descricao = `${v.descricao} ${d.descricao}`;
  });
  if (detalhes.falha) out.aviso = detalhes.falha;
  return out;
}

// ---------------------------------------------------------------- InHire (páginas de carreira por empresa)
// API pública da página de carreira ({empresa}.inhire.app/vagas). A lista não traz data: o detalhe
// de cada vaga remota é aberto uma vez e fica em cache.
async function inhire(cfg) {
  const cache = cacheDetalhes("inhire");
  const out = [];
  const falhas = [];
  for (const emp of cfg.empresas) {
    const headers = { "X-Tenant": emp, "X-Inhire-Client": "web-inhire" };
    try {
      const j = await getJSON("https://api.inhire.app/job-posts/public/pages", headers);
      const remotas = (j.jobsPage ?? []).filter((v) => v.status === "published" && /remote/i.test(v.workplaceType ?? ""));
      const detalhes = await emLotes(remotas, 3, (v) =>
        cache.obter(`${emp}:${v.jobId}`, async () => {
          const d = await getJSON(`https://api.inhire.app/job-posts/public/pages/${v.jobId}`, headers);
          return { data: d.publishedAt ?? d.createdAt, descricao: textoLimpo(d.description).slice(0, 12000), tags: d.contractType ?? [] };
        }),
      );
      if (detalhes.falha) falhas.push(`${emp}: ${detalhes.falha}`);
      remotas.forEach((v, i) => {
        const d = detalhes[i];
        if (!d?.data) return;
        out.push({
          id: `inhire:${emp}:${v.jobId}`,
          fonte: `InHire (${emp})`,
          titulo: v.displayName.trim(),
          empresa: j.tenantName ?? emp,
          url: `https://${emp}.inhire.app/vagas/${v.jobId}`,
          descricao: d.descricao,
          tags: d.tags,
          local: v.location === "BR" ? "" : v.location ?? "",
          remoto: true,
          data: d.data,
          idioma: "pt",
        });
      });
    } catch (e) {
      falhas.push(`${emp}: ${e.message}`);
    }
  }
  cache.salvar();
  if (!out.length && falhas.length) throw new Error(falhas[0]);
  if (falhas.length) out.aviso = falhas[0];
  return out;
}

const COLETORES = { github, remotar, remotive, remoteok, arbeitnow, himalayas, jobicy, workingnomads, weworkremotely, greenhouse, lever, programathor, nerdin, solides, coodesh, recrutei, inhire };

/** Roda todas as fontes ativas. Uma fonte com erro não derruba as outras. */
export async function coletarTudo(fontesCfg, log = console.log, ultimas = {}) {
  const vagas = [];
  const erros = [];
  await Promise.all(
    Object.entries(COLETORES).map(async ([nome, fn]) => {
      const cfg = fontesCfg[nome];
      if (!cfg?.ativo) return;
      // Fontes que pedem baixa frequência (ex.: Remotive, máx. 4x/dia) respeitam um intervalo mínimo.
      const horasDesde = ultimas[nome] ? (Date.now() - new Date(ultimas[nome]).getTime()) / 3600000 : Infinity;
      if (cfg.min_horas && horasDesde < cfg.min_horas) {
        log(`  ${nome.padEnd(14)}    — consultada há ${horasDesde.toFixed(1)}h (mínimo ${cfg.min_horas}h), pulando`);
        return;
      }
      ultimas[nome] = new Date().toISOString();
      try {
        const r = await fn(cfg);
        log(`  ${nome.padEnd(14)} ${String(r.length).padStart(4)} vagas${r.aviso ? `  (aviso: ${r.aviso})` : ""}`);
        vagas.push(...r);
      } catch (e) {
        log(`  ${nome.padEnd(14)} ERRO: ${e.message}`);
        erros.push({ fonte: nome, erro: e.message });
      }
    }),
  );
  return { vagas, erros };
}
