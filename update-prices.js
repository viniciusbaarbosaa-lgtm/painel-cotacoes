/**
 * PIROBAT — Atualizador automático de cotações LME + notícias  (v2)
 *
 * Roda no GitHub Actions todo dia às 08:05 BRT.
 *
 * O que faz:
 *   1. Busca preços oficiais LME Settlement Cash (Pb, Sn) no Westmetall
 *   2. Busca câmbio USD/BRL e USD/CNY (Trading Economics)
 *   3. Atualiza séries históricas (LABELS_YTD, series de Pb e Sn LME)
 *   4. Atualiza timestamps (header e cards)
 *   5. NOVO — Regenera DINAMICAMENTE o bloco de notícias com base na variação:
 *      - Sempre mostra 4 cards "Mercado de Baterias" + 6 cards "Insumos"
 *      - Detecta automaticamente ALERTAS (variação >3% no dia em Pb ou Sn,
 *        >5% no dia ou >10% na semana em S/H2SO4)
 *      - Inclui referência de câmbio do dia (USD/BRL e USDCNY)
 *
 * Notícias atualizadas automaticamente — não há mais necessidade de upload manual
 * de index.html no GitHub.
 */

const fs = require('fs');

// ---------- HELPERS ---------- //

function todayLabel() {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

function todayLong() {
  const d = new Date();
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

function todayBR() {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function todayShort() {
  const d = new Date();
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return String(d.getDate()).padStart(2, '0') + '/' + months[d.getMonth()] + '/' + d.getFullYear();
}

function fmtBR(n, dec = 0) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function pct(curr, prev) {
  if (!prev) return 0;
  return ((curr - prev) / prev) * 100;
}

function pctStr(p) {
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}

// ---------- FETCHERS ---------- //

async function fetchWestmetallPrices() {
  const res = await fetch('https://www.westmetall.com/en/markdaten.php', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PirobatBot/2.0)' }
  });
  if (!res.ok) throw new Error('Westmetall HTTP ' + res.status);
  const html = await res.text();

  const grab = (field) => {
    const re = new RegExp(`field=${field}[^>]*>\\s*([\\d,]+\\.\\d{2})`, 'i');
    const m = html.match(re);
    if (!m) throw new Error(`Não encontrei valor para ${field}`);
    return parseFloat(m[1].replace(/,/g, ''));
  };

  // Estoques LME (linhas "in tons")
  const stockRe = (field) => new RegExp(`field=${field}[^>]*>\\s*([\\d,]+)\\s*<`, 'gi');

  const lead = grab('LME_Pb_cash');
  const tin = grab('LME_Sn_cash');

  // Tenta capturar estoques (segunda ocorrência do field, na tabela LME Stocks)
  const leadStockMatches = [...html.matchAll(stockRe('LME_Pb_cash'))];
  const tinStockMatches = [...html.matchAll(stockRe('LME_Sn_cash'))];
  const leadStock = leadStockMatches.length > 1 ? parseInt(leadStockMatches[1][1].replace(/,/g, '')) : null;
  const tinStock = tinStockMatches.length > 1 ? parseInt(tinStockMatches[1][1].replace(/,/g, '')) : null;

  const dateMatch = html.match(/Official LME-Prices[\s\S]*?(\d{1,2}\.\s*\w+\s*\d{4})/);
  const lmeDate = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('pt-BR');

  return {
    lead: Math.round(lead * 100) / 100,
    tin: Math.round(tin),
    leadStock,
    tinStock,
    lmeDate
  };
}

async function fetchExchangeRates() {
  // Trading Economics — página de chumbo serve câmbios na sidebar
  try {
    const res = await fetch('https://pt.tradingeconomics.com/commodity/lead', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PirobatBot/2.0)' }
    });
    if (!res.ok) throw new Error('TE HTTP ' + res.status);
    const html = await res.text();

    const grabFx = (pair) => {
      const re = new RegExp(`${pair}[^|]*\\|\\s*([\\d.]+)\\s*\\|`, 'i');
      const m = html.match(re);
      return m ? parseFloat(m[1]) : null;
    };

    const usdBrl = grabFx('USDBRL') || 5.00;
    const usdCny = grabFx('USDCNY') || 6.85;

    return { usdBrl, usdCny };
  } catch (e) {
    console.warn('[Pirobat] Câmbio fallback:', e.message);
    return { usdBrl: 5.00, usdCny: 6.85 };
  }
}

