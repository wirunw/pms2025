const express = require('express');
const cors = require('cors');
const { db, dbPath } = require('./db');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const bcrypt = require('bcryptjs'); // เพิ่ม module สำหรับ hashing รหัสผ่าน
const jwt = require('jsonwebtoken'); // เพิ่ม module สำหรับ JWT
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text({ type: 'text/plain' }));
// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// คีย์ลับสำหรับ JWT (ควรเก็บใน environment variable ในการใช้งานจริง)
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

// ฟังก์ชันช่วยในการ query ฐานข้อมูล
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// ฟังก์ชันช่วยในการ execute คำสั่ง INSERT/UPDATE/DELETE
function runStatement(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ changes: this.changes, lastID: this.lastID });
      }
    });
  });
}

// สร้าง ID แบบ UUID
function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getPeriodRange(period) {
  const now = new Date();
  now.setMilliseconds(0);
  now.setSeconds(0);

  const start = new Date(now);
  const end = new Date(now);

  switch (period) {
    case 'daily':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'weekly': {
      const day = start.getDay();
      const diff = (day === 0 ? -6 : 1) - day; // เริ่มสัปดาห์ที่วันจันทร์
      start.setDate(start.getDate() + diff);
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'monthly':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime());
      end.setMonth(start.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'yearly':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime());
      end.setFullYear(start.getFullYear() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      return null;
  }

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function resolveDbFilePath(rawPath) {
  if (!rawPath) {
    return null;
  }

  if (rawPath.startsWith('file:')) {
    try {
      return fileURLToPath(new URL(rawPath));
    } catch (error) {
      try {
        const sanitized = rawPath.split('?')[0];
        if (sanitized.startsWith('file://')) {
          return sanitized.replace('file://', '');
        }
        if (sanitized.startsWith('file:')) {
          return sanitized.replace('file:', '');
        }
      } catch (innerError) {
        console.error('ไม่สามารถแปลงเส้นทางฐานข้อมูลได้:', innerError.message);
      }
    }
  }

  return rawPath;
}

const resolvedDbFilePath = resolveDbFilePath(dbPath);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'ไม่มี token สำหรับการเข้าถึง' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'token ไม่ถูกต้อง' });
    }
    req.user = user;
    next();
  });
};

