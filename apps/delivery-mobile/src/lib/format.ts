/** Small formatting helpers shared across the rider screens. */

export function rupees(value: number | null | undefined, decimals = 2): string {
  const amount = Number(value) || 0;
  return `Rs ${amount.toFixed(decimals)}`;
}

/** Money on the dashboard is read at a glance; paise are noise there. */
export function rupeesShort(value: number | null | undefined): string {
  return `Rs ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

export function distance(km: number | null | undefined): string {
  const value = Number(km);
  if (!value || Number.isNaN(value)) return '—';
  return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} km`;
}

export function clockTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function dayAndTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${clockTime(iso)}`;
}

export function hoursAndMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function initialsOf(name?: string): string {
  if (!name) return 'QB';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'QB';
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
