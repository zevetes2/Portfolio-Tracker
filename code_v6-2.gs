/**
 * ============================================
 * PORTFOLIO TRACKER API - Multi-Currency (v6.2)
 * Fixed: ROI percentage display
 * Added: Broker summary cards with market value, P/L, ROI per platform
 * Added: Multi-platform support via transaction traceability
 *          (assigns market value based on actual transaction history per broker)
 * Simplified: Transaction section
 * ============================================
 */
  
const SHEET_NAME = "Transactions";
const PORTFOLIO_SHEET_NAME = "Portfolio";
const PLATFORM_COLUMN_INDEX = 52; // Columna BA (53 en 1-based, 52 en 0-based)
const WEBSITE_URL_COLUMN_INDEX = 56; // Columna BE (57 en 1-based, 56 en 0-based)

function doGet(e) {
  try {
    var callback = e && e.parameter && e.parameter.callback ? e.parameter.callback : null;
    var action = e && e.parameter && e.parameter.action ? e.parameter.action : "dashboard";
    var viewCurrency = (e && e.parameter && e.parameter.currency) ? String(e.parameter.currency).toUpperCase() : "USD";
    var providedRate = (e && e.parameter && e.parameter.rate) ? parseFloat(e.parameter.rate) : null;

    var exchangeRate = null;
    if (viewCurrency !== "USD") {
      exchangeRate = getCachedRate("USD", viewCurrency) || providedRate || getExchangeRateFromSheet("USD", viewCurrency);
    }

    var response;
    switch(action) {
      case "transactions": response = getTransactions(viewCurrency, exchangeRate); break;
      case "summary": response = getSummary(viewCurrency, exchangeRate); break;
      case "assets": response = getAssets(viewCurrency, exchangeRate); break;
      case "platforms": response = getPlatforms(viewCurrency, exchangeRate); break;
      case "platformsSummary": response = getPlatformsSummary(viewCurrency, exchangeRate); break;
      case "portfolio": response = getPortfolio(viewCurrency, exchangeRate); break;
      case "performance": response = getPerformance(viewCurrency, exchangeRate); break;
      case "debug": response = getDebugInfo(); break;
      default: response = getDashboard(viewCurrency, exchangeRate);
    }

    response.meta = {
      viewCurrency: viewCurrency,
      exchangeRate: exchangeRate,
      timestamp: new Date().toISOString()
    };

    if (callback) {
      return ContentService.createTextOutput(callback + '(' + JSON.stringify(response) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService.createTextOutput(JSON.stringify(response, null, 2))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    var errorResponse = { error: error.toString(), stack: error.stack };
    if (e && e.parameter && e.parameter.callback) {
      return ContentService.createTextOutput(e.parameter.callback + '(' + JSON.stringify(errorResponse) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============ CACHE & EXCHANGE RATE ============

function getCachedRate(from, to) {
  var cache = CacheService.getScriptCache();
  var key = "rate_" + from + "_" + to;
  var cached = cache.get(key);
  return cached ? parseFloat(cached) : null;
}

function setCachedRate(from, to, rate) {
  CacheService.getScriptCache().put("rate_" + from + "_" + to, String(rate), 300);
}

function getExchangeRateFromSheet(from, to) {
  if (from === to) return 1;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("ExchangeRates");
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var rowFrom = String(data[i][0] || "").toUpperCase().trim();
    var rowTo = String(data[i][1] || "").toUpperCase().trim();
    if (rowFrom === from && rowTo === to) {
      var rate = parseFloat(data[i][2]);
      if (rate && rate > 0) { setCachedRate(from, to, rate); return rate; }
    }
  }

  for (var i = 1; i < data.length; i++) {
    var rowFrom = String(data[i][0] || "").toUpperCase().trim();
    var rowTo = String(data[i][1] || "").toUpperCase().trim();
    if (rowFrom === to && rowTo === from) {
      var rate = parseFloat(data[i][2]);
      if (rate && rate > 0) { var inv = 1 / rate; setCachedRate(from, to, inv); return inv; }
    }
  }

  return null;
}

// ============ CONVERSION ============

function toDisplayAmount(t, viewCurrency, exchangeRate) {
  var originalCurrency = String(t.currency || "USD").toUpperCase();
  var totalOriginal = parseFloat(t.total) || 0;
  var totalUSD = parseFloat(t.totalUSD) || 0;

  if (viewCurrency === "USD") {
    return totalUSD || totalOriginal;
  }

  if (viewCurrency === originalCurrency) {
    return totalOriginal;
  }

  var usdValue = totalUSD;
  if (!usdValue && originalCurrency === "USD") usdValue = totalOriginal;

  return (usdValue || 0) * (exchangeRate || 1);
}

function convertToUSD(value, fromCurrency, exchangeRate) {
  if (fromCurrency === "USD" || !exchangeRate) return value;
  return value / exchangeRate;
}

function convertFromUSD(value, toCurrency, exchangeRate) {
  if (toCurrency === "USD" || !exchangeRate) return value;
  return value * exchangeRate;
}

// ============ DOMAIN EXTRACTION FOR FAVICONS ============

function extractDomain(url) {
  if (!url) return "";
  // Remove protocol
  var clean = url.replace(/^(https?:\/\/)/, "");
  // Remove path, query params, etc.
  var domain = clean.split('/')[0];
  return domain;
}

function buildFaviconUrl(websiteUrl) {
  if (!websiteUrl) return null;
  var domain = extractDomain(websiteUrl);
  if (!domain) return null;
  return "https://s2.googleusercontent.com/s2/favicons?domain=" + domain + "&sz=32";
}

// ============ PORTFOLIO ============

function getPortfolio(viewCurrency, exchangeRate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PORTFOLIO_SHEET_NAME);

  if (!sheet) {
    return getPortfolioFromTransactions(viewCurrency, exchangeRate);
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return { portfolio: [], summary: {}, message: "No hay datos en Portfolio" };

  var range = sheet.getRange(3, 1, lastRow - 2, 57); // Extended to col BE (57)
  var allData = range.getValues();

  var portfolio = [];
  var summary = {
    totalCurrentValue: 0,
    totalCost: 0,
    totalUnrealizedPL: 0,
    totalRealizedPL: 0,
    totalPL: 0,
    totalDailyChange: 0,
    totalDailyChangePct: 0,
    currentHoldings: 0,
    soldPositions: 0,
    totalPositions: 0
  };

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];

    var ticker = String(row[1] || "").trim();
    if (!ticker) continue;

    var quantity = String(row[2] || "").trim();
    var isSold = (quantity === "Sold All");
    var quantityNum = isSold ? 0 : (parseFloat(quantity) || 0);

    // Los valores de la primera sección (A-AA, índices 0-26) SIEMPRE están en USD
    var sheetCurrency = "USD";

    var assetName = String(row[0] || row[28] || "").trim() || ticker;
    var avgPrice = parseMoney(row[3]);
    var currentPrice = parseMoney(row[4]);
    var dailyPctChange = parsePct(row[6]);
    var dailyChange = parseMoney(row[7]);
    var cost = parseMoney(row[8]);
    var currentValue = parseMoney(row[9]);
    var unrealizedROI = parsePct(row[10]);
    var unrealizedPL = parseMoney(row[11]);
    var realizedPL = parseMoney(row[12]);
    var totalPL = parseMoney(row[13]);
    var actualWeight = parsePct(row[19]);
    var marketcap = String(row[20] || "").trim();
    var assetClass = String(row[22] || "").trim();
    var assetClassActualWeight = parsePct(row[23]);
    var assetClassTargetWeight = parsePct(row[24]);
    var sector = String(row[26] || "").trim();
    
    // Plataforma(s) en columna 53 (índice 52)
    var platformRaw = String(row[PLATFORM_COLUMN_INDEX] || "").trim();
    var platforms = parsePlatforms(platformRaw);

    // Website URL en columna BE (índice 56)
    var websiteUrl = String(row[WEBSITE_URL_COLUMN_INDEX] || "").trim();
    var iconUrl = buildFaviconUrl(websiteUrl);

    // Convertir valores de USD a la moneda de visualización
    var displayAvgPrice = avgPrice;
    var displayCurrentPrice = currentPrice;
    var displayCost = cost;
    var displayCurrentValue = currentValue;
    var displayUnrealizedPL = unrealizedPL;
    var displayRealizedPL = realizedPL;
    var displayTotalPL = totalPL;
    var displayDailyChange = dailyChange;

    if (viewCurrency !== "USD" && exchangeRate) {
      displayAvgPrice = avgPrice * exchangeRate;
      displayCurrentPrice = currentPrice * exchangeRate;
      displayCost = cost * exchangeRate;
      displayCurrentValue = currentValue * exchangeRate;
      displayUnrealizedPL = unrealizedPL * exchangeRate;
      displayRealizedPL = realizedPL * exchangeRate;
      displayTotalPL = totalPL * exchangeRate;
      displayDailyChange = dailyChange * exchangeRate;
    }

    var item = {
      assetName: assetName,
      ticker: ticker,
      quantity: quantity,
      quantityNum: quantityNum,
      isSold: isSold,
      avgPurchasePrice: round(displayAvgPrice),
      currentPrice: round(displayCurrentPrice),
      dailyPctChange: dailyPctChange,
      dailyChange: round(displayDailyChange),
      cost: round(displayCost),
      currentValue: round(displayCurrentValue),
      unrealizedROI: unrealizedROI,
      unrealizedPL: round(displayUnrealizedPL),
      realizedPL: round(displayRealizedPL),
      totalPL: round(displayTotalPL),
      actualWeight: actualWeight,
      marketcap: marketcap,
      assetClass: assetClass,
      assetClassActualWeight: assetClassActualWeight,
      assetClassTargetWeight: assetClassTargetWeight,
      sector: sector,
      currency: sheetCurrency,
      originalCurrency: sheetCurrency,
      platform: platformRaw,
      platforms: platforms,
      websiteUrl: websiteUrl,
      iconUrl: iconUrl
    };

    portfolio.push(item);

    summary.totalPositions++;
    if (!isSold) {
      summary.totalCurrentValue += displayCurrentValue || 0;
      summary.totalCost += displayCost || 0;
      summary.totalUnrealizedPL += displayUnrealizedPL || 0;
      summary.totalDailyChange += displayDailyChange || 0;
      summary.currentHoldings++;
    } else {
      summary.totalRealizedPL += displayRealizedPL || 0;
      summary.soldPositions++;
    }
    summary.totalPL += displayTotalPL || 0;
  }

  summary.totalCurrentValue = round(summary.totalCurrentValue);
  summary.totalCost = round(summary.totalCost);
  summary.totalUnrealizedPL = round(summary.totalUnrealizedPL);
  summary.totalRealizedPL = round(summary.totalRealizedPL);
  summary.totalPL = round(summary.totalPL);
  summary.totalDailyChange = round(summary.totalDailyChange);
  summary.overallUnrealizedROI = summary.totalCost > 0 ? round((summary.totalUnrealizedPL / summary.totalCost) * 100) : 0;
  summary.overallDailyChangePct = summary.totalCurrentValue > 0 ? round((summary.totalDailyChange / (summary.totalCurrentValue - summary.totalDailyChange)) * 100) : 0;

  // Aggregates
  summary.byAssetClass = aggregateByField(portfolio, 'assetClass', 'currentValue', viewCurrency);
  summary.bySector = aggregateByField(portfolio, 'sector', 'currentValue', viewCurrency);
  summary.byMarketcap = aggregateByField(portfolio, 'marketcap', 'currentValue', viewCurrency);

  // Calcular top ganadores y perdedores
  var activePositions = [];
  for (var i = 0; i < portfolio.length; i++) {
    if (!portfolio[i].isSold) activePositions.push(portfolio[i]);
  }
  summary.topGainers = getTopGainersLosers(activePositions, 'unrealizedROI', 5, true);
  summary.topLosers = getTopGainersLosers(activePositions, 'unrealizedROI', 5, false);

  return { portfolio: portfolio, summary: summary };
}

/**
 * Parsea una cadena de plataformas separadas por comas
 * Ej: "Etoro, Hapi" -> ["Etoro", "Hapi"]
 * Ej: "TradeStation" -> ["TradeStation"]
 * Ej: "" -> ["Sin Plataforma"]
 */
function parsePlatforms(platformStr) {
  if (!platformStr || platformStr.trim() === "") {
    return ["Sin Plataforma"];
  }

  return platformStr.split(/[,;]/).map(function(p) {
    return p.trim();
  }).filter(function(p) {
    return p !== "";
  });
}

function getPortfolioFromTransactions(viewCurrency, exchangeRate) {
  var txData = getTransactions(viewCurrency, exchangeRate);
  var tx = txData.transactions;

  var assets = {};
  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    if (!t.ticker || t.ticker === "Cash" || t.ticker === "") continue;

    if (!assets[t.ticker]) {
      assets[t.ticker] = {
        ticker: t.ticker,
        name: t.assetName,
        class: t.assetClass,
        sector: t.sector,
        currency: t.currency,
        quantity: 0,
        totalInvested: 0,
        platform: t.platform
      };
    }

    if (t.action === "Buy" || t.action === "DRIP" || t.action === "Transfer Deposit") {
      assets[t.ticker].quantity += t.quantity;
      if (t.action === "Buy") {
        // Usar displayTotal si existe, sino totalUSD, sino total
        var buyAmount = Math.abs(t.displayTotal || t.totalUSD || t.total || 0);
        assets[t.ticker].totalInvested += buyAmount;
      }
    } else if (t.action === "Sell" || t.action === "Transfer Send") {
      assets[t.ticker].quantity -= t.quantity;
    }
  }

  var portfolio = [];
  for (var key in assets) {
    var a = assets[key];
    if (a.quantity > 0) {
      var costBasis = a.totalInvested;
      var avgPrice = a.quantity > 0 ? costBasis / a.quantity : 0;

      portfolio.push({
        assetName: a.name,
        ticker: a.ticker,
        quantity: String(a.quantity),
        quantityNum: a.quantity,
        isSold: false,
        assetClass: a.class,
        sector: a.sector,
        currency: a.currency,
        cost: round(costBasis),
        currentValue: round(costBasis), // Proxy: cost basis como valor estimado
        avgPurchasePrice: round(avgPrice),
        currentPrice: round(avgPrice),
        unrealizedROI: 0,
        unrealizedPL: 0,
        realizedPL: 0,
        totalPL: 0,
        dailyChange: 0,
        dailyPctChange: 0,
        actualWeight: 0,
        marketcap: '',
        assetClassActualWeight: 0,
        assetClassTargetWeight: 0,
        platform: a.platform || "Sin Plataforma",
        platforms: parsePlatforms(a.platform || ""),
        websiteUrl: "",
        iconUrl: null
      });
    }
  }

  // Calcular summary para que largestPositions funcione
  var totalCurrentValue = portfolio.reduce(function(s, p) { return s + (p.currentValue || 0); }, 0);
  var totalCost = portfolio.reduce(function(s, p) { return s + (p.cost || 0); }, 0);

  return { 
    portfolio: portfolio, 
    summary: { 
      totalCurrentValue: round(totalCurrentValue),
      totalCost: round(totalCost),
      totalUnrealizedPL: 0,
      totalRealizedPL: 0,
      totalPL: 0,
      totalDailyChange: 0,
      totalDailyChangePct: 0,
      currentHoldings: portfolio.length,
      totalPositions: portfolio.length,
      soldPositions: 0,
      overallUnrealizedROI: totalCost > 0 ? round((totalCurrentValue - totalCost) / totalCost * 100) : 0,
      overallDailyChangePct: 0,
      // Poblar largestPositions directamente aquí
      largestPositions: portfolio.slice().sort(function(a, b) {
        return (b.currentValue || 0) - (a.currentValue || 0);
      }).slice(0, 5),
      byAssetClass: aggregateByField(portfolio, 'assetClass', 'currentValue', viewCurrency),
      bySector: aggregateByField(portfolio, 'sector', 'currentValue', viewCurrency),
      topGainers: [],
      topLosers: []
    } 
  };
}

function aggregateByField(portfolio, field, valueField, viewCurrency) {
  var groups = {};
  var totalValue = 0;
  var totalCost = 0;

  for (var i = 0; i < portfolio.length; i++) {
    var p = portfolio[i];
    if (p.isSold) continue;

    var key = p[field] || 'Sin Datos';
    if (!groups[key]) {
      groups[key] = { name: key, value: 0, cost: 0, pl: 0, count: 0 };
    }
    groups[key].value += p[valueField] || 0;
    groups[key].cost += p.cost || 0;
    groups[key].pl += p.unrealizedPL || 0;
    groups[key].count++;
    totalValue += p[valueField] || 0;
    totalCost += p.cost || 0;
  }

  var result = [];
  for (var key in groups) {
    var g = groups[key];
    result.push({
      name: g.name,
      value: round(g.value),
      cost: round(g.cost),
      pl: round(g.pl),
      count: g.count,
      weight: totalValue > 0 ? round((g.value / totalValue) * 100) : 0,
      roi: g.cost > 0 ? round((g.pl / g.cost) * 100) : 0
    });
  }

  return result.sort(function(a, b) { return b.value - a.value; });
}

function getTopGainersLosers(portfolio, field, count, isGainers) {
  var current = [];
  for (var i = 0; i < portfolio.length; i++) {
    var p = portfolio[i];
    // Incluir solo posiciones no vendidas que tengan el campo definido
    if (p.isSold) continue;

    var val = p[field];
    // Aceptar 0 como valor válido para currentValue (para largestPositions)
    if (val === null || val === undefined) continue;

    current.push(p);
  }

  // Si no hay nada después de filtrar, devolver array vacío
  if (current.length === 0) return [];

  current.sort(function(a, b) {
    var va = a[field] !== null && a[field] !== undefined ? a[field] : (isGainers ? -Infinity : Infinity);
    var vb = b[field] !== null && b[field] !== undefined ? b[field] : (isGainers ? -Infinity : Infinity);
    return isGainers ? (vb - va) : (va - vb);
  });

  return current.slice(0, count);
}

function getPerformanceDistribution(portfolio) {
  var dist = { 
    excellent: 0, good: 0, neutral: 0, bad: 0, terrible: 0,
    excellentCount: 0, goodCount: 0, neutralCount: 0, badCount: 0, terribleCount: 0
  };

  for (var i = 0; i < portfolio.length; i++) {
    var p = portfolio[i];
    if (p.isSold || p.unrealizedROI === null) continue;

    var roi = p.unrealizedROI;
    if (roi >= 50) { dist.excellent += p.currentValue || 0; dist.excellentCount++; }
    else if (roi >= 10) { dist.good += p.currentValue || 0; dist.goodCount++; }
    else if (roi >= -10) { dist.neutral += p.currentValue || 0; dist.neutralCount++; }
    else if (roi >= -30) { dist.bad += p.currentValue || 0; dist.badCount++; }
    else { dist.terrible += p.currentValue || 0; dist.terribleCount++; }
  }

  return dist;
}

function parseMoney(val) {
  if (val === "" || val === null || val === undefined) return null;
  var s = String(val).trim().replace(/[$,]/g, "").replace(/%/g, "");
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parsePct(val) {
  if (val === "" || val === null || val === undefined) return null;
  var s = String(val).trim().replace(/[$,]/g, "").replace(/%/g, "");
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ============ TRANSACTIONS ============

function getTransactions(viewCurrency, exchangeRate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) throw new Error('Hoja "' + SHEET_NAME + '" no encontrada.');

  var lastRow = sheet.getLastRow();
  var lastCol = Math.min(sheet.getLastColumn(), 24);

  if (lastRow < 3) return { transactions: [], count: 0, message: "No hay datos" };

  var range = sheet.getRange(3, 1, lastRow - 2, lastCol);
  var allData = range.getValues();

  var transactions = [];

  for (var i = 0; i < allData.length; i++) {
    var row = allData[i];

    var hasData = false;
    for (var j = 0; j < Math.min(row.length, 8); j++) {
      if (row[j] !== "" && row[j] !== null && row[j] !== undefined) { hasData = true; break; }
    }
    if (!hasData) continue;

    var platform = String(row[0] || "").trim();
    var currency = String(row[1] || "USD").trim().toUpperCase();
    var dateRaw = row[2];
    var ticker = String(row[3] || "").trim();
    var assetName = String(row[4] || "").trim();
    var assetClass = String(row[5] || "").trim();
    var sector = String(row[6] || "").trim();
    var action = String(row[7] || "").trim();
    var quantity = parseFloat(row[8]) || 0;
    var price = parseFloat(row[9]) || 0;
    var fees = parseFloat(row[10]) || 0;
    var notes = String(row[11] || "").trim();
    var total = parseFloat(row[12]) || 0;
    var totalCost = parseFloat(row[13]) || 0;
    var rollingQuantity = parseFloat(row[14]) || 0;
    var rollingCost = parseFloat(row[15]) || 0;
    var usdCurrency = String(row[16] || "").trim();
    var brokerageFeeUSD = parseFloat(row[17]) || 0;
    var totalUSD = parseFloat(row[18]) || 0;

    var t = {
      id: transactions.length + 1,
      rowIndex: i + 3,
      platform: platform,
      currency: currency,
      date: formatDate(dateRaw),
      dateRaw: formatDate(dateRaw),
      ticker: ticker,
      assetName: assetName,
      assetClass: assetClass,
      sector: sector,
      action: action,
      quantity: quantity,
      price: price,
      fees: fees,
      notes: notes,
      total: total,
      totalCost: totalCost,
      rollingQuantity: rollingQuantity,
      rollingCost: rollingCost,
      usdCurrency: usdCurrency,
      brokerageFeeUSD: brokerageFeeUSD,
      totalUSD: totalUSD,
      day: row[19],
      month: String(row[20] || "").trim(),
      year: row[21],
      all: String(row[22] || "").trim()
    };

    t.displayTotal = round(toDisplayAmount(t, viewCurrency, exchangeRate));
    t.displayCurrency = viewCurrency;

    if (t.currency === viewCurrency) {
      t.displayPrice = t.price;
    } else if (viewCurrency === "USD") {
      t.displayPrice = t.price;
    } else {
      t.displayPrice = round(t.price * (exchangeRate || 1));
    }

    if (t.currency === viewCurrency) {
      t.displayRollingCost = t.rollingCost;
    } else {
      t.displayRollingCost = round(t.rollingCost * (exchangeRate || 1));
    }

    transactions.push(t);
  }

  return { transactions: transactions, count: transactions.length, lastRowRead: lastRow };
}

// ============ DASHBOARD ============

function getDashboard(viewCurrency, exchangeRate) {
  var txData = getTransactions(viewCurrency, exchangeRate);
  var tx = txData.transactions;

  if (tx.length === 0) {
    return {
      metrics: { totalTransactions: 0, totalDividends: 0 },
      currentAssets: [],
      byPlatform: [],
      platforms: [],
      recentTransactions: [],
      portfolio: null,
      history: null
    };
  }

  var totalInvested = 0, totalSold = 0, totalDeposits = 0, totalDividends = 0;
  var totalWithdrawals = 0, totalTransfersIn = 0, totalTransfersOut = 0;
  var totalCryptoInterest = 0, totalDRIP = 0;

  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    var amount = t.displayTotal || 0;

    if (t.action === "Buy") totalInvested += Math.abs(amount);
    else if (t.action === "Sell") totalSold += amount;
    else if (t.action === "Cash Deposit" || t.action === "Transfer Deposit") totalDeposits += amount;
    else if (t.action === "Dividend") totalDividends += amount;
    else if (t.action === "Cash Withdrawal") totalWithdrawals += amount;
    else if (t.action === "Transfer Send") totalTransfersOut += amount;
    else if (t.action === "Crypto Interest") totalCryptoInterest += amount;
    else if (t.action === "DRIP") totalDRIP += amount;
  }

  var assetsMap = {};
  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    if (t.ticker && t.ticker !== "Cash" && t.ticker !== "" && t.rollingQuantity > 0) {
      assetsMap[t.ticker] = {
        ticker: t.ticker,
        name: t.assetName,
        class: t.assetClass,
        sector: t.sector,
        quantity: t.rollingQuantity,
        costBasis: t.displayRollingCost || t.rollingCost,
        originalCostBasis: t.rollingCost,
        originalCurrency: t.currency,
        currency: viewCurrency,
        platform: t.platform
      };
    }
  }

  var currentAssets = [];
  for (var key in assetsMap) currentAssets.push(assetsMap[key]);

  var byPlatform = {};
  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    var pk = t.platform || "Sin Plataforma";

    if (!byPlatform[pk]) {
      byPlatform[pk] = {
        platform: pk,
        count: 0,
        invested: 0,
        originalCurrency: t.currency,
        deposits: 0,
        sold: 0,
        dividends: 0
      };
    }

    byPlatform[pk].count++;
    var amount = t.displayTotal || 0;

    if (t.action === "Buy") byPlatform[pk].invested += Math.abs(amount);
    else if (t.action === "Cash Deposit" || t.action === "Transfer Deposit") byPlatform[pk].deposits += Math.abs(amount);
    else if (t.action === "Sell") byPlatform[pk].sold += amount;
    else if (t.action === "Dividend") byPlatform[pk].dividends += amount;
  }

  var byPlatformArray = [];
  for (var key in byPlatform) {
    byPlatformArray.push(byPlatform[key]);
  }

  var recent = [];
  var startIdx = Math.max(0, tx.length - 20);
  for (var i = startIdx; i < tx.length; i++) recent.push(tx[i]);
  recent.reverse();

  var portfolioData = null;
  try {
    portfolioData = getPortfolio(viewCurrency, exchangeRate);
  } catch (e) {
    portfolioData = null;
  }

  // Enriquecer currentAssets con iconUrl del portfolio si existe
  if (portfolioData && portfolioData.portfolio) {
    var portfolioIcons = {};
    for (var i = 0; i < portfolioData.portfolio.length; i++) {
      var p = portfolioData.portfolio[i];
      if (p.ticker && p.iconUrl) {
        portfolioIcons[p.ticker.toUpperCase()] = p.iconUrl;
      }
    }
    for (var i = 0; i < currentAssets.length; i++) {
      var ticker = currentAssets[i].ticker.toUpperCase();
      if (portfolioIcons[ticker]) {
        currentAssets[i].iconUrl = portfolioIcons[ticker];
      }
    }
  }

  // Obtener resumen por plataforma con métricas de mercado
  var platformsSummary = getPlatformsSummary(viewCurrency, exchangeRate);

  // Obtener datos históricos de precios
  var historicalData = getHistoricalPrices();

  // ===== CÁLCULO CORRECTO DEL PATRIMONIO TOTAL =====
  // Usar datos del portfolio (valor de mercado + cash) en lugar de flujos contables
  var totalMarketValue = 0;
  var totalCash = 0;
  var totalPatrimonio = 0;

  if (portfolioData && portfolioData.summary) {
    totalMarketValue = portfolioData.summary.totalCurrentValue || 0;
  }

  // Calcular cash total desde las transacciones
  // Cash = depositos - retiros + dividendos + intereses - compras + ventas
  totalCash = totalDeposits - totalWithdrawals + totalDividends + totalCryptoInterest - totalInvested + totalSold;

  // Patrimonio total = valor de mercado de posiciones abiertas + efectivo disponible
  totalPatrimonio = totalMarketValue + totalCash;

  return {
    metrics: {
      totalTransactions: tx.length,
      totalInvested: round(totalInvested),
      totalSold: round(totalSold),
      totalDeposits: round(totalDeposits),
      totalDividends: round(totalDividends),
      totalWithdrawals: round(totalWithdrawals),
      totalTransfersIn: round(totalTransfersIn),
      totalTransfersOut: round(totalTransfersOut),
      totalCryptoInterest: round(totalCryptoInterest),
      totalDRIP: round(totalDRIP),
      netInvested: round(totalInvested - totalSold),
      currentAssets: currentAssets.length,
      // NUEVO: Patrimonio calculado correctamente
      totalMarketValue: round(totalMarketValue),
      totalCash: round(totalCash),
      totalPortfolioValue: round(totalPatrimonio)
    },
    currentAssets: currentAssets,
    byPlatform: byPlatformArray,
    platforms: platformsSummary.platforms,
    recentTransactions: recent,
    allTransactions: tx,
    portfolio: portfolioData,
    history: historicalData
  };
}

