const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./pharmacy.db');

db.serialize(() => {
  const users = [
    ['user1', '1234', 'User One'],
    ['user2', '1234', 'User Two'],
    ['user3', '1234', 'User Three'],
    ['user4', '1234', 'User Four'],
    ['user5', '1234', 'User Five']
  ];

  const stmt = db.prepare(`INSERT INTO Users (username, password, fullName, role) VALUES (?, ?, ?, 'user')`);
  
  users.forEach((userData, index) => {
    stmt.run(userData, function(err) {
      if (err) {
        console.error(`เกิดข้อผิดพลาดในการสร้างบัญชี ${userData[0]}:`, err.message);
      } else {
        console.log(`สร้างบัญชี ${userData[0]} เรียบร้อยแล้ว`);
      }
    });
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