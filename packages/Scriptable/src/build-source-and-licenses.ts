import dependencies from 'consts:dependencies';
import { type UITableBuilder } from './lib/uitable-builder.js';

export async function buildSourceAndLicenses(builder: UITableBuilder) {
  await builder.addForwardRow('Source Code on GitHub', async () => {
    const a = new Alert;
    a.title = 'Open GitHub URL or Copy to Clipboard?';
    a.message = 'Would you like to open the GitHub URL for this program in your default web browser, or copy it to the clipboard?';
    a.addAction('Open');
    a.addAction('Copy');
    a.addCancelAction('Cancel');
    const r = await a.presentAlert();
    const url = 'https://github.com/ChrisJohnsen/ISBN-Export-Tool';
    if (r == -1) return;
    else if (r == 0)
      Safari.open(url);
    else if (r == 1)
      Pasteboard.copyString(url);
  });

  if (dependencies.length <= 0) return;
  builder.addEmptyRow();
  const addTableRow = builder.adderForTableRow([
    { align: 'left', widthWeight: 7 },
    { align: 'center', widthWeight: 3 },
    { align: 'right', widthWeight: 3 },
  ]);
  const addRow = (name: string, version: string, license: string, licenseText: string) =>
    addTableRow([name, version, { title: license, ...licenseText.length > 0 ? { titleColor: Color.blue() } : {} }], {
      onSelect: licenseText.length > 0 ? async () => {
        const a = new Alert;
        a.title = name + ' License';
        a.message = licenseText;
        a.addCancelAction('Okay');
        await a.presentSheet();
      } : void 0
    });
  addTableRow(['Included Dependency', 'Version', 'License']);
  for (const d of dependencies)
    await addRow(d.name ?? '', d.version ?? '', d.license ?? '', d.licenseText ?? '');

  if (dependencies.some(d => (d.licenseText?.length ?? 0) > 0)) {
    builder.addEmptyRow();
    await builder.addTextRow('Tap any blue license to view full license text.');
  }
}
