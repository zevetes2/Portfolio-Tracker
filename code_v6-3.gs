// ============================================
// GOOGLE APPS SCRIPT - PORTFOLIO TRACKER API v3
// Defensivo: maneja NaN, Infinity, errores de fórmulas
// ============================================

function doGet(e) {
  const callback = e.parameter.callback;
  
  try {
    const action = e.parameter.action || 'dashboard';
    const currency = e.parameter.currency || 'USD';
    
    console.log("=== doGet START ===");
    console.log("Action:", action, "Currency:", currency);
    console.log("Callback:", callback ? "YES (JSONP)" : "NO (CORS/JSON)");
    
    let result;
    
    switch(action) {
      case 'dashboard':
        result = getDashboardData(currency);
        break;
      case 'summary':
        result = getSummaryOnly(currency);
        break;
      case 'performance':
        result = getPerformanceData(currency);
        break;
      default:
        result = getDashboardData(currency);
    }
    
    // SANITIZAR: eliminar NaN, Infinity, -Infinity, undefined
    result = sanitizeForJSON(result);
    
    result.meta = {
      timestamp: new Date().toISOString(),
      exchangeRate: getRate(currency),
      fromCache: false
    };
    
    const jsonString = JSON.stringify(result);
    console.log("JSON length:", jsonString.length);
    console.log("JSON preview:", jsonString.substring(0, 200));
    
    // ===== JSONP (legacy, para compatibilidad) =====
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + jsonString + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    
    // ===== CORS JSON (nuevo, recomendado) =====
    // Para peticiones fetch normales, devolver JSON con headers CORS
    return ContentService.createTextOutput(jsonString)
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error("FATAL ERROR:", error.toString(), error.stack);
    
    const errorResponse = sanitizeForJSON({
      error: error.toString(),
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    const errorJson = JSON.stringify(errorResponse);
    
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + errorJson + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    
    return ContentService.createTextOutput(errorJson)
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ============================================
// SANITIZADOR: elimina valores no serializables
// ============================================
function sanitizeForJSON(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number') {
    if (isNaN(obj)) return 0;
    if (!isFinite(obj)) return obj > 0 ? 999999999 : -999999999;
    return obj;
  }
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'boolean') return obj;
  if (obj instanceof Date) return obj.toISOString();
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJSON);
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = sanitizeForJSON(obj[key]);
      }
    }
    return result;
  }
  
  return String(obj);
}

// ============================================
// HELPERS
// ============================================
function getRate(currency) {
  if (currency === 'USD') return 1;
  return 58.5;
}

function getValue(matrix, label) {
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i][0] && matrix[i][0].toString().trim() === label) {
      const val = matrix[i][1];
      if (typeof val === 'number') {
        if (isNaN(val)) return 0;
        return val;
      }
      if (typeof val === 'string') {
        // Detectar errores de fórmula de Sheets
        if (val.startsWith('#')) return 0;
        const clean = val.replace(/[$,]/g, '').trim();
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    }
  }
  return 0;
}

function parsePct(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) return 0;
    return value;
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) return 0;
    const clean = value.replace('%', '').trim();
    const num = parseFloat(clean);
    return isNaN(num) || !isFinite(num) ? 0 : num / 100;
  }
  return 0;
}

function parseCurrency(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) return 0;
    return value;
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) return 0;
    const clean = value.replace(/[$,]/g, '').trim();
    return parseFloat(clean) || 0;
  }
  return 0;
}

function safeDivide(numerator, denominator) {
  if (!denominator || denominator === 0 || !isFinite(denominator)) return 0;
  const result = numerator / denominator;
  if (!isFinite(result)) return 0;
  return result;
}

function formatDate(dateVal) {
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return dateVal ? dateVal.toString() : '';
}

