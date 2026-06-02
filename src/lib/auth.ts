import { Employee, UserRole, LeaveRequest } from '../types';

/**
 * Convert grade string to numeric level (1..6). 0 for unknown.
 * Accepts "1","I","Golongan I","Admin", etc.
 */
export function gradeNum(grade?: string): number {
  const s = (grade || '').trim().toUpperCase().replace(/^GOLONGAN\s+/, '');
  const map: Record<string, number> = {
    '1': 1, 'I': 1,
    '2': 2, 'II': 2,
    '3': 3, 'III': 3,
    '4': 4, 'IV': 4,
    '5': 5, 'V': 5,
    '6': 6, 'VI': 6,
  };
  return map[s] ?? 0;
}

/**
 * Resolve effective role:
 * - SUPERUSER tetap SUPERUSER
 * - isHrApprover === true → APPROVAL_HR (override; setara ADMIN + final approver)
 * - Jabatan mengandung "admin" → ADMIN
 * - Golongan II..VI (non-admin) → APPROVAL
 * - Selain itu → REGULAR
 */
export function resolveRole(emp: Pick<Employee, 'role' | 'position' | 'grade' | 'isHrApprover'>): UserRole {
  if (emp.role === 'SUPERUSER') return 'SUPERUSER';
  if (emp.isHrApprover) return 'APPROVAL_HR';
  const pos = (emp.position || '').toLowerCase();
  if (pos.includes('admin')) return 'ADMIN';
  const n = gradeNum(emp.grade);
  if (n >= 2 && n <= 6) return 'APPROVAL';
  return 'REGULAR';
}

export function canViewEmployee(viewer: Employee | null, target: Employee): boolean {
  if (!viewer) return false;
  if (viewer.role === 'SUPERUSER' || viewer.role === 'APPROVAL_HR') return true;
  if (viewer.role === 'ADMIN') return viewer.department === target.department;
  return viewer.id === target.id;
}

export function canSubmitLeaveFor(viewer: Employee | null, target: Employee): boolean {
  if (!viewer) return false;
  if (target.role === 'SUPERUSER' && viewer.id !== target.id) return false;
  if (viewer.role === 'SUPERUSER' || viewer.role === 'APPROVAL_HR') return true;
  if (viewer.role === 'ADMIN') return viewer.department === target.department;
  return viewer.id === target.id;
}

/** Apakah tahap supervisor (atasan langsung + atasan dari atasan) sudah selesai. */
export function supervisorStageDone(req: LeaveRequest): boolean {
  if (!req.directApprovedAt) return false;
  if (req.indirectSupervisorId && !req.indirectApprovedAt) return false;
  return true;
}
