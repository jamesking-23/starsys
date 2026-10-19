// Desktop printing: the web layer sends only a paper name, an orientation and a file name; everything else is decided here.
const { dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');

const PAPERS = ['A4', 'A3', 'Letter', 'Legal'];

/** Never trust what the page sends: whitelist the paper, coerce the flag, strip anything path-like from the name. */
function sanitize(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const name = String(o.name == null ? '' : o.name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return { paper: PAPERS.includes(o.paper) ? o.paper : 'A4', landscape: o.landscape === true, name: name || 'Starsys report' };
}
// The pages are already laid out at paper size with their own margins, so the system margins are zero.
const pdfOptions = (o) => ({ pageSize: o.paper, landscape: o.landscape, printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
const printOptions = (o) => ({ silent: false, printBackground: true, pageSize: o.paper, landscape: o.landscape, margins: { marginType: 'none' } });
const trusted = (e) => { try { return !!e.senderFrame && /^file:\/\//.test(e.senderFrame.url); } catch (err) { return false; } };

function register(ipcMain, deps) {
  const dlg = (deps && deps.dialog) || dialog;
  ipcMain.handle('print:run', (e, raw) => {
    if (!trusted(e)) return { success: false, reason: 'Not allowed' };
    const o = sanitize(raw);
    return new Promise((resolve) => e.sender.print(printOptions(o), (success, reason) => resolve({ success, reason })));
  });
  ipcMain.handle('print:pdf', async (e, raw) => {
    if (!trusted(e)) return { ok: false };
    const o = sanitize(raw);
    const { canceled, filePath } = await dlg.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), o.name + '.pdf'), filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const data = await e.sender.printToPDF(pdfOptions(o));
    fs.writeFileSync(filePath, data);
    return { ok: true, path: filePath };
  });
}
module.exports = { sanitize, pdfOptions, printOptions, register };