// ============================================
// GET DASHBOARD DATA
// ============================================
function getDashboardData(currency) {
  console.log("=== getDashboardData START ===");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log("Spreadsheet:", ss.getName());
  
  // 1. Resumen global
  const summarySheet = ss.getSheetByName('Dashboard_Summary');
  if (!summarySheet) throw new Error("Hoja 'Dashboard_Summary' no encontrada");
  
  const summaryValues = summarySheet.getRange('A1:B13').getValues();
  console.log("Summary rows:", summaryValues.length);
  
  const summary = {
    totalBalance: getValue(summaryValues, 'Networth'),
    totalCurrentValue: getValue(summaryValues, 'Market Value'),
    totalCash: getValue(summaryValues, 'Total Cash'),
    totalCost: getValue(summaryValues, 'Cost Basis'),
    totalUnrealizedPL: getValue(summaryValues, 'Unrealized Gain / Loss'),
    totalRealizedPL: getValue(summaryValues, 'Realized Gain / Loss'),
    totalDepositCash: getValue(summaryValues, 'Total Deposit Cash'),
    overallUnrealizedROI: parsePct(getValue(summaryValues, 'Unrealized Gain / Loss %')),
    overallRealizedROI: parsePct(getValue(summaryValues, 'Realized Gain / Loss %')),
    totalPL: getValue(summaryValues, 'Total Gain / Loss'),
    currentHoldings: getValue(summaryValues, '# Posiciones Activas'),
    soldPositions: getValue(summaryValues, '# Posiciones Vendidas'),
    totalDailyChange: getValue(summaryValues, 'Day Change'), 
    
  };
  console.log("Summary parsed OK");

  // 2. Plataformas
  let platforms = [];
  try {
    const platformRange = summarySheet.getRange('A16:I27');
    const platformValues = platformRange.getValues();
    platforms = parsePlatformData(platformValues);
    console.log("Platforms:", platforms.length);
  } catch (e) {
    console.error("Error parsing platforms:", e);
  }

  // 3. Sectores
  let bySector = [];
  try {
    const sectorRange = summarySheet.getRange('A29:B38');
    const sectorValues = sectorRange.getValues();
    bySector = parseSectorData(sectorValues);
    console.log("Sectors:", bySector.length);
  } catch (e) {
    console.error("Error parsing sectors:", e);
  }

  let byAsset = [];
  try{
    const assetRange = summarySheet.getRange('A40:B47');
    const assetValues = assetRange.getValues();
    byAsset = parseAssetData(assetValues);
    console.log("Assets:", byAsset.length);
  }catch(e){
    console.error("Error parsing assets:", e);
  }

  // 4. Portfolio
  let portfolioData = [];
  try {
    const portfolioSheet = ss.getSheetByName('Portfolio');
    if (!portfolioSheet) throw new Error("Hoja 'Portfolio' no encontrada");
    
    portfolioData = getPortfolioData(portfolioSheet);
    console.log("Portfolio positions:", portfolioData.length);
  } catch (e) {
    console.error("Error parsing portfolio:", e);
  }

  // 5. Métricas
  const metrics = {
    totalPortfolioValue: summary.totalCurrentValue,
    totalCash: summary.totalCash,
    netWorth: summary.totalBalance,
    totalInvested: summary.totalCost
  };

  // 6. Top ganadoras/perdedoras
  const activePositions = portfolioData.filter(p => !p.isSold && p.currentValue > 0);
  const sortedByROI = activePositions.slice().sort((a, b) => b.unrealizedROI - a.unrealizedROI);

  const result = {
    portfolio: {
      summary: {
        ...summary,
        byAssetClass: byAsset,
        bySector: bySector,
        largestPositions: activePositions.slice(0, 10),
        topGainers: sortedByROI.slice(0, 5).filter(p => p.unrealizedROI > 0),
        topLosers: sortedByROI.slice(-5).reverse().filter(p => p.unrealizedROI < 0)
      },
      portfolio: portfolioData
    },
    platforms: platforms,
    metrics: metrics,
    currentAssets: portfolioData.map(p => ({
      ticker: p.ticker,
      name: p.assetName,
      assetClass: p.assetClass,
      sector: p.sector,
      quantity: p.quantityNum,
      costBasis: p.avgPurchasePrice,
      originalCurrency: p.currency,
      platform: p.platform,
      iconUrl: p.iconUrl
    })),
    allTransactions: getAllTransactions(ss)
  };
  
  console.log("=== getDashboardData END ===");
  return result;
}

