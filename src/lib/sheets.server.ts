const SHEET_ID = '1yGpNQ35c6i7N8CDfPKWbMAY5GDOC8AJAakV8tOtZR_U';
const GW = 'https://connector-gateway.lovable.dev/google_sheets/v4';

function authHeaders(): Record<string, string> {
  const k = process.env.LOVABLE_API_KEY;
  const c = process.env.GOOGLE_SHEETS_API_KEY;
  if (!k) throw new Error('LOVABLE_API_KEY missing');
  if (!c) throw new Error('GOOGLE_SHEETS_API_KEY missing');
  return {
    Authorization: `Bearer ${k}`,
    'X-Connection-Api-Key': c,
    'Content-Type': 'application/json',
  };
}

export async function readRange(range: string): Promise<any[][]> {
  const r = await fetch(`${GW}/spreadsheets/${SHEET_ID}/values/${range}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`Sheets read ${range} [${r.status}]: ${await r.text()}`);
  const j = await r.json() as { values?: any[][] };
  return j.values ?? [];
}

export async function writeRange(range: string, values: any[][]): Promise<void> {
  const w = await fetch(`${GW}/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ values }),
  });
  if (!w.ok) throw new Error(`Sheets write ${range} [${w.status}]: ${await w.text()}`);
}

export async function writeWholeSheet(sheetName: string, values: any[][]): Promise<void> {
  // 1) Clear the sheet
  const clr = await fetch(`${GW}/spreadsheets/${SHEET_ID}/values/${sheetName}:clear`, {
    method: 'POST', headers: authHeaders(),
  });
  if (!clr.ok) throw new Error(`Sheets clear ${sheetName} [${clr.status}]: ${await clr.text()}`);
  if (values.length === 0) return;
  // 2) Write starting at A1
  const w = await fetch(`${GW}/spreadsheets/${SHEET_ID}/values/${sheetName}!A1?valueInputOption=RAW`, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ values }),
  });
  if (!w.ok) throw new Error(`Sheets write ${sheetName} [${w.status}]: ${await w.text()}`);
}
