const express = require('express');
const cors = require('cors');
const db = require('./db');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs'); // เพิ่ม module สำหรับ hashing รหัสผ่าน
const jwt = require('jsonwebtoken'); // เพิ่ม module สำหรับ JWT
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
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

// API สำหรับ Member
app.get('/api/members', async (req, res) => {
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

app.get('/api/member/:memberId', async (req, res) => {
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

app.get('/api/search/members', async (req, res) => {
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

app.post('/api/members', async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Formulary (ยา)
app.get('/api/drugs', async (req, res) => {
  try {
    const drugs = await runQuery('SELECT * FROM Formulary ORDER BY tradeName');
    res.json(drugs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/drugs', async (req, res) => {
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

app.post('/api/drugs', async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Inventory
app.get('/api/inventory', async (req, res) => {
  try {
    const inventory = await runQuery('SELECT * FROM Inventory');
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/inventory/summary', async (req, res) => {
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

app.get('/api/search/available-drugs', async (req, res) => {
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

app.get('/api/drug-lots/:drugId', async (req, res) => {
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

app.post('/api/inventory', async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Sales
app.post('/api/sales', async (req, res) => {
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
  } catch (error) {
    console.error('Error processing sale:', error); // เพิ่ม log สำหรับ debugging
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับ Dashboard
app.get('/api/dashboard/:period', async (req, res) => {
  try {
    const period = req.params.period;
    
    // คำนวณช่วงเวลาตาม period
    let startDate;
    const endDate = new Date();
    endDate.setHours(23,59,59,999);
    
    switch(period) {
      case 'daily':
        startDate = new Date(endDate);
        startDate.setHours(0,0,0,0);
        break;
      case 'weekly':
        startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - endDate.getDay());
        startDate.setHours(0,0,0,0);
        break;
      case 'monthly':
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        break;
      case 'yearly':
        startDate = new Date(endDate.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(endDate);
    }
    
    // ดึงข้อมูลยอดขายในช่วงเวลา (จำกัดจำนวนข้อมูล)
    const salesInRange = await runQuery(
      `SELECT * FROM Sales 
       WHERE saleDate >= ? AND saleDate <= ?
       LIMIT 1000`, // จำกัดจำนวนข้อมูลเพื่อป้องกัน payload ใหญ่เกินไป
      [startDate.toISOString(), endDate.toISOString()]
    );

    // ดึงข้อมูลเพิ่มเติมสำหรับ dashboard
    const totalTransactions = salesInRange.length;
    
    // ดึงข้อมูลยาเพื่อใช้ชื่อ (จำกัดจำนวนเพื่อประสิทธิภาพ)
    const formulary = await runQuery('SELECT drugId, tradeName, genericName FROM Formulary LIMIT 500');
    const formularyMap = {};
    formulary.forEach(drug => {
      formularyMap[drug.drugId] = drug;
    });
    
    // ดึงข้อมูลสมาชิกเพื่อใช้ชื่อ (จำกัดจำนวนเพื่อประสิทธิภาพ)
    const members = await runQuery('SELECT memberId, fullName FROM Members LIMIT 500');
    const memberMap = {};
    members.forEach(member => {
      memberMap[member.memberId] = member;
    });
    
    // 1. คำนวณยอดขายรวม
    const totalSales = salesInRange.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
    
    // 2. หา 10 ยาขายดีที่สุด (ใช้การ query ที่มีประสิทธิภาพมากขึ้น)
    const drugSales = {};
    salesInRange.forEach(sale => {
      const drugInfo = formularyMap[sale.drugId];
      if (drugInfo && drugInfo.genericName) {
        const genericName = drugInfo.genericName;
        drugSales[genericName] = (drugSales[genericName] || 0) + (sale.quantitySold || 0);
      }
    });
    const topDrugs = Object.entries(drugSales)
      .map(([genericName, totalQuantity]) => ({ genericName, totalQuantity }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10);
    
    // 3. หาสินค้าใกล้หมดอายุ 10 อันดับแรก (จำกัดผลลัพธ์)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiringItems = await runQuery(
      `SELECT drugId, lotNumber, expiryDate FROM Inventory 
       WHERE quantity > 0 AND expiryDate >= ? 
       ORDER BY expiryDate 
       LIMIT 10`,
      [today.toISOString().split('T')[0]]
    );
    const processedExpiringItems = expiringItems.map(item => ({
      tradeName: formularyMap[item.drugId]?.tradeName || item.drugId,
      lotNumber: item.lotNumber,
      expiryDate: item.expiryDate
    }));
    
    // 4. หาสินค้าที่มี stock ต่ำกว่า min
    const inventoryQuantities = await runQuery(
      `SELECT drugId, SUM(quantity) as totalQuantity 
       FROM Inventory 
       GROUP BY drugId 
       HAVING totalQuantity > 0
       LIMIT 500` // จำกัดจำนวนผลลัพธ์
    );
    const lowStockItems = [];
    for (const inv of inventoryQuantities) {
      const drug = await runQuery('SELECT tradeName, minStock FROM Formulary WHERE drugId = ?', [inv.drugId]);
      if (drug.length > 0 && drug[0].minStock && inv.totalQuantity < drug[0].minStock) {
        lowStockItems.push({
          tradeName: drug[0].tradeName,
          totalQuantity: inv.totalQuantity,
          minStock: drug[0].minStock
        });
      }
    }
    
    // 5. หา member ที่มียอดซื้อสูงสุด (จำกัดผลลัพธ์)
    const memberSales = {};
    salesInRange.forEach(sale => {
      if (sale.memberId && sale.memberId !== 'N/A') {
        memberSales[sale.memberId] = (memberSales[sale.memberId] || 0) + (sale.totalAmount || 0);
      }
    });
    const topMembers = Object.entries(memberSales)
      .map(([memberId, totalAmount]) => ({
        fullName: memberMap[memberId]?.fullName || 'Unknown Member',
        totalAmount
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
    
    // นับจำนวนสมาชิกทั้งหมด
    const totalMembersResult = await runQuery('SELECT COUNT(*) as count FROM Members');
    const totalMembers = totalMembersResult[0].count || 0;
    
    // นับจำนวนยาทั้งหมด
    const totalDrugsResult = await runQuery('SELECT COUNT(*) as count FROM Formulary');
    const totalDrugs = totalDrugsResult[0].count || 0;
    
    // ส่งข้อมูลกลับในรูปแบบที่มีประสิทธิภาพ (จำกัดขนาด payload)
    const dashboardData = {
      totalSales: parseFloat(totalSales.toFixed(2)),
      totalTransactions,
      totalMembers, // เพิ่มจำนวนสมาชิก
      totalDrugs,   // เพิ่มจำนวนยา
      topDrugs: topDrugs.slice(0, 10), // จำกัดจำนวน
      expiringItems: processedExpiringItems.slice(0, 10), // จำกัดจำนวน
      lowStockItems: lowStockItems.slice(0, 10), // จำกัดจำนวน
      topMembers: topMembers.slice(0, 10) // จำกัดจำนวน
    };
    
    res.json(dashboardData);
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// สร้าง route สำหรับหน้าหลัก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index_sqlite.html'));
});

// API สำหรับ Staff (เภสัชกร/เจ้าหน้าที่)
app.get('/api/staffs', async (req, res) => {
  try {
    const staffs = await runQuery('SELECT * FROM Staff ORDER BY fullName');
    res.json(staffs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/staff/:staffId', async (req, res) => {
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

app.post('/api/staffs', async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับดูประวัติการซื้อของสมาชิก
app.get('/api/member/:memberId/purchases', async (req, res) => {
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
    
    // ตรวจสอบรหัสผ่าน (ในตัวอย่างนี้ใช้การเปรียบเทียบตรง แต่ในระบบจริงควรใช้ bcrypt)
    // สำหรับตัวอย่างนี้เราจะใช้ plain text ก่อน แล้วจะอัปเดตภายหลัง
    if (password === user.password) {
      // อัปเดตเวลาเข้าสู่ระบบล่าสุด
      await runStatement('UPDATE Users SET lastLogin = ? WHERE id = ?', [new Date().toISOString(), user.id]);
      
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
    
    // เข้ารหัสรหัสผ่าน (ในตัวอย่างนี้ยังใช้ plain text ก่อน)
    // ในระบบจริงควรใช้ bcrypt.hash()
    const hashedPassword = password; // ควรเปลี่ยนเป็น bcrypt.hash() ในระบบจริง
    
    // เพิ่มผู้ใช้ใหม่
    const result = await runStatement(
      `INSERT INTO Users (username, password, fullName, role) 
       VALUES (?, ?, ?, ?)`,
      [username, hashedPassword, fullName, role]
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

// Middleware สำหรับตรวจสอบ token
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
    
    // ตรวจสอบรหัสผ่านเดิม (ในตัวอย่างนี้เปรียบเทียบตรง)
    if (currentPassword === user.password) {
      // อัปเดตรหัสผ่านใหม่ (ควรใช้การเข้ารหัสในระบบจริง)
      await runStatement('UPDATE Users SET password = ? WHERE id = ?', [newPassword, req.user.userId]);
      res.json({ success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
    } else {
      res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }
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
    
    // อัปเดตรหัสผ่าน
    await runStatement('UPDATE Users SET password = ? WHERE id = ?', [newPassword, userId]);
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
    await runStatement('UPDATE Users SET isActive = ? WHERE id = ?', [newStatus, userId]);
    
    res.json({ 
      success: true, 
      message: newStatus === 1 ? 'เปิดใช้งานผู้ใช้เรียบร้อย' : 'ปิดใช้งานผู้ใช้เรียบร้อย',
      newStatus
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    let filename = '';
    
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
        filename = `sales_report_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
        
      case 'inventory':
        data = await runQuery(`
          SELECT i.*, f.tradeName, f.genericName
          FROM Inventory i
          LEFT JOIN Formulary f ON i.drugId = f.drugId
          ORDER BY f.tradeName
        `);
        filename = `inventory_report_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
        
      case 'members':
        data = await runQuery('SELECT * FROM Members ORDER BY fullName');
        filename = `members_report_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
        
      case 'staffs':
        data = await runQuery('SELECT * FROM Staff ORDER BY fullName');
        filename = `staffs_report_${new Date().toISOString().slice(0, 10)}.csv`;
        break;
        
      default:
        return res.status(400).json({ error: 'ไม่พบประเภทรายงานที่ระบุ' });
    }
    
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
    
    // ส่งไฟล์ CSV กลับไป
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
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

// รัน server
app.listen(port, () => {
  console.log(`Server กำลังรันที่ http://localhost:${port}`);
});