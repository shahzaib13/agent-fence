const FIELD_LABELS: Record<string, string> = {
  suburb: 'Suburb',
  fenceType: 'Fence type',
  lengthMeters: 'Length',
  heightMm: 'Height',
  removeOldFence: 'Remove old fence',
  siteAccess: 'Site access',
  existingPrice: 'Existing quote',
}

export function checklistFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

export function formatChecklistValue(key: string, value: string | number | boolean | null): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (key === 'lengthMeters') return `${value}m`
  if (key === 'heightMm') return `${value}mm`
  if (key === 'existingPrice') return `$${value}`
  return String(value)
}
