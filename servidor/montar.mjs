// Reúne em .publico os arquivos que o servidor publica (páginas e engine). Executado antes de cada publicação.
import { cpSync, mkdirSync, existsSync } from "node:fs";
const destino = ".publico";
const arquivos = ["index.html", "prova.html", "admin.html", "proctoria.js", "painel.js", "ferramentas.js", "relatorio.js", "app.css"];
mkdirSync(destino, { recursive: true });
for (const a of arquivos) if (existsSync(a)) cpSync(a, `${destino}/${a}`);
console.log("Arquivos publicados:", arquivos.filter((a) => existsSync(a)).join(", "));
