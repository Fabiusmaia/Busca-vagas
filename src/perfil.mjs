// "Meus dados": respostas para os campos mais comuns de formulários de candidatura.
// Fica em dados/perfil.json (só no seu computador). Você edita pela aba "Meus dados" do painel.
import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./db.mjs";

const ARQUIVO = path.join(RAIZ, "dados", "perfil.json");

/**
 * Definição dos campos. `chaves` são os padrões (já sem acento, minúsculos) usados pelo
 * botão "Preencher formulário" para reconhecer o campo na página da vaga.
 * `auto` = valores do atributo HTML autocomplete que identificam o campo com certeza.
 */
export const GRUPOS = [
  {
    titulo: "Contato",
    campos: [
      { id: "nome_completo", rotulo: "Nome completo", auto: ["name"], chaves: ["full name", "fullname", "nome completo", "seu nome", "your name", "^nome$", "^name$", "nome$"] },
      { id: "primeiro_nome", rotulo: "Primeiro nome", auto: ["given-name"], chaves: ["first name", "firstname", "first_name", "primeiro nome", "given name"] },
      { id: "sobrenome", rotulo: "Sobrenome", auto: ["family-name"], chaves: ["last name", "lastname", "last_name", "sobrenome", "surname", "family name"] },
      { id: "email", rotulo: "E-mail", auto: ["email"], chaves: ["e-mail", "email"] },
      { id: "telefone", rotulo: "Telefone (com DDD)", auto: ["tel", "tel-national"], chaves: ["telefone", "celular", "whatsapp", "phone", "mobile"] },
      { id: "telefone_int", rotulo: "Telefone internacional (+55…)", chaves: [] },
      // Sensível: não vai para o favorito (favoritos sincronizam com a nuvem), só para o botão "Aplicar".
      { id: "cpf", rotulo: "CPF", sensivel: true, chaves: ["cpf", "numero do cpf", "cpf do candidato"] },
      { id: "cidade", rotulo: "Cidade", auto: ["address-level2"], chaves: ["cidade", "city", "municipio"] },
      { id: "estado", rotulo: "Estado (UF)", auto: ["address-level1"], chaves: ["estado", "^uf$", "state", "province"] },
      { id: "pais", rotulo: "País", auto: ["country", "country-name"], chaves: ["pais", "country"] },
      { id: "fuso", rotulo: "Fuso horário", chaves: ["timezone", "time zone", "fuso"] },
    ],
  },
  {
    titulo: "Links",
    campos: [
      { id: "linkedin", rotulo: "LinkedIn", chaves: ["linkedin"] },
      { id: "github", rotulo: "GitHub", chaves: ["github"] },
      { id: "portfolio", rotulo: "Portfólio / site", auto: ["url"], chaves: ["portfolio", "portfolio url", "website", "personal site", "site pessoal", "^site$"] },
    ],
  },
  {
    titulo: "Situação profissional",
    campos: [
      { id: "cargo_atual", rotulo: "Cargo atual/último", chaves: ["current title", "current role", "job title", "cargo atual", "ultimo cargo"] },
      { id: "empresa_atual", rotulo: "Empresa atual/última", chaves: ["current company", "current employer", "empresa atual", "ultima empresa"] },
      { id: "anos_experiencia", rotulo: "Anos de experiência (total)", chaves: ["years of experience", "anos de experiencia", "tempo de experiencia", "experiencia (anos)"] },
      { id: "nivel", rotulo: "Senioridade", tipo: "opcoes", opcoes: ["Júnior", "Pleno", "Sênior"], chaves: ["senioridade", "seniority", "nivel profissional"] },
      { id: "disponibilidade", rotulo: "Disponibilidade para início", chaves: ["disponibilidade", "start date", "when can you start", "quando pode comecar", "availability", "data de inicio"] },
      { id: "aviso_previo", rotulo: "Aviso prévio / notice period", chaves: ["notice period", "aviso previo"] },
      { id: "modelo_contratacao", rotulo: "Modelo de contratação aceito", tipo: "opcoes", opcoes: ["CLT", "PJ", "CLT ou PJ", "Contractor (USD)"], chaves: ["modelo de contratacao", "tipo de contratacao", "regime", "employment type"] },
      { id: "possui_cnpj", rotulo: "Possui CNPJ?", tipo: "opcoes", opcoes: ["Sim", "Não", "Posso abrir"], chaves: ["cnpj"] },
      { id: "autorizado_br", rotulo: "Autorizado a trabalhar no Brasil?", tipo: "opcoes", opcoes: ["Sim", "Não"], chaves: ["autorizado a trabalhar", "authorized to work", "work authorization", "legally authorized"] },
      { id: "precisa_visto", rotulo: "Precisa de patrocínio de visto?", tipo: "opcoes", opcoes: ["Não", "Sim"], chaves: ["sponsorship", "visa", "visto"] },
    ],
  },
  {
    titulo: "Pretensão salarial",
    campos: [
      { id: "pretensao_clt", rotulo: "Pretensão CLT (R$/mês)", chaves: ["pretensao", "salario", "remuneracao", "expectativa salarial"] },
      { id: "pretensao_pj", rotulo: "Pretensão PJ (R$/mês)", chaves: [] },
      { id: "pretensao_usd_ano", rotulo: "Expected salary (USD/ano)", chaves: ["salary expectation", "expected salary", "desired salary", "compensation", "salary"] },
      { id: "pretensao_usd_hora", rotulo: "Hourly rate (USD/h)", chaves: ["hourly rate", "rate per hour"] },
    ],
  },
  {
    titulo: "Formação e idiomas",
    campos: [
      { id: "formacao", rotulo: "Formação", chaves: ["formacao", "education", "degree", "escolaridade", "graduacao"] },
      { id: "instituicao", rotulo: "Instituição", chaves: ["instituicao", "university", "universidade", "school", "faculdade"] },
      { id: "ano_conclusao", rotulo: "Ano de conclusão", chaves: ["ano de conclusao", "graduation year", "conclusao"] },
      { id: "ingles", rotulo: "Nível de inglês", tipo: "opcoes", opcoes: ["Básico", "Intermediário", "Avançado", "Fluente"], chaves: ["ingles", "english", "nivel de ingles", "english level", "english proficiency"] },
      { id: "espanhol", rotulo: "Nível de espanhol", tipo: "opcoes", opcoes: ["Nenhum", "Básico", "Intermediário", "Avançado", "Fluente"], chaves: ["espanhol", "spanish"] },
    ],
  },
  {
    titulo: "Anos por tecnologia",
    campos: ["React", "Next.js", "TypeScript", "JavaScript", "Node.js", "NestJS", "PHP", "Laravel", "React Native", "PostgreSQL", "MySQL", "Docker", "AWS", "Java"].map((t) => ({
      id: `anos_${t.toLowerCase().replace(/[^a-z]/g, "")}`,
      rotulo: `${t} (anos)`,
      tecnologia: t.toLowerCase(),
      chaves: [],
    })),
  },
  {
    titulo: "Respostas prontas",
    campos: [
      { id: "sobre_pt", rotulo: "Sobre mim (PT)", tipo: "texto", chaves: ["fale sobre voce", "sobre voce", "apresente-se", "apresentacao", "resumo profissional", "conte-nos"] },
      { id: "sobre_en", rotulo: "About me (EN)", tipo: "texto", chaves: ["tell us about yourself", "about you", "summary", "introduce yourself"] },
      { id: "carta_base_pt", rotulo: "Carta de apresentação base (PT)", tipo: "texto", chaves: ["carta de apresentacao", "carta"] },
      { id: "carta_base_en", rotulo: "Cover letter base (EN)", tipo: "texto", chaves: ["cover letter", "motivation letter"] },
      { id: "por_que_empresa", rotulo: "Por que quer trabalhar aqui? (modelo)", tipo: "texto", chaves: ["por que voce quer", "por que quer trabalhar", "por que esta vaga", "why do you want", "why are you interested", "why us", "why this company"] },
      { id: "maior_desafio", rotulo: "Maior desafio técnico que resolveu", tipo: "texto", chaves: ["maior desafio", "desafio tecnico", "challenging project", "biggest challenge", "proudest"] },
      { id: "motivo_saida", rotulo: "Motivo da saída do último emprego", tipo: "texto", chaves: ["motivo da saida", "por que saiu", "reason for leaving", "why did you leave"] },
      { id: "como_soube", rotulo: "Como soube da vaga?", chaves: ["como soube", "como conheceu", "how did you hear", "where did you find"] },
    ],
  },
  {
    titulo: "Diversidade (opcional — deixe em branco se preferir não informar)",
    campos: [
      { id: "genero", rotulo: "Gênero", chaves: ["genero", "gender"] },
      { id: "raca", rotulo: "Raça/etnia", chaves: ["raca", "etnia", "race", "ethnicity"] },
      { id: "pcd", rotulo: "Pessoa com deficiência?", chaves: ["pcd", "deficiencia", "disability"] },
    ],
  },
];

/** Valores iniciais na primeira execução; o resto você preenche em "Meus dados" (salvo em dados/, fora do git). */
const INICIAL = {
  pais: "Brasil",
};

export function carregarPerfil() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return { ...INICIAL };
  }
}

export function salvarPerfil(dados) {
  const validos = new Set(GRUPOS.flatMap((g) => g.campos.map((c) => c.id)));
  const limpo = {};
  for (const [k, v] of Object.entries(dados)) if (validos.has(k) && typeof v === "string") limpo[k] = v.slice(0, 5000);
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(limpo, null, 1));
  return limpo;
}