// ============ PLATFORMS SUMMARY (NEW - Transaction Traceability) ============

function getPlatformsSummary(viewCurrency, exchangeRate) {
  // DEBUG: verificar parámetros
  Logger.log("getPlatformsSummary called with viewCurrency=" + viewCurrency + ", exchangeRate=" + exchangeRate);

  // 1. Obtener portfolio con datos de mercado (ya convertidos si exchangeRate existe)
  var portfolioData = getPortfolio(viewCurrency, exchangeRate);
  var portfolio = portfolioData.portfolio || [];
  
  // 2. Obtener transacciones para trazabilidad por plataforma
  var txData = getTransactions(viewCurrency, exchangeRate);
  var transactions = txData.transactions || [];
  
  // 2b. Calcular cash por plataforma desde transacciones
  var platformCash = {};
  for (var i = 0; i < transactions.length; i++) {
    var t = transactions[i];
    var pk = (t.platform || "Sin Plataforma").toUpperCase().trim();
    var amount = t.displayTotal || 0;
    
    if (!platformCash[pk]) {
      platformCash[pk] = 0;
    }
    
    if (t.action === "Cash Deposit" || t.action === "Transfer Deposit" || 
        t.action === "Dividend" || t.action === "Crypto Interest") {
      platformCash[pk] += amount;
    } else if (t.action === "Cash Withdrawal" || t.action === "Transfer Send") {
      platformCash[pk] -= amount;
    } else if (t.action === "Buy") {
      platformCash[pk] -= amount;
    } else if (t.action === "Sell") {
      platformCash[pk] += amount;
    }
  }
  
  // 3. Calcular posiciones por plataforma desde transacciones
  var txPositions = {};
  
  for (var i = 0; i < transactions.length; i++) {
    var t = transactions[i];
    if (!t.ticker || t.ticker === "Cash" || t.ticker === "") continue;
    
    var ticker = t.ticker.toUpperCase();
    var pk = (t.platform || "Sin Plataforma").toUpperCase().trim();
    var action = t.action || "";
    var quantity = parseFloat(t.quantity) || 0;
    var amount = Math.abs(t.displayTotal || t.totalUSD || t.total || 0);
    
    if (!txPositions[ticker]) {
      txPositions[ticker] = {};
    }
    if (!txPositions[ticker][pk]) {
      txPositions[ticker][pk] = {
        quantity: 0,
        invested: 0,
        sold: 0,
        soldAmount: 0,
        realizedPL: 0
      };
    }
    
    var pos = txPositions[ticker][pk];
    
    if (action === "Buy") {
      pos.quantity += quantity;
      pos.invested += amount;
    } else if (action === "Sell") {
      var costBasisSold = pos.quantity > 0 ? (pos.invested / pos.quantity) * quantity : 0;
      pos.quantity -= quantity;
      pos.invested -= costBasisSold;
      pos.sold += quantity;
      pos.soldAmount += amount;
      pos.realizedPL += amount - costBasisSold;
      
      if (pos.quantity < 0) pos.quantity = 0;
      if (pos.invested < 0) pos.invested = 0;
    } else if (action === "DRIP" || action === "Transfer Deposit") {
      pos.quantity += quantity;
    } else if (action === "Transfer Send") {
      var costBasisTransferred = pos.quantity > 0 ? (pos.invested / pos.quantity) * quantity : 0;
      pos.quantity -= quantity;
      pos.invested -= costBasisTransferred;
      if (pos.quantity < 0) pos.quantity = 0;
      if (pos.invested < 0) pos.invested = 0;
    }
  }
  
  // 4. Agrupar métricas por plataforma
  var platforms = {};
  
  // 4a. Procesar posiciones abiertas del portfolio
  for (var i = 0; i < portfolio.length; i++) {
    var p = portfolio[i];
    if (p.isSold) continue;
    
    var ticker = p.ticker.toUpperCase();
    var currentPrice = p.currentPrice || 0;
    var currentValue = p.currentValue || 0;
    var cost = p.cost || 0;
    var dailyChange = p.dailyChange || 0;
    var unrealizedPL = p.unrealizedPL || 0;
    var unrealizedROI = p.unrealizedROI || 0;
    
    // Los valores de p ya vienen convertidos por getPortfolio()
    // Solo necesitamos asegurar que el cash también esté convertido
    
    var tickerTx = txPositions[ticker];
    
    if (tickerTx && Object.keys(tickerTx).length > 0) {
      var totalTxQuantity = 0;
      for (var pk in tickerTx) {
        totalTxQuantity += tickerTx[pk].quantity;
      }
      
      var portfolioQuantity = p.quantityNum || totalTxQuantity;
      
      for (var pk in tickerTx) {
        var pos = tickerTx[pk];
        if (pos.quantity <= 0) continue;
        
        if (!platforms[pk]) {
          platforms[pk] = {
            platform: pk,
            totalInvested: 0,
            marketValue: 0,
            unrealizedPL: 0,
            dayChange: 0,
            symbols: 0,
            realizedPL: 0
          };
        }
        
        var ratio = portfolioQuantity > 0 ? pos.quantity / portfolioQuantity : 0;
        if (ratio > 1) ratio = 1;
        
        platforms[pk].totalInvested += cost * ratio;
        platforms[pk].marketValue += currentValue * ratio;
        platforms[pk].unrealizedPL += unrealizedPL * ratio;
        platforms[pk].dayChange += dailyChange * ratio;
        platforms[pk].symbols += 1;
      }
    } else {
      // Fallback: usar plataformas del portfolio
      var platformsList = p.platforms || [p.platform || "Sin Plataforma"];
      
      for (var j = 0; j < platformsList.length; j++) {
        var pk = platformsList[j].toUpperCase().trim();
        if (!pk) pk = "Sin Plataforma";
        
        if (!platforms[pk]) {
          platforms[pk] = {
            platform: platformsList[j],
            totalInvested: 0,
            marketValue: 0,
            unrealizedPL: 0,
            dayChange: 0,
            symbols: 0,
            realizedPL: 0
          };
        }
        
        var weight = 1 / platformsList.length;
        platforms[pk].totalInvested += cost * weight;
        platforms[pk].marketValue += currentValue * weight;
        platforms[pk].unrealizedPL += unrealizedPL * weight;
        platforms[pk].dayChange += dailyChange * weight;
        platforms[pk].symbols += 1;
      }
    }
  }
  
  // 4b. Agregar realized P/L de posiciones cerradas
  for (var ticker in txPositions) {
    for (var pk in txPositions[ticker]) {
      var pos = txPositions[ticker][pk];
      if (pos.realizedPL !== 0) {
        if (!platforms[pk]) {
          platforms[pk] = {
            platform: pk,
            totalInvested: 0,
            marketValue: 0,
            unrealizedPL: 0,
            dayChange: 0,
            symbols: 0,
            realizedPL: 0
          };
        }
        platforms[pk].realizedPL += pos.realizedPL;
      }
    }
  }
  
  // 5. Calcular métricas derivadas y construir resultado
  var result = [];
  for (var key in platforms) {
    var p = platforms[key];
    
    var dayChangePct = p.marketValue > 0 && (p.marketValue - p.dayChange) !== 0 ? 
      (p.dayChange / (p.marketValue - p.dayChange)) * 100 : 0;
    var unrealizedROI = p.totalInvested > 0 ? (p.unrealizedPL / p.totalInvested) * 100 : 0;
    
    var historicalInvested = 0;
    for (var ticker in txPositions) {
      if (txPositions[ticker][key]) {
        historicalInvested += txPositions[ticker][key].invested || 0;
      }
    }
    var realizedROI = historicalInvested > 0 ? (p.realizedPL / historicalInvested) * 100 : 0;
    
    var cash = platformCash[key] || 0;
    var totalValue = p.marketValue + cash;
    
    Logger.log("Platform " + key + ": marketValue=" + p.marketValue + ", cash=" + cash + ", totalValue=" + totalValue + ", viewCurrency=" + viewCurrency);
    
    result.push({
      platform: p.platform,
      totalInvested: round(p.totalInvested),
      marketValue: round(p.marketValue),
      cash: round(cash),
      totalValue: round(totalValue),
      symbols: p.symbols,
      dayChange: round(p.dayChange),
      dayChangePct: round(dayChangePct),
      unrealizedPL: round(p.unrealizedPL),
      unrealizedROI: round(unrealizedROI),
      realizedPL: round(p.realizedPL),
      realizedROI: round(realizedROI)
    });
  }
  
  return { platforms: result };
}
// ============ ASSETS ============

