import { readFileSync } from 'node:fs';
import path from 'node:path';

export const PDF_TEMPLATE_VERSION = 'red-gate-v1';
// The runtime image copies this bundle alongside the compiled module.
export const PDF_TEMPLATE_DIRECTORY = path.join(__dirname, 'templates', PDF_TEMPLATE_VERSION);

export interface PdfDocument {
  templateVersion: string;
  title: string;
  taskCode: string;
  akaName: string;
  realName: string;
  language: string;
  countryCode: string;
  /** Must already have passed sanitizeStatement with this packet's asset allowlist. */
  statementHtml: string;
}

export interface PdfRenderOptions {
  templateBaseUrl: string;
  /** Packet assets directory, used for {{ASSET_BASE}}/filename references. */
  assetBaseUrl: string;
  /** Controlled path to the packet's decoded avatar PNG; no built-in author logo. */
  avatarUrl?: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function localUrl(value: string): string {
  // Renderer-owned paths only. Limit syntax as these URLs also occur in CSS strings.
  if (!/^file:\/\/\/[A-Za-z0-9_./,%-]+$/.test(value)) throw new Error('Invalid local PDF URL');
  const parsed = new URL(value);
  if (parsed.hostname || parsed.search || parsed.hash || /%(?![0-9a-f]{2})/i.test(value)) throw new Error('Invalid local PDF URL');
  return value.replace(/\/$/, '');
}

function fontFace(baseUrl: string, name: string, file: string, weight: number): string {
  return `@font-face{font-family:'${name}';src:local('${name}'),url('${baseUrl}/fonts/${file}') format('truetype');font-weight:${weight};font-style:normal;font-display:block;}`;
}

/** Builds only the trusted shell; user HTML must be sanitized before calling this function. */
export function buildPdfHtml(document: PdfDocument, options: PdfRenderOptions): string {
  if (document.templateVersion !== PDF_TEMPLATE_VERSION) throw new Error('Unsupported PDF template version');
  const baseUrl = localUrl(options.templateBaseUrl);
  const assetBase = localUrl(options.assetBaseUrl);
  const avatar = options.avatarUrl ? `<img src="${escapeHtml(localUrl(options.avatarUrl))}" alt="">` : '';
  const content = document.statementHtml.replaceAll('{{ASSET_BASE}}', assetBase);
  const css = readFileSync(path.join(PDF_TEMPLATE_DIRECTORY, 'layout.css'), 'utf8');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title>
<link rel="stylesheet" href="${baseUrl}/vendor/katex.css"><style>
${fontFace(baseUrl, 'Sarabun', 'Sarabun-Regular.ttf', 400)}
${fontFace(baseUrl, 'Sarabun', 'Sarabun-Medium.ttf', 500)}
${fontFace(baseUrl, 'Sarabun', 'Sarabun-Bold.ttf', 700)}
@font-face{font-family:'RedGatePreviewInconsolata';src:url('${baseUrl}/fonts/Inconsolata-VariableFont_wdth,wght.ttf') format('truetype');font-weight:100 900;font-style:normal;font-display:block}
${css}
</style></head><body><main class="document">
<header class="document-header"><div class="header-logo">${avatar}</div>
<div class="header-title"><div><span class="aka-name">${escapeHtml(document.akaName)}</span><br><span class="author-name">Author : ${escapeHtml(document.realName)}</span></div></div>
<div class="header-meta"><div>${escapeHtml(document.taskCode)}</div><div>${escapeHtml(document.language)} (${escapeHtml(document.countryCode)})</div></div><div style="clear:both"></div><hr></header>
<article id="statement" class="statement">${content}</article></main>
<script src="${baseUrl}/vendor/bundle.js"></script><script>
var renderFailed = false;
function failPdfRender(error) {
  renderFailed = true;
  window.status = 'pdf-render-error';
  document.getElementById('statement').setAttribute('data-render-error', String(error));
  console.error('PDF_RENDER_ERROR: ' + String(error));
}
window.onerror = function (message) { failPdfRender(message); return true; };
try {
  var renderMathInElement=require('katex/dist/contrib/auto-render');
  renderMathInElement(document.getElementById('statement'),{
    delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\[',right:'\\\\]',display:true},{left:'$',right:'$',display:false},{left:'\\\\(',right:'\\\\)',display:false}],
    trust:false,strict:'error',throwOnError:true,maxExpand:1000,maxSize:100,
    errorCallback:function (message,error) { throw error || new Error(message); }
  });
} catch (error) { failPdfRender(error); }
window.setTimeout(function () {
  if (!renderFailed) {
    window.status='ready-to-print';
    document.documentElement.setAttribute('data-ready', 'true');
  }
}, 4000);
</script></body></html>`;
}