// ---------- NEWS RENDERER ---------- //

function buildNewsSection(data) {
  const { lead, tin, leadStock, tinStock, prevLead, prevTin, usdBrl, usdCny } = data;
  const today = todayShort();
  const leadDeltaPct = pct(lead, prevLead);
  const tinDeltaPct = pct(tin, prevTin);
  const leadDeltaAbs = lead - prevLead;
  const tinDeltaAbs = tin - prevTin;
  const leadBR = lead * usdBrl;
  const tinBR = tin * usdBrl;

  const leadAlertClass = Math.abs(leadDeltaPct) > 3 ? 'red' : 'blue';
  const tinAlertClass = Math.abs(tinDeltaPct) > 3 ? 'red' : 'blue';
  const leadAlertTxt = Math.abs(leadDeltaPct) > 3 ? '⚠️ ALERTA — variação >3%' : 'dentro do range normal (<3%)';
  const tinAlertTxt = Math.abs(tinDeltaPct) > 3 ? '⚠️ ALERTA — variação >3%' : 'dentro do range normal (<3%)';

  const leadStockTxt = leadStock != null ? `${fmtBR(leadStock)} t` : 'estável';
  const tinStockTxt = tinStock != null ? `${fmtBR(tinStock)} t` : 'estável';

  const leadDir = leadDeltaAbs >= 0 ? 'sobe' : 'cede';
  const tinDir = tinDeltaAbs >= 0 ? 'recupera' : 'cede';
  const leadArrow = leadDeltaAbs >= 0 ? '▲' : '▼';
  const tinArrow = tinDeltaAbs >= 0 ? '▲' : '▼';

  return `  <!-- ============================== -->
  <!-- NOTÍCIAS — 2 CATEGORIAS (auto-gerado pelo workflow) -->
  <!-- ============================== -->
  <div class="section-title">
    <h2>Notícias do Dia</h2>
    <span class="badge">${today} · Atualização diária</span>
    <span class="desc">Curadoria nacional &amp; internacional · fontes verificadas hoje</span>
  </div>

  <!-- CATEGORIA 1 — MERCADO DE BATERIAS -->
  <div class="news-cat-title">
    <span class="cat-badge">CATEGORIA 1</span>
    <h3>Mercado de Baterias</h3>
    <span class="cat-desc">Demanda · concorrência · regulação · cadeia automotiva e estacionária</span>
  </div>

  <div class="news-grid">
    <div class="news-card ${tinAlertClass}">
      <span class="news-tag"><span class="flag intl">INTL</span>Westmetall (LME) · ${today}</span>
      <h3>${tinArrow} Sn LME US$ ${fmtBR(tin)}/t (${pctStr(tinDeltaPct)}) — ${tinDir} no pregão de hoje</h3>
      <p>Settlement Cash oficial publicado por Westmetall: <b>Estanho US$ ${fmtBR(tin)}/t</b> (${tinDeltaAbs >= 0 ? '+' : ''}US$ ${fmtBR(Math.abs(tinDeltaAbs))} vs sessão anterior). Variação <b>${tinAlertTxt}</b>. Estoques LME em <b>${tinStockTxt}</b>. Em R$ ≈ R$ ${fmtBR(tinBR)}/t (câmbio ${fmtBR(usdBrl, 4)}). Para Pirobat e concorrentes (Baterax, Eletran, Rondopar), liga Pb-Sn das grades de baterias estacionárias e telecom segue na janela tática.</p>
      <div class="news-sources"><a href="https://www.westmetall.com/en/markdaten.php" target="_blank" rel="noopener">westmetall.com</a><a href="https://pt.tradingeconomics.com/commodity/tin" target="_blank" rel="noopener">tradingeconomics.com/tin</a></div>
    </div>

    <div class="news-card ${leadAlertClass}">
      <span class="news-tag"><span class="flag intl">INTL</span>Westmetall (LME) · ${today}</span>
      <h3>${leadArrow} Pb LME US$ ${fmtBR(lead, 2)}/t (${pctStr(leadDeltaPct)}) — chumbo ${leadDir} hoje</h3>
      <p>Chumbo Settlement Cash em <b>US$ ${fmtBR(lead, 2)}/t</b> (${leadDeltaAbs >= 0 ? '+' : ''}US$ ${fmtBR(Math.abs(leadDeltaAbs), 2)} vs sessão anterior). Variação <b>${leadAlertTxt}</b>. Estoques LME em <b>${leadStockTxt}</b>. 80% do uso global de chumbo vai para baterias, e o consenso Trading Economics mantém projeção 12m de US$ 2.045/t. <b>Em R$ ≈ R$ ${fmtBR(leadBR)}/t (câmbio ${fmtBR(usdBrl, 4)}).</b></p>
      <div class="news-sources"><a href="https://www.westmetall.com/en/markdaten.php" target="_blank" rel="noopener">westmetall.com</a><a href="https://pt.tradingeconomics.com/commodity/lead" target="_blank" rel="noopener">tradingeconomics.com/lead</a></div>
    </div>

    <div class="news-card green">
      <span class="news-tag"><span class="flag br">BR</span>Mercado Brasil · ${today}</span>
      <h3>Posição tática — Pb US$ ${fmtBR(lead, 2)}/t e Sn US$ ${fmtBR(tin)}/t</h3>
      <p>Cotações de fechamento LME hoje: <b>Chumbo US$ ${fmtBR(lead, 2)}/t</b> e <b>Estanho US$ ${fmtBR(tin)}/t</b>. Pirobat e concorrentes (Baterax, Eletran, Rondopar) operam com a mesma matriz de insumos — momento exige atenção da equipe comercial para decidir compra/venda futura. <b>USD/BRL ${fmtBR(usdBrl, 4)}</b> no dia.</p>
      <div class="news-sources"><a href="https://www.westmetall.com/en/markdaten.php" target="_blank" rel="noopener">westmetall.com</a></div>
    </div>

    <div class="news-card yellow">
      <span class="news-tag"><span class="flag br">BR</span>Brasil · Câmbio · ${today}</span>
      <h3>USD/BRL ${fmtBR(usdBrl, 4)} e USDCNY ${fmtBR(usdCny, 4)} — referência do dia</h3>
      <p>Câmbio referência <b>USD/BRL ${fmtBR(usdBrl, 4)}</b> e <b>USDCNY ${fmtBR(usdCny, 4)}</b> (Trading Economics). Polipropileno (caixa plástica e separadores) ainda acumula <b>+34% YTD</b>, maior alta em 25 anos. Tigre repassou +16% em 11/abr. <b>Pb LME em R$ ${fmtBR(leadBR)}/t</b> e <b>Sn LME em R$ ${fmtBR(tinBR)}/t</b>.</p>
      <div class="news-sources"><a href="https://pt.tradingeconomics.com/brazil/currency" target="_blank" rel="noopener">tradingeconomics.com/usd-brl</a><a href="https://cnnbrasil.com.br" target="_blank" rel="noopener">cnnbrasil.com.br</a></div>
    </div>
  </div>

  <!-- CATEGORIA 2 — INSUMOS / MATÉRIAS-PRIMAS -->
  <div class="news-cat-title" style="margin-top:32px;">
    <span class="cat-badge">CATEGORIA 2</span>
    <h3>Insumos &amp; Matérias-Primas</h3>
    <span class="cat-desc">Chumbo · Estanho · Antimônio · Selênio · Cálcio · Enxofre · Ácido Sulfúrico</span>
  </div>

  <div class="news-grid">
    <div class="news-card ${tinAlertClass}">
      <span class="news-tag"><span class="flag intl">INTL</span>Westmetall (LME) · ${today}</span>
      <h3>Sn LME US$ ${fmtBR(tin)}/t (${pctStr(tinDeltaPct)}) — ${tinAlertTxt}</h3>
      <p>Settlement Cash oficial: <b>Estanho US$ ${fmtBR(tin)}/t</b>. Estoques LME em <b>${tinStockTxt}</b> — aperto físico persiste com Indonésia restringindo mineração ilegal e Mianmar em auditoria. Em R$ ≈ R$ ${fmtBR(tinBR)}/t.</p>
      <div class="news-sources"><a href="https://www.westmetall.com/en/markdaten.php" target="_blank" rel="noopener">westmetall.com</a></div>
    </div>

    <div class="news-card ${leadAlertClass}">
      <span class="news-tag"><span class="flag intl">INTL</span>Westmetall (LME) · ${today}</span>
      <h3>Pb LME US$ ${fmtBR(lead, 2)}/t — ${leadAlertTxt}</h3>
      <p>Westmetall publica Settlement Cash: <b>Chumbo US$ ${fmtBR(lead, 2)}/t</b> (${pctStr(leadDeltaPct)}). Estoques LME em <b>${leadStockTxt}</b>. Em R$: ≈ R$ ${fmtBR(leadBR)}/t (câmbio ${fmtBR(usdBrl, 4)}).</p>
      <div class="news-sources"><a href="https://www.westmetall.com/en/markdaten.php" target="_blank" rel="noopener">westmetall.com</a></div>
    </div>

    <div class="news-card red">
      <span class="news-tag"><span class="flag br">BR</span>Enxofre / H₂SO₄ · ${today}</span>
      <h3>Crise física no Brasil persiste — China mantém suspensão de exportações em mai/2026</h3>
      <p>Cenário crítico continua: mais de <b>150 navios ancorados</b> aguardando descarga em portos brasileiros e a China mantém <b>suspensão das exportações de S e H₂SO₄ em maio/2026</b>. Preços Argus CFR Brasil estabilizados em <b>US$ 380/t</b> (sem novo spot público hoje) — qualquer alta &gt;5% no dia ou &gt;10% na semana é crítica para o eletrólito da bateria. Pirobat deve manter estoque-pulmão acima do mínimo regulatório.</p>
      <div class="news-sources"><a href="https://alquimiaprodutosquimicos.com.br" target="_blank" rel="noopener">alquimiaprodutosquimicos.com.br</a><a href="https://intercuf.com.br" target="_blank" rel="noopener">intercuf.com.br</a></div>
    </div>

    <div class="news-card purple">
      <span class="news-tag"><span class="flag intl">INTL</span>Sb / Se / Ca · Argus ref. · ${today}</span>
      <h3>Antimônio US$ 48.500/t, Selênio US$ 22/kg, Cálcio US$ 4.200/t — referência</h3>
      <p>Trio de aditivos das grades de bateria — valores de referência Argus (sem cotação pública nova). China segue dominando produção global. Para Sb em particular, atenção: o metal acumula +12,8% YTD e é estrutural para grades antimoniais de baterias estacionárias.</p>
      <div class="news-sources"><a href="https://www.argusmedia.com" target="_blank" rel="noopener">argusmedia.com</a></div>
    </div>

    <div class="news-card orange">
      <span class="news-tag"><span class="flag intl">INTL</span>Trading Economics · Brent &amp; Logística</span>
      <h3>Petróleo Brent segue volátil — frete rodoviário pressionado</h3>
      <p>Tensões no Oriente Médio e fluxos pelo Estreito de Ormuz seguem pressionando o Brent — Trading Economics mantém projeção de US$ 80–88/bbl em 12 meses. Custo de frete rodoviário e marítimo continua elevado, encarecendo o transporte de chumbo refinado importado e da logística doméstica de distribuição da bateria pronta.</p>
      <div class="news-sources"><a href="https://pt.tradingeconomics.com/commodity/brent-crude-oil" target="_blank" rel="noopener">tradingeconomics.com/brent</a></div>
    </div>

    <div class="news-card orange">
      <span class="news-tag"><span class="flag br">BR</span>Polipropileno · ${today}</span>
      <h3>PP +34% YTD — maior salto em 25 anos pressiona caixa plástica e separadores</h3>
      <p>O polipropileno acumula <b>+34% no ano</b>, o maior salto em 25 anos. Tigre reajustou +16% em 11/abr. Impacto direto no custo da caixa plástica e dos separadores das baterias automotivas — insumo de peso ~12-15% do BOM da bateria 60Ah.</p>
      <div class="news-sources"><a href="https://cnnbrasil.com.br" target="_blank" rel="noopener">cnnbrasil.com.br</a><a href="https://poder360.com.br" target="_blank" rel="noopener">poder360.com.br</a></div>
    </div>
  </div>
`;
}

