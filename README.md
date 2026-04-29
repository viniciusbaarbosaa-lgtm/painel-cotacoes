# Painel Pirobat — Cotações de Matérias-Primas

Painel público com cotações diárias dos metais e insumos químicos críticos para a fabricação de baterias chumbo-ácido.

## Acesso

URL pública (preencher após deploy): https://`SEU-USUARIO`.github.io/painel-cotacoes/

## Atualização automática

- GitHub Actions roda todo dia às **08:05 BRT** (11:05 UTC)
- Busca preços oficiais LME Settlement Cash do Westmetall
- Atualiza `index.html` e faz commit automático
- GitHub Pages republica em ~1 minuto

## Conteúdo

- **Bolsa de Londres (LME)**: Chumbo, Estanho (oficiais Westmetall) + Antimônio, Selênio, Cálcio (referência Argus)
- **Bolsa da China (SHFE/SMM)**: 5 metais em CNY
- **Insumos Químicos**: Enxofre, Ácido Sulfúrico (Argus)
- **Notícias correlatas**: cadeia de suprimentos da bateria

## Arquivos

- `index.html` — o painel completo (HTML autocontido com Chart.js)
- `update-prices.js` — script de atualização diária
- `.github/workflows/update-prices.yml` — workflow do GitHub Actions

## Manutenção

Para atualização manual fora do horário automático:

1. Vá em **Actions** → **Atualizar cotações LME diariamente**
2. Clique em **Run workflow** → **Run workflow**
3. Em ~30s o painel é atualizado e republicado

## Suporte

Pirobat — Gestão Comercial
