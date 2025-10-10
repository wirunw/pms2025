const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = process.env.DATABASE_URL || path.resolve(__dirname, 'pharmacy.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // สร้างบัญชี admin
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const stmt = db.prepare(`INSERT INTO Users (username, password, fullName, role, dateModified) VALUES (?, ?, ?, ?, ?)`);
  stmt.run(['admin', hashedPassword, 'Administrator', 'admin', new Date().toISOString()], function(err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        console.log('บัญชี admin มีอยู่แล้ว');
      } else {
        console.error('เกิดข้อผิดพลาด:', err.message);
      }
    } else {
      console.log('สร้างบัญชี admin เรียบร้อยแล้ว');
      console.log('Username: admin');
      console.log('Password: admin123');
    }
  });
  stmt.finalize();
});

db.close((err) => {
  if (err) {
    console.error('เกิดข้อผิดพลาด:', err.message);
  } else {
    console.log('ปิดฐานข้อมูลเรียบร้อยแล้ว');
  }
});