function getAssets(viewCurrency, exchangeRate) {
  var tx = getTransactions(viewCurrency, exchangeRate).transactions;
  var assets = {};

  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    if (!t.ticker || t.ticker === "Cash" || t.ticker === "") continue;

    if (!assets[t.ticker]) {
      assets[t.ticker] = {
        ticker: t.ticker, name: t.assetName, class: t.assetClass, sector: t.sector,
        buys: [], sells: [], dividends: [], transfersIn: [], transfersOut: [],
        cryptoInterests: [], drips: [],
        totalQuantity: 0, totalInvested: 0, totalSold: 0, totalDividends: 0, totalCryptoInterest: 0,
        originalCurrency: t.currency, currency: viewCurrency, platform: t.platform
      };
    }

    var a = assets[t.ticker];
    var amount = t.displayTotal || 0;

    if (t.action === "Buy") {
      a.buys.push({ date: t.date, quantity: t.quantity, price: t.displayPrice, total: Math.abs(amount) });
      a.totalQuantity += t.quantity; a.totalInvested += Math.abs(amount);
    } else if (t.action === "Sell") {
      a.sells.push({ date: t.date, quantity: t.quantity, price: t.displayPrice, total: amount });
      a.totalQuantity -= t.quantity; a.totalSold += amount;
    } else if (t.action === "Dividend") {
      a.dividends.push({ date: t.date, amount: t.amount, total: amount });
      a.totalDividends += amount;
    } else if (t.action === "Crypto Interest") {
      a.cryptoInterests.push({ date: t.date, amount: t.amount, total: amount });
      a.totalCryptoInterest += amount;
    } else if (t.action === "DRIP") {
      a.drips.push({ date: t.date, quantity: t.quantity, total: amount });
      a.totalQuantity += t.quantity;
    } else if (t.action === "Transfer Deposit") {
      a.transfersIn.push({ date: t.date, quantity: t.quantity });
      a.totalQuantity += t.quantity;
    } else if (t.action === "Transfer Send") {
      a.transfersOut.push({ date: t.date, quantity: t.quantity });
      a.totalQuantity -= t.quantity;
    }
  }

  var result = [];
  for (var key in assets) {
    var a = assets[key];
    var totalBought = 0;
    for (var j = 0; j < a.buys.length; j++) totalBought += a.buys[j].quantity;

    a.avgCost = totalBought > 0 ? round(a.totalInvested / totalBought) : 0;
    a.realizedPnL = round(a.totalSold - a.totalInvested + a.totalDividends + a.totalCryptoInterest);
    a.netInvested = round(a.totalInvested - a.totalSold);
    a.currentQuantity = round(a.totalQuantity);
    a.currentCost = a.currentQuantity > 0 ? round(a.avgCost * a.currentQuantity) : 0;
    result.push(a);
  }

  return { assets: result };
}

