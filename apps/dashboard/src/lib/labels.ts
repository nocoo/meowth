export function displayLabel(value: string): string {
  const words = value.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function chatStatusLabel(value: string): string {
  if (value === 'streaming') return 'Responding';
  if (value === 'aborted-by-client') return 'Stopped';
  if (value === 'network-aborted') return 'Connection lost';
  return displayLabel(value);
}
