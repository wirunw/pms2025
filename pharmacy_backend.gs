// ===================================================================================
// ===== CONFIGURATION: PASTE YOUR GOOGLE IDS BELOW ==================================
// ===================================================================================
const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";
const DRIVE_FOLDER_ID = "PASTE_YOUR_GOOGLE_DRIVE_ID_HERE";
// ===================================================================================

const REQUIRED_SHEETS = {
  Members: ["memberId", "fullName", "nationalId", "dob", "phone", "allergies", "disease", "dateCreated"],
  Formulary: ["drugId", "tradeName", "genericName", "legalCategory", "pharmaCategory", "strength", "unit", "indication", "caution", "imageUrl", "interaction1", "interaction2", "interaction3", "interaction4", "interaction5", "minStock", "maxStock", "dateCreated"],
  Inventory: ["inventoryId", "drugId", "lotNumber", "expiryDate", "quantity", "costPrice", "sellingPrice", "referenceId", "barcode", "dateReceived"],
  Sales: ["saleId", "saleDate", "memberId", "pharmacist", "totalAmount", "inventoryId", "quantitySold", "pricePerUnit", "drugId", "lotNumber"]
};

// --- Utility Functions ---
const getSheet = (name) => SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  for (const sheetName in REQUIRED_SHEETS) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      const headers = REQUIRED_SHEETS[sheetName];
      sheet.appendRow(headers);
    } else { // Check if headers are missing columns
      const headers = REQUIRED_SHEETS[sheetName];
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const missingHeaders = headers.filter(h => !currentHeaders.includes(h));
      if (missingHeaders.length > 0) {
        sheet.getRange(1, currentHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
      }
    }
  }
}

function generateId() {
  return Utilities.getUuid();
}

function sheetDataToJson(sheet) {
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    if (!headers) return [];
    return data.map(row => {
        let obj = {};
        headers.forEach((header, i) => {
            obj[header] = row[i];
        });
        return obj;
    });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}


// --- Main Handlers ---
function doGet(e) {
  if (SPREADSHEET_ID === "PASTE_YOUR_SPREADSHEET_ID_HERE") {
    return jsonResponse({status: 'error', message: 'SPREADSHEET_ID has not been set in the script.'});
  }
  setupSheets(); 
  const action = e.parameter.action;
  
  switch(action) {
    case 'getMembers': return jsonResponse(getMembers());
    case 'getMemberDetails': return jsonResponse(getMemberDetails(e.parameter.memberId));
    case 'searchMembers': return jsonResponse(searchMembers(e.parameter.term));
    case 'getDrugs': return jsonResponse(getDrugs());
    case 'searchDrugs': return jsonResponse(searchDrugs(e.parameter.term));
    case 'searchAvailableDrugs': return jsonResponse(searchAvailableDrugs(e.parameter.term));
    case 'searchDrugByBarcode': return jsonResponse(searchDrugByBarcode(e.parameter.barcode));
    case 'getInventorySummary': return jsonResponse(getInventorySummary());
    case 'getDrugLots': return jsonResponse(getDrugLots(e.parameter.drugId));
    case 'getDashboardData': return jsonResponse(getDashboardData(e.parameter.period));
    // Reports
    case 'getSalesReport': return jsonResponse(getSalesReport(e.parameter.date));
    case 'getWeeklySalesReport': return jsonResponse(getWeeklySalesReport(e.parameter.date));
    case 'getMonthlySalesReport': return jsonResponse(getMonthlySalesReport(e.parameter.year, e.parameter.month));
    case 'getYearlySalesReport': return jsonResponse(getYearlySalesReport(e.parameter.year));
    case 'getInventoryReport': return jsonResponse(getInventorySummary());
    case 'getMemberReport': return jsonResponse(getMembers());
    default: return jsonResponse({status: 'error', message: 'Invalid action'});
  }
}

function doPost(e) {
  if (SPREADSHEET_ID === "PASTE_YOUR_SPREADSHEET_ID_HERE" || DRIVE_FOLDER_ID === "PASTE_YOUR_GOOGLE_DRIVE_ID_HERE") {
    return jsonResponse({status: 'error', message: 'SPREADSHEET_ID or DRIVE_FOLDER_ID has not been set in the script.'});
  }
  setupSheets();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000); 

  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const payload = request.payload;

    switch(action) {
      case 'addMember': return jsonResponse(addMember(payload));
      case 'addDrug': return jsonResponse(addDrug(payload));
      case 'addGoodsReceived': return jsonResponse(addGoodsReceived(payload));
      case 'recordSale': return jsonResponse(recordSale(payload));
      case 'saveDrugImage': return jsonResponse(saveDrugImage(payload));
      default: return jsonResponse({status: 'error', message: 'Invalid action'});
    }
  } catch(err) {
    return jsonResponse({status: 'error', message: err.message, stack: err.stack});
  } finally {
    lock.releaseLock();
  }
}