// ============ PLATFORMS (Original - para tab de Brókers) ============

function getPlatforms(viewCurrency, exchangeRate) {
  var tx = getTransactions(viewCurrency, exchangeRate).transactions;
  var platforms = {};

  for (var i = 0; i < tx.length; i++) {
    var t = tx[i];
    var pk = t.platform || "Sin Plataforma";

    if (!platforms[pk]) {
      platforms[pk] = {
        platform: pk,
        originalCurrency: t.currency,
        currency: viewCurrency,
        transactions: 0,
        totalDeposits: 0,
        totalInvested: 0,
        totalSold: 0,
        totalDividends: 0,
        totalWithdrawals: 0,
        totalTransfersOut: 0,
        totalCryptoInterest: 0,
        assetCount: {}
      };
    }

    var p = platforms[pk];
    p.transactions++;
    var amount = t.displayTotal || 0;

    if (t.action === "Cash Deposit" || t.action === "Transfer Deposit") p.totalDeposits += amount;
    if (t.action === "Buy") p.totalInvested += amount;
    if (t.action === "Sell") p.totalSold += amount;
    if (t.action === "Dividend") p.totalDividends += amount;
    if (t.action === "Cash Withdrawal") p.totalWithdrawals += amount;
    if (t.action === "Transfer Send") p.totalTransfersOut += amount;
    if (t.action === "Crypto Interest") p.totalCryptoInterest += amount;
    if (t.ticker && t.ticker !== "Cash" && t.ticker !== "") p.assetCount[t.ticker] = true;
  }

  var result = [];
  for (var key in platforms) {
    var p = platforms[key];
    var assetCountSize = 0;
    for (var k in p.assetCount) assetCountSize++;

    result.push({
      platform: p.platform,
      originalCurrency: p.originalCurrency,
      currency: p.currency,
      transactions: p.transactions,
      totalDeposits: round(p.totalDeposits),
      totalInvested: round(p.totalInvested),
      totalSold: round(p.totalSold),
      totalDividends: round(p.totalDividends),
      totalWithdrawals: round(p.totalWithdrawals),
      totalTransfersOut: round(p.totalTransfersOut),
      totalCryptoInterest: round(p.totalCryptoInterest),
      assetCount: assetCountSize,
      netFlow: round(p.totalDeposits - p.totalInvested + p.totalSold + p.totalDividends - p.totalWithdrawals - p.totalTransfersOut + p.totalCryptoInterest)
    });
  }

  return { platforms: result };
}