async function logActivity(activityType, description, { entity = null, entityId = null, performedBy = null } = {}) {
  try {
    await runStatement(
      `INSERT INTO ActivityLog (activityType, entity, entityId, description, performedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        activityType,
        entity,
        entityId,
        description,
        performedBy,
        new Date().toISOString()
      ]
    );
  } catch (error) {
    console.error('บันทึกกิจกรรมล้มเหลว:', error.message);
  }
}

// API สำหรับ Member
app.get('/api/members', authenticateToken, async (req, res) => {
  try {
    const members = await runQuery('SELECT * FROM Members ORDER BY fullName');
    // แปลง JSON string ใน field allergies ให้เป็น array
    const processedMembers = members.map(member => {
      let allergies = [];
      try {
        if (member.allergies) {
          allergies = JSON.parse(member.allergies);
        }
      } catch (e) {
        // หากไม่สามารถ parse JSON ได้ ให้ใช้ array ว่าง
      }
      return {
        ...member,
        allergies
      };
    });
    res.json(processedMembers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/member/:memberId', authenticateToken, async (req, res) => {
  try {
    const memberId = req.params.memberId;
    const member = await runQuery('SELECT * FROM Members WHERE memberId = ?', [memberId]);
    if (member.length > 0) {
      let allergies = [];
      try {
        if (member[0].allergies) {
          allergies = JSON.parse(member[0].allergies);
        }
      } catch (e) {
        // หากไม่สามารถ parse JSON ได้ ให้ใช้ array ว่าง
      }
      res.json({
        ...member[0],
        allergies
      });
    } else {
      res.status(404).json({ error: 'Member not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/members', authenticateToken, async (req, res) => {
  try {
    const term = req.query.term;
    if (!term || term.length < 2) {
      return res.json([]);
    }
    const members = await runQuery(
      'SELECT * FROM Members WHERE fullName LIKE ? OR phone LIKE ?', 
      [`%${term}%`, `%${term}%`]
    );
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    const memberId = generateId();
    await runStatement(
      'INSERT INTO Members (memberId, fullName, nationalId, dob, phone, allergies, disease, dateCreated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        memberId,
        payload.fullName,
        payload.nationalId,
        payload.dob,
        payload.phone,
        payload.allergies,
        payload.disease,
        new Date().toISOString()
      ]
    );
    res.json({ status: 'success', memberId });
    await logActivity('MEMBER_CREATE', `เพิ่มสมาชิกใหม่: ${payload.fullName || memberId}`, {
      entity: 'Member',
      entityId: memberId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Formulary (ยา)
app.get('/api/drugs', authenticateToken, async (req, res) => {
  try {
    const drugs = await runQuery('SELECT * FROM Formulary ORDER BY tradeName');
    res.json(drugs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/drugs', authenticateToken, async (req, res) => {
  try {
    const term = req.query.term;
    if (!term || term.length < 2) {
      return res.json([]);
    }
    const drugs = await runQuery(
      'SELECT * FROM Formulary WHERE tradeName LIKE ? OR genericName LIKE ?',
      [`%${term}%`, `%${term}%`]
    );
    res.json(drugs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/drugs', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    await runStatement(
      `INSERT INTO Formulary
      (drugId, tradeName, genericName, legalCategory, pharmaCategory, strength, unit,
       indication, caution, imageUrl, interaction1, interaction2, interaction3, interaction4, 
       interaction5, minStock, maxStock, dateCreated) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.drugId, payload.tradeName, payload.genericName, payload.legalCategory,
        payload.pharmaCategory, payload.strength, payload.unit, payload.indication,
        payload.caution, payload.imageUrl, payload.interaction1, payload.interaction2,
        payload.interaction3, payload.interaction4, payload.interaction5,
        payload.minStock, payload.maxStock, new Date().toISOString()
      ]
    );
    res.json({ status: 'success' });
    await logActivity('FORMULARY_CREATE', `เพิ่มยา ${payload.tradeName || payload.drugId}`, {
      entity: 'Formulary',
      entityId: payload.drugId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/drugs', authenticateToken, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const uniqueIds = [...new Set(ids.filter(id => typeof id === 'string' && id.trim() !== ''))];

  if (uniqueIds.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกรายการยาที่ต้องการลบอย่างน้อย 1 รายการ' });
  }

  const deleted = [];
  const blocked = [];
  let inTransaction = false;

  try {
    await runStatement('BEGIN TRANSACTION');
    inTransaction = true;

    for (const drugId of uniqueIds) {
      const records = await runQuery('SELECT drugId, tradeName FROM Formulary WHERE drugId = ?', [drugId]);
      if (records.length === 0) {
        blocked.push({ drugId, reason: 'ไม่พบรายการยาในระบบ' });
        continue;
      }

      const [{ tradeName }] = records;
      const saleUsage = await runQuery('SELECT COUNT(*) as count FROM Sales WHERE drugId = ?', [drugId]);
      const saleCount = saleUsage[0]?.count || 0;

      if (saleCount > 0) {
        blocked.push({ drugId, tradeName, reason: `มีประวัติการขาย ${saleCount} รายการ` });
        continue;
      }

      await runStatement('DELETE FROM Inventory WHERE drugId = ?', [drugId]);
      const result = await runStatement('DELETE FROM Formulary WHERE drugId = ?', [drugId]);

      if (result.changes > 0) {
        deleted.push({ drugId, tradeName });
        await logActivity('FORMULARY_DELETE', `ลบยา ${tradeName || drugId}`, {
          entity: 'Formulary',
          entityId: drugId,
          performedBy: req.user?.username || null
        });
      } else {
        blocked.push({ drugId, tradeName, reason: 'ไม่สามารถลบรายการได้' });
      }
    }

    await runStatement('COMMIT');
    inTransaction = false;

    res.json({ deleted, blocked });
  } catch (error) {
    if (inTransaction) {
      try {
        await runStatement('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError.message);
      }
    }
    console.error('Delete drugs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Inventory
app.get('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const inventory = await runQuery('SELECT * FROM Inventory');
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/summary', authenticateToken, async (req, res) => {
  try {
    // ดึงข้อมูล inventory ที่มี quantity > 0
    const inventory = await runQuery('SELECT * FROM Inventory WHERE quantity > 0');
    // ดึงข้อมูล formulary เพื่อใช้ชื่อยา
    const formulary = await runQuery('SELECT drugId, tradeName, genericName FROM Formulary');
    
    // สร้าง map สำหรับชื่อยา
    const formularyMap = {};
    formulary.forEach(drug => {
      formularyMap[drug.drugId] = drug;
    });
    
    // จัดกลุ่มตาม drugId และคำนวณสรุป
    const summary = {};
    inventory.forEach(item => {
      const drugInfo = formularyMap[item.drugId];
      if (drugInfo) {
        const key = item.drugId;
        if (!summary[key]) {
          summary[key] = {
            'ชื่อยา': `${drugInfo.tradeName} (${drugInfo.genericName})`,
            'จำนวนคงเหลือรวม': 0,
            'Lot ที่ใกล้หมดอายุก่อน': '-',
            'วันหมดอายุ': null
          };
        }
        summary[key]['จำนวนคงเหลือรวม'] += Number(item.quantity) || 0;
        const itemExpiry = new Date(item.expiryDate);
        if (!summary[key]['วันหมดอายุ'] || itemExpiry < new Date(summary[key]['วันหมดอายุ'])) {
          summary[key]['วันหมดอายุ'] = item.expiryDate;
          summary[key]['Lot ที่ใกล้หมดอายุก่อน'] = item.lotNumber;
        }
      }
    });
    
    res.json(Object.values(summary).sort((a,b) => a['ชื่อยา'].localeCompare(b['ชื่อยา'])));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/available-drugs', authenticateToken, async (req, res) => {
  try {
    const term = req.query.term;
    if (!term || term.length < 2) {
      return res.json([]);
    }
    
    // ค้นหา inventory ที่มี quantity > 0
    const availableInventory = await runQuery(
      `SELECT DISTINCT i.drugId 
       FROM Inventory i 
       WHERE i.quantity > 0`
    );
    const availableDrugIds = availableInventory.map(item => item.drugId);
    
    if (availableDrugIds.length === 0) {
      return res.json([]);
    }
    
    // ค้นหายาใน formulary ที่ตรงกับคำค้นหาและมีใน inventory
    const placeholders = availableDrugIds.map(() => '?').join(',');
    const drugs = await runQuery(
      `SELECT * FROM Formulary 
       WHERE drugId IN (${placeholders}) 
       AND (tradeName LIKE ? OR genericName LIKE ?)`,
      [...availableDrugIds, `%${term}%`, `%${term}%`]
    );
    
    res.json(drugs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/drug-lots/:drugId', authenticateToken, async (req, res) => {
  try {
    const drugId = req.params.drugId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lots = await runQuery(
      `SELECT * FROM Inventory 
       WHERE drugId = ? AND quantity > 0 AND expiryDate >= ? 
       ORDER BY expiryDate`,
      [drugId, today.toISOString().split('T')[0]]
    );
    
    res.json(lots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    const inventoryId = generateId();
    await runStatement(
      `INSERT INTO Inventory 
      (inventoryId, drugId, lotNumber, expiryDate, quantity, costPrice, 
       sellingPrice, referenceId, barcode, dateReceived) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inventoryId, payload.drugId, payload.lotNumber, payload.expiryDate,
        payload.quantity, payload.costPrice, payload.sellingPrice,
        payload.referenceId, payload.barcode, new Date().toISOString()
      ]
    );
    res.json({ status: 'success', inventoryId });
    await logActivity('INVENTORY_RECEIVE', `รับสินค้าเข้า ${payload.drugId} Lot ${payload.lotNumber}`, {
      entity: 'Inventory',
      entityId: inventoryId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Sales
app.post('/api/sales', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    const saleId = generateId();
    const saleDate = new Date().toISOString();
    
    console.log('Payload ที่ได้รับ:', payload); // เพิ่ม log สำหรับ debugging
    
    // บันทึกข้อมูลการขายแต่ละรายการ
    for (const item of payload.items) {
      console.log('กำลังบันทึก item:', item); // เพิ่ม log สำหรับ debugging
      
      await runStatement(
        `INSERT INTO Sales 
        (saleId, saleDate, memberId, pharmacist, totalAmount, inventoryId, 
         quantitySold, pricePerUnit, drugId, lotNumber) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, saleDate, payload.memberId || 'N/A', payload.pharmacist,
          payload.total, item.inventoryId, item.quantity, item.price,
          item.drugId, item.lot || 'N/A' // เพิ่มค่าเริ่มต้นหากไม่มี lot
        ]
      );
      
      // อัปเดต inventory
      await runStatement(
        `UPDATE Inventory 
         SET quantity = quantity - ? 
         WHERE inventoryId = ?`,
        [item.quantity, item.inventoryId]
      );
    }
    
    res.json({ status: 'success', saleId });
    await logActivity('SALE_CREATE', `บันทึกการขายยอดรวม ${Number(payload.total || 0).toFixed(2)} บาท`, {
      entity: 'Sales',
      entityId: saleId,
      performedBy: req.user?.username || payload.pharmacist || null
    });
  } catch (error) {
    console.error('Error processing sale:', error); // เพิ่ม log สำหรับ debugging
    res.status(500).json({ error: error.message });
  }
});

// สร้าง route สำหรับหน้าหลัก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index_sqlite.html'));
});

// Middleware สำหรับจัดการ error กลาง
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error('JSON parse error:', err);
    return res.status(400).json({ error: 'ไม่สามารถอ่านข้อมูลที่ส่งมาได้' });
  }

  if (err && (err.code === 'ECONNABORTED' || err.message === 'request aborted')) {
    console.warn('Request aborted by client:', err);
    return res.status(400).json({ error: 'คำขอถูกยกเลิกก่อนเสร็จสิ้น' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
});

// API สำหรับ Staff (เภสัชกร/เจ้าหน้าที่)
app.get('/api/staffs', authenticateToken, async (req, res) => {
  try {
    const staffs = await runQuery('SELECT * FROM Staff ORDER BY fullName');
    res.json(staffs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/staff/:staffId', authenticateToken, async (req, res) => {
  try {
    const staffId = req.params.staffId;
    const staff = await runQuery('SELECT * FROM Staff WHERE staffId = ?', [staffId]);
    if (staff.length > 0) {
      res.json(staff[0]);
    } else {
      res.status(404).json({ error: 'Staff not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/staffs', authenticateToken, async (req, res) => {
  try {
    const payload = req.body;
    const staffId = generateId();
    await runStatement(
      `INSERT INTO Staff 
      (staffId, fullName, licenseNumber, position, phone, email, dateCreated) 
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        staffId,
        payload.fullName,
        payload.licenseNumber,
        payload.position,
        payload.phone,
        payload.email,
        new Date().toISOString()
      ]
    );
    res.json({ status: 'success', staffId });
    await logActivity('STAFF_CREATE', `เพิ่มเจ้าหน้าที่ ${payload.fullName}`, {
      entity: 'Staff',
      entityId: staffId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับดูประวัติการซื้อของสมาชิก
app.get('/api/member/:memberId/purchases', authenticateToken, async (req, res) => {
  try {
    const memberId = req.params.memberId;
    const purchases = await runQuery(
      `SELECT s.saleId, s.saleDate, f.tradeName, f.genericName, s.quantitySold, 
       s.pricePerUnit, (s.quantitySold * s.pricePerUnit) as totalItemPrice, s.pharmacist
       FROM Sales s
       LEFT JOIN Formulary f ON s.drugId = f.drugId
       WHERE s.memberId = ?
       ORDER BY s.saleDate DESC`,
      [memberId]
    );
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับการล็อกอิน
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // ตรวจสอบข้อมูลที่ส่งมา
    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }
    
    // ดึงข้อมูลผู้ใช้จากฐานข้อมูล
    const users = await runQuery('SELECT * FROM Users WHERE username = ? AND isActive = 1', [username]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    
    const user = users[0];
    
    let passwordMatch = false;
    if (user.password && user.password.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, user.password);
    } else if (user.password) {
      passwordMatch = password === user.password;
      if (passwordMatch) {
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          await runStatement(
            'UPDATE Users SET password = ?, dateModified = ? WHERE id = ?',
            [hashedPassword, new Date().toISOString(), user.id]
          );
          user.password = hashedPassword;
        } catch (hashError) {
          console.error('Error upgrading password hash:', hashError);
        }
      }
    }

    if (passwordMatch) {
      // อัปเดตเวลาเข้าสู่ระบบล่าสุด
      await runStatement('UPDATE Users SET lastLogin = ?, dateModified = ? WHERE id = ?', [new Date().toISOString(), new Date().toISOString(), user.id]);

      // สร้าง JWT token
      const token = jwt.sign(
        { userId: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // ส่งข้อมูลผู้ใช้และ token กลับไป
      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          role: user.role
        }
      });
    } else {
      res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับการสมัครผู้ใช้ใหม่ (ใช้เฉพาะในระบบทดสอบ ไม่ควรเปิดใช้ใน production)
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, fullName, role = 'user' } = req.body;
    
    // ตรวจสอบข้อมูลที่ส่งมา
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
    
    // ตรวจสอบว่า username ซ้ำหรือไม่
    const existingUsers = await runQuery('SELECT * FROM Users WHERE username = ?', [username]);
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);

    // เพิ่มผู้ใช้ใหม่
    const result = await runStatement(
      `INSERT INTO Users (username, password, fullName, role, dateModified)
       VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, fullName, role, new Date().toISOString()]
    );
    
    res.json({
      success: true,
      message: 'สมัครสมาชิกเรียบร้อย',
      userId: result.lastID
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับดึงข้อมูลผู้ใช้ที่ล็อกอิน
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const users = await runQuery('SELECT id, username, fullName, role, dateCreated FROM Users WHERE id = ?', [req.user.userId]);
    if (users.length > 0) {
      res.json(users[0]);
    } else {
      res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับเปลี่ยนรหัสผ่าน
app.post('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });
    }
    
    // ดึงข้อมูลผู้ใช้
    const users = await runQuery('SELECT * FROM Users WHERE id = ?', [req.user.userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลผู้ใช้' });
    }
    
    const user = users[0];
    
    let isCurrentPasswordValid = false;
    if (user.password && user.password.startsWith('$2')) {
      isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    } else {
      isCurrentPasswordValid = currentPassword === user.password;
    }

    if (!isCurrentPasswordValid) {
      return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await runStatement('UPDATE Users SET password = ?, dateModified = ? WHERE id = ?', [hashedNewPassword, new Date().toISOString(), req.user.userId]);
    res.json({ success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับดึงรายชื่อผู้ใช้ทั้งหมด (เฉพาะ admin เท่านั้น)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    // ตรวจสอบว่าผู้ใช้เป็น admin หรือไม่
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }
    
    const users = await runQuery('SELECT id, username, fullName, role, isActive, dateCreated, lastLogin FROM Users ORDER BY dateCreated DESC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ reset รหัสผ่าน (เฉพาะ admin เท่านั้น)
app.post('/api/reset-password/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;
    
    // ตรวจสอบว่าผู้ใช้เป็น admin หรือไม่
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }
    
    if (!newPassword) {
      return res.status(400).json({ error: 'กรุณากำหนดรหัสผ่านใหม่' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await runStatement('UPDATE Users SET password = ?, dateModified = ? WHERE id = ?', [hashedPassword, new Date().toISOString(), userId]);
    res.json({ success: true, message: 'รีเซ็ตรหัสผ่านเรียบร้อย' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับเปลี่ยนสถานะผู้ใช้ (เฉพาะ admin เท่านั้น)
app.post('/api/toggle-user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // ตรวจสอบว่าผู้ใช้เป็น admin หรือไม่
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }
    
    // ดึงสถานะปัจจุบัน
    const users = await runQuery('SELECT isActive FROM Users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });
    }
    
    const currentStatus = users[0].isActive;
    const newStatus = currentStatus === 1 ? 0 : 1;
    
    // เปลี่ยนสถานะ
    await runStatement('UPDATE Users SET isActive = ?, dateModified = ? WHERE id = ?', [newStatus, new Date().toISOString(), userId]);
    
    res.json({
      success: true,
      message: newStatus === 1 ? 'เปิดใช้งานผู้ใช้เรียบร้อย' : 'ปิดใช้งานผู้ใช้เรียบร้อย',
      newStatus
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/activities', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }

    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isNaN(limitParam) ? 20 : Math.min(Math.max(limitParam, 1), 100);

    const activities = await runQuery(
      `SELECT activityType, entity, entityId, description, performedBy, createdAt
       FROM ActivityLog
       ORDER BY datetime(createdAt) DESC
       LIMIT ?`,
      [limit]
    );

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Dashboard
app.get('/api/dashboard/:period', authenticateToken, async (req, res) => {
  try {
    const range = getPeriodRange(req.params.period);
    if (!range) {
      return res.status(400).json({ error: 'ช่วงเวลาที่ขอไม่ถูกต้อง' });
    }

    const { start, end } = range;

    const salesSummary = await runQuery(
      `SELECT
         COUNT(*) AS totalTransactions,
         IFNULL(SUM(totalAmount), 0) AS totalSales
       FROM Sales
       WHERE saleDate BETWEEN ? AND ?`,
      [start, end]
    );

    const totalMembersResult = await runQuery('SELECT COUNT(*) AS totalMembers FROM Members');

    const topMembers = await runQuery(
      `SELECT
         COALESCE(m.fullName, 'ลูกค้าทั่วไป') AS fullName,
         IFNULL(SUM(s.totalAmount), 0) AS totalAmount
       FROM Sales s
       LEFT JOIN Members m ON s.memberId = m.memberId
       WHERE s.saleDate BETWEEN ? AND ?
       GROUP BY COALESCE(m.fullName, 'ลูกค้าทั่วไป')
       ORDER BY totalAmount DESC
       LIMIT 10`,
      [start, end]
    );

    const lowStockItems = await runQuery(
      `SELECT
         f.tradeName,
         IFNULL(f.minStock, 0) AS minStock,
         IFNULL(SUM(i.quantity), 0) AS totalQuantity
       FROM Formulary f
       LEFT JOIN Inventory i ON f.drugId = i.drugId
       GROUP BY f.drugId
       HAVING f.minStock IS NOT NULL AND f.minStock > 0 AND totalQuantity <= f.minStock
       ORDER BY totalQuantity ASC
       LIMIT 10`
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next30Days = new Date(today);
    next30Days.setDate(today.getDate() + 30);

    const expiringItems = await runQuery(
      `SELECT
         f.tradeName,
         i.lotNumber,
         i.expiryDate
       FROM Inventory i
       INNER JOIN Formulary f ON i.drugId = f.drugId
       WHERE i.quantity > 0
         AND DATE(i.expiryDate) BETWEEN DATE(?) AND DATE(?)
       ORDER BY DATE(i.expiryDate)
       LIMIT 10`,
      [today.toISOString(), next30Days.toISOString()]
    );

    const topDrugs = await runQuery(
      `SELECT
         f.genericName,
         f.tradeName,
         IFNULL(SUM(s.quantitySold), 0) AS totalQuantity
       FROM Sales s
       INNER JOIN Formulary f ON s.drugId = f.drugId
       WHERE s.saleDate BETWEEN ? AND ?
       GROUP BY s.drugId
       ORDER BY totalQuantity DESC
       LIMIT 10`,
      [start, end]
    );

    const summary = salesSummary[0] || { totalTransactions: 0, totalSales: 0 };
    const totalMembers = totalMembersResult[0]?.totalMembers || 0;

    res.json({
      totalSales: Number(summary.totalSales) || 0,
      totalTransactions: Number(summary.totalTransactions) || 0,
      totalMembers: Number(totalMembers) || 0,
      topMembers: topMembers.map(item => ({
        fullName: item.fullName,
        totalAmount: Number(item.totalAmount) || 0
      })),
      lowStockItems: lowStockItems.map(item => ({
        tradeName: item.tradeName,
        minStock: Number(item.minStock) || 0,
        totalQuantity: Number(item.totalQuantity) || 0
      })),
      expiringItems,
      topDrugs: topDrugs.map(item => ({
        genericName: item.genericName,
        tradeName: item.tradeName,
        totalQuantity: Number(item.totalQuantity) || 0
      }))
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูล dashboard ได้', details: error.message });
  }
});

// API สำหรับดึงสรุปยอดขาย (สำหรับ Admin Dashboard)
app.get('/api/sales/summary', authenticateToken, async (req, res) => {
  try {
    // ตรวจสอบว่าผู้ใช้เป็น admin หรือไม่
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }
    
    // ดึงข้อมูลยอดขายรวม
    const salesSummary = await runQuery(`
      SELECT 
        COUNT(*) as totalTransactions,
        SUM(totalAmount) as totalRevenue,
        AVG(totalAmount) as averageTransactionValue
      FROM Sales
    `);
    
    // ดึงข้อมูลยอดขายตามช่วงเวลา (ล่าสุด 30 วัน)
    const recentSales = await runQuery(`
      SELECT 
        saleDate,
        totalAmount
      FROM Sales
      WHERE saleDate >= date('now', '-30 days')
      ORDER BY saleDate DESC
      LIMIT 30
    `);
    
    // ดึงข้อมูลยอดขายตามเภสัชกร
    const salesByStaff = await runQuery(`
      SELECT 
        pharmacist,
        COUNT(*) as transactionCount,
        SUM(totalAmount) as totalSales
      FROM Sales
      GROUP BY pharmacist
      ORDER BY totalSales DESC
    `);
    
    res.json({
      summary: salesSummary[0] || { totalTransactions: 0, totalRevenue: 0, averageTransactionValue: 0 },
      recentSales,
      salesByStaff
    });
  } catch (error) {
    console.error('Sales summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับรายงานยอดขายตามวัน
app.get('/api/sales/date/:date', authenticateToken, async (req, res) => {
  try {
    const { date } = req.params;
    const sales = await runQuery(`
      SELECT s.*, m.fullName as memberName, f.tradeName, f.genericName
      FROM Sales s
      LEFT JOIN Members m ON s.memberId = m.memberId
      LEFT JOIN Formulary f ON s.drugId = f.drugId
      WHERE DATE(s.saleDate) = ?
      ORDER BY s.saleDate DESC
    `, [date]);
    
    // ประมวลผลข้อมูลให้อยู่ในรูปแบบที่เหมาะกับการแสดงผล
    const processedSales = sales.map(sale => ({
      'เวลา': new Date(sale.saleDate).toLocaleString('th-TH'),
      'ลูกค้า': sale.memberName || 'ลูกค้าทั่วไป',
      'รายการยา': sale.tradeName,
      'ชื่อสามัญ': sale.genericName,
      'Lot': sale.lotNumber,
      'จำนวน': sale.quantitySold,
      'ราคา/หน่วย': parseFloat(sale.pricePerUnit).toFixed(2),
      'รวม': (sale.quantitySold * sale.pricePerUnit).toFixed(2),
      'ผู้ขาย': sale.pharmacist,
      'Sale ID': sale.saleId
    }));
    
    // เพิ่มการคำนวณยอดรวม
    const totalAmount = sales.reduce((sum, sale) => sum + (sale.quantitySold * sale.pricePerUnit), 0);
    processedSales.totalAmount = totalAmount;
    
    res.json(processedSales);
  } catch (error) {
    console.error('Daily sales report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับรายงานยอดขายตามสัปดาห์
app.get('/api/sales/week/:date', authenticateToken, async (req, res) => {
  try {
    const { date } = req.params;
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    
    const startDate = new Date(targetDate);
    startDate.setDate(targetDate.getDate() - dayOfWeek);
    
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7);

    const sales = await runQuery(`
      SELECT s.*, m.fullName as memberName, f.tradeName, f.genericName
      FROM Sales s
      LEFT JOIN Members m ON s.memberId = m.memberId
      LEFT JOIN Formulary f ON s.drugId = f.drugId
      WHERE s.saleDate >= ? AND s.saleDate < ?
      ORDER BY s.saleDate DESC
    `, [startDate.toISOString(), endDate.toISOString()]);
    
    // ประมวลผลข้อมูลให้อยู่ในรูปแบบที่เหมาะกับการแสดงผล
    const processedSales = sales.map(sale => ({
      'เวลา': new Date(sale.saleDate).toLocaleString('th-TH'),
      'ลูกค้า': sale.memberName || 'ลูกค้าทั่วไป',
      'รายการยา': sale.tradeName,
      'ชื่อสามัญ': sale.genericName,
      'Lot': sale.lotNumber,
      'จำนวน': sale.quantitySold,
      'ราคา/หน่วย': parseFloat(sale.pricePerUnit).toFixed(2),
      'รวม': (sale.quantitySold * sale.pricePerUnit).toFixed(2),
      'ผู้ขาย': sale.pharmacist,
      'Sale ID': sale.saleId
    }));
    
    // เพิ่มการคำนวณยอดรวม
    const totalAmount = sales.reduce((sum, sale) => sum + (sale.quantitySold * sale.pricePerUnit), 0);
    processedSales.totalAmount = totalAmount;
    
    res.json(processedSales);
  } catch (error) {
    console.error('Weekly sales report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับรายงานยอดขายตามเดือน
app.get('/api/sales/month/:year/:month', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.params;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const sales = await runQuery(`
      SELECT s.*, m.fullName as memberName, f.tradeName, f.genericName
      FROM Sales s
      LEFT JOIN Members m ON s.memberId = m.memberId
      LEFT JOIN Formulary f ON s.drugId = f.drugId
      WHERE s.saleDate >= ? AND s.saleDate < ?
      ORDER BY s.saleDate DESC
    `, [startDate.toISOString(), endDate.toISOString()]);
    
    // ประมวลผลข้อมูลให้อยู่ในรูปแบบที่เหมาะกับการแสดงผล
    const processedSales = sales.map(sale => ({
      'วันที่': new Date(sale.saleDate).toLocaleDateString('th-TH'),
      'ลูกค้า': sale.memberName || 'ลูกค้าทั่วไป',
      'รายการยา': sale.tradeName,
      'ชื่อสามัญ': sale.genericName,
      'Lot': sale.lotNumber,
      'จำนวน': sale.quantitySold,
      'ราคา/หน่วย': parseFloat(sale.pricePerUnit).toFixed(2),
      'รวม': (sale.quantitySold * sale.pricePerUnit).toFixed(2),
      'ผู้ขาย': sale.pharmacist,
      'Sale ID': sale.saleId
    }));
    
    // เพิ่มการคำนวณยอดรวม
    const totalAmount = sales.reduce((sum, sale) => sum + (sale.quantitySold * sale.pricePerUnit), 0);
    processedSales.totalAmount = totalAmount;
    
    res.json(processedSales);
  } catch (error) {
    console.error('Monthly sales report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับรายงานยอดขายตามปี
app.get('/api/sales/year/:year', authenticateToken, async (req, res) => {
  try {
    const { year } = req.params;
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(Number(year) + 1, 0, 1);

    const sales = await runQuery(`
      SELECT s.*, m.fullName as memberName, f.tradeName, f.genericName
      FROM Sales s
      LEFT JOIN Members m ON s.memberId = m.memberId
      LEFT JOIN Formulary f ON s.drugId = f.drugId
      WHERE s.saleDate >= ? AND s.saleDate < ?
      ORDER BY s.saleDate DESC
    `, [startDate.toISOString(), endDate.toISOString()]);
    
    // ประมวลผลข้อมูลให้อยู่ในรูปแบบที่เหมาะกับการแสดงผล
    const processedSales = sales.map(sale => ({
      'วันที่': new Date(sale.saleDate).toLocaleDateString('th-TH'),
      'ลูกค้า': sale.memberName || 'ลูกค้าทั่วไป',
      'รายการยา': sale.tradeName,
      'ชื่อสามัญ': sale.genericName,
      'Lot': sale.lotNumber,
      'จำนวน': sale.quantitySold,
      'ราคา/หน่วย': parseFloat(sale.pricePerUnit).toFixed(2),
      'รวม': (sale.quantitySold * sale.pricePerUnit).toFixed(2),
      'ผู้ขาย': sale.pharmacist,
      'Sale ID': sale.saleId
    }));
    
    // เพิ่มการคำนวณยอดรวม
    const totalAmount = sales.reduce((sum, sale) => sum + (sale.quantitySold * sale.pricePerUnit), 0);
    processedSales.totalAmount = totalAmount;
    
    res.json(processedSales);
  } catch (error) {
    console.error('Yearly sales report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ export รายงานเป็น CSV
app.get('/api/export/:reportType', authenticateToken, async (req, res) => {
  try {
    const { reportType } = req.params;
    let data = [];
    let filenameBase = '';
    let exportLabel = '';

    switch(reportType) {
      case 'sales':
        data = await runQuery(`
          SELECT s.saleId, s.saleDate, m.fullName as memberName, s.pharmacist,
                 s.totalAmount, f.tradeName, s.quantitySold, s.pricePerUnit,
                 (s.quantitySold * s.pricePerUnit) as itemTotal
          FROM Sales s
          LEFT JOIN Members m ON s.memberId = m.memberId
          LEFT JOIN Formulary f ON s.drugId = f.drugId
          ORDER BY s.saleDate DESC
        `);
        filenameBase = 'sales_report';
        exportLabel = 'รายงานยอดขาย';
        break;

      case 'inventory':
        data = await runQuery(`
          SELECT i.*, f.tradeName, f.genericName
          FROM Inventory i
          LEFT JOIN Formulary f ON i.drugId = f.drugId
          ORDER BY f.tradeName
        `);
        filenameBase = 'inventory_report';
        exportLabel = 'รายงานสินค้าคงคลัง';
        break;

      case 'members':
        data = await runQuery('SELECT * FROM Members ORDER BY fullName');
        filenameBase = 'members_report';
        exportLabel = 'รายงานสมาชิก';
        break;

      case 'staffs':
        data = await runQuery('SELECT * FROM Staff ORDER BY fullName');
        filenameBase = 'staffs_report';
        exportLabel = 'รายงานเจ้าหน้าที่';
        break;

      default:
        return res.status(400).json({ error: 'ไม่พบประเภทรายงานที่ระบุ' });
    }

    const filename = `${filenameBase}_${new Date().toISOString().slice(0, 10)}.csv`;
    
    // สร้าง CSV content
    if (data.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    }
    
    // สร้าง headers จาก keys ของข้อมูล
    const headers = Object.keys(data[0]);
    let csvContent = headers.join(',') + '\n';
    
    // เพิ่มข้อมูลแต่ละแถว
    data.forEach(row => {
      const values = headers.map(header => {
        let value = row[header];
        // จัดการค่าที่มี comma หรือ quote ในข้อมูล
        if (value !== null && value !== undefined) {
          value = String(value);
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = '"' + value.replace(/"/g, '""') + '"';
          }
        } else {
          value = '';
        }
        return value;
      });
      csvContent += values.join(',') + '\n';
    });
    
    // ส่งไฟล์ CSV กลับไป (เพิ่ม BOM เพื่อรองรับภาษาไทย)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await logActivity('EXPORT_CSV', `ส่งออก${exportLabel}`, {
      entity: 'Report',
      entityId: reportType,
      performedBy: req.user?.username || null
    });
    res.send(`\uFEFF${csvContent}`);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export/database', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
    }

    if (!resolvedDbFilePath) {
      return res.status(500).json({ error: 'ไม่สามารถระบุที่อยู่ไฟล์ฐานข้อมูลได้' });
    }

    await fs.promises.access(resolvedDbFilePath, fs.constants.R_OK);
    const filename = `pharmacy_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await logActivity('EXPORT_DATABASE', 'ดาวน์โหลดไฟล์ฐานข้อมูล', {
      entity: 'Database',
      entityId: filename,
      performedBy: req.user?.username || null
    });

    const stream = fs.createReadStream(resolvedDbFilePath);
    stream.on('error', (streamError) => {
      console.error('Database export stream error:', streamError);
      if (!res.headersSent) {
        res.status(500).json({ error: 'ไม่สามารถอ่านไฟล์ฐานข้อมูลได้' });
      } else {
        res.destroy(streamError);
      }
    });
    stream.pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'ไม่พบไฟล์ฐานข้อมูล' });
    }
    if (error.code === 'EACCES') {
      return res.status(500).json({ error: 'ไม่มีสิทธิ์อ่านไฟล์ฐานข้อมูล' });
    }
    console.error('Database export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับรายงานยอดขายทั้งหมด (สำหรับหน้ารายงาน)
app.get('/api/sales', authenticateToken, async (req, res) => {
  try {
    const sales = await runQuery(`
      SELECT s.*, m.fullName as memberName, f.tradeName, f.genericName
      FROM Sales s
      LEFT JOIN Members m ON s.memberId = m.memberId
      LEFT JOIN Formulary f ON s.drugId = f.drugId
      ORDER BY s.saleDate DESC
      LIMIT 1000  -- จำกัดจำนวนข้อมูลเพื่อป้องกันโหลดเกิน
    `);
    
    // ประมวลผลข้อมูลให้อยู่ในรูปแบบที่เหมาะกับการแสดงผล
    const processedSales = sales.map(sale => ({
      'เวลา': new Date(sale.saleDate).toLocaleString('th-TH'),
      'ลูกค้า': sale.memberName || 'ลูกค้าทั่วไป',
      'รายการยา': sale.tradeName,
      'ชื่อสามัญ': sale.genericName,
      'Lot': sale.lotNumber,
      'จำนวน': sale.quantitySold,
      'ราคา/หน่วย': parseFloat(sale.pricePerUnit).toFixed(2),
      'รวม': (sale.quantitySold * sale.pricePerUnit).toFixed(2),
      'ผู้ขาย': sale.pharmacist,
      'Sale ID': sale.saleId
    }));
    
    // เพิ่มการคำนวณยอดรวม
    const totalAmount = sales.reduce((sum, sale) => sum + (sale.quantitySold * sale.pricePerUnit), 0);
    processedSales.totalAmount = totalAmount;
    
    res.json(processedSales);
  } catch (error) {
    console.error('All sales report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ฟังก์ชันสำหรับตรวจสอบและสร้างบัญชี admin หากยังไม่มี
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    // สร้างบัญชี admin หากยังไม่มี
    db.get("SELECT * FROM Users WHERE username = 'admin'", async (err, row) => {
      if (err) {
        console.error('Error checking admin user:', err.message);
        resolve();
        return;
      }

      const nowIso = new Date().toISOString();

      if (!row) {
        try {
          const hashedPassword = bcrypt.hashSync('admin123', 10);
          const stmt = db.prepare(`INSERT INTO Users (username, password, fullName, role, dateModified) VALUES (?, ?, ?, ?, ?)`);
          stmt.run(['admin', hashedPassword, 'Administrator', 'admin', nowIso], function(err) {
            if (err) {
              console.error('Error creating admin user:', err.message);
            } else {
              console.log('Created admin user successfully');
              console.log('Username: admin');
              console.log('Password: admin123');
            }
          });
          stmt.finalize();
        } catch (hashError) {
          console.error('Error hashing default admin password:', hashError);
        }
      } else {
        if (!row.password || !row.password.startsWith('$2')) {
          try {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            await runStatement(
              'UPDATE Users SET password = ?, dateModified = ? WHERE id = ?',
              [hashedPassword, nowIso, row.id]
            );
            console.log('Upgraded admin password storage to hashed format');
          } catch (upgradeError) {
            console.error('Error upgrading admin password hash:', upgradeError);
          }
        }
        console.log('Admin user already exists');
      }
      
      // เพิ่มข้อมูลตัวอย่าง Members หากยังไม่มี
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

        // เพิ่มข้อมูลตัวอย่าง Formulary หากยังไม่มี
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
          
          resolve();
        });
      });
    });
  });
}

// รันการ initialize database ก่อนเปิด server
initializeDatabase().then(() => {
  // รัน server
  app.listen(port, () => {
    console.log(`Server กำลังรันที่ http://localhost:${port}`);
  });
}).catch(err => {
  console.error('Error initializing database:', err);
  process.exit(1);
});