import { createServerFn } from '@tanstack/react-start';

// Google Sheets sync is temporarily disabled.
// All server functions are no-ops so the app logic runs on local state only.
// Reconnect the Google Sheets connector later to re-enable real sync.

export const loadAllSheets = createServerFn({ method: 'GET' }).handler(async () => {
  return { employees: [], leaves: [], overrides: [], symbols: [] } as {
    employees: any[]; leaves: any[]; overrides: any[]; symbols: any[];
  };
});

export const saveSheetTable = createServerFn({ method: 'POST' })
  .inputValidator((d: { table: 'employees'|'leaves'|'overrides'|'symbols'; items: any[] }) => {
    if (!d || !Array.isArray(d.items)) throw new Error('invalid payload');
    return d;
  })
  .handler(async ({ data }) => {
    return { ok: true, skipped: true, count: data.items.length };
  });

export const saveEmployeeToDB = createServerFn({ method: 'POST' })
  .inputValidator((d: { employee: any }) => {
    if (!d?.employee) throw new Error('employee required');
    return d;
  })
  .handler(async () => {
    return { ok: true, skipped: true };
  });