// ============ SUMMARY ============

function getSummary(viewCurrency, exchangeRate) {
  var dashboard = getDashboard(viewCurrency, exchangeRate);
  var assets = getAssets(viewCurrency, exchangeRate);

  return {
    metrics: dashboard.metrics,
    currentAssets: dashboard.currentAssets,
    byPlatform: dashboard.byPlatform,
    platforms: dashboard.platforms,
    recentTransactions: dashboard.recentTransactions,
    allTransactions: dashboard.allTransactions,
    assetDetails: assets.assets,
    portfolio: dashboard.portfolio
  };
}

// ============ DEBUG ============

function getDebugInfo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var portfolioSheet = ss.getSheetByName(PORTFOLIO_SHEET_NAME);

  var availableSheets = ss.getSheets().map(function(s) { return s.getName(); });

  if (!sheet) {
    return { error: 'Hoja no encontrada', availableSheets: availableSheets };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var tx = getTransactions("USD", null);

  var platforms = {};
  for (var i = 0; i < tx.transactions.length; i++) {
    var p = tx.transactions[i].platform || "Sin Plataforma";
    platforms[p] = (platforms[p] || 0) + 1;
  }

  var portfolioInfo = null;
  if (portfolioSheet) {
    portfolioInfo = {
      name: PORTFOLIO_SHEET_NAME,
      lastRow: portfolioSheet.getLastRow(),
      lastCol: portfolioSheet.getLastColumn()
    };
  }

  return {
    debug: true,
    sheetName: SHEET_NAME,
    lastRow: lastRow,
    lastColumn: lastCol,
    transactionsCount: tx.count,
    uniquePlatforms: platforms,
    sampleTransaction: tx.count > 0 ? tx.transactions[0] : null,
    exchangeRateUSD_DOP: getExchangeRateFromSheet("USD", "DOP"),
    availableSheets: availableSheets,
    portfolioSheet: portfolioInfo
  };
}

