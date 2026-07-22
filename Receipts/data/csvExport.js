// csvExport.js — builds the CSV that KennelOS's Expense importer reads.
//
// The column set is EXACTLY the KennelOS `expense` mapping's templateHeaders:
//   subject_type, subject_name, expense_date, amount, category, vendor, miles,
//   mileage_rate, notes
// (see KennelOS data/csvImport.js EXPENSE_MAPPING). Keep them in sync.
//
// Row rules that mirror the importer's expectations:
//  - Receipt  → amount set; miles/mileage_rate blank; category as chosen.
//  - Trip     → miles + mileage_rate set; amount LEFT BLANK (KennelOS derives it
//               from miles × rate); category is `mileage`.
//  - subject_name blank on a kennel row is fine — the importer falls back to your
//    configured "my kennel".
import { effectiveAmount } from './entryRepo.js';

// `receipt_number` rides so KennelOS can tie the imported row back to this app's
// entry (and its photo). `business` deliberately does NOT — it's this app's own
// bucketing dimension, used only to scope which entries an export includes.
const HEADERS = ['subject_type', 'subject_name', 'expense_date', 'amount', 'category', 'vendor', 'miles', 'mileage_rate', 'receipt_number', 'notes'];

// RFC-4180-ish quoting: wrap in quotes if the value has a comma, quote, or
// newline, and double any embedded quotes.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowFor(entry) {
  const isTrip = entry.kind === 'trip';
  return {
    subject_type: entry.subject_type || 'kennel',
    subject_name: entry.subject_name || '',
    expense_date: entry.entry_date || '',
    // Trips leave amount blank so KennelOS derives it; receipts carry the figure.
    amount: isTrip ? '' : (entry.amount != null ? entry.amount : ''),
    category: isTrip ? 'mileage' : (entry.category || 'other'),
    vendor: isTrip ? '' : (entry.vendor || ''),
    miles: isTrip ? (entry.miles != null ? entry.miles : '') : '',
    mileage_rate: isTrip ? (entry.mileage_rate != null ? entry.mileage_rate : '') : '',
    receipt_number: entry.receipt_number || '',
    notes: entry.notes || ''
  };
}

export function buildCsv(entries) {
  const lines = [HEADERS.join(',')];
  for (const e of entries) {
    const r = rowFor(e);
    lines.push(HEADERS.map((h) => csvCell(r[h])).join(','));
  }
  return lines.join('\r\n');
}

// A short human summary of what an export will contain (for the confirm UI).
export function summarize(entries) {
  let receipts = 0, trips = 0, total = 0;
  for (const e of entries) {
    if (e.kind === 'trip') trips++; else receipts++;
    const amt = effectiveAmount(e);
    if (amt != null) total += amt;
  }
  return { count: entries.length, receipts, trips, total };
}

// Trigger a browser download of a CSV string.
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
