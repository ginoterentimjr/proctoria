/*! Proctoria 0.7.0 | Safe Exam Browser: arquivo de configuração, Config Key e conferência do navegador */

/* Configuração entregue ao Safe Exam Browser. A Config Key é calculada apenas com as chaves presentes
   neste arquivo, como o próprio SEB faz, e por isso a lista é curta e explícita. */
export function configuracao(origem) {
  return {
    originatorVersion: "Proctoria_0.7.0",
    sebConfigPurpose: 0,                     // iniciar uma prova, sem reconfigurar o computador
    startURL: origem + "/prova",
    startURLAppendQueryParameter: true,      // o código do participante chega pelo endereço sebs://...?c=código
    sendBrowserExamKey: false,               // a conferência é feita pela API JavaScript do SEB
    browserWindowWebView: 3,                 // macOS: motor atual, exigido para câmera, microfone e API JavaScript
    browserViewMode: 1,                      // tela cheia
    browserWindowAllowReload: true,          // recarregar a página aciona a retomada da sessão
    browserMediaCaptureCamera: true,
    browserMediaCaptureMicrophone: true,
    browserMediaCaptureScreen: true,
    allowVideoCapture: true,
    allowAudioCapture: true,
    allowedDisplaysMaxNumber: 1,
    allowQuit: true,                         // sair no meio da prova conta como interrupção da sessão
    quitURL: origem + "/api/seb/sair",
    quitURLConfirm: false
  };
}

const escaparXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function no(valor, recuo) {
  const e = "  ".repeat(recuo);
  if (valor === true) return e + "<true/>";
  if (valor === false) return e + "<false/>";
  if (typeof valor === "number") return e + (Number.isInteger(valor) ? "<integer>" + valor + "</integer>" : "<real>" + valor + "</real>");
  if (typeof valor === "string") return e + "<string>" + escaparXml(valor) + "</string>";
  if (Array.isArray(valor)) return valor.length ? e + "<array>\n" + valor.map((v) => no(v, recuo + 1)).join("\n") + "\n" + e + "</array>" : e + "<array/>";
  if (valor && typeof valor === "object") {
    if (typeof valor.__data === "string") return e + "<data>" + valor.__data + "</data>";
    const chaves = Object.keys(valor);
    if (!chaves.length) return e + "<dict/>";
    return e + "<dict>\n" + chaves.map((k) => e + "  <key>" + escaparXml(k) + "</key>\n" + no(valor[k], recuo + 1)).join("\n") + "\n" + e + "</dict>";
  }
  return e + "<string></string>";
}
export function plist(config) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' + no(config, 0) + "\n</plist>\n";
}

/* Ordenação das chaves: alfabética sem distinção de maiúsculas; no empate, a minúscula vem antes. */
function compararChaves(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] === a[i].toLowerCase() ? -1 : 1;
  }
  return a.length - b.length;
}
function vazio(v) { return v && typeof v === "object" && !Array.isArray(v) && typeof v.__data !== "string" && !Object.keys(v).length; }
function serializar(valor) {
  if (valor === true || valor === false) return String(valor);
  if (typeof valor === "number") return String(valor);
  if (typeof valor === "string") return '"' + valor.replace(/"/g, '\\"') + '"';   // sem escapar barras, como pede o SEB
  if (Array.isArray(valor)) return "[" + valor.filter((v) => !vazio(v)).map(serializar).join(",") + "]";
  if (valor && typeof valor === "object") {
    if (typeof valor.__data === "string") return '"' + valor.__data + '"';
    return "{" + Object.keys(valor).filter((k) => !vazio(valor[k])).sort(compararChaves)
      .map((k) => '"' + k + '":' + serializar(valor[k])).join(",") + "}";
  }
  return '""';
}
/* SEB-JSON: sem "originatorVersion", chaves ordenadas, sem espaços e sem dicionários vazios. */
export function sebJson(config) {
  const copia = { ...config };
  delete copia.originatorVersion;
  return serializar(copia);
}

export async function sha256Hex(texto) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return Array.from(b, (x) => ("0" + x.toString(16)).slice(-2)).join("");
}
export const chaveDeConfiguracao = (config) => sha256Hex(sebJson(config));
/* Valor que o SEB informa em cada página: SHA256 do endereço, sem o fragmento, seguido da Config Key. */
export const hashDaPagina = (endereco, chave) => sha256Hex(String(endereco).replace(/#.*$/, "") + chave);
