export function downloadFile(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value) {
  const string = String(value ?? '');
  // Spreadsheet formula injection must not turn saved notes/names into commands.
  const safe = /^[\s]*[=+@-]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function centresCsv(centres) {
  return [['Centre ID', 'Centre name', 'City', 'State', 'Claimed', 'Observed', 'Source', 'Connection'], ...centres.map(c => [c.id, c.name, c.city, c.state, c.claimed, c.detected ?? 'Unavailable', c.source, c.connection])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