// ============ HISTORICAL PRICES (FECHAS sheet) ============

const FECHAS_SHEET_NAME = "FECHA";

function getHistoricalPrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("FECHA");

  if (!sheet) {
    return { dates: [], prices: {}, error: "Hoja FECHA no encontrada" };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < 2 || lastCol < 3) {
    return { dates: [], prices: {}, error: "Hoja FECHA vacía" };
  }

  var range = sheet.getRange(1, 1, lastRow, lastCol);
  var allData = range.getValues();

  var headers = allData[0];
  var dates = [];
  var dateKeys = [];

  for (var col = 3; col < headers.length; col++) {
    var header = headers[col];
    var headerStr = "";

    if (header instanceof Date) {
      headerStr = Utilities.formatDate(header, Session.getScriptTimeZone(), "MMM''yy");
    } else {
      headerStr = String(header || "").trim();
    }

    if (headerStr && headerStr !== "Total" && headerStr !== "") {
      var parsed = parseMonthYear(headerStr);
      if (parsed && parsed.key) {
        dates.push(parsed.key);
        dateKeys.push(parsed.key);
      }
    }
  }

  dates.sort();

  var prices = {};
  var currentBroker = "";
  var lastRealBroker = "";

  // Palabras que NO son brókeres
  var nonBrokerWords = ["GANANCIAS", "PERDIDAS", "CON", "ACCIONES", "VENDIDAS", "FRANCISCO", "MARIANOPARDO", "OLIVERDANVEL", "RUBYMZA"];
  // Nombres de brókeres conocidos
  var knownBrokersList = ["ETORO", "HAPI", "TRADESTATION"];

  for (var row = 1; row < allData.length; row++) {
    var rowData = allData[row];
    var colA = String(rowData[0] || "").trim();
    var colB = String(rowData[1] || "").trim();
    var colC = rowData[2] !== undefined ? String(rowData[2] || "").trim() : "";

    // LIMPIAR "CellImage"
    if (colA === "CellImage") colA = "";

    // DEBUG
    if (row < 35) {
      Logger.log("Row " + (row + 1) + ": A='" + colA + "' B='" + colB + "' C='" + colC + "'");
    }

    // FILA VACÍA: no resetear lastRealBroker
    if (colA === "" && colB === "" && colC === "") {
      currentBroker = "";
      if (row < 35) Logger.log("  -> Fila vacía");
      continue;
    }

    // PATRÓN 1: Bróker en colA, colB vacío (ej: "ETORO,,")
    if (colA !== "" && colB === "" && colC === "") {
      currentBroker = colA.toUpperCase();
      lastRealBroker = currentBroker;
      if (row < 35) Logger.log("  -> Broker (patrón 1): " + currentBroker);
      continue;
    }

    // PATRÓN 2: Subtotal con "Total" en colB
    if (colB === "Total" && colA !== "") {
      currentBroker = colA.toUpperCase();
      lastRealBroker = currentBroker;
      if (row < 35) Logger.log("  -> Broker (patrón 3): " + currentBroker);
      continue;
    }

    // PATRÓN 3: Bróker en colB, colA vacío - detectar por nombre conocido
    if (colA === "" && colB !== "") {
      var possibleBroker = colB.toUpperCase();

      // Verificar si es un bróker conocido
      var isKnownBroker = false;
      for (var i = 0; i < knownBrokersList.length; i++) {
        if (possibleBroker === knownBrokersList[i]) {
          isKnownBroker = true;
          break;
        }
      }

      // Verificar si es palabra prohibida
      var isNonBroker = false;
      for (var i = 0; i < nonBrokerWords.length; i++) {
        if (possibleBroker.indexOf(nonBrokerWords[i]) !== -1) {
          isNonBroker = true;
          break;
        }
      }

      if (isKnownBroker && !isNonBroker) {
        currentBroker = possibleBroker;
        lastRealBroker = currentBroker;
        if (row < 35) Logger.log("  -> Broker (patrón 2): " + currentBroker);
        continue;
      } else if (isNonBroker) {
        if (row < 35) Logger.log("  -> Ignorado: " + possibleBroker);
        continue;
      }
    }

    // TICKER: colA vacío, colB es ticker corto (1-5 letras), no es bróker conocido
    if ((colA === "" || colA === "CellImage") && colB !== "" && colB !== "Total") {
      var ticker = colB.toUpperCase();

      // Verificar que sea un ticker válido (corto, sin espacios)
      if (ticker.length > 6 || ticker.indexOf(" ") !== -1) {
        if (row < 35) Logger.log("  -> Saltado (no parece ticker): " + ticker);
        continue;
      }

      // Verificar que no sea bróker conocido
      var isBroker = false;
      for (var i = 0; i < knownBrokersList.length; i++) {
        if (ticker === knownBrokersList[i]) {
          isBroker = true;
          break;
        }
      }
      if (isBroker) {
        if (row < 35) Logger.log("  -> Saltado (es broker): " + ticker);
        continue;
      }

      // Usar lastRealBroker si no hay currentBroker válido
      var brokerToUse = currentBroker || lastRealBroker;

      if (!brokerToUse) {
        if (row < 35) Logger.log("  -> Saltado (sin broker): " + ticker);
        continue;
      }

      if (!prices[ticker]) {
        prices[ticker] = {};
      }
      if (!prices[ticker][brokerToUse]) {
        prices[ticker][brokerToUse] = {};
      }

      var pricesFound = 0;
      for (var col = 3; col < rowData.length && (col - 3) < dateKeys.length; col++) {
        var priceVal = rowData[col];
        var priceStr = String(priceVal || "").replace(/[$,]/g, "").trim();
        var price = parseFloat(priceStr);

        if (!isNaN(price) && price > 0) {
          var dateKey = dateKeys[col - 3];
          prices[ticker][brokerToUse][dateKey] = price;
          pricesFound++;
        }
      }

      if (pricesFound > 0 && row < 35) {
        Logger.log("  -> Ticker " + ticker + " (" + brokerToUse + "): " + pricesFound + " prices");
      }
    }
  }

  var totalPrices = 0;
  var tickers = Object.keys(prices);
  for (var i = 0; i < tickers.length; i++) {
    var brokers = Object.keys(prices[tickers[i]]);
    for (var j = 0; j < brokers.length; j++) {
      totalPrices += Object.keys(prices[tickers[i]][brokers[j]]).length;
    }
  }

  Logger.log("Total tickers: " + tickers.length);
  Logger.log("Total price entries: " + totalPrices);
  Logger.log("Tickers found: " + tickers.join(", "));

  return { 
    dates: dates,
    prices: prices
  };
}

