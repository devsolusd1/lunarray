# lunarray

Bond + stake engine acoplado a um token lançado na **Pons v2** (Robinhood Chain), **vivo desde a bonding curve**.
As taxas de criador (5%) são divididas em código: 3% pra tesouraria, 2% trabalhando no protocolo (rendimento em
ETH pros stakers e buyback que paga os bonds). Na graduação o engine troca sozinho da curva pro pool Uniswap v4.

Contratos (`contracts/`):

| Contrato | Papel |
|---|---|
| `FeeSplitter` | É o `creatorFeeRecipient` do token na Pons. `harvest()` (qualquer um chama) saca do FeeEscrow da Pons e reparte `treasuryBps` (6000 = 60% de cada harvest = 3% de cada trade) pra tesouraria e o resto (2%) pro `BondEngine`. Sem dono, sem saque, shares imutáveis. |
| `BondEngine` | Oráculo de preço (curva da Pons antes da graduação, StateView v4 depois), bonds com bônus por desconto (fila FIFO, vesting), staking com recompensa em ETH, buyback por época (na curva via `curve.buy`, no pool via PoolManager v4), pausa só de entradas (máx. 7 dias), parâmetros com timelock de 48 h, `sweepIdle()` pra fundos ociosos. |
| `StakedLunarray` | sLUNARRAY: recibo de stake líquido, 1:1, ETH segue o saldo. Opcional. |

## Fase da curva

O engine não espera a graduação. `start()` funciona assim que a curva existe; `spot()` lê `curve.getReserves()`
(tokens por ETH, mesmas reservas que a Pons usa pra cotar) e o buyback de cada época chama `curve.buy{value}`.
Se a compra for maior do que sobrou na curva, a Pons preenche parcial e devolve o resto na mesma tx; o engine
reconhece o reembolso pelo remetente e devolve pra reserva (nunca vira "receita" pros stakers). Se a curva recusar a
compra, a época avança do mesmo jeito (`BuybackSkipped`). Quando `curve.graduated()` vira true, o preço e o buyback
passam pro pool v4, na mesma série de amostras, sem redeploy e sem `start()` de novo.

## Fundos ociosos

Se ninguém bondar, o crypt (tokens recomprados) e a reserva de ETH ficariam presos. `sweepIdle()` (só guardian) move
os dois pra tesouraria, mas só quando **não há bond em aberto** e **nenhum bond foi aberto, pago ou cancelado há 30
dias** (`IDLE_DELAY`). Stake dos usuários, ETH devido a stakers e payout de bonds abertos nunca entram no sweep.

## Ordem de deploy (mainnet 4663)

Tudo é lido do `.env` (copie de `.env.example`). Preencha `DEPLOYER_PK`, `TREASURY` e `RH_RPC` antes do passo 1;
`TOKEN`, `SPLITTER` e `GUARDIAN` antes do passo 3; `ENGINE` antes do passo 4.

1. **Antes do launch** — FeeSplitter (grava tesouraria + 60% de forma imutável):
   ```bash
   npx hardhat run scripts/1-deploy-splitter.js --network robinhood
   ```
2. **Launch na Pons pelo código** (o site da Pons não deixa anexar o website; pelo script logo, descrição,
   website e socials vão on-chain no próprio launch e a Pons lê do contrato do token):
   ```bash
   DRY_RUN=1 npx hardhat run scripts/0-launch-pons.js --network robinhood   # simula: taxa, token/curva previstos, gas
   npx hardhat run scripts/0-launch-pons.js --network robinhood             # envia
   ```
   Lê `LAUNCH_*`, `CREATOR_TAX_BPS`, `DEV_BUY_ETH`, `SNIPE_EXEMPT` do `.env`; `creatorFeeRecipient = SPLITTER`,
   `pairToken = ETH`, `buybackEnabled = false` (o buyback é do nosso engine). Com `DEV_BUY_ETH` usa o router
   `launchAndBuy` (compra isenta de snipe tax na mesma tx); sem, usa `launchToken` na factory.
   A taxa de criador **não muda depois**; o recipient muda só com timelock de 3 dias. Tudo que vai no launch
   (nome, símbolo, logo, descrição, links) é imutável.
3. **Logo depois do launch** — BondEngine. O script lê o registro da launch na factory da Pons (curva, poolFee,
   tickSpacing), a tesouraria do splitter, e faz o wiring do splitter (uma vez só):
   ```bash
   npx hardhat run scripts/2-deploy-engine.js --network robinhood
   ```