// --- API Functions ---

// MEMBERS
function getMembers() {
  const sheet = getSheet('Members');
  return sheetDataToJson(sheet).sort((a,b) => a.fullName.localeCompare(b.fullName));
}

function getMemberDetails(memberId) {
    if (!memberId) return null;
    const members = getMembers();
    const member = members.find(m => m.memberId == memberId);
    if (member && member.allergies) {
        try {
            member.allergies = JSON.parse(member.allergies);
        } catch (e) {
            member.allergies = []; // If parsing fails, default to empty array
        }
    }
    return member;
}


function searchMembers(term) {
  if (!term || term.length < 2) return [];
  const lowerTerm = term.toLowerCase();
  return getMembers().filter(m => 
    String(m.fullName).toLowerCase().includes(lowerTerm) || 
    (m.phone && String(m.phone).includes(term)) 
  );
}

function addMember(payload) {
  const sheet = getSheet('Members');
  sheet.appendRow([
    generateId(), payload.fullName, payload.nationalId, payload.dob,
    payload.phone, payload.allergies, payload.disease, new Date()
  ]);
  return { status: 'success' };
}

// DRUGS (FORMULARY)
function getDrugs() {
  const sheet = getSheet('Formulary');
  return sheetDataToJson(sheet).sort((a, b) => a.tradeName.localeCompare(b.tradeName));
}

function searchDrugs(term) {
    if (!term || term.length < 2) return [];
    const lowerTerm = term.toLowerCase();
    const allDrugs = getDrugs();
    return allDrugs.filter(d => 
        d.tradeName.toLowerCase().includes(lowerTerm) || 
        d.genericName.toLowerCase().includes(lowerTerm)
    );
}

function addDrug(payload) {
  const sheet = getSheet('Formulary');
  const headers = REQUIRED_SHEETS.Formulary;
  const newRow = headers.map(header => payload[header] || '');
  
  newRow[headers.indexOf('dateCreated')] = new Date();
  
  sheet.appendRow(newRow);
  return { status: 'success' };
}

function saveDrugImage(payload) {
  const { drugId, base64ImageData } = payload;
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const decodedData = Utilities.base64Decode(base64ImageData);
  const blob = Utilities.newBlob(decodedData, 'image/jpeg', `${drugId}.jpg`);
  
  const files = folder.getFilesByName(`${drugId}.jpg`);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const imageUrl = `https://drive.google.com/uc?id=${file.getId()}`;

  const sheet = getSheet('Formulary');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const drugIdCol = headers.indexOf('drugId') + 1;
  const imageUrlCol = headers.indexOf('imageUrl') + 1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][drugIdCol - 1] == drugId) {
      sheet.getRange(i + 1, imageUrlCol).setValue(imageUrl);
      break;
    }
  }

  return { status: 'success', imageUrl: imageUrl };
}

// INVENTORY
function addGoodsReceived(payload) {
    const sheet = getSheet('Inventory');
    sheet.appendRow([
        generateId(), payload.drugId, payload.lotNumber, payload.expiryDate,
        payload.quantity, payload.costPrice, payload.sellingPrice,
        payload.referenceId, payload.barcode, new Date()
    ]);
    return { status: 'success' };
}

function getInventorySummary() {
    const inventoryData = sheetDataToJson(getSheet('Inventory'));
    const formularyData = sheetDataToJson(getSheet('Formulary'));

    const formularyMap = formularyData.reduce((map, drug) => {
        map[drug.drugId] = drug;
        return map;
    }, {});

    const summary = {};

    inventoryData.forEach(item => {
        if (Number(item.quantity) > 0) {
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
        }
    });
    
    return Object.values(summary).sort((a,b) => a['ชื่อยา'].localeCompare(b['ชื่อยา']));
}

