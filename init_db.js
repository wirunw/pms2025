const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = process.env.DATABASE_URL || path.resolve(__dirname, 'pharmacy.db');
const db = new sqlite3.Database(dbPath);

// สร้างตารางหากยังไม่มี
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
      allergies TEXT,
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
      licenseNumber TEXT,
      position TEXT,
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
      password TEXT NOT NULL,
      fullName TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      isActive INTEGER DEFAULT 1,
      lastLogin TEXT,
      dateCreated TEXT DEFAULT CURRENT_TIMESTAMP,
      dateModified TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // เพิ่มบัญชี admin หากยังไม่มี
  db.get("SELECT * FROM Users WHERE username = 'admin'", (err, row) => {
    if (err) {
      console.error('Error checking admin user:', err.message);
    } else if (!row) {
      // ไม่มีบัญชี admin อยู่แล้ว ให้สร้างใหม่
      const stmt = db.prepare(`INSERT INTO Users (username, password, fullName, role) VALUES (?, ?, ?, ?)`);
      stmt.run(['admin', 'admin123', 'Administrator', 'admin'], function(err) {
        if (err) {
          console.error('Error creating admin user:', err.message);
        } else {
          console.log('Created admin user successfully');
          console.log('Username: admin');
          console.log('Password: admin123');
        }
      });
      stmt.finalize();
    } else {
      console.log('Admin user already exists');
    }
  });

  // เพิ่มข้อมูลตัวอย่างอื่นๆ หากต้องการ
  db.get("SELECT COUNT(*) as count FROM Members", (err, row) => {
    if (err) {
      console.error('Error checking members:', err.message);
    } else if (row.count === 0) {
      // เพิ่มข้อมูลตัวอย่าง Members
      const stmt = db.prepare(`
        INSERT INTO Members (memberId, fullName, nationalId, dob, phone, allergies, disease) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(['MEM001', 'สมชาย ใจดี', '1234567890123', '1980-05-15', '0812345678', '[]', 'ความดันโลหิตสูง']);
      stmt.finalize();
      console.log('Added sample member data');
    }
  });

  db.get("SELECT COUNT(*) as count FROM Formulary", (err, row) => {
    if (err) {
      console.error('Error checking formulary:', err.message);
    } else if (row.count === 0) {
      // เพิ่มข้อมูลตัวอย่าง Formulary
      const stmt = db.prepare(`
        INSERT INTO Formulary (drugId, tradeName, genericName, legalCategory, pharmaCategory, strength, unit, indication, caution) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(['DRG001', 'พาราเซตามอล', 'Paracetamol', 'ยาบรรจุเสร็จ', 'ยาแก้ปวด ลดไข้', '500mg', 'เม็ด', 'ลดไข้ แก้ปวด', 'ควรใช้พร้อมอาหาร']);
      stmt.finalize();
      console.log('Added sample drug data');
    }
  });
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err.message);
  } else {
    console.log('Database initialization completed!');
  }
});