// ============================================
// GET SUMMARY ONLY
// ============================================
function getSummaryOnly(currency) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const summarySheet = ss.getSheetByName('Dashboard_Summary');
  if (!summarySheet) throw new Error("Hoja 'Dashboard_Summary' no encontrada");
  
  const summaryValues = summarySheet.getRange('A1:B13').getValues();
  
  const summary = {
    totalBalance: getValue(summaryValues, 'Networth'),
    totalCurrentValue: getValue(summaryValues, 'Market Value'),
    totalCash: getValue(summaryValues, 'Total Cash'),
    totalCost: getValue(summaryValues, 'Cost Basis'),
    totalUnrealizedPL: getValue(summaryValues, 'Unrealized Gain / Loss'),
    totalRealizedPL: getValue(summaryValues, 'Realized Gain / Loss'),
    totalDepositCash: getValue(summaryValues, 'Total Deposit Cash'),
    overallUnrealizedROI: parsePct(getValue(summaryValues, 'Unrealized Gain / Loss %')),
    overallRealizedROI: parsePct(getValue(summaryValues, 'Realized Gain / Loss %')),
    totalPL: getValue(summaryValues, 'Total Gain / Loss'),
    currentHoldings: getValue(summaryValues, '# Posiciones Activas'),
    soldPositions: getValue(summaryValues, '# Posiciones Vendidas'),
    totalDailyChange: getValue(summaryValues, 'Day Change'),
  };

  return {
    portfolio: {
      summary: summary,
      portfolio: []
    },
    metrics: {
      totalPortfolioValue: summary.totalCurrentValue,
      totalCash: summary.totalCash,
      netWorth: summary.totalBalance,
      totalInvested: summary.totalCost
    },
    platforms: [],
    currentAssets: [],
    allTransactions: []
  };
}

// ============================================
// GET PERFORMANCE DATA
// ============================================
function getPerformanceData(currency) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rendSheet = ss.getSheetByName('RENDIMIENTO');
  
  if (!rendSheet) {
    return {
      performance: {
        summary: { totalReturn: 0, totalReturnPct: 0, totalInvested: 0, totalPortfolioValue: 0 },
        periods: [],
        riskMetrics: { maxDrawdown: 0 }
      }
    };
  }
  
  const rendData = rendSheet.getDataRange().getValues();
  const periods = parseRendimientoData(rendData);
  
  return {
    performance: {
      summary: {
        totalReturn: periods.length > 0 ? periods[periods.length - 1].totalPL : 0,
        totalReturnPct: 0,
        totalInvested: periods.length > 0 ? periods[0].startValue : 0,
        totalPortfolioValue: periods.length > 0 ? periods[periods.length - 1].endValue : 0
      },
      periods: periods,
      riskMetrics: { maxDrawdown: 0 }
    }
  };
}