function isLikelyTicker(str) {
  var upper = str.toUpperCase();
  var nonTickers = ["TOTAL", "GANANCIAS", "PERDIDAS", "CON", "ACCIONES", "VENDIDAS", "FRANCISCO", "MARIANOPARDO", "OLIVERDANVEL", "RUBYMZA", "ETORO", "HAPI", "TRADESTATION"];
  if (nonTickers.indexOf(upper) !== -1) return false;

  if (str.indexOf(" ") !== -1 || str.length > 6) return false;

  return /^[A-Z0-9]{1,6}$/i.test(str) && /[A-Z]/i.test(str);
}

function parseMonthYear(monthYearStr) {
  // Formato: "Jun'26" o "Jun'2026" o "Jun 26"
  var str = String(monthYearStr).trim();
  Logger.log("parseMonthYear input: '" + str + "'");

  var match = str.match(/([A-Za-z]{3})['']?\s*(\d{2,4})/);

  if (!match) {
    // Intentar parsear como fecha si es un objeto Date stringificado
    try {
      var d = new Date(str);
      if (!isNaN(d.getTime())) {
        var year = d.getFullYear();
        var month = d.getMonth() + 1;
        var key = year + "-" + String(month).padStart(2, '0');
        Logger.log("  -> parsed as Date: " + key);
        return { key: key, label: str };
      }
    } catch(e) {}

    Logger.log("  -> FAILED to parse");
    return { key: str, label: str };
  }

  var monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  var monthIdx = monthNames.indexOf(match[1].toLowerCase());

  if (monthIdx === -1) {
    Logger.log("  -> month not recognized: " + match[1]);
    return { key: str, label: str };
  }

  var year = parseInt(match[2]);
  if (year < 100) year += 2000;

  var month = monthIdx + 1;
  var key = year + "-" + String(month).padStart(2, '0');

  Logger.log("  -> parsed: " + key);
  return { key: key, label: str };
}


// ============ PERFORMANCE (RENDIMIENTO) - NUEVO v6.3 ============

