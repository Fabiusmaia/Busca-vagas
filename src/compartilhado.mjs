// Código usado em três lugares: no painel (navegador), no servidor (Node) e DENTRO da página
// da vaga (favorito e janela do Edge controlada). Por isso não importa nada.

/** Sem acento, minúsculo, "_" e "-" viram espaço. Igual à normalização dentro do kit. */
export const normChave = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** Transforma "Meus dados" em regras de reconhecimento de campos. A primeira regra que casar vence. */
export function regrasDoPerfil(grupos, valores) {
  const campos = grupos.flatMap((g) => g.campos).filter((c) => (valores[c.id] ?? "").trim());
  const regra = (c) => ({ valor: valores[c.id], auto: c.auto ?? [], chaves: (c.chaves ?? []).map(normChave), tec: c.tecnologia ? normChave(c.tecnologia) : null });
  // Tecnologias mais longas antes ("react native" antes de "react"); primeiro nome/sobrenome antes de nome completo.
  const tec = campos.filter((c) => c.tecnologia).sort((a, b) => b.tecnologia.length - a.tecnologia.length);
  const prioridade = campos.filter((c) => ["primeiro_nome", "sobrenome", "email"].includes(c.id));
  const resto = campos.filter((c) => !c.tecnologia && !prioridade.includes(c));
  return [...tec, ...prioridade, ...resto].map(regra);
}

/** Prompt para colar em qualquer chat gratuito (ChatGPT, Claude.ai, Gemini). */
export function montarPrompt(v, p, pergunta) {
  const ingles = v.idioma === "en";
  const anos = Object.entries(p)
    .filter(([k, val]) => k.startsWith("anos_") && k !== "anos_experiencia" && val)
    .map(([k, val]) => `${k.replace("anos_", "")}: ${val} anos`)
    .join(", ");
  const tarefa = pergunta ? `Responda a pergunta do formulário de candidatura: "${pergunta}"` : "Escreva uma carta de apresentação curta para esta vaga.";
  return `Você está me ajudando a me candidatar a uma vaga. ${tarefa}

Regras:
- Responda em ${ingles ? "inglês" : "português"}, em primeira pessoa, com 80 a 150 palavras, pronto para colar no formulário.
- Use SOMENTE fatos do meu perfil abaixo. Não invente experiências, números, tecnologias ou conquistas.
- Conecte 2 ou 3 pontos concretos do meu perfil com o que a vaga pede; mencione algo específico da empresa/produto que apareça na descrição.
- Sem clichês ("sou apaixonado por", "venho por meio desta") e sem saudação longa.
- Se a vaga pedir algo que eu não tenho, não esconda nem finja: foque no que eu tenho de relevante.

MEU PERFIL
Cargo: ${p.cargo_atual || ""} · ${p.nivel || ""} · ${p.anos_experiencia || "?"} anos de experiência
Tecnologias (anos): ${anos}
Formação: ${p.formacao || ""}, ${p.instituicao || ""}
Inglês: ${p.ingles || ""}
Resumo: ${(ingles ? p.sobre_en : p.sobre_pt) || p.sobre_pt || ""}
Projeto/desafio de destaque: ${p.maior_desafio || ""}

A VAGA
Empresa: ${v.empresa || "não informada"}
Título: ${v.titulo}
Descrição:
${v.descricao}`;
}

