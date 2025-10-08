/**
 * ไฟล์สำหรับแปลงข้อมูลจาก Google Sheets ไปยัง SQLite
 * ใช้สำหรับย้ายข้อมูลจากระบบเดิมมายังระบบใหม่
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// เชื่อมต่อกับฐานข้อมูล
const dbPath = path.resolve(__dirname, 'pharmacy.db');
const db = new sqlite3.Database(dbPath);

// ข้อมูลจำลองจาก Google Sheets (ในรูปแบบ JSON)
// ในงานจริง คุณจะต้องดึงข้อมูลจาก Google Sheets API หรือคัดลอกจาก export file

const sampleData = {
  Members: [
    {
      memberId: "MEM001",
      fullName: "สมชาย ใจดี",
      nationalId: "1234567890123",
      dob: "1980-05-15",
      phone: "0812345678",
      allergies: JSON.stringify([{genericName: "Penicillin", reaction: "ผื่นคัน"}]),
      disease: "ความดันโลหิตสูง",
      dateCreated: "2024-01-15"
    }
  ],
  Formulary: [
    {
      drugId: "DRG001",
      tradeName: "พาราเซตามอล",
      genericName: "Paracetamol",
      legalCategory: "ยาบรรจุเสร็จ",
      pharmaCategory: "ยาแก้ปวด ลดไข้ ต้านอักเสบ",
      strength: "500mg",
      unit: "เม็ด",
      indication: "ลดไข้ แก้ปวด",
      caution: "ควรใช้พร้อมอาหาร",
      imageUrl: "https://example.com/drug-image.jpg",
      interaction1: "Warfarin",
      interaction2: "",
      interaction3: "",
      interaction4: "",
      interaction5: "",
      minStock: 10,
      maxStock: 100,
      dateCreated: "2024-01-10"
    }
  ],
  Inventory: [
    {
      inventoryId: "INV001",
      drugId: "DRG001",
      lotNumber: "LOT2024A",
      expiryDate: "2025-12-31",
      quantity: 50,
      costPrice: 2.50,
      sellingPrice: 5.00,
      referenceId: "REF001",
      barcode: "1234567890123",
      dateReceived: "2024-01-15"
    }
  ],
  Sales: [
    {
      saleId: "SAL001",
      saleDate: "2024-01-20T10:30:00.000Z",
      memberId: "MEM001",
      pharmacist: "เภสัชกรสมศรี",
      totalAmount: 10.00,
      inventoryId: "INV001",
      quantitySold: 2,
      pricePerUnit: 5.00,
      drugId: "DRG001",
      lotNumber: "LOT2024A"
    }
  ]
};

// ฟังก์ชันสำหรับล้างข้อมูลเก่าและเพิ่มข้อมูลใหม่
function migrateData() {
  db.serialize(() => {
    // ล้างข้อมูลเก่า (ควรระมัดระวังในสภาพแวดล้อมจริง)
    db.run("DELETE FROM Sales");
    db.run("DELETE FROM Inventory");
    db.run("DELETE FROM Formulary");
    db.run("DELETE FROM Members");

    // เพิ่มข้อมูล Members
    const stmtMembers = db.prepare("INSERT INTO Members VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    sampleData.Members.forEach(member => {
      stmtMembers.run([
        null, // id (auto-increment)
        member.memberId,
        member.fullName,
        member.nationalId,
        member.dob,
        member.phone,
        member.allergies,
        member.disease,
        member.dateCreated
      ]);
    });
    stmtMembers.finalize();

    // เพิ่มข้อมูล Formulary
    const stmtFormulary = db.prepare("INSERT INTO Formulary VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    sampleData.Formulary.forEach(drug => {
      stmtFormulary.run([
        null, // id (auto-increment)
        drug.drugId,
        drug.tradeName,
        drug.genericName,
        drug.legalCategory,
        drug.pharmaCategory,
        drug.strength,
        drug.unit,
        drug.indication,
        drug.caution,
        drug.imageUrl,
        drug.interaction1,
        drug.interaction2,
        drug.interaction3,
        drug.interaction4,
        drug.interaction5,
        drug.minStock,
        drug.maxStock,
        drug.dateCreated
      ]);
    });
    stmtFormulary.finalize();

    // เพิ่มข้อมูล Inventory
    const stmtInventory = db.prepare("INSERT INTO Inventory VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    sampleData.Inventory.forEach(item => {
      stmtInventory.run([
        null, // id (auto-increment)
        item.inventoryId,
        item.drugId,
        item.lotNumber,
        item.expiryDate,
        item.quantity,
        item.costPrice,
        item.sellingPrice,
        item.referenceId,
        item.barcode,
        item.dateReceived
      ]);
    });
    stmtInventory.finalize();

    // เพิ่มข้อมูล Sales
    const stmtSales = db.prepare("INSERT INTO Sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    sampleData.Sales.forEach(sale => {
      stmtSales.run([
        null, // id (auto-increment)
        sale.saleId,
        sale.saleDate,
        sale.memberId,
        sale.pharmacist,
        sale.totalAmount,
        sale.inventoryId,
        sale.quantitySold,
        sale.pricePerUnit,
        sale.drugId,
        sale.lotNumber
      ]);
    });
    stmtSales.finalize();

    console.log("แปลงข้อมูลจาก Google Sheets ไปยัง SQLite เรียบร้อยแล้ว");
  });
}

// รันการแปลงข้อมูล
migrateData();

// ปิดการเชื่อมต่อเมื่อเสร็จ
db.close((err) => {
  if (err) {
    console.error(err.message);
  } else {
    console.log('ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อยแล้ว');
  }
});