export const templates = {
  Cleaning: ['Visual inspection', 'Filter cleaning', 'Drainage check', 'Cooling performance test', 'Controls check', 'Work area cleanup'],
  Repair: ['Fault diagnosis', 'Electrical safety check', 'Repair / replacement', 'Operation test', 'Leak check', 'Work area cleanup'],
};
export function parseChecks(value) {
  if (!value?.startsWith('[Service checklist]\n')) return [];
  return value.slice(20).split('\n').filter(Boolean).map(line => {
    const match = line.match(/^\[(Completed|Not completed)\] (.*?)(?: — Reason: (.*))?$/);
    return match ? { name: match[2], done: match[1] === 'Completed', reason: match[3] || '' } : null;
  }).filter(Boolean);
}
export function summarizeChecks(rows) {
  return '[Service checklist]\n' + rows.map(r => `[${r.done ? 'Completed' : 'Not completed'}] ${r.name}${r.done || !r.reason ? '' : ' — Reason: ' + r.reason.replace(/[\r\n]+/g, ' ')}`).join('\n');
}
