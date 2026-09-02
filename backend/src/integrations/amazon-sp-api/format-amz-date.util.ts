/**
 * Formata uma data no formato `x-amz-date` (`YYYYMMDD'T'HHMMSS'Z'`, sempre
 * UTC) usado pelos headers de requisição da SP-API.
 */
export function formatAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
