const SHEET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function buildGoogleSheetUrl(sheetId: string, gid = '0'): string {
  const trimmed = sheetId.trim();
  if (!SHEET_ID_PATTERN.test(trimmed)) {
    throw new Error('Invalid sheet ID format');
  }
  const encoded = encodeURIComponent(trimmed);
  return `https://docs.google.com/spreadsheets/d/${encoded}/edit?gid=${gid}#gid=${gid}`;
}

export function getDefaultSheetUrlFromEnv(): string | null {
  const sheetId = process.env.SHEET_ID?.trim();
  if (!sheetId) {
    return null;
  }
  try {
    return buildGoogleSheetUrl(sheetId);
  } catch {
    console.warn('SHEET_ID is set but invalid; default sheet URL disabled');
    return null;
  }
}
