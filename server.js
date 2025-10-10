const express = require('express');
const cors = require('cors');
const { db, dbPath } = require('./db');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const bcrypt = require('bcryptjs'); // เพิ่ม module สำหรับ hashing รหัสผ่าน
const jwt = require('jsonwebtoken'); // เพิ่ม module สำหรับ JWT
const packageJson = require('./package.json');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text({ type: 'text/plain' }));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
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

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม'
];

function parseReferenceDate(referenceDate) {
  if (!referenceDate) {
    return new Date();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    const [year, month, day] = referenceDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  if (/^\d{4}-\d{2}$/.test(referenceDate)) {
    const [year, month] = referenceDate.split('-').map(Number);
    return new Date(year, month - 1, 1);
  }

  if (/^\d{4}$/.test(referenceDate)) {
    const year = Number(referenceDate);
    return new Date(year, 0, 1);
  }

  const parsed = new Date(referenceDate);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

function formatThaiDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const day = date.getDate();
  const monthName = THAI_MONTHS[date.getMonth()] || '';
  const year = date.getFullYear() + 543;
  return `${day} ${monthName} ${year}`.trim();
}

function formatThaiDateRange(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    return '';
  }
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return '';
  }

  if (startDate.toDateString() === endDate.toDateString()) {
    return formatThaiDate(startDate);
  }

  const sameMonth =
    startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();

  if (sameMonth) {
    const monthName = THAI_MONTHS[startDate.getMonth()] || '';
    const year = startDate.getFullYear() + 543;
    return `${startDate.getDate()}-${endDate.getDate()} ${monthName} ${year}`.trim();
  }

  return `${formatThaiDate(startDate)} - ${formatThaiDate(endDate)}`.trim();
}

