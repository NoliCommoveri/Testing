// vocab.js — controlled vocabularies for the Receipts app.
//
// ⚠️ These MUST stay in lock-step with KennelOS's `data/vocab.js`
// (EXPENSE_CATEGORIES, EXPENSE_SUBJECT_TYPES). The whole point of this app is to
// produce a CSV KennelOS's expense importer accepts, and that importer matches
// each `category`/`subject_type` against these exact `value` strings. If KennelOS
// adds/renames a category, mirror it here — an unknown category still imports
// (KennelOS soft-defaults it to "Other"), but you lose the clean mapping.
//
// Values are copied verbatim from KennelOS; labels may differ cosmetically.

export const EXPENSE_CATEGORIES = [
  { value: 'food',         label: 'Food & nutrition' },
  { value: 'veterinary',   label: 'Veterinary' },
  { value: 'testing',      label: 'Health testing' },
  { value: 'registration', label: 'Registration' },
  { value: 'supplies',     label: 'Supplies' },
  { value: 'facility',     label: 'Facility' },
  { value: 'boarding',     label: 'Boarding & travel' },
  { value: 'mileage',      label: 'Mileage / travel' },
  { value: 'stud_fee',     label: 'Stud fee' },
  { value: 'dog_purchase', label: 'New dog purchase' },
  { value: 'marketing',    label: 'Marketing' },
  { value: 'insurance',    label: 'Insurance' },
  { value: 'other',        label: 'Other' }
];

// What a cost can attach to in KennelOS. This app can only name subjects a
// name-only CSV can resolve, so we expose the two the importer supports:
// `kennel` (program overhead — the default) and `dog` (by name).
export const SUBJECT_TYPES = [
  { value: 'kennel', label: 'Kennel (whole business)' },
  { value: 'dog',    label: 'A specific dog' }
];

export function categoryLabel(value) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value || 'Other';
}

// The full category list for the picker: the KennelOS-mirrored built-ins plus
// any custom categories the user added (each custom one is its own value+label;
// it exports as-is and KennelOS maps an unrecognized category to "Other").
export function categoryList(custom = []) {
  const builtinValues = new Set(EXPENSE_CATEGORIES.map((c) => c.value));
  const extra = custom
    .filter((name) => name && !builtinValues.has(name))
    .map((name) => ({ value: name, label: name, custom: true }));
  return [...EXPENSE_CATEGORIES, ...extra];
}

export function subjectTypeLabel(value) {
  return SUBJECT_TYPES.find((s) => s.value === value)?.label || value || 'Kennel';
}