function searchAvailableDrugs(term) {
    if (!term || term.length < 2) return [];
    const lowerTerm = term.toLowerCase();
    const inventoryData = sheetDataToJson(getSheet('Inventory')).filter(i => Number(i.quantity) > 0);
    const availableDrugIds = [...new Set(inventoryData.map(i => i.drugId))];
    const formularyData = sheetDataToJson(getSheet('Formulary'));
    return formularyData.filter(drug => 
      availableDrugIds.includes(drug.drugId) &&
      (String(drug.tradeName).toLowerCase().includes(lowerTerm) || String(drug.genericName).toLowerCase().includes(lowerTerm))
    );
}

function searchDrugByBarcode(barcode) {
    const inventoryData = sheetDataToJson(getSheet('Inventory'));
    const foundItem = inventoryData.find(item => item.barcode && String(item.barcode) == barcode && Number(item.quantity) > 0); 
    if (!foundItem) return null;

    const formularyData = sheetDataToJson(getSheet('Formulary'));
    const drugInfo = formularyData.find(d => String(d.drugId) === String(foundItem.drugId));
    return drugInfo || null;
}

function getDrugLots(drugId) {
    const inventoryData = sheetDataToJson(getSheet('Inventory'));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return inventoryData
        .filter(item => String(item.drugId) == String(drugId) && Number(item.quantity) > 0 && new Date(item.expiryDate) >= today)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
}

// SALES
function recordSale(payload) {
    const salesSheet = getSheet('Sales');
    const inventorySheet = getSheet('Inventory');
    const inventoryData = inventorySheet.getDataRange().getValues();
    const headers = inventoryData[0];
    const inventoryIdCol = headers.indexOf('inventoryId') + 1;
    const quantityCol = headers.indexOf('quantity') + 1;

    const saleId = generateId();
    const saleDate = new Date();

    payload.items.forEach(item => {
        const drugInfo = getDrugInfoFromInventoryId(item.inventoryId);
        salesSheet.appendRow([
            saleId, saleDate, payload.memberId || 'N/A', payload.pharmacist,
            payload.total, item.inventoryId, item.quantity, item.price,
            drugInfo.drugId, drugInfo.lotNumber
        ]);

        for (let i = 1; i < inventoryData.length; i++) {
            if (inventoryData[i][inventoryIdCol - 1] == item.inventoryId) {
                const currentQty = inventoryData[i][quantityCol - 1];
                const newQty = currentQty - item.quantity;
                inventorySheet.getRange(i + 1, quantityCol).setValue(newQty);
                break;
            }
        }
    });
    return { status: 'success' };
}

function getDrugInfoFromInventoryId(inventoryId) {
    const invData = sheetDataToJson(getSheet('Inventory'));
    const item = invData.find(i => i.inventoryId == inventoryId);
    return item ? { drugId: item.drugId, lotNumber: item.lotNumber } : { drugId: 'N/A', lotNumber: 'N/A' };
}


// REPORTS
function processSalesData(sales) {
  const formularyData = sheetDataToJson(getSheet('Formulary'));
  const membersData = sheetDataToJson(getSheet('Members'));
  
  const formularyMap = formularyData.reduce((map, drug) => {
    map[drug.drugId] = drug.tradeName;
    return map;
  }, {});

  const membersMap = membersData.reduce((map, member) => {
    map[member.memberId] = member.fullName;
    return map;
  }, {});

  return sales.map(sale => ({
    'เวลา': new Date(sale.saleDate).toLocaleString('th-TH'),
    'ลูกค้า': membersMap[sale.memberId] || 'ลูกค้าทั่วไป',
    'รายการยา': formularyMap[sale.drugId] || sale.drugId,
    'Lot': sale.lotNumber,
    'จำนวน': sale.quantitySold,
    'ราคา/หน่วย': sale.pricePerUnit,
    'รวม': (sale.quantitySold * sale.pricePerUnit).toFixed(2),
    'ผู้ขาย': sale.pharmacist,
    'Sale ID': sale.saleId,
  }));
}

function getSalesReport(dateString) {
    const salesData = sheetDataToJson(getSheet('Sales'));
    const targetDate = new Date(dateString);
    targetDate.setHours(0,0,0,0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(targetDate.getDate() + 1);

    const filteredSales = salesData.filter(sale => {
        const saleDate = new Date(sale.saleDate);
        return saleDate >= targetDate && saleDate < nextDay;
    });
    return processSalesData(filteredSales);
}

function getWeeklySalesReport(dateString) {
    const salesData = sheetDataToJson(getSheet('Sales'));
    const targetDate = new Date(dateString);
    const dayOfWeek = targetDate.getDay();
    
    const startDate = new Date(targetDate);
    startDate.setDate(targetDate.getDate() - dayOfWeek);
    startDate.setHours(0,0,0,0);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 7);

    const filteredSales = salesData.filter(sale => {
        const saleDate = new Date(sale.saleDate);
        return saleDate >= startDate && saleDate < endDate;
    });
    return processSalesData(filteredSales);
}

