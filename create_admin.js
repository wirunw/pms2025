const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./pharmacy.db');

db.serialize(() => {
  // สร้างบัญชี admin
  const stmt = db.prepare(`INSERT INTO Users (username, password, fullName, role) VALUES (?, ?, ?, ?)`);
  stmt.run(['admin', 'admin123', 'Administrator', 'admin'], function(err) {
    if (err) {
      console.error('เกิดข้อผิดพลาด:', err.message);
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