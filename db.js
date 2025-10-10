const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// สร้างหรือเปิดฐานข้อมูล
const rawDbPath = process.env.DATABASE_URL;
let dbPath = rawDbPath || path.resolve(__dirname, 'pharmacy.db');

if (rawDbPath && rawDbPath.startsWith('file:')) {
  dbPath = rawDbPath;
}

if (rawDbPath && rawDbPath.startsWith('sqlite://')) {
  dbPath = rawDbPath.replace('sqlite://', '');
}

const isFileUri = dbPath.startsWith('file:');
const openMode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | (isFileUri ? sqlite3.OPEN_URI : 0);

const db = new sqlite3.Database(dbPath, openMode, (err) => {
  if (err) {
    console.error('เกิดข้อผิดพลาดในการเปิดฐานข้อมูล:', err.message);
  } else {
    console.log(`เชื่อมต่อฐานข้อมูล SQLite สำเร็จที่ ${dbPath}`);
  }
});

// สร้างตาราง Members
db.serialize(() => {
  // สร้างตาราง Members
  db.run(`
    CREATE TABLE IF NOT EXISTS Members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memberId TEXT UNIQUE NOT NULL,
      fullName TEXT NOT NULL,
      nationalId TEXT,
      dob TEXT,
      phone TEXT,
      allergies TEXT, -- JSON string
      disease TEXT,
      dateCreated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // สร้างตาราง Formulary (ยา)
  db.run(`
    CREATE TABLE IF NOT EXISTS Formulary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drugId TEXT UNIQUE NOT NULL,
      tradeName TEXT NOT NULL,
      genericName TEXT,
      legalCategory TEXT,
      pharmaCategory TEXT,
      strength TEXT,
      unit TEXT,
      indication TEXT,
      caution TEXT,
      imageUrl TEXT,
      interaction1 TEXT,
      interaction2 TEXT,
      interaction3 TEXT,
      interaction4 TEXT,
      interaction5 TEXT,
      minStock INTEGER DEFAULT 0,
      maxStock INTEGER DEFAULT 0,
      dateCreated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // สร้างตาราง Inventory
  db.run(`
    CREATE TABLE IF NOT EXISTS Inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventoryId TEXT UNIQUE NOT NULL,
      drugId TEXT NOT NULL,
      lotNumber TEXT NOT NULL,
      expiryDate TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      costPrice REAL NOT NULL,
      sellingPrice REAL NOT NULL,
      referenceId TEXT,
      barcode TEXT,
      dateReceived TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drugId) REFERENCES Formulary (drugId)
    )
  `);

  // สร้างตาราง Sales
  db.run(`
    CREATE TABLE IF NOT EXISTS Sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saleId TEXT UNIQUE NOT NULL,
      saleDate TEXT DEFAULT CURRENT_TIMESTAMP,
      memberId TEXT,
      pharmacist TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      inventoryId TEXT NOT NULL,
      quantitySold INTEGER NOT NULL,
      pricePerUnit REAL NOT NULL,
      drugId TEXT NOT NULL,
      lotNumber TEXT NOT NULL,
      FOREIGN KEY (inventoryId) REFERENCES Inventory (inventoryId),
      FOREIGN KEY (drugId) REFERENCES Formulary (drugId)
    )
  `);

  // สร้างตาราง Staff (เภสัชกร/เจ้าหน้าที่)
  db.run(`
    CREATE TABLE IF NOT EXISTS Staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staffId TEXT UNIQUE NOT NULL,
      fullName TEXT NOT NULL,
      licenseNumber TEXT, -- ใบประกอบวิชาชีพ
      position TEXT, -- ตำแหน่ง
      phone TEXT,
      email TEXT,
      dateCreated TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // สร้างตาราง Users (ผู้ใช้งานระบบ)
  db.run(`
    CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, -- ควรเก็บเป็น hash ในการใช้งานจริง
      fullName TEXT NOT NULL,
      role TEXT DEFAULT 'user', -- 'admin' หรือ 'user'
      isActive INTEGER DEFAULT 1, -- 1 สำหรับ active, 0 สำหรับ inactive
      lastLogin TEXT,
      dateCreated TEXT DEFAULT CURRENT_TIMESTAMP,
      dateModified TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // สร้างตาราง RefreshTokens (สำหรับระบบ authentication)
  db.run(`
    CREATE TABLE IF NOT EXISTS RefreshTokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      token TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES Users (id)
    )
  `);

  // ตารางสำหรับบันทึกกิจกรรมของระบบ
  db.run(`
    CREATE TABLE IF NOT EXISTS ActivityLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activityType TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      description TEXT,
      performedBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('สร้างตารางฐานข้อมูลเรียบร้อยแล้ว');
});

module.exports = { db, dbPath };
