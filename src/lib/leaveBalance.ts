import { differenceInMonths } from 'date-fns';
import { Employee, ManualOverride } from '../types';
import { safeParse } from './roster';

export interface LeaveBalance {
  /** Saldo Extra Cuti yang tersedia (earned - used + manual adjust) */
  extraAvailable: number;
  /** Saldo Cuti Tahunan yang tersedia (entitlement - used + manual adjust) */
  annualAvailable: number;
  /** Detail */
  earnedExtra: number;
  usedExtra: number;
  annualEntitlement: number;
  usedAnnual: number;
}

/**
 * Hitung saldo Extra Cuti & Cuti Tahunan untuk satu karyawan pada tahun terpilih.
 * Konsisten dengan logic di TimesheetView.
 */
export function computeLeaveBalance(
  employee: Employee,
  overrides: ManualOverride[],
  targetYear: number = new Date().getFullYear()
): LeaveBalance {
  const yStart = `${targetYear}-01-01`;
  const yEnd = `${targetYear}-12-31`;

  const empOverrides = overrides.filter(o => o.employeeId === employee.id);

  const extraWorkDays = empOverrides.filter(o =>
    o.date >= yStart && o.date <= yEnd &&
    /^X\d+$/i.test(o.symbol) && o.color === '#000000'
  ).length;

  const usedExtra = empOverrides.filter(o =>
    o.date >= yStart && o.date <= yEnd &&
    o.symbol.toUpperCase().startsWith('CE')
  ).length;

  let usedAnnual = 0;
  let annualEntitlement = 0;

  const joinSrc = employee.joinDateLatest || employee.joinDate;
  if (joinSrc) {
    const join = safeParse(joinSrc);
    const now = new Date();
    const monthsWorked = differenceInMonths(now, join);
    if (monthsWorked >= 12) {
      annualEntitlement = 12;
      const lastAnniversary = new Date(join);
      lastAnniversary.setFullYear(now.getFullYear());
      if (lastAnniversary > now) lastAnniversary.setFullYear(now.getFullYear() - 1);
      usedAnnual = empOverrides.filter(o => {
        if (!o.symbol.toUpperCase().startsWith('CT')) return false;
        const d = safeParse(o.date);
        return d >= lastAnniversary;
      }).length;
    }
  }

  // Divisor: Gol I/admin = 5; II/III = 4; IV = 3.5; V/VI = 3
  let divisor = 3;
  const g = (employee.grade || '').trim();
  const pos = (employee.position || '').toLowerCase();
  if (pos.includes('admin') || /^(I|1|Golongan\s*I|Golongan\s*1|Grade\s*1)$/i.test(g)) divisor = 5;
  else if (/^(II|III|2|3|Golongan\s*II|Golongan\s*III|Golongan\s*2|Golongan\s*3)$/i.test(g)) divisor = 4;
  else if (/^(IV|4|Golongan\s*IV|Golongan\s*4)$/i.test(g)) divisor = 3.5;

  const raw = extraWorkDays / divisor;
  const floor = Math.floor(raw);
  const decimal = raw - floor;
  const earnedExtra = decimal > 0.5 ? floor + 1 : floor;

  const extraAvailable = (employee.extraLeaveBalance || 0) + (earnedExtra - usedExtra);
  const annualAvailable = (employee.annualLeaveBalance || 0) + (annualEntitlement - usedAnnual);

  return {
    extraAvailable,
    annualAvailable,
    earnedExtra,
    usedExtra,
    annualEntitlement,
    usedAnnual,
  };
}