// ============================================
// PARSE PLATFORM DATA
// ============================================
function parsePlatformData(values) {
  const platforms = [];
  const headers = values[0];
  
  for (let col = 1; col < headers.length; col++) {
    const platformName = headers[col];
    if (!platformName || platformName === '') continue;
    
    const p = {
      platform: platformName,
      marketValue: 0, costBasis: 0, cash: 0,
      unrealizedPL: 0, realizedPL: 0, totalDepositCash: 0,
      unrealizedROI: 0, realizedROI: 0, totalPL: 0,
      totalROI: 0, activePositions: 0, soldPositions: 0, totalDailyChange: 0
    };
    
    for (let row = 1; row < values.length; row++) {
      const metric = values[row][0] ? values[row][0].toString().trim() : '';
      const val = values[row][col];
      
      switch(metric) {
        case 'Market Value': p.marketValue = parseCurrency(val); break;
        case 'Cost Basis': p.costBasis = parseCurrency(val); break;
        case 'Cash': p.cash = parseCurrency(val); break;
        case 'Unrealized Gain / Loss': p.unrealizedPL = parseCurrency(val); break;
        case 'Realized Gain / Loss': p.realizedPL = parseCurrency(val); break;
        case 'Total Deposit Cash': p.totalDepositCash = parseCurrency(val); break;
        case 'Unrealized Gain / Loss %': p.unrealizedROI = parsePct(val); break;
        case 'Realized Gain / Loss %': p.realizedROI = parsePct(val); break;
        case 'Total Gain / Loss': p.totalPL = parseCurrency(val); break;
        case '# Posiciones Activas': p.activePositions = parseInt(val) || 0; break;
        case '# Posiciones Vendidas': p.soldPositions = parseInt(val) || 0; break;
        case 'Day Change': p.totalDailyChange = parseCurrency(val); break;
      }
    }
    
    p.totalROI = safeDivide(p.totalPL, p.costBasis);
    platforms.push(p);
  }
  
  return platforms;
}

// ============================================
// PARSE SECTOR DATA
// ============================================
function parseSectorData(values) {
  const sectors = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] && values[i][0] !== 'Sector') {
      sectors.push({
        name: values[i][0],
        value: parseCurrency(values[i][1])
      });
    }
  }
  return sectors;
}

function parseAssetData(values){
  const assets = [];
  for(let i = 1; i < values.length; i++){
    if(values[i][0] && values[i][0] !== 'Asset'){
      assets.push({
        name: values[i][0],
        value: parseCurrency(values[i][1])
      });
    }
  }
  return assets;
}


// ============================================
// GET PORTFOLIO DATA (A:AA USD section)
// ============================================
function getPortfolioData(sheet) {
  console.log("getPortfolioData START");
  const lastRow = sheet.getLastRow();
  console.log("Last row:", lastRow);
  
  if (lastRow < 2) return [];
  
  const data = sheet.getRange(1, 1, lastRow, 27).getValues();
  console.log("Data shape:", data.length, "rows x", data[0].length, "cols");
  
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => { 
    if (h) colMap[h.toString().trim()] = i; 
  });
  
  console.log("Headers found:", Object.keys(colMap).join(", "));
  
  const result = [];
  
  for (let idx = 1; idx < data.length; idx++) {
    const row = data[idx];
    
    const ticker = row[colMap['Ticker'] !== undefined ? colMap['Ticker'] : 1];
    if (!ticker) continue;
    
    const qty = parseFloat(row[colMap['Quantity'] !== undefined ? colMap['Quantity'] : 2]) || 0;
    const avgPrice = parseCurrency(row[colMap['Avg. Purchase Price'] !== undefined ? colMap['Avg. Purchase Price'] : 3]);
    const currentPrice = parseCurrency(row[colMap['Current Price'] !== undefined ? colMap['Current Price'] : 4]);
    const cost = parseCurrency(row[colMap['Cost'] !== undefined ? colMap['Cost'] : 8]);
    const currentValue = parseCurrency(row[colMap['Current Value'] !== undefined ? colMap['Current Value'] : 9]);
    const unrealizedROIRaw = parsePct(row[colMap['Unrealized ROI'] !== undefined ? colMap['Unrealized ROI'] : 10]);
    const unrealizedPL = parseCurrency(row[colMap['Unrealized P/L'] !== undefined ? colMap['Unrealized P/L'] : 11]);
    const realizedPL = parseCurrency(row[colMap['Realized P/L'] !== undefined ? colMap['Realized P/L'] : 12]);
    const totalPL = parseCurrency(row[colMap['Total Profit/Loss'] !== undefined ? colMap['Total Profit/Loss'] : 13]);
    const assetClass = row[colMap['Asset Class'] !== undefined ? colMap['Asset Class'] : 20] || 'Stock';
    const sector = row[colMap['Sector'] !== undefined ? colMap['Sector'] : 26] || '';
    const dailyChange = parseCurrency(row[colMap['Daily Change'] !== undefined ? colMap['Daily Change'] : 7]);
    const dailyPct = parsePct(row[colMap['Daily % Change'] !== undefined ? colMap['Daily % Change'] : 6]);
    
    // Calcular unrealizedROI de forma segura
    let unrealizedROI = unrealizedROIRaw;
    if (unrealizedROI === 0 && cost > 0 && currentValue > 0) {
      unrealizedROI = safeDivide(currentValue - cost, cost);
    }
    
    const item = {
      ticker: String(ticker).trim(),
      assetName: String(row[colMap['Asset Name'] !== undefined ? colMap['Asset Name'] : 0] || ticker).trim(),
      quantityNum: qty,
      avgPurchasePrice: avgPrice,
      currentPrice: currentPrice,
      cost: cost,
      currentValue: currentValue,
      unrealizedPL: unrealizedPL,
      unrealizedROI: unrealizedROI,
      realizedPL: realizedPL,
      totalPL: totalPL,
      assetClass: String(assetClass).trim(),
      sector: String(sector).trim(),
      currency: 'USD',
      platform: '',
      iconUrl: '',
      isSold: qty === 0,
      dailyChange: dailyChange,
      dailyChangePct: dailyPct
    };
    
    result.push(item);
  }
  
  console.log("Portfolio items parsed:", result.length);
  return result.sort((a, b) => b.currentValue - a.currentValue);
}

