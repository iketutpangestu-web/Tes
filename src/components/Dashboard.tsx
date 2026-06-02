import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Ship, Calendar, UserCheck, AlertTriangle, Plane, PlaneLanding, Edit2, X, Download, Settings } from 'lucide-react';
import { format, addDays, getDay } from 'date-fns';
import * as XLSX from 'xlsx';
import { calculateTimesheet } from '../lib/roster';
import { BOAT_SCHEDULE, DEFAULT_BOAT_TIMES, BoatDay, Employee } from '../types';
import type { DayActivity } from '../lib/roster';

type TravelKind = 'speedboatOut' | 'flightOut' | 'flightIn' | 'speedboatIn' | null;

const FN_OUT = 'Travel Perjalanan Dari Site';
const FN_IN = 'Travel Perjalanan Ke Site';

function classifyTravel(
  poh: string,
  prev: DayActivity | undefined,
  today: DayActivity | undefined,
  next: DayActivity | undefined,
): TravelKind {
  const p = (poh || '').toUpperCase();
  if (p === 'FLUK') return null;
  const isOut = (a?: DayActivity) => a?.function === FN_OUT;
  const isIn = (a?: DayActivity) => a?.function === FN_IN;
  if (isOut(today)) {
    if (p === 'TERNATE') return 'speedboatOut';
    return isOut(prev) ? 'flightOut' : 'speedboatOut';
  }
  if (isIn(today)) {
    if (p === 'TERNATE') return 'speedboatIn';
    return isIn(next) ? 'flightIn' : 'speedboatIn';
  }
  return null;
}

function isOnSiteFn(fn?: string): boolean {
  if (!fn) return false;
  return /kerja|penyesuaian/i.test(fn);
}

function isOnLeaveFn(fn?: string): boolean {
  if (!fn) return false;
  if (/travel/i.test(fn)) return false;
  if (isOnSiteFn(fn)) return false;
  return true;
}

