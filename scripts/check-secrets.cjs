#!/usr/bin/env node
/*
 * Varre os arquivos staged (ou todos os versionados) procurando segredos reais antes de commitar.
 * Uso: node scripts/check-secrets.cjs [--staged]   (sai com 1 se achar algo)
 * Ativado como hook com: git config core.hooksPath .githooks
 */
const { execSync } = require("child_process");
const fs = require("fs");

const staged = process.argv.includes("--staged");
const list = execSync(staged ? "git diff --cached --name-only --diff-filter=ACM" : "git ls-files", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

// chaves publicas de teste do Hardhat (contas #0..#3): podem aparecer em scripts de demo local
const ALLOWED = new Set([
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
].map((k) => k.toLowerCase()));

// 32 bytes em hex sao tambem poolIds, hashes de tx e bytes32 de teste: so viram suspeita quando a MESMA linha
// fala em chave/segredo/carteira, ou quando estao atribuidos a uma variavel com nome de chave.
const KEYISH = /priv|secret|\bpk\b|mnemonic|seed|wallet|signer|deployer_pk|keeper_pk/i;
const rules = [
  { name: "chave privada EVM (0x + 64 hex)", re: /0x[0-9a-fA-F]{64}/g, when: (line) => KEYISH.test(line), allow: (m) => ALLOWED.has(m.toLowerCase()) },
  { name: "chave privada EVM atribuida (PK=...)", re: /(?:PRIVATE_KEY|DEPLOYER_PK|KEEPER_PK|\bPK)\s*[:=]\s*"?(?:0x)?[0-9a-fA-F]{64}\b/g },
  { name: "mnemonic (12+ palavras)", re: /(?:MNEMONIC|SEED)\s*[:=]\s*"?(?:[a-z]+\s+){11,}[a-z]+/gi },
  { name: "chave privada Solana (array de 64 bytes)", re: /\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g },
  { name: "API key Helius (api-key=uuid)", re: /api-key=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
  { name: "JWT Pinata", re: /PINATA_JWT\s*=\s*eyJ[A-Za-z0-9_-]{20,}/g },
];

let bad = 0;
for (const f of list) {
  if (/\.(png|jpg|jpeg|webp|ico|woff2?|lock|svg)$/i.test(f)) continue;
  if (/^(node_modules|artifacts|cache)\//.test(f)) continue;
  let text;
  try {
    text = staged ? execSync(`git show :"${f}"`, { encoding: "utf8" }) : fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of rules) {
      if (r.when && !r.when(line)) continue;
      for (const m of line.match(r.re) || []) {
        if (r.allow && r.allow(m)) continue;
        if (/COLE_AQUI/.test(m)) continue;
        console.error(`BLOQUEADO: ${f}:${i + 1} contem ${r.name}: ${m.slice(0, 12)}...`);
        bad += 1;
      }
    }
  });
}
if (bad) {
  console.error("\nRemova o segredo (use .env, que esta no .gitignore) e tente de novo.");
  process.exit(1);
}
if (!staged) console.log("ok: nenhum segredo nos arquivos versionados");