/** Textos com botão "Copiar" no kit flutuante, já no idioma da vaga. */
export function textosDoKit(v, p) {
  const en = v.idioma === "en";
  const pretensao = en
    ? [p.pretensao_usd_ano && `USD ${p.pretensao_usd_ano}/year`, p.pretensao_usd_hora && `USD ${p.pretensao_usd_hora}/hour`].filter(Boolean).join(" or ")
    : [p.pretensao_clt && `CLT: R$ ${p.pretensao_clt}/mês`, p.pretensao_pj && `PJ: R$ ${p.pretensao_pj}/mês`].filter(Boolean).join(" · ");
  return [
    ["Prompt p/ ChatGPT (por que esta empresa)", montarPrompt(v, p, en ? "Why do you want to work at this company?" : "Por que você quer trabalhar nesta empresa?")],
    ["Prompt p/ ChatGPT (carta)", montarPrompt(v, p, null)],
    ["Carta (IA)", v.ia?.carta],
    [en ? "Cover letter base" : "Carta base", en ? p.carta_base_en : p.carta_base_pt],
    ["Por que esta empresa (modelo)", p.por_que_empresa],
    [en ? "About me" : "Sobre mim", en ? p.sobre_en : p.sobre_pt],
    [en ? "Biggest challenge" : "Maior desafio", p.maior_desafio],
    [en ? "Salary expectation" : "Pretensão salarial", pretensao],
  ].filter(([, t]) => t);
}

/**
 * Roda DENTRO da página do formulário. Preenche os campos vazios que reconhece (contorno verde),
 * marca obrigatórios vazios (laranja) e mostra um painel flutuante com botões de copiar.
 * Nunca envia o formulário. Não pode usar nada de fora desta função.
 * DADOS = { regras, textos: [[rótulo, texto]], vagaId?, titulo?, atraso? }
 */
