// Pontuação heurística (sem IA): decide se a vaga serve, qual currículo usar e por quê.

export function normalizar(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function escapar(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Procura o termo como palavra inteira ("react" não casa com "reactive"). */
export function contem(texto, termo) {
  return new RegExp(`(^|[^a-z0-9])${escapar(normalizar(termo))}([^a-z0-9]|$)`).test(texto);
}

const ALGUM = (texto, termos) => termos.some((t) => contem(texto, t));

const T_FULLSTACK = ["fullstack", "full stack", "full-stack"];
const T_MOBILE = ["mobile", "react native", "android", "ios", "flutter", "kotlin", "swift"];
const T_JAVA = ["java", "spring", "spring boot", "quarkus"];
const T_FRONT = ["front-end", "frontend", "front end", "ui engineer", "react developer", "desenvolvedor react", "dev react", "web developer"];
const T_BACK = ["back-end", "backend", "back end", "api", "php", "laravel", "node", "node.js", "nodejs", "nestjs", "python", "golang", "go developer", "ruby", "rails", ".net", "c#"];
const T_DEV = ["desenvolvedor", "desenvolvedora", "developer", "engineer", "engenheiro", "engenheira", "programador", "programadora", "software", "dev"];

const T_ESTAGIO = ["estagio", "estagiario", "estagiaria", "intern", "internship", "trainee", "aprendiz", "werkstudent", "working student"];
const T_JUNIOR = ["junior", "jr", "jr."];
const T_SENIOR = ["senior", "sr", "sr.", "lead", "tech lead", "staff", "principal", "especialista", "architect", "arquiteto", "head"];
const T_PLENO = ["pleno", "mid-level", "mid level", "midlevel", "ii"];

/** Papel principal da vaga pelo título (cai na descrição se o título for genérico). */
export function detectarPapel(titulo, descricao) {
  const t = normalizar(titulo);
  if (ALGUM(t, T_FULLSTACK)) return "fullstack";
  if (ALGUM(t, T_MOBILE)) return "mobile";
  if (ALGUM(t, T_JAVA) && !contem(t, "javascript")) return "java";
  if (ALGUM(t, T_FRONT)) return "frontend";
  if (ALGUM(t, T_BACK)) return "backend";
  if (ALGUM(t, T_DEV)) {
    const d = normalizar(descricao);
    if (ALGUM(d, T_FULLSTACK)) return "fullstack";
    if (contem(d, "react native")) return "mobile";
    return "fullstack";
  }
  return null;
}

export function detectarIdioma(texto) {
  const t = ` ${normalizar(texto).slice(0, 4000)} `;
  const pt = (t.match(/ (de|para|com|voce|vaga|experiencia|conhecimento|desenvolvimento|nao|uma) /g) ?? []).length;
  const en = (t.match(/ (the|and|with|you|we|experience|our|will|team|are) /g) ?? []).length;
  return pt >= en ? "pt" : "en";
}

function localAceito(local, aceitas) {
  const l = normalizar(local).trim();
  if (!l) return true;
  return aceitas.some((a) => l.includes(normalizar(a)));
}

/**
 * Avalia uma vaga. Retorna { descartada, motivo_descartada?, nota, papel, idioma, curriculo, motivos[], stack[] }.
 * A nota (0-100) é só uma triagem para ordenar; a análise por IA (opcional) é mais precisa.
 */
export function avaliar(vaga, config) {
  const f = config.filtros;
  const titulo = normalizar(vaga.titulo);
  const corpo = normalizar(`${vaga.titulo} ${vaga.descricao} ${(vaga.tags ?? []).join(" ")}`);
  const idioma = vaga.idioma ?? detectarIdioma(`${vaga.titulo} ${vaga.descricao}`);
  const descartar = (motivo) => ({ descartada: true, motivo_descartada: motivo, nota: 0, papel: null, idioma, curriculo: null, motivos: [], stack: [] });

  if (f.dias_max && vaga.data && Date.now() - new Date(vaga.data).getTime() > f.dias_max * 86400000) {
    return descartar(`publicada há mais de ${f.dias_max} dias`);
  }
  const excl = f.excluir_titulo.find((t) => contem(titulo, t.trim()));
  if (excl) return descartar(`título fora da área ("${excl.trim()}")`);
  if (/somente (eua|usa|us|canada|europa|portugal)|apenas (eua|usa|europa)|(us|usa|u\.s\.|uk|eu|emea|europe|canada) only|only (us|usa|canada|europe|eu|uk)|\b(eua|usa|us)\s*\/\s*canada/.test(titulo)) {
    return descartar("título restringe o país");
  }
  const papel = detectarPapel(vaga.titulo, vaga.descricao);
  if (!papel) return descartar("não parece vaga de desenvolvimento");
  if (!vaga.remoto) return descartar("não é remota");
  if (!localAceito(vaga.local, f.localizacoes_aceitas)) return descartar(`restrita a: ${vaga.local}`);
  if (/(must|need to) (be|reside|live)[^.]{0,40}(in the us|united states|in europe|in the eu|in the uk|in canada)|us citizens? only|u\.s\. only/.test(corpo)) {
    return descartar("exige residência fora do Brasil");
  }
  if (f.excluir_estagio !== false && ALGUM(titulo, T_ESTAGIO)) return descartar("estágio/trainee");
  if (!f.aceitar_junior && ALGUM(titulo, T_JUNIOR)) return descartar("júnior");

  const motivos = [];
  let nota = 30;
  motivos.push(`papel: ${papel}`);

  if (ALGUM(titulo, T_JUNIOR)) {
    nota += f.bonus_junior ?? 0;
    motivos.push(f.bonus_junior ? `júnior (${f.bonus_junior > 0 ? "+" : ""}${f.bonus_junior})` : "júnior");
  } else if (ALGUM(titulo, T_SENIOR)) {
    nota -= f.penalidade_senior;
    motivos.push(`sênior/lead (−${f.penalidade_senior})`);
  } else if (ALGUM(titulo, T_PLENO)) {
    nota += 10;
    motivos.push("pleno (+10)");
  }

  const stack = [];
  let pontosStack = 0;
  for (const [termo, peso] of Object.entries(config.stack)) {
    if (contem(corpo, termo)) {
      stack.push(termo);
      pontosStack += peso;
      if (contem(titulo, termo)) pontosStack += Math.ceil(peso / 2);
    }
  }
  pontosStack = Math.min(pontosStack, 55);
  if (pontosStack === 0) return descartar("nenhuma tecnologia em comum com o currículo");
  nota += pontosStack;
  if (stack.length) motivos.push(`stack em comum (+${pontosStack})`);

  if (papel === "mobile" && !contem(corpo, "react native")) {
    nota -= 20;
    motivos.push("mobile nativo/Flutter, sem React Native (−20)");
  }
  if (papel === "java") {
    nota -= 10;
    motivos.push("Java: sem experiência prática no CV (−10)");
  }
  const outras = ["python", "django", "golang", "ruby", "rails", ".net", "c#", "elixir", "scala", "angular", "vue"].filter((t) => contem(titulo, t));
  if (outras.length && !stack.some((s) => contem(titulo, s))) {
    nota -= 15;
    motivos.push(`stack principal diferente: ${outras.join(", ")} (−15)`);
  }

  // Anúncios em massa ("Trabalhe de Casa … / Ref. 0289P"): dezenas de vagas iguais publicadas de uma vez.
  if (/(trabalhe de casa|work from home|home office)\b.*\/\s*ref\.?\s*\w+/.test(titulo)) {
    nota -= 20;
    motivos.push("⚠ anúncio em massa (Ref.): confira a empresa antes de enviar dados (−20)");
  }

  nota = Math.max(0, Math.min(100, Math.round(nota)));
  const cv = config.curriculos[papel]?.[idioma] ?? config.curriculos.fullstack[idioma];
  return { descartada: nota < f.nota_minima, motivo_descartada: nota < f.nota_minima ? `nota ${nota} abaixo do mínimo` : undefined, nota, papel, idioma, curriculo: cv, motivos, stack };
}

/** Horas desde a publicação (vaga sem data conta como "desde que a vimos pela primeira vez"). */
export function horasDesde(vaga, agora = Date.now()) {
  const t = new Date(vaga.data ?? vaga.primeira_vez ?? agora).getTime();
  return Math.max(0, (agora - t) / 3600000);
}

/**
 * Chance estimada de retorno (0-100). Combina:
 *  - frescor (maior peso): candidatar nas primeiras horas coloca você no topo da pilha do recrutador;
 *    decai pela metade a cada `meia_vida_horas`;
 *  - aderência: nota da IA (se houver) ou da heurística de stack/senioridade;
 *  - concorrência: vagas de comunidades BR recebem bem menos candidatos do que vagas remotas globais.
 * Depende do horário atual, então é recalculada sempre que o painel é aberto.
 */
export function calcularChance(vaga, config, agora = Date.now()) {
  const c = config.chance;
  const horas = horasDesde(vaga, agora);
  const frescor = 100 * Math.pow(0.5, horas / c.meia_vida_horas);
  const aderencia = vaga.ia?.nota != null ? vaga.ia.nota * 10 : vaga.nota;
  const local = normalizar(vaga.local);
  let concorrencia = 45; // remota global: muita gente aplicando
  const fonte = vaga.fonte ?? "";
  if (fonte.startsWith("GitHub")) concorrencia = 85; // comunidade BR: poucos candidatos
  else if (fonte === "LinkedIn (post)") concorrencia = 75; // post de recrutador: alcance menor que vaga anunciada
  else if (/^(LinkedIn \(vaga\)|Indeed|Glassdoor|Gupy)/.test(fonte)) concorrencia = 50; // grandes portais: muito volume
  else if (vaga.idioma === "pt") concorrencia = 80;
  else if (/latam|latin america|brazil|brasil|south america/.test(local)) concorrencia = 70;
  const chance = c.peso_frescor * frescor + c.peso_aderencia * aderencia + c.peso_concorrencia * concorrencia;
  return {
    chance: Math.round(Math.max(0, Math.min(100, chance))),
    horas: Math.round(horas * 10) / 10,
    frescor: Math.round(frescor),
    aderencia: Math.round(aderencia),
    concorrencia,
  };
}
