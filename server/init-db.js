// Setup awal: jalankan schema.sql + seed 3 akun default (Super, Admin, User).
// Pakai sekali setelah database `fluksite` dibuat: `npm run init-db`
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[init] Menjalankan schema.sql...');
  await pool.query(schema);

  const seeds = [
    { id: 'acc-super', email: 'super@gts.com', name: 'Super Admin', role: 'SUPERUSER', password: 'super123',
      profile: { nik: '-', grade: 'Admin', department: 'Management', position: 'Superuser', poh: 'HO', joinDate: new Date().toISOString().slice(0,10), nextLeaveDate: '' } },
    { id: 'acc-admin', email: 'admin@gts.com', name: 'Demo Admin', role: 'ADMIN', password: 'admin123',
      profile: { nik: '-', grade: '4', department: 'Plant', position: 'Admin Plant', poh: 'TERNATE', joinDate: new Date().toISOString().slice(0,10), nextLeaveDate: '' } },
    { id: 'acc-user', email: 'user@gts.com', name: 'Demo User', role: 'REGULAR', password: 'user123',
      profile: { nik: '-', grade: '6', department: 'Plant', position: 'Operator', poh: 'FLUK', joinDate: new Date().toISOString().slice(0,10), nextLeaveDate: '' } },
  ];

  for (const u of seeds) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO users (id, email, name, nik, role, password, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.email, u.name, u.profile.nik, u.role, hash, u.profile]
    );
    console.log(`[init] Seed user: ${u.email} / ${u.password}`);
  }

  console.log('[init] Selesai. Default login:');
  console.log('  super@gts.com / super123');
  console.log('  admin@gts.com / admin123');
  console.log('  user@gts.com  / user123');
  await pool.end();
}

main().catch((err) => {
  console.error('[init] Gagal:', err);
  process.exit(1);
});
