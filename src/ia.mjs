// Análise opcional com Claude: nota de aderência currículo x vaga, pontos fortes,
// lacunas e um rascunho de carta curta no idioma da vaga.
// Só roda se houver credencial (ANTHROPIC_API_KEY ou `ant auth login`).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Você é um recrutador técnico experiente ajudando um desenvolvedor a decidir a quais vagas se candidatar.
Você recebe o currículo dele (PDF) e o texto de uma vaga.

Regras:
- Seja honesto: a nota deve refletir a aderência real (requisitos obrigatórios pesam mais que desejáveis).
- Nunca invente experiência, tecnologia ou resultado que não esteja no currículo — nem na carta.
- A carta deve estar no idioma da vaga, em primeira pessoa, com 80 a 150 palavras, citando 2 ou 3 pontos concretos do currículo ligados aos requisitos. Sem clichês ("sou apaixonado por", "venho por meio desta"), sem saudação genérica longa.
- Lacunas: requisitos da vaga que o currículo não demonstra, de forma objetiva.`;

const SCHEMA = {
  type: "object",
  properties: {
    nota: { type: "integer", description: "Aderência de 0 a 10" },
    resumo: { type: "string", description: "1 ou 2 frases explicando a nota" },
    pontos_fortes: { type: "array", items: { type: "string" } },
    lacunas: { type: "array", items: { type: "string" } },
    senioridade_vaga: { type: "string", description: "júnior, pleno, sênior, lead ou indefinida" },
    carta: { type: "string" },
  },
  required: ["nota", "resumo", "pontos_fortes", "lacunas", "senioridade_vaga", "carta"],
  additionalProperties: false,
};

let client = null;

/** Há credencial da Anthropic? (variável de ambiente ou perfil criado por `ant auth login`) */
export function credencialConfigurada() {
  const e = process.env;
  return Boolean(e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN || e.ANTHROPIC_PROFILE || fs.existsSync(path.join(os.homedir(), ".config", "anthropic")));
}

export function iaDisponivel() {
  if (!credencialConfigurada()) return false;
  try {
    client ??= new Anthropic();
    return true;
  } catch {
    return false;
  }
}

/** Sempre manda um PDF para a IA (o .docx de Java cai no PDF de backend do mesmo idioma). */
function pdfDoCurriculo(config, arquivo, idioma) {
  const nome = arquivo.toLowerCase().endsWith(".pdf") ? arquivo : config.curriculos.backend[idioma];
  return path.join(config.pasta_curriculos, nome);
}

export async function analisarVaga(vaga, avaliacao, config) {
  const pdf = fs.readFileSync(pdfDoCurriculo(config, avaliacao.curriculo, avaliacao.idioma)).toString("base64");
  const response = await client.beta.messages.create({
    model: config.ia.modelo,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: config.ia.esforco,
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          // O currículo vem primeiro e com cache: as próximas vagas reaproveitam esse trecho.
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf }, cache_control: { type: "ephemeral" } },
          {
            type: "text",
            text: `Idioma da vaga: ${avaliacao.idioma === "pt" ? "português" : "inglês"}\nEmpresa: ${vaga.empresa || "não informada"}\nTítulo: ${vaga.titulo}\nLocal: ${vaga.local || "remoto"}\n\nDescrição:\n${vaga.descricao}`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return { erro: `recusado (${response.stop_details?.category ?? "sem categoria"})` };
  }
  if (response.stop_reason === "max_tokens") {
    return { erro: "resposta cortada (max_tokens)" };
  }
  const texto = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { ...JSON.parse(texto), modelo: response.model, analisado_em: new Date().toISOString() };
}

export function descreverErro(e) {
  if (e instanceof Anthropic.AuthenticationError) return "credencial inválida: confira ANTHROPIC_API_KEY ou rode `ant auth login`";
  if (e instanceof Anthropic.RateLimitError) return "limite de requisições atingido, tente mais tarde";
  if (e instanceof Anthropic.BadRequestError) return `requisição inválida: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `erro da API ${e.status}: ${e.message}`;
  return `${e.message} (IA desligada? defina ANTHROPIC_API_KEY ou rode \`ant auth login\`; ou busque com --sem-ia)`;
}