// ============================================
// GET ALL TRANSACTIONS
// ============================================
function getAllTransactions(ss) {
  const txSheet = ss.getSheetByName('Transactions');
  if (!txSheet) return [];
  
  const data = txSheet.getDataRange().getValues();
  const headers = data[0];
  const colMap = {};
  headers.forEach((h, i) => { if (h) colMap[h.toString().trim()] = i; });
  
  return data.slice(1).map(row => ({
    date: formatDate(row[colMap['Date'] || 0]),
    dateRaw: row[colMap['Date'] || 0],
    ticker: row[colMap['Asset Ticker'] || 1],
    assetClass: row[colMap['Asset Class'] || colMap['Asset Name'] || 1],
    action: row[colMap['Action'] || 2],
    quantity: row[colMap['Quantity'] || 3],
    price: parseCurrency(row[colMap['Price'] || 4]),
    displayPrice: parseCurrency(row[colMap['Price'] || 4]),
    totalUSD: parseCurrency(row[colMap['Total'] || 5]),
    displayTotal: parseCurrency(row[colMap['Total'] || 5]),
    platform: row[colMap['Platform'] || 6],
    currency: row[colMap['Currency'] || 7] || 'USD'
  })).filter(tx => tx.date);
}

// ============================================
// PARSE RENDIMIENTO
// ============================================
function parseRendimientoData(data) {
  const periods = [];
  
  if (data.length < 2) return periods;
  
  const headers = data[0];
  const totalRow = data[1];
  
  const monthCols = [];
  for (let i = 2; i < headers.length; i++) {
    if (headers[i] && headers[i].toString().includes("'")) {
      monthCols.push({
        col: i,
        label: headers[i].toString().trim()
      });
    }
  }
  
  monthCols.forEach((month, idx) => {
    const totalPL = parseCurrency(totalRow[month.col]);
    const prevTotal = idx > 0 ? periods[idx - 1].endValue : 0;
    const endValue = prevTotal + totalPL;
    
    periods.push({
      key: month.label,
      label: month.label,
      yearMonth: convertMonthLabel(month.label),
      startValue: prevTotal,
      endValue: endValue,
      realizedPL: 0,
      unrealizedPL: totalPL,
      totalPL: totalPL,
      marketValue: endValue * 0.9,
      cash: endValue * 0.1
    });
  });
  
  return periods;
}

function convertMonthLabel(label) {
  const months = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  
  const match = label.match(/([A-Za-z]{3})'(\d{2})/);
  if (match) {
    const month = months[match[1]];
    const year = '20' + match[2];
    return year + '-' + month;
  }
  return label;
}