function getPeriodRangeWithReference(period, referenceDate) {
  const baseDate = parseReferenceDate(referenceDate);
  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  baseDate.setHours(0, 0, 0, 0);
  const start = new Date(baseDate);
  const end = new Date(baseDate);
  let label = '';

  switch (period) {
    case 'daily':
      end.setHours(23, 59, 59, 999);
      label = `รายวัน (${formatThaiDate(start)})`;
      break;
    case 'weekly': {
      const day = start.getDay();
      const diff = (day === 0 ? -6 : 1) - day; // start on Monday
      start.setDate(start.getDate() + diff);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      label = `รายสัปดาห์ (${formatThaiDateRange(start, end)})`;
      break;
    }
    case 'monthly':
      start.setDate(1);
      end.setTime(start.getTime());
      end.setMonth(start.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      label = `รายเดือน (${THAI_MONTHS[start.getMonth()] || ''} ${start.getFullYear() + 543})`;
      break;
    case 'quarterly': {
      const quarter = Math.floor(start.getMonth() / 3) + 1;
      const quarterStartMonth = (quarter - 1) * 3;
      start.setMonth(quarterStartMonth, 1);
      end.setMonth(quarterStartMonth + 3, 0);
      end.setHours(23, 59, 59, 999);
      label = `รายไตรมาส (ไตรมาส ${quarter}/${start.getFullYear() + 543})`;
      break;
    }
    case 'yearly':
      start.setMonth(0, 1);
      end.setFullYear(start.getFullYear() + 1, 0, 0);
      end.setHours(23, 59, 59, 999);
      label = `รายปี (${start.getFullYear() + 543})`;
      break;
    default:
      return null;
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label,
    startDate: start,
    endDate: end,
    displayRange: formatThaiDateRange(start, end)
  };
}

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

const CONTROLLED_KEYWORDS = ['ยาควบคุม', 'ยาเสพติด', 'วัตถุออกฤทธิ์'];

function calculateLineTotal(quantity, pricePerUnit) {
  const qty = Number(quantity) || 0;
  const price = Number(pricePerUnit) || 0;
  return qty * price;
}

function formatNumber(value, fractionDigits = 2) {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return '0';
  }
  return num.toLocaleString('th-TH', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

async function buildKpiReport(period = 'monthly', referenceDate = null) {
  const range = getPeriodRangeWithReference(period, referenceDate);
  if (!range) {
    throw new Error('รูปแบบช่วงเวลารายงานไม่ถูกต้อง');
  }

  const { start, end } = range;
  const [salesRows, inventoryRows, lastSalesRows] = await Promise.all([
    runQuery(
      `SELECT s.saleId, s.saleDate, s.memberId, s.pharmacistId, s.pharmacist, s.totalAmount,
              s.quantitySold, s.pricePerUnit, s.drugId, s.lotNumber,
              f.tradeName, f.genericName, f.pharmaCategory, f.legalCategory
       FROM Sales s
       LEFT JOIN Formulary f ON s.drugId = f.drugId
       WHERE s.saleDate >= ? AND s.saleDate <= ?
       ORDER BY s.saleDate ASC`,
      [start, end]
    ),
    runQuery(
      `SELECT i.inventoryId, i.drugId, i.lotNumber, i.expiryDate, i.quantity,
              i.costPrice, i.sellingPrice, i.referenceId, i.barcode, i.dateReceived,
              f.tradeName, f.genericName, f.pharmaCategory, f.legalCategory,
              f.minStock, f.maxStock
       FROM Inventory i
       LEFT JOIN Formulary f ON i.drugId = f.drugId`
    ),
    runQuery(
      `SELECT drugId, MAX(saleDate) as lastSaleDate
       FROM Sales
       GROUP BY drugId`
    )
  ]);

  const saleTotalsById = new Map();
  const uniqueCustomers = new Set();
  const productMap = new Map();
  const categoryMap = new Map();
  const legalSummaryMap = new Map();
  const thaiFdaTransactions = [];

  let totalRevenue = 0;
  let totalUnitsSold = 0;
  let dangerousCount = 0;
  let controlledCount = 0;

  salesRows.forEach((row) => {
    const lineTotal = calculateLineTotal(row.quantitySold, row.pricePerUnit);
    totalRevenue += lineTotal;
    totalUnitsSold += Number(row.quantitySold) || 0;

    if (row.memberId && row.memberId !== 'N/A') {
      uniqueCustomers.add(row.memberId);
    }

    if (!saleTotalsById.has(row.saleId)) {
      saleTotalsById.set(row.saleId, Number(row.totalAmount) || lineTotal);
    }

    const productKey = row.drugId || row.tradeName || row.saleId;
    if (!productMap.has(productKey)) {
      productMap.set(productKey, {
        drugId: row.drugId,
        tradeName: row.tradeName || 'ไม่ระบุชื่อการค้า',
        genericName: row.genericName || '',
        pharmaCategory: row.pharmaCategory || 'ไม่ระบุหมวด',
        quantitySold: 0,
        revenue: 0
      });
    }
    const productEntry = productMap.get(productKey);
    productEntry.quantitySold += Number(row.quantitySold) || 0;
    productEntry.revenue += lineTotal;

    const categoryKey = row.pharmaCategory || 'ไม่ระบุหมวด';
    if (!categoryMap.has(categoryKey)) {
      categoryMap.set(categoryKey, {
        pharmaCategory: categoryKey,
        quantitySold: 0,
        revenue: 0
      });
    }
    const categoryEntry = categoryMap.get(categoryKey);
    categoryEntry.quantitySold += Number(row.quantitySold) || 0;
    categoryEntry.revenue += lineTotal;

    const legalCategory = row.legalCategory || 'ไม่ระบุ';
    if (!legalSummaryMap.has(legalCategory)) {
      legalSummaryMap.set(legalCategory, {
        category: legalCategory,
        transactions: 0,
        quantity: 0,
        revenue: 0
      });
    }
    const legalEntry = legalSummaryMap.get(legalCategory);
    legalEntry.transactions += 1;
    legalEntry.quantity += Number(row.quantitySold) || 0;
    legalEntry.revenue += lineTotal;

    const normalizedLegal = legalCategory.toLowerCase();
    const isDangerous = normalizedLegal.includes('ยาอันตราย');
    const isControlled = CONTROLLED_KEYWORDS.some((keyword) => normalizedLegal.includes(keyword));

    if (isDangerous) {
      dangerousCount += 1;
    }
    if (isControlled) {
      controlledCount += 1;
    }

    if (isDangerous || isControlled) {
      thaiFdaTransactions.push({
        saleId: row.saleId,
        saleDate: row.saleDate,
        tradeName: row.tradeName || row.drugId,
        legalCategory: row.legalCategory,
        quantitySold: row.quantitySold,
        pharmacistId: row.pharmacistId,
        pharmacist: row.pharmacist,
        lineTotal
      });
    }
  });

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const topCategories = Array.from(categoryMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const totalTransactions = saleTotalsById.size;
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  const perDrugInventory = new Map();
  let stockValue = 0;
  inventoryRows.forEach((row) => {
    const quantity = Number(row.quantity) || 0;
    const value = quantity * (Number(row.sellingPrice) || 0);
    stockValue += value;

    if (!perDrugInventory.has(row.drugId)) {
      perDrugInventory.set(row.drugId, {
        drugId: row.drugId,
        tradeName: row.tradeName || row.drugId,
        minStock: Number(row.minStock) || 0,
        maxStock: Number(row.maxStock) || 0,
        quantity: 0,
        lots: []
      });
    }

    const entry = perDrugInventory.get(row.drugId);
    entry.quantity += quantity;
    entry.lots.push({
      inventoryId: row.inventoryId,
      lotNumber: row.lotNumber,
      expiryDate: row.expiryDate,
      quantity,
      sellingPrice: Number(row.sellingPrice) || 0
    });
  });

  const totalUnits = Array.from(perDrugInventory.values()).reduce((acc, item) => acc + item.quantity, 0);

  const belowMin = Array.from(perDrugInventory.values())
    .filter((item) => item.minStock > 0 && item.quantity < item.minStock)
    .map((item) => ({
      drugId: item.drugId,
      tradeName: item.tradeName,
      quantity: item.quantity,
      minStock: item.minStock,
      diff: item.quantity - item.minStock
    }));

  const today = new Date();
  const nearExpiryThreshold = new Date();
  nearExpiryThreshold.setDate(today.getDate() + 90);

  const nearExpiry = inventoryRows
    .filter((row) => {
      if (!row.expiryDate) return false;
      const expiryDate = new Date(row.expiryDate);
      if (Number.isNaN(expiryDate.getTime())) return false;
      return expiryDate >= today && expiryDate <= nearExpiryThreshold;
    })
    .map((row) => {
      const expiryDate = new Date(row.expiryDate);
      const diffTime = expiryDate.getTime() - today.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return {
        inventoryId: row.inventoryId,
        drugId: row.drugId,
        tradeName: row.tradeName || row.drugId,
        lotNumber: row.lotNumber,
        expiryDate: row.expiryDate,
        quantity: Number(row.quantity) || 0,
        daysRemaining
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const slowMovingCutoff = new Date();
  slowMovingCutoff.setDate(today.getDate() - 90);
  const lastSalesMap = new Map();
  lastSalesRows.forEach((row) => {
    if (row.drugId) {
      lastSalesMap.set(row.drugId, row.lastSaleDate);
    }
  });

  const slowMoving = Array.from(perDrugInventory.values())
    .map((item) => {
      const lastSaleDate = lastSalesMap.get(item.drugId);
      return {
        drugId: item.drugId,
        tradeName: item.tradeName,
        quantity: item.quantity,
        lastSaleDate
      };
    })
    .filter((item) => {
      if (item.quantity <= 0) return false;
      if (!item.lastSaleDate) return true;
      const lastSale = new Date(item.lastSaleDate);
      return Number.isNaN(lastSale.getTime()) || lastSale < slowMovingCutoff;
    })
    .sort((a, b) => {
      const dateA = a.lastSaleDate ? new Date(a.lastSaleDate).getTime() : 0;
      const dateB = b.lastSaleDate ? new Date(b.lastSaleDate).getTime() : 0;
      return dateA - dateB;
    });

  return {
    meta: {
      period,
      label: range.label,
      start,
      end,
      displayRange: range.displayRange,
      generatedAt: new Date().toISOString(),
      referenceDate: referenceDate || null
    },
    sales: {
      totalRevenue,
      totalTransactions,
      avgTicket,
      totalUnitsSold,
      uniqueCustomers: uniqueCustomers.size,
      topProducts,
      topCategories
    },
    inventory: {
      totalSkus: perDrugInventory.size,
      totalLots: inventoryRows.length,
      totalUnits,
      stockValue,
      belowMin,
      nearExpiry,
      slowMoving
    },
    thaiFda: {
      summary: Array.from(legalSummaryMap.values()),
      transactions: thaiFdaTransactions,
      totalDangerous: dangerousCount,
      totalControlled: controlledCount
    }
  };
}

function stringifyCsvRows(rows) {
  if (!Array.isArray(rows)) {
    return '';
  }

  return rows
    .map((row) =>
      row
        .map((value) => {
          if (value === null || value === undefined) {
            return '';
          }
          const str = String(value);
          if (/[",\n]/.test(str)) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        })
        .join(',')
    )
    .join('\n');
}

function buildKpiCsvRows(report, sections = ['sales', 'inventory', 'thaiFda']) {
  if (!report || typeof report !== 'object') {
    return [];
  }

  const rows = [];
  const header = ['หมวด', 'หัวข้อ', 'ค่า', 'รายละเอียดเพิ่มเติม 1', 'รายละเอียดเพิ่มเติม 2', 'รายละเอียดเพิ่มเติม 3'];
  rows.push(header);

  const meta = report.meta || {};
  const startDate = meta.start ? new Date(meta.start) : null;
  const endDate = meta.end ? new Date(meta.end) : null;
  const generatedAt = meta.generatedAt ? new Date(meta.generatedAt) : null;
  rows.push([
    'เมตา',
    'ช่วงเวลารายงาน',
    meta.displayRange || '-',
    startDate ? `เริ่ม ${formatThaiDate(startDate)}` : '',
    endDate ? `สิ้นสุด ${formatThaiDate(endDate)}` : '',
    generatedAt ? `ออกรายงาน ${formatThaiDate(generatedAt)}` : ''
  ]);

  if (sections.includes('sales') && report.sales) {
    const sales = report.sales;
    rows.push(['งานขาย', 'ยอดขายรวม (บาท)', formatNumber(sales.totalRevenue), '', '', '']);
    rows.push(['งานขาย', 'จำนวนธุรกรรม', formatNumber(sales.totalTransactions, 0), '', '', '']);
    rows.push(['งานขาย', 'ยอดซื้อเฉลี่ยต่อบิล (บาท)', formatNumber(sales.avgTicket), '', '', '']);
    rows.push(['งานขาย', 'จำนวนหน่วยที่ขาย', formatNumber(sales.totalUnitsSold, 0), '', '', '']);
    rows.push(['งานขาย', 'จำนวนสมาชิกที่ซื้อ', formatNumber(sales.uniqueCustomers, 0), '', '', '']);

    if (Array.isArray(sales.topProducts) && sales.topProducts.length > 0) {
      sales.topProducts.forEach((product, index) => {
        rows.push([
          'งานขาย-สินค้าขายดี',
          `อันดับ ${index + 1}`,
          product.tradeName || product.drugId || '-',
          product.genericName ? `ชื่อสามัญ ${product.genericName}` : '',
          `ขาย ${formatNumber(product.quantitySold, 0)} หน่วย`,
          `รายได้ ${formatNumber(product.revenue)} บาท`
        ]);
      });
    }

    if (Array.isArray(sales.topCategories) && sales.topCategories.length > 0) {
      sales.topCategories.forEach((category) => {
        rows.push([
          'งานขาย-หมวดสินค้า',
          category.pharmaCategory || '-',
          '',
          `ขาย ${formatNumber(category.quantitySold, 0)} หน่วย`,
          `รายได้ ${formatNumber(category.revenue)} บาท`,
          ''
        ]);
      });
    }
  }

  if (sections.includes('inventory') && report.inventory) {
    const inventory = report.inventory;
    rows.push(['งานคลัง', 'จำนวน SKU ทั้งหมด', formatNumber(inventory.totalSkus, 0), '', '', '']);
    rows.push(['งานคลัง', 'จำนวน Lot ทั้งหมด', formatNumber(inventory.totalLots, 0), '', '', '']);
    rows.push(['งานคลัง', 'จำนวนหน่วยคงคลัง', formatNumber(inventory.totalUnits, 0), '', '', '']);
    rows.push(['งานคลัง', 'มูลค่าสินค้าคงคลัง (บาท)', formatNumber(inventory.stockValue), '', '', '']);

    if (Array.isArray(inventory.belowMin) && inventory.belowMin.length > 0) {
      inventory.belowMin.forEach((item) => {
        rows.push([
          'งานคลัง-ต่ำกว่า Min',
          item.tradeName || item.drugId || '-',
          '',
          `คงเหลือ ${formatNumber(item.quantity, 0)} หน่วย`,
          `ขั้นต่ำ ${formatNumber(item.minStock, 0)} หน่วย`,
          ''
        ]);
      });
    }

    if (Array.isArray(inventory.nearExpiry) && inventory.nearExpiry.length > 0) {
      inventory.nearExpiry.forEach((item) => {
        const expiryDate = item.expiryDate ? new Date(item.expiryDate) : null;
        rows.push([
          'งานคลัง-ใกล้หมดอายุ',
          `${item.tradeName || item.drugId || '-'} (Lot ${item.lotNumber || '-'})`,
          expiryDate ? formatThaiDate(expiryDate) : '-',
          `คงเหลือ ${formatNumber(item.quantity, 0)} หน่วย`,
          `เหลือ ${formatNumber(item.daysRemaining, 0)} วัน`,
          ''
        ]);
      });
    }

    if (Array.isArray(inventory.slowMoving) && inventory.slowMoving.length > 0) {
      inventory.slowMoving.forEach((item) => {
        const lastSaleDate = item.lastSaleDate ? new Date(item.lastSaleDate) : null;
        rows.push([
          'งานคลัง-ขายช้า',
          item.tradeName || item.drugId || '-',
          '',
          `คงเหลือ ${formatNumber(item.quantity, 0)} หน่วย`,
          lastSaleDate ? `ขายล่าสุด ${formatThaiDate(lastSaleDate)}` : 'ยังไม่เคยขาย',
          ''
        ]);
      });
    }
  }

  if (sections.includes('thaiFda') && report.thaiFda) {
    const thaiFda = report.thaiFda;
    rows.push([
      'รายงาน อย.',
      'จำนวนรายการยาอันตราย',
      formatNumber(thaiFda.totalDangerous, 0),
      '',
      '',
      ''
    ]);
    rows.push([
      'รายงาน อย.',
      'จำนวนรายการยาควบคุม/วัตถุออกฤทธิ์',
      formatNumber(thaiFda.totalControlled, 0),
      '',
      '',
      ''
    ]);

    if (Array.isArray(thaiFda.summary) && thaiFda.summary.length > 0) {
      thaiFda.summary.forEach((item) => {
        rows.push([
          'รายงาน อย.-สรุป',
          item.category || '-',
          '',
          `ธุรกรรม ${formatNumber(item.transactions, 0)} ครั้ง`,
          `ปริมาณ ${formatNumber(item.quantity, 0)} หน่วย`,
          `มูลค่า ${formatNumber(item.revenue)} บาท`
        ]);
      });
    }

    if (Array.isArray(thaiFda.transactions) && thaiFda.transactions.length > 0) {
      thaiFda.transactions.forEach((txn, index) => {
        const saleDate = txn.saleDate ? new Date(txn.saleDate) : null;
        const categoryInfo = txn.legalCategory ? `ประเภท ${txn.legalCategory}` : '';
        const quantityInfo = `จำนวน ${formatNumber(txn.quantitySold, 0)} หน่วย`;
        const pharmacistInfo = txn.pharmacist
          ? `ผู้ขาย ${txn.pharmacist}${txn.pharmacistId ? ` (${txn.pharmacistId})` : ''}`
          : '';
        const valueInfo = `มูลค่า ${formatNumber(txn.lineTotal)} บาท`;
        const detailTwo = [categoryInfo, quantityInfo].filter(Boolean).join(' | ');
        const detailThree = [pharmacistInfo, valueInfo].filter(Boolean).join(' | ');
        rows.push([
          'รายงาน อย.-รายการ',
          `ลำดับ ${index + 1}`,
          txn.tradeName || txn.saleId || '-',
          saleDate ? formatThaiDate(saleDate) : '-',
          detailTwo,
          detailThree
        ]);
      });
    }
  }

  return rows;
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

app.put('/api/drugs/:drugId', authenticateToken, async (req, res) => {
  try {
    const drugId = req.params.drugId;
    const existing = await runQuery('SELECT drugId, tradeName FROM Formulary WHERE drugId = ?', [drugId]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการยาที่ต้องการแก้ไข' });
    }

    const payload = req.body || {};
    await runStatement(
      `UPDATE Formulary
       SET tradeName = ?, genericName = ?, legalCategory = ?, pharmaCategory = ?,
           strength = ?, unit = ?, indication = ?, caution = ?, imageUrl = ?,
           interaction1 = ?, interaction2 = ?, interaction3 = ?, interaction4 = ?, interaction5 = ?,
           minStock = ?, maxStock = ?
       WHERE drugId = ?`,
      [
        payload.tradeName,
        payload.genericName,
        payload.legalCategory,
        payload.pharmaCategory,
        payload.strength,
        payload.unit,
        payload.indication,
        payload.caution,
        payload.imageUrl,
        payload.interaction1,
        payload.interaction2,
        payload.interaction3,
        payload.interaction4,
        payload.interaction5,
        payload.minStock,
        payload.maxStock,
        drugId
      ]
    );

    res.json({ status: 'success' });
    await logActivity('FORMULARY_UPDATE', `แก้ไขข้อมูลยา ${payload.tradeName || drugId}`, {
      entity: 'Formulary',
      entityId: drugId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/drugs', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบรายการยาได้' });
  }
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

app.put('/api/members/:memberId', authenticateToken, async (req, res) => {
  try {
    const memberId = req.params.memberId;
    const existing = await runQuery('SELECT memberId, fullName FROM Members WHERE memberId = ?', [memberId]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'ไม่พบสมาชิกที่ต้องการแก้ไข' });
    }

    const payload = req.body || {};
    await runStatement(
      `UPDATE Members
       SET fullName = ?, nationalId = ?, dob = ?, phone = ?, allergies = ?, disease = ?
       WHERE memberId = ?`,
      [
        payload.fullName,
        payload.nationalId,
        payload.dob,
        payload.phone,
        payload.allergies,
        payload.disease,
        memberId
      ]
    );

    res.json({ status: 'success' });
    await logActivity('MEMBER_UPDATE', `แก้ไขข้อมูลสมาชิก ${payload.fullName || memberId}`, {
      entity: 'Member',
      entityId: memberId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/members', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบสมาชิกได้' });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const uniqueIds = [...new Set(ids.filter(id => typeof id === 'string' && id.trim() !== ''))];

  if (uniqueIds.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกรายการสมาชิกที่ต้องการลบอย่างน้อย 1 รายการ' });
  }

  const deleted = [];
  const blocked = [];
  let inTransaction = false;

  try {
    await runStatement('BEGIN TRANSACTION');
    inTransaction = true;

    for (const memberId of uniqueIds) {
      const memberRecords = await runQuery('SELECT memberId, fullName FROM Members WHERE memberId = ?', [memberId]);
      if (memberRecords.length === 0) {
        blocked.push({ memberId, reason: 'ไม่พบข้อมูลสมาชิกในระบบ' });
        continue;
      }

      const [{ fullName }] = memberRecords;
      const salesUsage = await runQuery('SELECT COUNT(*) as count FROM Sales WHERE memberId = ?', [memberId]);
      const salesCount = salesUsage[0]?.count || 0;

      if (salesCount > 0) {
        blocked.push({ memberId, fullName, reason: `มีประวัติการซื้อ ${salesCount} รายการ` });
        continue;
      }

      const result = await runStatement('DELETE FROM Members WHERE memberId = ?', [memberId]);

      if (result.changes > 0) {
        deleted.push({ memberId, fullName });
        await logActivity('MEMBER_DELETE', `ลบสมาชิก ${fullName || memberId}`, {
          entity: 'Member',
          entityId: memberId,
          performedBy: req.user?.username || null
        });
      } else {
        blocked.push({ memberId, fullName, reason: 'ไม่สามารถลบสมาชิกได้' });
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
    console.error('Delete members error:', error);
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
    const payload = req.body || {};
    const saleId = generateId();
    const saleDate = new Date().toISOString();
    const memberId = payload.memberId || 'N/A';
    const pharmacistId = payload.pharmacistId || null;
    const pharmacistName = payload.pharmacistName || payload.pharmacist || null;
    const totalAmount = Number(payload.total || 0);

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      return res.status(400).json({ error: 'ไม่มีรายการสินค้าที่จะบันทึกการขาย' });
    }

    if (!pharmacistName || !pharmacistId) {
      return res.status(400).json({ error: 'กรุณาเลือกผู้ขายจากรายชื่อเจ้าหน้าที่' });
    }

    console.log('Payload ที่ได้รับ:', payload); // เพิ่ม log สำหรับ debugging

    // บันทึกข้อมูลการขายแต่ละรายการ
    for (const item of payload.items) {
      console.log('กำลังบันทึก item:', item); // เพิ่ม log สำหรับ debugging

      await runStatement(
        `INSERT INTO Sales
        (saleId, saleDate, memberId, pharmacistId, pharmacist, totalAmount, inventoryId,
         quantitySold, pricePerUnit, drugId, lotNumber)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          saleDate,
          memberId,
          pharmacistId,
          pharmacistName,
          totalAmount,
          item.inventoryId,
          item.quantity,
          Number(item.price),
          item.drugId,
          item.lot || 'N/A'
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
    const saleValueText = Number.isFinite(totalAmount) ? totalAmount.toFixed(2) : '0.00';
    await logActivity(
      'SALE_CREATE',
      `บันทึกการขายยอดรวม ${saleValueText} บาท โดย ${pharmacistName} (${pharmacistId})`,
      {
        entity: 'Sales',
        entityId: saleId,
        performedBy: req.user?.username || pharmacistName || null
      }
    );
  } catch (error) {
    console.error('Error processing sale:', error); // เพิ่ม log สำหรับ debugging
    res.status(500).json({ error: error.message });
  }
});

// สร้าง route สำหรับหน้าหลักให้ใช้ไฟล์เดียวกับที่พัฒนา
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// รองรับเส้นทางเดิมสำหรับ index_sqlite โดยเปลี่ยนไปใช้ไฟล์หลัก
app.get('/index_sqlite.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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

app.put('/api/staffs/:staffId', authenticateToken, async (req, res) => {
  try {
    const staffId = req.params.staffId;
    const existing = await runQuery('SELECT staffId, fullName FROM Staff WHERE staffId = ?', [staffId]);

    if (existing.length === 0) {
      return res.status(404).json({ error: 'ไม่พบเจ้าหน้าที่ที่ต้องการแก้ไข' });
    }

    const payload = req.body || {};
    await runStatement(
      `UPDATE Staff
       SET fullName = ?, licenseNumber = ?, position = ?, phone = ?, email = ?
       WHERE staffId = ?`,
      [
        payload.fullName,
        payload.licenseNumber,
        payload.position,
        payload.phone,
        payload.email,
        staffId
      ]
    );

    res.json({ status: 'success' });
    await logActivity('STAFF_UPDATE', `แก้ไขข้อมูลเจ้าหน้าที่ ${payload.fullName || staffId}`, {
      entity: 'Staff',
      entityId: staffId,
      performedBy: req.user?.username || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/staffs', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบเจ้าหน้าที่ได้' });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const uniqueIds = [...new Set(ids.filter(id => typeof id === 'string' && id.trim() !== ''))];

  if (uniqueIds.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกรายการเจ้าหน้าที่ที่ต้องการลบอย่างน้อย 1 รายการ' });
  }

  const deleted = [];
  const blocked = [];
  let inTransaction = false;

  try {
    await runStatement('BEGIN TRANSACTION');
    inTransaction = true;

    for (const staffId of uniqueIds) {
      const staffRecords = await runQuery('SELECT staffId, fullName FROM Staff WHERE staffId = ?', [staffId]);
      if (staffRecords.length === 0) {
        blocked.push({ staffId, reason: 'ไม่พบข้อมูลเจ้าหน้าที่ในระบบ' });
        continue;
      }

      const [{ fullName }] = staffRecords;
      const result = await runStatement('DELETE FROM Staff WHERE staffId = ?', [staffId]);

      if (result.changes > 0) {
        deleted.push({ staffId, fullName });
        await logActivity('STAFF_DELETE', `ลบเจ้าหน้าที่ ${fullName || staffId}`, {
          entity: 'Staff',
          entityId: staffId,
          performedBy: req.user?.username || null
        });
      } else {
        blocked.push({ staffId, fullName, reason: 'ไม่สามารถลบเจ้าหน้าที่ได้' });
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
    console.error('Delete staffs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API สำหรับดูประวัติการซื้อของสมาชิก
app.get('/api/member/:memberId/purchases', authenticateToken, async (req, res) => {
  try {
    const memberId = req.params.memberId;
    const purchases = await runQuery(
      `SELECT s.saleId, s.saleDate, f.tradeName, f.genericName, s.quantitySold,
       s.pricePerUnit, (s.quantitySold * s.pricePerUnit) as totalItemPrice, s.pharmacistId, s.pharmacist
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
        pharmacistId,
        pharmacist,
        COUNT(*) as transactionCount,
        SUM(totalAmount) as totalSales
      FROM Sales
      GROUP BY pharmacistId, pharmacist
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
      'รหัสผู้ขาย': sale.pharmacistId || '-',
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
      'รหัสผู้ขาย': sale.pharmacistId || '-',
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
      'รหัสผู้ขาย': sale.pharmacistId || '-',
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
      'รหัสผู้ขาย': sale.pharmacistId || '-',
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

app.get('/api/reports/kpi', authenticateToken, async (req, res) => {
  try {
    const { period = 'monthly', referenceDate = null } = req.query;
    const report = await buildKpiReport(period, referenceDate);
    await logActivity('REPORT_VIEW', `สร้างรายงาน KPI (${report.meta?.label || period})`, {
      entity: 'Report',
      entityId: `kpi-${period}`,
      performedBy: req.user?.username || null
    });
    res.json(report);
  } catch (error) {
    console.error('KPI report error:', error);
    res.status(400).json({ error: error.message });
  }
});

// API สำหรับ export รายงานเป็น CSV
app.get('/api/export/:reportType', authenticateToken, async (req, res) => {
  try {
    const { reportType } = req.params;
    const { period: periodQuery = 'monthly', referenceDate = null } = req.query;
    let data = [];
    let filenameBase = '';
    let exportLabel = '';
    let csvContent = '';
    let isCustomCsv = false;
    let reportSections = [];
    let kpiReport = null;

    switch(reportType) {
      case 'sales':
        data = await runQuery(`
          SELECT s.saleId, s.saleDate, m.fullName as memberName, s.pharmacistId, s.pharmacist,
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

      case 'kpi':
      case 'kpi-all':
      case 'kpi_all':
        kpiReport = await buildKpiReport(periodQuery, referenceDate);
        reportSections = ['sales', 'inventory', 'thaiFda'];
        csvContent = stringifyCsvRows(buildKpiCsvRows(kpiReport, reportSections));
        filenameBase = 'kpi_full_report';
        exportLabel = `รายงาน KPI ครบมิติ (${kpiReport.meta?.label || periodQuery})`;
        isCustomCsv = true;
        break;

      case 'kpi-sales':
      case 'kpi_sales':
        kpiReport = await buildKpiReport(periodQuery, referenceDate);
        reportSections = ['sales'];
        csvContent = stringifyCsvRows(buildKpiCsvRows(kpiReport, reportSections));
        filenameBase = 'kpi_sales_report';
        exportLabel = `รายงาน KPI งานขาย (${kpiReport.meta?.label || periodQuery})`;
        isCustomCsv = true;
        break;

      case 'kpi-inventory':
      case 'kpi_inventory':
        kpiReport = await buildKpiReport(periodQuery, referenceDate);
        reportSections = ['inventory'];
        csvContent = stringifyCsvRows(buildKpiCsvRows(kpiReport, reportSections));
        filenameBase = 'kpi_inventory_report';
        exportLabel = `รายงาน KPI งานคลัง (${kpiReport.meta?.label || periodQuery})`;
        isCustomCsv = true;
        break;

      case 'kpi-thai-fda':
      case 'kpi_thai_fda':
      case 'kpi-thai_fda':
        kpiReport = await buildKpiReport(periodQuery, referenceDate);
        reportSections = ['thaiFda'];
        csvContent = stringifyCsvRows(buildKpiCsvRows(kpiReport, reportSections));
        filenameBase = 'kpi_thai_fda_report';
        exportLabel = `รายงานส่ง อย. (${kpiReport.meta?.label || periodQuery})`;
        isCustomCsv = true;
        break;

      default:
        return res.status(400).json({ error: 'ไม่พบประเภทรายงานที่ระบุ' });
    }

    if (isCustomCsv) {
      if (!csvContent) {
        return res.status(404).json({ error: 'ไม่พบข้อมูล' });
      }

      const filename = `${filenameBase}_${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await logActivity('EXPORT_CSV', `ส่งออก${exportLabel}`, {
        entity: 'Report',
        entityId: reportType,
        performedBy: req.user?.username || null
      });
      return res.send(Buffer.from(`\uFEFF${csvContent}`, 'utf8'));
    }

    const filename = `${filenameBase}_${new Date().toISOString().slice(0, 10)}.csv`;

    // สร้าง CSV content
    if (data.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    }
    
    // สร้าง headers จาก keys ของข้อมูล
    const headers = Object.keys(data[0]);
    let standardCsvContent = headers.join(',') + '\n';
    
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
      standardCsvContent += values.join(',') + '\n';
    });
    
    // ส่งไฟล์ CSV กลับไป (เพิ่ม BOM เพื่อรองรับภาษาไทย)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await logActivity('EXPORT_CSV', `ส่งออก${exportLabel}`, {
      entity: 'Report',
      entityId: reportType,
      performedBy: req.user?.username || null
    });
    const csvBuffer = Buffer.from(`\uFEFF${standardCsvContent}`, 'utf8');
    res.send(csvBuffer);

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

app.get('/api/build-info', (req, res) => {
  try {
    const indexPath = path.join(__dirname, 'index.html');
    const serverPath = __filename;
    const info = {
      branch: process.env.RAILWAY_GIT_BRANCH || process.env.GIT_BRANCH || null,
      commit: process.env.RAILWAY_GIT_COMMIT || process.env.GIT_COMMIT || null,
      apiVersion: packageJson.version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      indexUpdatedAt: null,
      serverUpdatedAt: null
    };

    if (fs.existsSync(indexPath)) {
      const stats = fs.statSync(indexPath);
      info.indexUpdatedAt = stats.mtime.toISOString();
    }

    if (fs.existsSync(serverPath)) {
      const stats = fs.statSync(serverPath);
      info.serverUpdatedAt = stats.mtime.toISOString();
    }

    res.json(info);
  } catch (error) {
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
      'รหัสผู้ขาย': sale.pharmacistId || '-',
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

const REPLACEMENT_CHAR = '\uFFFD';

const THAI_FORMULARY_SEED = [
  {
    drugId: 'DRG001',
    tradeName: 'พาราเซตามอล 500 มก.',
    genericName: 'Paracetamol',
    legalCategory: 'ยาสามัญประจำบ้าน',
    pharmaCategory: 'ยาแก้ปวด ลดไข้',
    strength: '500 mg',
    unit: 'เม็ด',
    indication: 'ลดไข้ บรรเทาอาการปวดเล็กน้อย',
    caution: 'หลีกเลี่ยงการใช้เกินขนาดและแอลกอฮอล์',
    minStock: 30,
    maxStock: 300
  },
  {
    drugId: 'DRG002',
    tradeName: 'ไอบูโพรเฟน 400 มก.',
    genericName: 'Ibuprofen',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาแก้อักเสบ ลดไข้',
    strength: '400 mg',
    unit: 'เม็ด',
    indication: 'บรรเทาปวดอักเสบจากกล้ามเนื้อและข้อ',
    caution: 'รับประทานพร้อมอาหารเพื่อลดการระคายเคืองกระเพาะ',
    minStock: 20,
    maxStock: 200
  },
  {
    drugId: 'DRG003',
    tradeName: 'ไดโคลฟีแนค โซเดียม',
    genericName: 'Diclofenac',
    legalCategory: 'ยาควบคุมพิเศษ',
    pharmaCategory: 'ยาแก้อักเสบลดปวด (NSAIDs)',
    strength: '25 mg',
    unit: 'เม็ด',
    indication: 'บรรเทาปวดข้อ ปวดกล้ามเนื้อ',
    caution: 'ควรระวังในผู้ป่วยโรคไตและโรคกระเพาะ',
    minStock: 10,
    maxStock: 120
  },
  {
    drugId: 'DRG004',
    tradeName: 'นาพรอกเซน 250 มก.',
    genericName: 'Naproxen',
    legalCategory: 'ยาควบคุมพิเศษ',
    pharmaCategory: 'ยาแก้อักเสบลดปวด (NSAIDs)',
    strength: '250 mg',
    unit: 'เม็ด',
    indication: 'รักษาอาการปวดจากข้อเสื่อมและข้ออักเสบ',
    caution: 'ไม่ควรใช้ร่วมกับยาในกลุ่ม NSAIDs อื่น',
    minStock: 10,
    maxStock: 120
  },
  {
    drugId: 'DRG005',
    tradeName: 'แอสไพริน 81 มก.',
    genericName: 'Acetylsalicylic Acid',
    legalCategory: 'ยาควบคุมพิเศษ',
    pharmaCategory: 'ยาต้านเกล็ดเลือด',
    strength: '81 mg',
    unit: 'เม็ดเคลือบ',
    indication: 'ลดความเสี่ยงหัวใจขาดเลือดเฉียบพลัน',
    caution: 'ห้ามใช้ในเด็กที่มีไข้หรือหญิงตั้งครรภ์ไตรมาสสุดท้าย',
    minStock: 10,
    maxStock: 150
  },
  {
    drugId: 'DRG006',
    tradeName: 'อะม็อกซีซิลลิน 500 มก.',
    genericName: 'Amoxicillin',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'เพนิซิลลิน',
    strength: '500 mg',
    unit: 'แคปซูล',
    indication: 'รักษาการติดเชื้อทางเดินหายใจและผิวหนัง',
    caution: 'รับประทานให้ครบคอร์สแม้อาการดีขึ้น',
    minStock: 20,
    maxStock: 180
  },
  {
    drugId: 'DRG007',
    tradeName: 'คลอกซาซิลลิน 500 มก.',
    genericName: 'Cloxacillin',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'เพนิซิลลิน',
    strength: '500 mg',
    unit: 'แคปซูล',
    indication: 'รักษาการติดเชื้อจากเชื้อสแตฟีโลคอคคัส',
    caution: 'ควรรับประทานก่อนอาหาร 1 ชั่วโมง',
    minStock: 15,
    maxStock: 120
  },
  {
    drugId: 'DRG008',
    tradeName: 'อะม็อกซีซิลลิน/คลาวูลาเนต 625 มก.',
    genericName: 'Amoxicillin + Clavulanate',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'เพนิซิลลินผสม',
    strength: '500/125 mg',
    unit: 'เม็ด',
    indication: 'รักษาการติดเชื้อทางเดินหายใจรุนแรง',
    caution: 'รับประทานพร้อมอาหารเพื่อลดอาการคลื่นไส้',
    minStock: 10,
    maxStock: 100
  },
  {
    drugId: 'DRG009',
    tradeName: 'อะซิโทรไมซิน 250 มก.',
    genericName: 'Azithromycin',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'มาโครไลด์',
    strength: '250 mg',
    unit: 'แคปซูล',
    indication: 'รักษาการติดเชื้อระบบทางเดินหายใจและผิวหนัง',
    caution: 'รับประทานวันละครั้งตามคำแนะนำแพทย์',
    minStock: 10,
    maxStock: 90
  },
  {
    drugId: 'DRG010',
    tradeName: 'คลาริโทรไมซิน 500 มก.',
    genericName: 'Clarithromycin',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'มาโครไลด์',
    strength: '500 mg',
    unit: 'เม็ด',
    indication: 'รักษาการติดเชื้อทางเดินหายใจ ลำไส้ และผิวหนัง',
    caution: 'ระวังการใช้ร่วมกับยาลดไขมันกลุ่มสแตติน',
    minStock: 10,
    maxStock: 90
  },
  {
    drugId: 'DRG011',
    tradeName: 'เลโวฟลอกซาซิน 500 มก.',
    genericName: 'Levofloxacin',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'ควิโนโลนรุ่นใหม่',
    strength: '500 mg',
    unit: 'เม็ด',
    indication: 'รักษาปอดอักเสบและติดเชื้อระบบทางเดินปัสสาวะรุนแรง',
    caution: 'หลีกเลี่ยงการใช้ร่วมกับยาต้านกรดที่มีอะลูมิเนียม',
    minStock: 8,
    maxStock: 80
  },
  {
    drugId: 'DRG012',
    tradeName: 'ซิโพรฟลอกซาซิน 500 มก.',
    genericName: 'Ciprofloxacin',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'ควิโนโลน',
    strength: '500 mg',
    unit: 'เม็ด',
    indication: 'รักษาการติดเชื้อทางเดินปัสสาวะและทางเดินอาหาร',
    caution: 'หลีกเลี่ยงการออกแดดจัดในระหว่างใช้ยา',
    minStock: 12,
    maxStock: 120
  },
  {
    drugId: 'DRG013',
    tradeName: 'เมโทรนิดาโซล 400 มก.',
    genericName: 'Metronidazole',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'ยาต้านปรสิตและแบคทีเรียไม่ใช้ออกซิเจน',
    strength: '400 mg',
    unit: 'เม็ด',
    indication: 'รักษาโรคบิดมีตัวและติดเชื้อทางนรีเวช',
    caution: 'ห้ามดื่มแอลกอฮอล์ร่วมกับยา',
    minStock: 10,
    maxStock: 100
  },
  {
    drugId: 'DRG014',
    tradeName: 'ลอราทาดีน 10 มก.',
    genericName: 'Loratadine',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาต้านฮิสตามีนรุ่นที่ 2',
    strength: '10 mg',
    unit: 'เม็ด',
    indication: 'บรรเทาอาการแพ้และไข้ละอองฟาง',
    caution: 'อาจทำให้ง่วงในผู้ป่วยบางราย',
    minStock: 25,
    maxStock: 200
  },
  {
    drugId: 'DRG015',
    tradeName: 'เซทิริซีน 10 มก.',
    genericName: 'Cetirizine',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาต้านฮิสตามีนรุ่นที่ 2',
    strength: '10 mg',
    unit: 'เม็ด',
    indication: 'บรรเทาอาการแพ้และลมพิษ',
    caution: 'หลีกเลี่ยงการขับรถหากมีอาการง่วงนอน',
    minStock: 25,
    maxStock: 200
  },
  {
    drugId: 'DRG016',
    tradeName: 'เฟกโซเฟนาดีน 120 มก.',
    genericName: 'Fexofenadine',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาต้านฮิสตามีนรุ่นที่ 2',
    strength: '120 mg',
    unit: 'เม็ด',
    indication: 'รักษาอาการแพ้และลมพิษเรื้อรัง',
    caution: 'ไม่ควรรับประทานร่วมกับน้ำผลไม้บางชนิด',
    minStock: 20,
    maxStock: 180
  },
  {
    drugId: 'DRG017',
    tradeName: 'คลอร์เฟนิรามีน 4 มก.',
    genericName: 'Chlorpheniramine',
    legalCategory: 'ยาสามัญประจำบ้าน',
    pharmaCategory: 'ยาต้านฮิสตามีนรุ่นที่ 1',
    strength: '4 mg',
    unit: 'เม็ด',
    indication: 'บรรเทาอาการคัดจมูก น้ำมูกไหล',
    caution: 'ทำให้ง่วง ควรหลีกเลี่ยงการขับขี่',
    minStock: 40,
    maxStock: 240
  },
  {
    drugId: 'DRG018',
    tradeName: 'ลอเปอร์เอไมด์ 2 มก.',
    genericName: 'Loperamide',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยารักษาอาการท้องเสีย',
    strength: '2 mg',
    unit: 'แคปซูล',
    indication: 'บรรเทาอาการท้องเสียเฉียบพลัน',
    caution: 'ห้ามใช้ในเด็กอายุน้อยกว่า 2 ปี',
    minStock: 15,
    maxStock: 150
  },
  {
    drugId: 'DRG019',
    tradeName: 'ไดเมนไฮดริเนต 50 มก.',
    genericName: 'Dimenhydrinate',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาป้องกันอาการเมารถเมาเรือ',
    strength: '50 mg',
    unit: 'เม็ด',
    indication: 'ป้องกันและรักษาอาการเวียนศีรษะ คลื่นไส้จากการเดินทาง',
    caution: 'ควรรับประทานก่อนเดินทางอย่างน้อย 30 นาที',
    minStock: 12,
    maxStock: 120
  },
  {
    drugId: 'DRG020',
    tradeName: 'ไดไซโคลมีน 10 มก.',
    genericName: 'Dicyclomine',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาคลายกล้ามเนื้อเรียบทางเดินอาหาร',
    strength: '10 mg',
    unit: 'เม็ด',
    indication: 'รักษาอาการปวดเกร็งท้อง',
    caution: 'ระวังการใช้ในผู้สูงอายุและผู้ป่วยต้อหิน',
    minStock: 10,
    maxStock: 100
  },
  {
    drugId: 'DRG021',
    tradeName: 'บิสซาโคดิล 5 มก.',
    genericName: 'Bisacodyl',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาระบายกระตุ้นการบีบตัวของลำไส้',
    strength: '5 mg',
    unit: 'เม็ดเคลือบ',
    indication: 'รักษาอาการท้องผูกเฉียบพลัน',
    caution: 'ควรรับประทานก่อนนอนและดื่มน้ำมากเพียงพอ',
    minStock: 15,
    maxStock: 150
  },
  {
    drugId: 'DRG022',
    tradeName: 'ไซเลียม ฮัสก์',
    genericName: 'Psyllium Husk',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ใยอาหารเสริม',
    strength: '3.4 g',
    unit: 'ซองผง',
    indication: 'เพิ่มกากใยในลำไส้ ช่วยให้ขับถ่ายปกติ',
    caution: 'ต้องรับประทานกับน้ำอย่างน้อย 1 แก้ว',
    minStock: 8,
    maxStock: 80
  },
  {
    drugId: 'DRG023',
    tradeName: 'ออร์นิดาโซล 500 มก.',
    genericName: 'Ornidazole',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'ยาต้านโปรโตซัว',
    strength: '500 mg',
    unit: 'เม็ด',
    indication: 'รักษาโรคพยาธิในลำไส้และติดเชื้อทางนรีเวช',
    caution: 'ไม่ควรดื่มเครื่องดื่มแอลกอฮอล์ร่วม',
    minStock: 8,
    maxStock: 80
  },
  {
    drugId: 'DRG024',
    tradeName: 'เซฟาโดรซิล 500 มก.',
    genericName: 'Cefadroxil',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'เซฟาโลสปอรินรุ่นที่ 1',
    strength: '500 mg',
    unit: 'แคปซูล',
    indication: 'รักษาการติดเชื้อทางเดินหายใจและผิวหนัง',
    caution: 'ระวังในผู้ที่แพ้เพนิซิลลิน',
    minStock: 12,
    maxStock: 110
  },
  {
    drugId: 'DRG025',
    tradeName: 'เซฟิกซิม 200 มก.',
    genericName: 'Cefixime',
    legalCategory: 'ยาปฏิชีวนะ',
    pharmaCategory: 'เซฟาโลสปอรินรุ่นที่ 3',
    strength: '200 mg',
    unit: 'เม็ด',
    indication: 'รักษาการติดเชื้อทางเดินปัสสาวะและหูคอจมูก',
    caution: 'อาจทำให้ถ่ายเหลว ควรดื่มน้ำมากๆ',
    minStock: 10,
    maxStock: 90
  },
  {
    drugId: 'DRG026',
    tradeName: 'โพแทสเซียม คลอไรด์ 600 มก.',
    genericName: 'Potassium Chloride',
    legalCategory: 'ยาควบคุมพิเศษ',
    pharmaCategory: 'เกลือแร่ทดแทนโพแทสเซียม',
    strength: '600 mg',
    unit: 'เม็ดออกฤทธิ์ช้า',
    indication: 'รักษาภาวะโพแทสเซียมต่ำ',
    caution: 'ต้องรับประทานพร้อมอาหารหรือหลังอาหารทันที',
    minStock: 6,
    maxStock: 60
  },
  {
    drugId: 'DRG027',
    tradeName: 'แมกนีเซียม ไฮดรอกไซด์ ซัสเพนชัน',
    genericName: 'Magnesium Hydroxide',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'ยาลดกรดและยาระบายอ่อน',
    strength: '400 mg/5 mL',
    unit: 'สารแขวนตะกอน',
    indication: 'บรรเทาอาการกรดเกินและท้องผูกเล็กน้อย',
    caution: 'เขย่าขวดก่อนใช้ทุกครั้ง',
    minStock: 6,
    maxStock: 60
  },
  {
    drugId: 'DRG028',
    tradeName: 'โซเดียม ไบคาร์บอเนต',
    genericName: 'Sodium Bicarbonate',
    legalCategory: 'ยาสามัญประจำบ้าน',
    pharmaCategory: 'ยาลดกรด',
    strength: '500 mg',
    unit: 'ผง',
    indication: 'บรรเทาอาการกรดไหลย้อนและแน่นท้อง',
    caution: 'หลีกเลี่ยงการใช้ต่อเนื่องในผู้ป่วยโรคหัวใจ',
    minStock: 8,
    maxStock: 80
  },
  {
    drugId: 'DRG029',
    tradeName: 'กรดโฟลิก 5 มก.',
    genericName: 'Folic Acid',
    legalCategory: 'ยาบรรจุเสร็จ',
    pharmaCategory: 'วิตามินและแร่ธาตุ',
    strength: '5 mg',
    unit: 'เม็ด',
    indication: 'ป้องกันภาวะโลหิตจางจากการขาดโฟเลต',
    caution: 'เหมาะสำหรับสตรีวัยเจริญพันธุ์และหญิงตั้งครรภ์',
    minStock: 20,
    maxStock: 160
  },
  {
    drugId: 'DRG030',
    tradeName: 'ไฮโดรคอร์ติโซน ครีม 1%',
    genericName: 'Hydrocortisone',
    legalCategory: 'ยาควบคุมพิเศษ',
    pharmaCategory: 'ยาทาภายนอกแก้อักเสบ',
    strength: '1 %',
    unit: 'ครีม',
    indication: 'บรรเทาอาการแพ้ คัน และผื่นแดง',
    caution: 'ไม่ควรใช้ต่อเนื่องเกิน 2 สัปดาห์ในบริเวณกว้าง',
    minStock: 10,
    maxStock: 80
  }
];

function seedThaiFormularySet() {
  return new Promise((resolve, reject) => {
    const insertSql = `
      INSERT OR IGNORE INTO Formulary
      (drugId, tradeName, genericName, legalCategory, pharmaCategory, strength, unit,
       indication, caution, minStock, maxStock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = db.prepare(insertSql, (err) => {
      if (err) {
        reject(err);
      }
    });

    let index = 0;
    let inserted = 0;

    const finalizeAndUpdate = () => {
      stmt.finalize(async (err) => {
        if (err) {
          reject(err);
          return;
        }

        const pattern = `%${REPLACEMENT_CHAR}%`;

        try {
          const updates = await Promise.all(
            THAI_FORMULARY_SEED.map((drug) =>
              runStatement(
                `UPDATE Formulary
                   SET tradeName = ?, genericName = ?, legalCategory = ?, pharmaCategory = ?,
                       strength = ?, unit = ?, indication = ?, caution = ?,
                       minStock = CASE WHEN IFNULL(minStock, 0) = 0 THEN ? ELSE minStock END,
                       maxStock = CASE WHEN IFNULL(maxStock, 0) = 0 THEN ? ELSE maxStock END
                 WHERE drugId = ?
                   AND (
                     tradeName LIKE ? OR tradeName IS NULL OR TRIM(tradeName) = '' OR
                     genericName LIKE ? OR genericName IS NULL OR TRIM(genericName) = '' OR
                     legalCategory LIKE ? OR legalCategory IS NULL OR TRIM(legalCategory) = '' OR
                     pharmaCategory LIKE ? OR pharmaCategory IS NULL OR TRIM(pharmaCategory) = '' OR
                     indication LIKE ? OR indication IS NULL OR TRIM(indication) = '' OR
                     caution LIKE ? OR caution IS NULL OR TRIM(caution) = ''
                   )`,
                [
                  drug.tradeName,
                  drug.genericName,
                  drug.legalCategory,
                  drug.pharmaCategory,
                  drug.strength,
                  drug.unit,
                  drug.indication,
                  drug.caution,
                  drug.minStock,
                  drug.maxStock,
                  drug.drugId,
                  pattern,
                  pattern,
                  pattern,
                  pattern,
                  pattern,
                  pattern
                ]
              ).then((result) => result.changes || 0).catch((error) => {
                console.error(`Error normalizing drug ${drug.drugId}:`, error.message);
                return 0;
              })
            )
          );

          const normalized = updates.reduce((sum, value) => sum + value, 0);
          resolve({ inserted, normalized });
        } catch (updateError) {
          reject(updateError);
        }
      });
    };

    const runNext = () => {
      if (index >= THAI_FORMULARY_SEED.length) {
        finalizeAndUpdate();
        return;
      }

      const drug = THAI_FORMULARY_SEED[index++];
      stmt.run(
        [
          drug.drugId,
          drug.tradeName,
          drug.genericName,
          drug.legalCategory,
          drug.pharmaCategory,
          drug.strength,
          drug.unit,
          drug.indication,
          drug.caution,
          drug.minStock,
          drug.maxStock
        ],
        function(err) {
          if (err) {
            console.error(`Error seeding drug ${drug.drugId}:`, err.message);
          } else if (this.changes > 0) {
            inserted += 1;
          }
          runNext();
        }
      );
    };

    runNext();
  });
}

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
        db.get("SELECT COUNT(*) as count FROM Formulary", async (err, row) => {
          if (err) {
            console.error('Error checking formulary:', err.message);
            resolve();
            return;
          }

          try {
            const result = await seedThaiFormularySet();
            if (result.inserted > 0 || result.normalized > 0) {
              console.log(`Ensured Thai formulary seed set (added ${result.inserted}, normalized ${result.normalized})`);
            } else if ((row?.count || 0) === 0) {
              console.warn('Formulary table is empty even after attempting to seed sample data');
            }
          } catch (seedError) {
            console.error('Error ensuring Thai formulary seed:', seedError.message);
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