export function kitCandidatura(DADOS) {
  const ID = "busca-vagas-kit";
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const casa = (texto, chave) => {
    if (chave.startsWith("^") || chave.endsWith("$")) return new RegExp(chave).test(texto);
    const k = chave.replace(/[.*+?()[\]{}|\\/]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(texto);
  };
  const definir = (el, valor) => {
    const win = el.ownerDocument.defaultView;
    if (el.tagName === "SELECT") {
      const alvo = norm(valor);
      const ops = [...el.options].filter((o) => norm(o.text));
      const op = ops.find((o) => norm(o.text) === alvo) || ops.find((o) => norm(o.text).includes(alvo) || (alvo.includes(norm(o.text)) && norm(o.text).length > 2));
      if (!op) return false;
      el.value = op.value;
      el.dispatchEvent(new win.Event("change", { bubbles: true }));
      return true;
    }
    if (el.type === "number" && !/^\d+([.,]\d+)?$/.test(valor.trim())) return false;
    const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    // Setter nativo + eventos: necessário para formulários React/Vue registrarem o valor.
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, valor);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    el.dispatchEvent(new win.FocusEvent("blur", { bubbles: true }));
    return true;
  };

  function preencher() {
    const docs = [document];
    for (const f of document.querySelectorAll("iframe")) {
      try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) { /* iframe de outro domínio */ }
    }
    const res = { n: 0, faltando: 0, iframes: document.querySelectorAll("iframe").length - (docs.length - 1), campos: 0 };
    for (const doc of docs) {
      for (const el of doc.querySelectorAll("input, textarea, select")) {
        if (el.closest(`#${ID}`)) continue;
        const tipo = (el.type || "").toLowerCase();
        if (["hidden", "file", "checkbox", "radio", "password", "submit", "button", "image", "reset", "search"].includes(tipo)) continue;
        if (el.disabled || el.readOnly || !el.getClientRects().length) continue;
        res.campos++;
        const vazio = el.tagName === "SELECT" ? el.selectedIndex <= 0 : !el.value;
        if (vazio) {
          const pedacos = [];
          for (const l of el.labels || []) pedacos.push(l.innerText);
          const lb = el.getAttribute("aria-labelledby");
          if (lb) for (const id of lb.split(/\s+/)) pedacos.push(doc.getElementById(id)?.innerText);
          pedacos.push(el.getAttribute("aria-label"), el.placeholder, el.name, el.id);
          if (!el.labels?.length && !lb) {
            const t = el.closest("div, fieldset, li, p")?.innerText || "";
            if (t && t.length < 140) pedacos.push(t);
          }
          const ps = pedacos.map(norm).filter(Boolean);
          const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
          const regra = DADOS.regras.find((r) =>
            (auto && r.auto.includes(auto)) ||
            (r.tec ? ps.some((p) => casa(p, r.tec) && /(anos|years|experiencia|experience)/.test(p)) : r.chaves.some((k) => ps.some((p) => casa(p, k)))));
          if (regra && definir(el, regra.valor)) {
            el.style.outline = "2px solid #0ca30c";
            el.style.outlineOffset = "1px";
            res.n++;
            continue;
          }
        }
        const obrigatorio = el.required || el.getAttribute("aria-required") === "true";
        const aindaVazio = el.tagName === "SELECT" ? el.selectedIndex <= 0 : !el.value;
        if (obrigatorio && aindaVazio) {
          el.style.outline = "2px solid #ec835a";
          el.style.outlineOffset = "1px";
          res.faltando++;
        }
      }
    }
    return res;
  }

  async function copiar(texto, botao) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const antes = botao.textContent;
    botao.textContent = "Copiado ✓";
    setTimeout(() => (botao.textContent = antes), 1500);
  }

  function painel(res) {
    document.getElementById(ID)?.remove();
    const box = document.createElement("div");
    box.id = ID;
    Object.assign(box.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647, width: "320px", maxHeight: "70vh", overflow: "auto",
      background: "#1a1a19", color: "#fff", padding: "12px 14px", borderRadius: "12px", font: "13px/1.4 system-ui, sans-serif",
      boxShadow: "0 8px 28px rgba(0,0,0,.35)",
    });
    const botao = (rotulo, acao, destaque) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = rotulo;
      Object.assign(b.style, {
        display: "block", width: "100%", textAlign: "left", margin: "6px 0 0", padding: "6px 10px", borderRadius: "8px", cursor: "pointer",
        border: "1px solid #33332f", background: destaque ? "#3987e5" : "#232321", color: "#fff", font: "inherit",
      });
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); acao(b); };
      box.appendChild(b);
      return b;
    };
    const topo = document.createElement("div");
    topo.style.cssText = "display:flex;justify-content:space-between;gap:8px;font-weight:600";
    topo.textContent = "Busca de Vagas";
    const fechar = document.createElement("span");
    fechar.textContent = "×";
    fechar.style.cssText = "cursor:pointer;font-size:18px;line-height:1";
    fechar.onclick = () => box.remove();
    topo.appendChild(fechar);
    box.appendChild(topo);
    if (DADOS.titulo) {
      const t = document.createElement("div");
      t.style.cssText = "color:#c3c2b7;margin-top:2px";
      t.textContent = DADOS.titulo;
      box.appendChild(t);
    }
    const st = document.createElement("div");
    st.style.cssText = "margin-top:8px";
    st.textContent = res.campos === 0
      ? "Nenhum formulário nesta página ainda. Abra o formulário de candidatura e clique em “Preencher campos”."
      : `${res.n} campo(s) preenchido(s) (verde)${res.faltando ? `, ${res.faltando} obrigatório(s) vazio(s) (laranja)` : ""}. Confira tudo e envie você mesmo.`;
    if (res.iframes > 0) st.textContent += " Parte do formulário está em outro domínio: abra-o numa aba própria.";
    box.appendChild(st);
    botao("Preencher campos", () => painel(preencher()), true);
    for (const [rotulo, texto] of DADOS.textos || []) botao(`Copiar: ${rotulo}`, (b) => copiar(texto, b));
    if (DADOS.vagaId && typeof window.buscaVagasMarcar === "function") {
      botao("✔ Já enviei: marcar como aplicada", async (b) => {
        await window.buscaVagasMarcar(DADOS.vagaId);
        b.textContent = "Marcada como aplicada no painel ✓";
        b.disabled = true;
      });
    }
    document.body.appendChild(box);
  }

  // Formulários de SPA (Gupy, Greenhouse…) costumam aparecer depois do carregamento: tenta algumas vezes.
  let tentativas = 0;
  const rodar = () => {
    const res = preencher();
    painel(res);
    if (res.campos === 0 && ++tentativas < 6) setTimeout(rodar, 2000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(rodar, 1200));
  else setTimeout(rodar, DADOS.atraso ?? 0);
}
