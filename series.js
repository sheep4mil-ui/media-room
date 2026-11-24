const numberedPart = /^(.+?)[\s._-]+\(?(?:part|pt)[\s._-]*(\d+)\)?\.mp4$/i;

export function groupVideos(files) {
  const groups = new Map();
  const rows = files.map((file) => {
    const row = { name: file.name, parts: [file] };
    const match = file.key.endsWith('.mp4') && numberedPart.exec(file.name);
    if (!match) return row;
    const name = match[1].trim();
    const number = Number(match[2]);
    if (!name || !Number.isSafeInteger(number)) return row;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, name, number, file });
    return row;
  });
  const groupedRows = new Set();
  for (const entries of groups.values()) {
    if (entries.length < 2 || new Set(entries.map(({ number }) => number)).size !== entries.length) continue;
    const [{ row, name }] = entries;
    entries.sort((a, b) => a.number - b.number);
    row.name = name;
    row.parts = entries.map(({ file }) => file);
    for (const entry of entries) {
      if (entry.row !== row) groupedRows.add(entry.row);
    }
  }
  return rows.filter((row) => !groupedRows.has(row));
}