4. **Keeper** (pode começar na hora: ele chama `start()` na curva e `poke()` a cada época; também faz `harvest()`,
   `settle()` e, se a compra que encheu a curva não criou o pool, `createGraduatedPool()` na factory):
   ```bash
   npx hardhat run scripts/3-start-and-poke.js --network robinhood
   ```
   (`LOOP=1` no `.env` pra ficar rodando, ou `run-keeper.bat`.) Adicione `VERIFY=1` no `.env` pra tentar verificar
   no Blockscout logo após o deploy (costuma falhar por Cloudflare; use `scripts/verify-sourcify.js`).
5. **Opcional** — sLUNARRAY:
   ```bash
   npx hardhat run scripts/4-deploy-slunar.js --network robinhood
   ```
6. Preencher `site/config.js` (endereços + `treasuryBps`) e publicar a pasta `site/` (estático, `vercel.json`
   pronto): `index.html` = terminal (arte ASCII gerada em `ascii.js`, botões ASCII, barra de status, prompt,
   dashboard, bond, stake, manutenção), `docs.html` = NFO/documentação em inglês no mesmo tema. Fonte: stack
   monoespaçada do sistema com box-drawing (Cascadia/Consolas/Menlo). Tema roxo escuro.

Endereços da Pons/Uniswap usados estão em `scripts/addresses.js` (PoolKey confirmada contra o pool do REVENANT:
currency0 = ETH, currency1 = token, fee 0, tickSpacing 200, hook = MemeHook).

## RPC do site

`site/config.js` tem `rpcs` (lista em ordem de preferência: Alchemy → oficial → publicnode) e `multicall` (Multicall3 em `0xcA11bde05977b3631167028862bE2a173976CA11`). `site/rpc.js` manda cada requisição pro primeiro RPC que responde e pula pro próximo em erro de rede ou de limite; todas as leituras do dashboard vão num único `aggregate3`. A chave da Alchemy é de leitura e fica pública no frontend por natureza: restrinja ela ao domínio do site no painel da Alchemy. Os scripts e o keeper leem `RH_RPC` do `.env`.

## Parâmetros padrão (`scripts/addresses.js`)

| Parâmetro | Valor | Significado |
|---|---|---|
| epochLength | 3600 s | 1 amostra de preço por hora |
| window | 24 | alvo = média das últimas 24 h |
| minSamples | 6 | bonds abrem 6 h depois do `start()` |
| maxBonusBps / bandBps | 5000 / 5000 | +50% de bônus quando o preço está 50% abaixo do alvo, linear até lá |
| entryBurnBps | 100 | 1% da entrada queimado |
| vestEpochs | 24 | bond vence em 24 h |
| penaltyBps | 2000 | sair antes devolve principal menos 20% |
| releaseBps | 1000 | 10% da reserva de ETH vira buyback por época |
| stakingShareBps | 5000 | metade do ETH que entra vai pros stakers, metade pra reserva |
| IDLE_DELAY | 30 dias | constante: tempo sem nenhum bond antes do `sweepIdle()` |

## Segurança (o que o guardian pode e não pode)

- Pode: `pause(duration ≤ 7 dias)` bloqueando **só** `bond` e `stake`; `proposeParams` que só executa 48 h depois;
  `sweepIdle()` depois de 30 dias sem nenhum bond.
- Não pode: mover token ou ETH de usuário, mudar endereços, curva ou pool, pausar `unstake`, `exit`, `settle`,
  `claimRewards`, `poke`.
- Recomendação: guardian = carteira fria separada do deployer; tesouraria = a mesma carteira fria.

## Testes

```bash
npx hardhat test                                            # unitários (mocks: pool, curva, escrow)
FORK=1 RH_RPC=https://rpc.ordofi.network npx hardhat test test/fork.test.js   # buyback real na curva do NADIR e no pool v4 do REVENANT
```

`CURVE_TOKEN=0x...` troca o token usado no teste de curva (precisa ser uma launch da Pons ainda não graduada).

## Demo local do site

```bash
npx hardhat node --port 8546
npx hardhat run scripts/dev-local.js --network localhost    # gera site/config.local.js (curva → graduação → bonds abertos)
python -m http.server 4181 --directory site                 # abre http://localhost:4181
```

(`hardhat.config.js` aponta `localhost` pra porta 8546.)
