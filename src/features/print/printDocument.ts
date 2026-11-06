/**
 * Print a standalone HTML document (inventory, move checklist) through a hidden iframe, so the
 * editor itself is never printed. Callers pass already-escaped body HTML (use `esc`).
 */

export const esc = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);

const BASE_CSS = `
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.4 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1d2126; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 2pt; }
  h2 { font-size: 10pt; letter-spacing: .08em; text-transform: uppercase; color: #5f666d; margin: 14pt 0 4pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  .meta { color: #5f666d; font-size: 9.5pt; margin-bottom: 8pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; vertical-align: top; padding: 4pt 6pt 4pt 0; border-bottom: 1px solid #e2e2e2; font-size: 10pt; }
  th { font-size: 8.5pt; color: #5f666d; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: #6b7178; font-size: 9pt; }
  .box { display: inline-block; width: 11pt; height: 11pt; border: 1.2pt solid #1d2126; border-radius: 2pt; margin-right: 6pt; vertical-align: -2pt; }
  .done { text-decoration: line-through; color: #8a8f95; }
  .tag { display: inline-block; font-size: 8pt; border: 1px solid #999; border-radius: 3pt; padding: 0 3pt; margin-left: 4pt; color: #444; }
  tr { page-break-inside: avoid; }
`;

export function printDocument(title: string, bodyHtml: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const win = iframe.contentWindow!;
  const cleanup = () => setTimeout(() => iframe.remove(), 500);
  win.addEventListener('afterprint', cleanup);
  // Let layout settle before opening the dialog.
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(cleanup, 60_000);
  }, 50);
}