function getPerformance(viewCurrency, exchangeRate) {
  var dashboard = getDashboard(viewCurrency, exchangeRate);
  var portfolio = dashboard.portfolio;
  var transactions = dashboard.allTransactions || [];
  var summary = portfolio ? portfolio.summary : {};

  // 1. Rendimiento Total (desde el inicio)
  // Capital invertido = costo de posiciones abiertas (del portfolio) + costo de posiciones vendidas
  var totalInvested = summary ? (summary.totalCost || 0) : 0;

  // Calcular costo de posiciones vendidas usando FIFO desde transacciones
  var soldCost = calculateSoldCostFIFO(transactions);
  totalInvested += soldCost;

  var totalSold = dashboard.metrics ? (dashboard.metrics.totalSold || 0) : 0;
  var totalDividends = dashboard.metrics ? (dashboard.metrics.totalDividends || 0) : 0;
  var totalCryptoInterest = dashboard.metrics ? (dashboard.metrics.totalCryptoInterest || 0) : 0;
  var totalMarketValue = summary ? (summary.totalCurrentValue || 0) : 0;
  var totalRealizedPL = summary ? (summary.totalRealizedPL || 0) : 0;
  var totalUnrealizedPL = summary ? (summary.totalUnrealizedPL || 0) : 0;

  var totalReturn = totalUnrealizedPL + totalRealizedPL + totalDividends + totalCryptoInterest;
  var totalReturnPct = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

  // 2. Rendimiento por períodos — EL FRONTEND LO CALCULA CON DATOS REALES DE FECHAS
  var periods = [];

  // 3. Rendimiento por activo (top performers)
  var assetPerformance = [];
  if (portfolio && portfolio.portfolio) {
    var activeAssets = portfolio.portfolio.filter(function(p) { return !p.isSold; });
    assetPerformance = activeAssets.map(function(p) {
      return {
        ticker: p.ticker,
        assetName: p.assetName,
        assetClass: p.assetClass,
        quantity: p.quantityNum,
        cost: p.cost,
        currentValue: p.currentValue,
        unrealizedPL: p.unrealizedPL,
        unrealizedROI: p.unrealizedROI,
        realizedPL: p.realizedPL,
        totalPL: p.totalPL,
        dailyChange: p.dailyChange,
        dailyChangePct: p.dailyPctChange,
        weight: summary && summary.totalCurrentValue > 0 ? (p.currentValue / summary.totalCurrentValue) * 100 : 0,
        iconUrl: p.iconUrl
      };
    }).sort(function(a, b) { return b.totalPL - a.totalPL; });
  }

  // 4. Rendimiento por plataforma
  var platformPerformance = [];
  if (dashboard.platforms) {
    platformPerformance = dashboard.platforms.map(function(p) {
      var totalPL = (p.unrealizedPL || 0) + (p.realizedPL || 0);
      var totalInvestedPlatform = p.totalInvested || 0;
      return {
        platform: p.platform,
        totalInvested: p.totalInvested,
        marketValue: p.marketValue,
        cash: p.cash,
        totalValue: p.totalValue,
        unrealizedPL: p.unrealizedPL,
        unrealizedROI: p.unrealizedROI,
        realizedPL: p.realizedPL,
        realizedROI: p.realizedROI,
        totalPL: totalPL,
        totalROI: totalInvestedPlatform > 0 ? (totalPL / totalInvestedPlatform) * 100 : 0,
        dayChange: p.dayChange,
        dayChangePct: p.dayChangePct,
        symbols: p.symbols
      };
    }).sort(function(a, b) { return b.totalPL - a.totalPL; });
  }

  // 5. Distribución de rendimiento
  var distribution = { excellent: 0, good: 0, neutral: 0, bad: 0, terrible: 0, 
                       excellentCount: 0, goodCount: 0, neutralCount: 0, badCount: 0, terribleCount: 0 };

  if (portfolio && portfolio.portfolio) {
    distribution = getPerformanceDistribution(portfolio.portfolio);
  }

  // 6. Métricas de riesgo
  var riskMetrics = calculateRiskMetrics(portfolio, transactions, viewCurrency);

  return {
    summary: {
      totalInvested: round(totalInvested),
      totalMarketValue: round(totalMarketValue),
      totalCash: round(dashboard.metrics ? (dashboard.metrics.totalCash || 0) : 0),
      totalPortfolioValue: round(dashboard.metrics ? (dashboard.metrics.totalPortfolioValue || 0) : 0),
      totalUnrealizedPL: round(totalUnrealizedPL),
      totalRealizedPL: round(totalRealizedPL),
      totalDividends: round(totalDividends),
      totalCryptoInterest: round(totalCryptoInterest),
      totalReturn: round(totalReturn),
      totalReturnPct: round(totalReturnPct),
      overallUnrealizedROI: summary ? round(summary.overallUnrealizedROI || 0) : 0,
      overallDailyChangePct: summary ? round(summary.overallDailyChangePct || 0) : 0
    },
    periods: periods,
    assetPerformance: assetPerformance.slice(0, 20),
    platformPerformance: platformPerformance,
    distribution: distribution,
    riskMetrics: riskMetrics
  };
}

function calculateRiskMetrics(portfolio, transactions, viewCurrency) {
  var metrics = {
    volatility: null,
    maxDrawdown: null,
    sharpeRatio: null,
    bestMonth: null,
    worstMonth: null,
    avgMonthlyReturn: null
  };

  if (portfolio && portfolio.portfolio) {
    var positions = portfolio.portfolio.filter(function(p) { return !p.isSold; });
    var totalInvested = 0;
    var totalCurrentValue = 0;

    for (var i = 0; i < positions.length; i++) {
      totalInvested += positions[i].cost || 0;
      totalCurrentValue += positions[i].currentValue || 0;
    }

    var peak = totalInvested > totalCurrentValue ? totalInvested : totalCurrentValue;
    if (peak > 0) {
      metrics.maxDrawdown = round(((peak - totalCurrentValue) / peak) * 100);
    }
  }

  return metrics;
}


// ============ CALCULO FIFO PARA COSTO DE POSICIONES VENDIDAS ============

function calculateSoldCostFIFO(transactions) {
  var buys = [];
  var sells = [];

  for (var i = 0; i < transactions.length; i++) {
    var t = transactions[i];
    if (t.action === "Buy") {
      buys.push({
        ticker: t.ticker,
        quantity: parseFloat(t.quantity) || 0,
        price: parseFloat(t.displayPrice || t.price) || 0,
        total: Math.abs(t.displayTotal || t.totalUSD || t.total || 0),
        date: t.dateRaw || t.date
      });
    } else if (t.action === "Sell") {
      sells.push({
        ticker: t.ticker,
        quantity: parseFloat(t.quantity) || 0,
        date: t.dateRaw || t.date
      });
    }
  }

  // Ordenar compras por fecha (FIFO)
  buys.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
  sells.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

  var totalSoldCost = 0;
  var buyQueue = [];

  // Inicializar cola de compras
  for (var i = 0; i < buys.length; i++) {
    buyQueue.push({
      ticker: buys[i].ticker,
      quantity: buys[i].quantity,
      costPerShare: buys[i].quantity > 0 ? buys[i].total / buys[i].quantity : 0,
      remaining: buys[i].quantity
    });
  }

  // Procesar ventas con FIFO
  for (var i = 0; i < sells.length; i++) {
    var sell = sells[i];
    var qtyToMatch = sell.quantity;

    while (qtyToMatch > 0 && buyQueue.length > 0) {
      var buy = buyQueue[0];

      if (buy.ticker !== sell.ticker) {
        buyQueue.shift();
        continue;
      }

      var matchQty = Math.min(qtyToMatch, buy.remaining);
      totalSoldCost += matchQty * buy.costPerShare;
      buy.remaining -= matchQty;
      qtyToMatch -= matchQty;

      if (buy.remaining <= 0.0001) {
        buyQueue.shift();
      }
    }
  }

  return round(totalSoldCost);
}

// ============ UTILIDADES ============


function formatDate(dateValue) {
  if (dateValue instanceof Date) {
    return Utilities.formatDate(dateValue, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(dateValue);
}

function round(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function testFechas() {
  var result = getHistoricalPrices();
  Logger.log("dates: " + JSON.stringify(result.dates));
  Logger.log("prices keys: " + Object.keys(result.prices || {}).length);
  Logger.log("sample price: " + JSON.stringify(result.prices ? result.prices[Object.keys(result.prices)[0]] : null));
}

function testPlatformsSummary() {
  var result = getPlatformsSummary("DOP", 58.5);
  Logger.log(JSON.stringify(result, null, 2));
}