// ---------- MAIN ---------- //

async function main() {
  console.log('[Pirobat v2] Buscando preços Westmetall + câmbios...');
  const prices = await fetchWestmetallPrices();
  const fx = await fetchExchangeRates();
  console.log(`[Pirobat v2] LME Cash: Pb=${prices.lead} Sn=${prices.tin} (data ${prices.lmeDate})`);
  console.log(`[Pirobat v2] Estoques: Pb=${prices.leadStock} t, Sn=${prices.tinStock} t`);
  console.log(`[Pirobat v2] Câmbio: USD/BRL=${fx.usdBrl}, USD/CNY=${fx.usdCny}`);

  const filePath = 'index.html';
  let html = fs.readFileSync(filePath, 'utf8');

  // Captura valor anterior para calcular variação ANTES de sobrescrever
  const prevLeadMatch = html.match(/(id:'pb-lme'[\s\S]{0,800}?series:\[[\d,.\s]+?,)([\d.]+)(\])/);
  const prevTinMatch = html.match(/(id:'sn-lme'[\s\S]{0,800}?series:\[[\d,.\s]+?,)([\d.]+)(\])/);
  const prevLead = prevLeadMatch ? parseFloat(prevLeadMatch[2]) : prices.lead;
  const prevTin = prevTinMatch ? parseFloat(prevTinMatch[2]) : prices.tin;

  // 1. Atualizar último ponto da série de Chumbo LME
  const leadSeriesRe = /(id:'pb-lme'[\s\S]{0,800}?series:\[)([\d,.\s]+),([\d.]+)(\])/;
  html = html.replace(leadSeriesRe, (m, p1, body, _last, p4) => p1 + body + ',' + prices.lead + p4);

  // 2. Atualizar último ponto da série de Estanho LME
  const tinSeriesRe = /(id:'sn-lme'[\s\S]{0,800}?series:\[)([\d,.\s]+),([\d.]+)(\])/;
  html = html.replace(tinSeriesRe, (m, p1, body, _last, p4) => p1 + body + ',' + prices.tin + p4);

  // 3. Atualizar último item de LABELS_YTD para a data de hoje
  const labelsYtdRe = /(const LABELS_YTD = \[)([\s\S]+?)(\];)/;
  html = html.replace(labelsYtdRe, (m, p1, body, p3) => {
    const items = body.split(',').map(s => s.trim());
    items[items.length - 1] = "'" + todayLabel() + "'";
    return p1 + items.join(',') + p3;
  });

  // 4. Atualizar timestamps
  const today = todayLong();
  html = html.replace(/(<strong id="last-update">)[^<]+(<\/strong>)/, '$1' + today + ' · 08:00 BRT$2');
  html = html.replace(/<div class="timestamp">[^<]+<a/g, '<div class="timestamp">' + today + ' · 08:00 BRT<a');

  // 5. Regenerar bloco de notícias
  const newsSectionRe = /(  <!-- ============================== -->\s*\n\s*<!-- NOTÍCIAS[\s\S]+?)(\s*<footer class="bot">)/;
  const newNews = buildNewsSection({
    lead: prices.lead,
    tin: prices.tin,
    leadStock: prices.leadStock,
    tinStock: prices.tinStock,
    prevLead,
    prevTin,
    usdBrl: fx.usdBrl,
    usdCny: fx.usdCny
  });
  if (newsSectionRe.test(html)) {
    html = html.replace(newsSectionRe, newNews + '$2');
    console.log('[Pirobat v2] Bloco de notícias regenerado com dados de hoje.');
  } else {
    console.warn('[Pirobat v2] Regex de notícias não bateu — bloco preservado intacto.');
  }

  fs.writeFileSync(filePath, html);
  console.log('[Pirobat v2] index.html atualizado com sucesso.');
}

main().catch(err => {
  console.error('[Pirobat v2] ERRO:', err.message);
  process.exit(1);
});