function getMonthlySalesReport(year, month) {
    const salesData = sheetDataToJson(getSheet('Sales'));
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const filteredSales = salesData.filter(sale => {
        const saleDate = new Date(sale.saleDate);
        return saleDate >= startDate && saleDate < endDate;
    });
    return processSalesData(filteredSales);
}

function getYearlySalesReport(year) {
    const salesData = sheetDataToJson(getSheet('Sales'));
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(Number(year) + 1, 0, 1);
    
    const filteredSales = salesData.filter(sale => {
        const saleDate = new Date(sale.saleDate);
        return saleDate >= startDate && saleDate < endDate;
    });
    return processSalesData(filteredSales);
}

// DASHBOARD
function getDashboardData(period) {
    const today = new Date();
    today.setHours(0,0,0,0);
    let startDate;
    const endDate = new Date();
    endDate.setHours(23,59,59,999);

    switch(period) {
        case 'daily':
            startDate = new Date(today);
            break;
        case 'weekly':
            startDate = new Date(today);
            startDate.setDate(today.getDate() - today.getDay());
            break;
        case 'monthly':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'yearly':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        default:
            startDate = new Date(today);
    }
    
    const allSales = sheetDataToJson(getSheet('Sales'));
    const salesInRange = allSales.filter(s => {
      const saleDate = new Date(s.saleDate);
      return saleDate >= startDate && saleDate <= endDate;
    });

    const inventoryData = sheetDataToJson(getSheet('Inventory'));
    const formularyData = sheetDataToJson(getSheet('Formulary'));
    const membersData = sheetDataToJson(getSheet('Members'));

    // 1. Total Sales
    const totalSales = salesInRange.reduce((sum, sale) => sum + Number(sale.totalAmount), 0);
    
    // Maps for easy lookup
    const formularyMap = formularyData.reduce((map, drug) => { map[drug.drugId] = drug; return map; }, {});
    const memberMap = membersData.reduce((map, member) => { map[member.memberId] = member; return map; }, {});

    // 2. Top Selling Drugs
    const drugSales = salesInRange.reduce((acc, sale) => {
      const drugInfo = formularyMap[sale.drugId];
      if (drugInfo && drugInfo.genericName) {
        const genericName = drugInfo.genericName;
        acc[genericName] = (acc[genericName] || 0) + Number(sale.quantitySold);
      }
      return acc;
    }, {});
    const topDrugs = Object.entries(drugSales)
      .map(([genericName, totalQuantity]) => ({ genericName, totalQuantity }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10);

    // 3. Expiring Items
    const expiringItems = inventoryData
      .filter(item => Number(item.quantity) > 0 && new Date(item.expiryDate) >= today)
      .sort((a,b) => new Date(a.expiryDate) - new Date(b.expiryDate))
      .slice(0, 10)
      .map(item => ({
        tradeName: formularyMap[item.drugId]?.tradeName || item.drugId,
        lotNumber: item.lotNumber,
        expiryDate: item.expiryDate
      }));
    
    // 4. Low Stock Items
    const stockLevels = inventoryData.reduce((acc, item) => {
        acc[item.drugId] = (acc[item.drugId] || 0) + Number(item.quantity);
        return acc;
    }, {});
    const lowStockItems = formularyData
        .filter(drug => drug.minStock && stockLevels[drug.drugId] < Number(drug.minStock))
        .map(drug => ({
            tradeName: drug.tradeName,
            totalQuantity: stockLevels[drug.drugId] || 0,
            minStock: drug.minStock
        }));
        
    // 5. Top Members
    const memberSales = salesInRange.reduce((acc, sale) => {
        if (sale.memberId && sale.memberId !== 'N/A') {
            acc[sale.memberId] = (acc[sale.memberId] || 0) + Number(sale.totalAmount);
        }
        return acc;
    }, {});
    const topMembers = Object.entries(memberSales)
        .map(([memberId, totalAmount]) => ({
            fullName: memberMap[memberId]?.fullName || 'Unknown Member',
            totalAmount
        }))
        .sort((a,b) => b.totalAmount - a.totalAmount)
        .slice(0, 10);
        
    return {
        totalSales,
        topDrugs,
        expiringItems,
        lowStockItems,
        topMembers
    };
}

