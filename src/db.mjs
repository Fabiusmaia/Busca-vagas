// Armazenamento simples em JSON (dados/vagas.json). Guarda status e análises entre execuções.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO = path.join(RAIZ, "dados", "vagas.json");

// Fluxo: nova → interessante → aplicada → (retornou | entrevista | proposta | recusada | sem_retorno)
export const STATUS = ["nova", "interessante", "aplicada", "retornou", "entrevista", "proposta", "recusada", "sem_retorno", "descartada"];
/** Status que significam "a empresa respondeu" (recusa também é retorno). */
export const RESPOSTAS = ["retornou", "entrevista", "proposta", "recusada"];
/** Status que só existem depois de aplicar. */
export const POS_APLICACAO = ["aplicada", ...RESPOSTAS, "sem_retorno"];

export function carregar() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return { vagas: {}, ultima_busca: null, erros: [] };
  }
}

export function salvar(db) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, ARQUIVO);
}

export function carregarConfig() {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, "config.json"), "utf8"));
}

export { RAIZ };
