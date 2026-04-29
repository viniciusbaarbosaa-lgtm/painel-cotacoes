/**
 * PIROBAT — Atualizador automático de cotações LME
 *
 * Script que roda no GitHub Actions todo dia às 08:05 BRT.
 * Busca os preços oficiais LME Settlement Cash do Westmetall
 * e atualiza o index.html (painel) com os novos valores.
 *
 * Atualiza Chumbo (Pb) e Estanho (Sn) — únicos metais negociados na LME.
 * Os demais (Antimônio, Selênio, Cálcio, China, Insumos Químicos) ficam
 * como referência da última atualização manual.
 */

const fs = require('fs');

async function fetchWestmetallPrices() {
  const res = await fetch('https://www.westmetall.com/en/markdaten.php', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PirobatBot/1.0)' }
  });
  if (!res.ok) throw new Error('Westmetall HTTP ' + res.status);
  const html = await res.text();

  // Padrões de extração robustos baseados nos links da tabela oficial
  // O HTML tem links com action=diagram&field=LME_Pb_cash etc, perto dos preços
  const grab = (field) => {
    const re = new RegExp(`field=${field}[^>]*>\\s*([\\d,]+\\.\\d{2})`, 'i');
    const m = html.match(re);
    if (!m) throw new Error(`Não encontrei valor para ${field}`);
    return parseFloat(m[1].replace(/,/g, ''));
  };

  const lead = grab('LME_Pb_cash');
  const tin  = grab('LME_Sn_cash');

  // Data publicada na página (28. April 2026 etc)
  const dateMatch = html.match(/Official LME-Prices[\s\S]*?(\d{1,2}\.\s*\w+\s*\d{4})/);
  const lmeDate = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('pt-BR');

  return { lead: Math.round(lead), tin: Math.round(tin), lmeDate };
}

function todayLabel() {
  const d = new Date();
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

function todayLong() {
  const d = new Date();
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

async function main() {
  console.log('[Pirobat] Buscando preços Westmetall...');
  const prices = await fetchWestmetallPrices();
  console.log('[Pirobat] LME Cash: Pb=' + prices.lead + ' Sn=' + prices.tin + ' (data ' + prices.lmeDate + ')');

  const filePath = 'index.html';
  let html = fs.readFileSync(filePath, 'utf8');

  // 1. Atualizar último ponto da série de Chumbo LME (12º elemento)
  // Padrão: series:[2034,2050,2065,2080,2055,2030,2010,1985,1972,1968,1965,XXXX] — chumbo
  const leadSeriesRe = /(id:'pb-lme'[\s\S]{0,800}?series:\[)([\d,\s]+),(\d+)(\])/;
  html = html.replace(leadSeriesRe, (m, p1, body, _last, p4) => {
    return p1 + body + ',' + prices.lead + p4;
  });

  // 2. Atualizar último ponto da série de Estanho LME
  const tinSeriesRe = /(id:'sn-lme'[\s\S]{0,800}?series:\[)([\d,\s]+),(\d+)(\])/;
  html = html.replace(tinSeriesRe, (m, p1, body, _last, p4) => {
    return p1 + body + ',' + prices.tin + p4;
  });

  // 3. Atualizar último item de LABELS_YTD para a data de hoje
  const labelsYtdRe = /(const LABELS_YTD = \[)([\s\S]+?)(\];)/;
  html = html.replace(labelsYtdRe, (m, p1, body, p3) => {
    const items = body.split(',').map(s => s.trim());
    items[items.length - 1] = "'" + todayLabel() + "'";
    return p1 + items.join(',') + p3;
  });

  // 4. Atualizar timestamp do header
  const today = todayLong();
  html = html.replace(/(<strong id="last-update">)[^<]+(<\/strong>)/, '$1' + today + ' · 08:00 BRT$2');

  // 5. Atualizar timestamp dentro dos cards (no JS)
  html = html.replace(/<div class="timestamp">[^<]+<a/g, '<div class="timestamp">' + today + ' · 08:00 BRT<a');

  fs.writeFileSync(filePath, html);
  console.log('[Pirobat] index.html atualizado com sucesso.');
}

main().catch(err => {
  console.error('[Pirobat] ERRO:', err.message);
  process.exit(1);
});