export default function Dashboard() {
  const { user, employees, leaveRequests, customSymbols, overrides, boatOverrides, setBoatOverride, leavePreviewDays } = useApp();

  // Superuser dapat memfilter dashboard per departemen
  const [deptFilter, setDeptFilter] = useState<string>('ALL');

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { if (e.department) set.add(e.department); });
    return Array.from(set).sort();
  }, [employees]);

  // Admin sees only own department; Superuser optionally filters by department
  const scoped = useMemo(() => {
    if (user?.role === 'ADMIN') return employees.filter(e => e.department === user.department);
    if (user?.role === 'SUPERUSER' && deptFilter !== 'ALL') {
      return employees.filter(e => e.department === deptFilter);
    }
    return employees;
  }, [employees, user, deptFilter]);

  const today = useMemo(() => new Date(), []);
  const todayStr = format(today, 'yyyy-MM-dd');
  const yesterdayStr = useMemo(() => format(addDays(today, -1), 'yyyy-MM-dd'), [today]);
  const tomorrowStr = useMemo(() => format(addDays(today, 1), 'yyyy-MM-dd'), [today]);

  const todayActivities = useMemo(() => {
    return scoped.map(emp => {
      const ts = calculateTimesheet(emp, yesterdayStr, tomorrowStr, leaveRequests, customSymbols, overrides);
      const prev = ts[0], activity = ts[1], next = ts[2];
      const travel = classifyTravel(emp.poh || '', prev, activity, next);
      return { emp, activity, travel };
    });
  }, [scoped, yesterdayStr, tomorrowStr, leaveRequests, customSymbols, overrides]);

  const onSiteList = todayActivities.filter(({ activity }) => isOnSiteFn(activity?.function));
  const onLeaveList = todayActivities.filter(({ activity }) => isOnLeaveFn(activity?.function));
  const speedboatOutList = todayActivities.filter(({ travel }) => travel === 'speedboatOut');
  const flightOutList = todayActivities.filter(({ travel }) => travel === 'flightOut');
  const flightInList = todayActivities.filter(({ travel }) => travel === 'flightIn');
  const speedboatInList = todayActivities.filter(({ travel }) => travel === 'speedboatIn');

  type DetailRow = { name: string; nik: string; department: string; positionGrade: string; info: string };
  const empMeta = (emp: Employee) => ({
    department: emp.department || '-',
    positionGrade: `${emp.position || '-'}${emp.grade ? ` (${emp.grade})` : ''}`,
  });
  const onLeaveRows: DetailRow[] = onLeaveList.map(({ emp, activity }) => ({
    name: emp.name, nik: emp.nik || '-', ...empMeta(emp),
    info: activity?.symbol || activity?.function || '-',
  }));
  const mkRow = (label: string) => ({ emp }: { emp: Employee }) => ({
    name: emp.name, nik: emp.nik || '-', ...empMeta(emp), info: label,
  });
  const speedboatOutRows: DetailRow[] = speedboatOutList.map(mkRow('Speedboat Out'));
  const flightOutRows: DetailRow[] = flightOutList.map(mkRow('Flight Out'));
  const flightInRows: DetailRow[] = flightInList.map(mkRow('Flight In'));
  const speedboatInRows: DetailRow[] = speedboatInList.map(mkRow('Speedboat In'));
  const onSiteRows: DetailRow[] = onSiteList.map(({ emp, activity }) => ({
    name: emp.name,
    nik: emp.nik || '-',
    ...empMeta(emp),
    info: (() => {
      const sym = activity?.symbol || '-';
      const fn = activity?.function || '';
      if (/kelebihan/i.test(fn)) return `${sym} (kelebihan kerja)`;
      return sym;
    })(),
  }));
  const scopedIdSet = useMemo(() => new Set(scoped.map(e => e.id)), [scoped]);
  const scopedLeaveRequests = useMemo(
    () => (user?.role === 'ADMIN' ? leaveRequests.filter(r => scopedIdSet.has(r.employeeId)) : leaveRequests),
    [leaveRequests, scopedIdSet, user]
  );
  const pendingRows: DetailRow[] = scopedLeaveRequests.filter(r => r.status === 'PENDING').map(r => {
    const emp = employees.find(e => e.id === r.employeeId);
    return {
      name: emp?.name || '-',
      nik: emp?.nik || '-',
      department: emp?.department || '-',
      positionGrade: `${emp?.position || '-'}${emp?.grade ? ` (${emp.grade})` : ''}`,
      info: `${r.type} (${r.startDate} → ${r.endDate})`,
    };
  });

  // Karyawan yang akan Cuti Roster dalam N hari ke depan (berdasarkan timesheet)
  const upcomingLeaveRows: DetailRow[] = useMemo(() => {
    const N = Math.max(1, leavePreviewDays || 3);
    const startStr = format(addDays(today, 1), 'yyyy-MM-dd');
    const endStr = format(addDays(today, N), 'yyyy-MM-dd');
    const rows: { emp: Employee; date: string; days: number; fn: string }[] = [];
    for (const emp of scoped) {
      const ts = calculateTimesheet(emp, startStr, endStr, leaveRequests, customSymbols, overrides);
      const isFluk = (emp.poh || '').toUpperCase() === 'FLUK';
      for (const day of ts) {
        if (!day) continue;
        const fn = day.function || '';
        const sym = (day.symbol || '').toUpperCase();
        // Hanya tangkap AWAL siklus cuti, bukan hari di tengah cuti:
        // - FLUK: hari pertama Cuti Roster = Cr1
        // - Non-FLUK: hari TV Out (Travel Perjalanan Dari Site)
        const match = isFluk
          ? (sym === 'CR1' && /^Cuti Roster/i.test(fn))
          : fn === FN_OUT;
        if (match) {
          const days = Math.max(1, Math.ceil((new Date(day.date).getTime() - today.getTime()) / 86400000));
          rows.push({ emp, date: day.date, days, fn: isFluk ? 'Cr1' : 'TV Out' });
          break;
        }
      }
    }
    return rows
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({
        name: r.emp.name,
        nik: r.emp.nik || '-',
        ...empMeta(r.emp),
        info: `${r.date} (${r.fn}) — H-${r.days}`,
      }));
  }, [scoped, leaveRequests, customSymbols, overrides, today, leavePreviewDays]);

  type StatCard = {
    label: string; value: number; icon: typeof UserCheck;
    color: string; bg: string; rows?: DetailRow[]; rowHeader?: string;
  };
  const stats: StatCard[] = [
    { label: 'On-Site Personnel', value: onSiteList.length, icon: UserCheck, color: 'text-blue-600', bg: 'bg-blue-50', rows: onSiteRows, rowHeader: 'Aktivitas' },
    { label: 'On-Leave Today', value: onLeaveRows.length, icon: Calendar, color: 'text-green-600', bg: 'bg-green-50', rows: onLeaveRows, rowHeader: 'Keterangan' },
    { label: 'Speedboat Out', value: speedboatOutRows.length, icon: Ship, color: 'text-red-600', bg: 'bg-red-50', rows: speedboatOutRows, rowHeader: 'Status' },
    { label: 'Flight Out', value: flightOutRows.length, icon: Plane, color: 'text-orange-600', bg: 'bg-orange-50', rows: flightOutRows, rowHeader: 'Status' },
    { label: 'Flight In', value: flightInRows.length, icon: PlaneLanding, color: 'text-indigo-700', bg: 'bg-indigo-50', rows: flightInRows, rowHeader: 'Status' },
    { label: 'Speedboat In', value: speedboatInRows.length, icon: Ship, color: 'text-blue-700', bg: 'bg-blue-50', rows: speedboatInRows, rowHeader: 'Status' },
    { label: 'Cuti Terdekat', value: upcomingLeaveRows.length, icon: Calendar, color: 'text-emerald-600', bg: 'bg-emerald-50', rows: upcomingLeaveRows, rowHeader: `H-${leavePreviewDays}..H-1` },
    { label: 'Pending Approval', value: pendingRows.length, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', rows: pendingRows, rowHeader: 'Request' },
  ];

  // Next 4 boat sailings starting today
  const sailings = useMemo(() => {
    const out: {
      date: Date; dateStr: string; time: string;
      speedboatOut: string[]; flightOut: string[];
      flightIn: string[]; speedboatIn: string[];
    }[] = [];
    let cur = new Date(today);
    while (out.length < 4) {
      const dow = getDay(cur);
      if (BOAT_SCHEDULE.includes(dow as BoatDay)) {
        const dateStr = format(cur, 'yyyy-MM-dd');
        const prevStr = format(addDays(cur, -1), 'yyyy-MM-dd');
        const nextStr = format(addDays(cur, 1), 'yyyy-MM-dd');
        const override = boatOverrides.find(o => o.date === dateStr);
        const time = override?.time || DEFAULT_BOAT_TIMES[dow] || '08:00';
        const speedboatOut: string[] = [];
        const flightOut: string[] = [];
        const flightIn: string[] = [];
        const speedboatIn: string[] = [];
        scoped.forEach(emp => {
          const poh = (emp.poh || '').toUpperCase();
          if (poh === 'FLUK') return;
          const ts = calculateTimesheet(emp, prevStr, nextStr, leaveRequests, customSymbols, overrides);
          const kind = classifyTravel(poh, ts[0], ts[1], ts[2]);
          if (kind === 'speedboatOut') speedboatOut.push(emp.name);
          else if (kind === 'flightOut') flightOut.push(emp.name);
          else if (kind === 'flightIn') flightIn.push(emp.name);
          else if (kind === 'speedboatIn') speedboatIn.push(emp.name);
        });
        speedboatOut.sort(); flightOut.sort(); flightIn.sort(); speedboatIn.sort();
        out.push({ date: new Date(cur), dateStr, time, speedboatOut, flightOut, flightIn, speedboatIn });
      }
      cur = addDays(cur, 1);
    }
    return out;
  }, [today, boatOverrides, scoped, leaveRequests, customSymbols, overrides]);

  // All boat dates within next 30 days (for time manager modal)
  const monthBoatDates = useMemo(() => {
    const arr: { date: Date; dateStr: string; dow: number; defaultTime: string; overrideTime?: string }[] = [];
    for (let i = 0; i < 30; i++) {
      const d = addDays(today, i);
      const dow = getDay(d);
      if (BOAT_SCHEDULE.includes(dow as BoatDay)) {
        const dateStr = format(d, 'yyyy-MM-dd');
        const ov = boatOverrides.find(o => o.date === dateStr);
        arr.push({
          date: d, dateStr, dow,
          defaultTime: DEFAULT_BOAT_TIMES[dow] || '08:00',
          overrideTime: ov?.time,
        });
      }
    }
    return arr;
  }, [today, boatOverrides]);

  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null); // key: `${dateStr}:out|in`
  const [openStat, setOpenStat] = useState<number | null>(null);
  const [showBoatManager, setShowBoatManager] = useState(false);
  const [draftTimes, setDraftTimes] = useState<Record<string, string>>({});

  const exportStat = (stat: StatCard) => {
    if (!stat.rows) return;
    const data = stat.rows.map((r, idx) => ({
      No: idx + 1, Nama: r.name, NIK: r.nik,
      Departemen: r.department, Jabatan: r.positionGrade,
      [stat.rowHeader || 'Info']: r.info,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, stat.label.slice(0, 28));
    const fname = `${stat.label.replace(/[^\w]+/g, '_')}_${todayStr}.xlsx`;
    XLSX.writeFile(wb, fname);
  };

  return (
    <>
    <div className="space-y-8">
      {user?.role === 'SUPERUSER' && (
        <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-[var(--line)] shadow-sm">
          <label className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
            Filter Departemen
          </label>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="ALL">Semua Departemen</option>
            {departmentOptions.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          {deptFilter !== 'ALL' && (
            <span className="text-[10px] text-gray-500">
              Menampilkan {scoped.length} karyawan
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3 md:gap-4">
        {stats.map((stat, i) => {
          const clickable = !!stat.rows;
          return (
            <button
              key={i}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && setOpenStat(i)}
              className={`text-left bg-white p-3 md:p-5 rounded-2xl border border-[var(--line)] shadow-sm transition-shadow ${clickable ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex justify-between items-start mb-2 md:mb-3">
                <div className={`p-2 rounded-xl ${stat.bg} ${stat.color}`}><stat.icon size={18} /></div>
                <span className="text-[10px] font-bold text-gray-400">#{i+1}</span>
              </div>
              <p className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{stat.value}</p>
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mt-1">{stat.label}</h3>
            </button>
          );
        })}
      </div>

      {openStat !== null && stats[openStat].rows && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenStat(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-gray-900">{stats[openStat].label}</h4>
                <p className="text-[10px] text-gray-400 font-medium">{stats[openStat].rows!.length} orang • {todayStr}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => exportStat(stats[openStat]!)}
                  title="Export ke Excel"
                  className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50"
                >
                  <Download size={12} />
                </button>
                <button
                  onClick={() => setOpenStat(null)}
                  title="Tutup"
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              {stats[openStat].rows!.length === 0 ? (
                <p className="p-8 text-center text-xs text-gray-400 italic">Tidak ada data.</p>
              ) : (
                <>
                {/* Mobile card list */}
                <ul className="sm:hidden divide-y divide-gray-100">
                  {stats[openStat].rows!.map((r, idx) => (
                    <li key={idx} className="p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-bold text-gray-900 text-sm">{idx + 1}. {r.name}</p>
                        <span className="font-mono text-[10px] text-gray-500">{r.nik}</span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1">{r.department}</p>
                      <p className="text-[11px] text-gray-600">{r.positionGrade}</p>
                      <p className="text-[11px] text-gray-700 mt-1"><span className="font-semibold">{stats[openStat].rowHeader}:</span> {r.info}</p>
                    </li>
                  ))}
                </ul>
                {/* Desktop table */}
                <table className="w-full text-xs hidden sm:table">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-[9px] uppercase tracking-wider text-gray-500 font-black">
                      <th className="text-left px-4 py-2 w-8">#</th>
                      <th className="text-left px-2 py-2">Nama</th>
                      <th className="text-left px-2 py-2">NIK</th>
                      <th className="text-left px-2 py-2">Departemen</th>
                      <th className="text-left px-2 py-2">Jabatan</th>
                      <th className="text-left px-2 py-2">{stats[openStat].rowHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats[openStat].rows!.map((r, idx) => (
                      <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-400">{idx + 1}</td>
                        <td className="px-2 py-2 font-bold text-gray-900">{r.name}</td>
                        <td className="px-2 py-2 font-mono text-gray-600">{r.nik}</td>
                        <td className="px-2 py-2 text-gray-700">{r.department}</td>
                        <td className="px-2 py-2 text-gray-700">{r.positionGrade}</td>
                        <td className="px-2 py-2 text-gray-700">{r.info}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Recent Leave Requests</h3>
          <div className="bg-white rounded-2xl border border-[var(--line)] overflow-hidden shadow-sm">
            {scopedLeaveRequests.length > 0 ? (
              scopedLeaveRequests.slice(0, 6).map((req) => {
                const emp = employees.find(e => e.id === req.employeeId);
                return (
                  <div key={req.id} className="flex items-center justify-between p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-bold text-xs text-gray-600">
                        {emp?.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{emp?.name}</p>
                        <p className="text-[10px] text-gray-500 uppercase font-medium">
                          {req.type}
                          {req.submittedByName && (
                            <span className="ml-2 text-amber-600">• by {req.submittedByName}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-gray-400">{req.startDate} - {req.endDate}</p>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        req.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        req.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>{req.status}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-12 text-center text-gray-400 italic text-sm">No recent requests.</div>
            )}
          </div>
        </div>

        <div className="bg-[var(--sidebar)] text-white p-8 rounded-3xl relative overflow-hidden shadow-xl">
          <Ship size={160} className="absolute -right-12 -bottom-12 opacity-10 rotate-12" />
          <div className="flex items-center justify-between mb-6 relative z-10">
            <h3 className="text-sm font-bold uppercase tracking-widest">Next Boat Travel</h3>
            <button
              type="button"
              onClick={() => {
                const init: Record<string, string> = {};
                monthBoatDates.forEach(d => { init[d.dateStr] = d.overrideTime || d.defaultTime; });
                setDraftTimes(init);
                setShowBoatManager(true);
              }}
              title="Atur jam boat 1 bulan"
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-white/10 hover:bg-white/20 px-2 py-1 rounded-md"
            >
              <Settings size={11} /> Atur Jam
            </button>
          </div>

          <div className="space-y-4 relative z-10">
            {sailings.map((s) => {
              const dayLabel = format(s.date, 'EEE').toUpperCase();
              const dateLabel = format(s.date, 'dd MMM');
              const isEditing = editingDate === s.dateStr;
              return (
                <div key={s.dateStr} className="border-b border-white/10 pb-3 last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                      <div>
                        <p className="text-xs font-bold tracking-widest">{dayLabel}</p>
                        <p className="text-[9px] text-gray-400">{dateLabel}</p>
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                          className="bg-white/10 text-white text-[10px] font-mono px-1 py-0.5 rounded border border-white/20 w-20" />
                        <button onClick={() => { setBoatOverride(s.dateStr, editTime); setEditingDate(null); }}
                          className="text-[9px] font-black bg-blue-500 px-2 py-1 rounded">OK</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingDate(s.dateStr); setEditTime(s.time); }}
                        className="text-[10px] text-gray-300 font-mono hover:text-white flex items-center gap-1">
                        {s.time} WIT <Edit2 size={9} />
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 ml-5 flex flex-col gap-1 text-[9px] font-bold uppercase tracking-wider">
                    {([
                      { key: 'speedboatOut', label: 'Speedboat Out', names: s.speedboatOut, cls: 'text-red-300 hover:text-red-200' },
                      { key: 'flightOut', label: 'Flight Out', names: s.flightOut, cls: 'text-orange-300 hover:text-orange-200' },
                      { key: 'flightIn', label: 'Flight In', names: s.flightIn, cls: 'text-indigo-300 hover:text-indigo-200' },
                      { key: 'speedboatIn', label: 'Speedboat In', names: s.speedboatIn, cls: 'text-blue-300 hover:text-blue-200' },
                    ] as const).map(({ key, label, names, cls }) => {
                      const k = `${s.dateStr}:${key}`;
                      return (
                        <div key={key}>
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === k ? null : k)}
                            className={`${cls} underline-offset-2 hover:underline`}
                          >
                            {label}: {names.length}
                          </button>
                          {expanded === k && (
                            <div className="mt-1 bg-white/5 rounded-lg p-2 normal-case tracking-normal font-medium text-[10px] text-gray-100 max-h-40 overflow-y-auto">
                              {names.length ? (
                                <ul className="space-y-0.5">
                                  {names.map((n: string) => <li key={n}>• {n}</li>)}
                                </ul>
                              ) : <p className="text-gray-400 italic">Tidak ada</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 bg-white/5 p-3 rounded-xl relative z-10">
            <p className="text-[9px] uppercase tracking-widest text-gray-400 leading-relaxed font-medium">
              Manual Check Weather Advisory<br />Mandatory before departure
            </p>
          </div>
        </div>
      </div>
    </div>
    {showBoatManager && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowBoatManager(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div>
              <h4 className="text-sm font-black uppercase tracking-wider text-gray-900">Atur Jam Boat</h4>
              <p className="text-[10px] text-gray-400 font-medium">30 hari ke depan • {monthBoatDates.length} jadwal</p>
            </div>
            <button onClick={() => setShowBoatManager(false)} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100">
              <X size={14} />
            </button>
          </div>
          <div className="overflow-y-auto p-4 space-y-2">
            {monthBoatDates.map(d => {
              const draft = draftTimes[d.dateStr] ?? (d.overrideTime || d.defaultTime);
              const isOverridden = !!d.overrideTime;
              return (
                <div key={d.dateStr} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                  <div className="flex-1">
                    <p className="text-xs font-bold text-gray-900">{format(d.date, 'EEE, dd MMM yyyy')}</p>
                    <p className="text-[10px] text-gray-400 font-mono">
                      Default {d.defaultTime} {isOverridden && <span className="text-amber-600">• override aktif</span>}
                    </p>
                  </div>
                  <input
                    type="time"
                    value={draft}
                    onChange={(e) => setDraftTimes(prev => ({ ...prev, [d.dateStr]: e.target.value }))}
                    className="text-xs font-mono px-2 py-1 rounded border border-gray-200 w-24"
                  />
                  <button
                    onClick={() => setBoatOverride(d.dateStr, draft)}
                    className="text-[10px] font-black bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                  >
                    Simpan
                  </button>
                  <button
                    onClick={() => {
                      setBoatOverride(d.dateStr, '');
                      setDraftTimes(prev => ({ ...prev, [d.dateStr]: d.defaultTime }));
                    }}
                    title="Reset ke default"
                    className="text-[10px] font-bold text-gray-500 hover:text-gray-900 px-1"
                  >
                    Reset
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
