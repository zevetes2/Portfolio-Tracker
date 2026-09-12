// ============================================================
// CONFIGURACIÓN
// ============================================================
const API_URL = "https://script.google.com/macros/s/AKfycbzljOCK6u9cCGViOPrAXdLxmznXTAHR8YTBFZ5TQNPnuwij5b6mHKsczAvQdz2_YFaj/exec";

// ============================================================
// ESTADO GLOBAL
// ============================================================
let cache = { USD: null, DOP: null };
let perfCache = { USD: null, DOP: null };
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

let charts = {};
let allTransactions = [];
let portfolioData = [];
let portfolioSummary = {};
let txPage = 0;
const TX_PER_PAGE = 25;
let currentCurrency = "USD";
let currentRate = null;
let showSoldPositionsFlag = false;
let portfolioSort = { field: 'currentValue', dir: 'desc' };
let portfolioFilter = '';
let mobileViewMode = 'cards';
let historyRange = 'ALL';
let historyData = [];
let historicalPrices = {};
let historicalDates = [];

Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";

const chartTooltipConfig = {
  backgroundColor: 'rgba(15, 23, 42, 0.95)',
  titleColor: '#f8fafc',
  bodyColor: '#cbd5e1',
  borderColor: '#334155',
  borderWidth: 1,
  padding: 12,
  cornerRadius: 8,
  boxPadding: 4
};

// ============================================================
// CARGA DE DATOS
// ============================================================
async function loadData(forceRefresh = false) {
  showLoading();
  console.log("loadData called, currentCurrency=" + currentCurrency + ", forceRefresh=" + forceRefresh);

  const now = Date.now();

  if (!forceRefresh && cache[currentCurrency] && (now - lastFetchTime) < CACHE_TTL) {
    console.log("Usando caché para " + currentCurrency);
    var cachedData = cache[currentCurrency];

    allTransactions = cachedData.allTransactions || [];
    txPage = 0;

    if (cachedData.portfolio) {
      portfolioData = cachedData.portfolio.portfolio || [];
      portfolioSummary = cachedData.portfolio.summary || {};
    }

    renderDashboard(cachedData);
    document.getElementById('lastUpdate').textContent =
      new Date(cachedData.meta?.timestamp || Date.now()).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) + ' (caché)';
    showContent();
    return;
  }

  try {
    var url = API_URL + "?action=dashboard&currency=" + currentCurrency;
    if (currentCurrency !== "USD" && currentRate) {
      url += "&rate=" + currentRate;
    }

    var data = await fetchAPI(url, 30000, 2);

    if (data.error) throw new Error(data.error);

    console.log("API response meta:", data.meta);
    if (data.meta && data.meta.exchangeRate) {
      currentRate = data.meta.exchangeRate;
      console.log("Saved currentRate:", currentRate);
    }

    cache[currentCurrency] = data;
    lastFetchTime = now;

    allTransactions = data.allTransactions || [];
    txPage = 0;

    if (data.portfolio) {
      portfolioData = data.portfolio.portfolio || [];
      portfolioSummary = data.portfolio.summary || {};
    }

    renderDashboard(data);
    document.getElementById('lastUpdate').textContent =
      new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    showContent();

  } catch (error) {
    console.error("Error:", error);
    showError(error.message);
  }
}

async function loadPerformanceData() {
  try {
    const perfData = await fetchAPI(
      API_URL + "?action=performance&currency=" + currentCurrency,
      15000,
      1
    );
    renderPerformance(perfData.performance);
  } catch (e) {
    console.warn("No se pudo cargar rendimiento:", e);
  }
}

// ============================================================
// MONEDA / VISTA / TABS
// ============================================================
function setCurrency(currency) {
  if (currency === currentCurrency) return;
  currentCurrency = currency;

  document.getElementById('btn-usd').className = currency === 'USD'
    ? "px-2.5 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-semibold transition-all bg-brand-500 text-white shadow-sm touch-btn"
    : "px-2.5 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 touch-btn";
  document.getElementById('btn-dop').className = currency === 'DOP'
    ? "px-2.5 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-semibold transition-all bg-brand-500 text-white shadow-sm touch-btn"
    : "px-2.5 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-semibold transition-all text-slate-400 hover:text-slate-200 touch-btn";

  loadData();
}

function setMobileView(mode) {
  mobileViewMode = mode;
  document.getElementById('view-cards').classList.toggle('active', mode === 'cards');
  document.getElementById('view-table').classList.toggle('active', mode === 'table');

  const tableEl = document.querySelector('#panel-portfolio .desktop-table');
  const cardsEl = document.getElementById('portfolioMobileCards');

  if (mode === 'cards') {
    if (tableEl) tableEl.style.display = 'none';
    cardsEl.style.display = 'block';
  } else {
    if (tableEl) tableEl.style.display = 'block';
    cardsEl.style.display = 'none';
  }
}

function switchTab(tab) {
  var tabs = ['portfolio', 'assets', 'transactions', 'performance', 'platforms'];
  tabs.forEach(function(t) {
    document.getElementById('panel-' + t).classList.add('hidden');
    document.getElementById('tab-' + t).classList.remove('tab-active');
    document.getElementById('tab-' + t).classList.remove('text-brand-400');
  });
  document.getElementById('panel-' + tab).classList.remove('hidden');
  document.getElementById('tab-' + tab).classList.add('tab-active');
  document.getElementById('tab-' + tab).classList.add('text-brand-400');

  if (window.dashboardData) {
    if (tab === 'assets') {
      renderAssetsTable(window.dashboardData.currentAssets || []);
    } else if (tab === 'platforms') {
      renderPlatformsTable(window.dashboardData.byPlatform || []);
    } else if (tab === 'transactions') {
      renderTransactionsTable();
    }
  }

  if (tab === 'portfolio' && window.innerWidth < 768) {
    setMobileView(mobileViewMode);
  }
}

// ============================================================
// FETCH API (con fallback a JSONP)
// ============================================================
async function fetchAPI(url, timeoutMs, retries) {
  timeoutMs = timeoutMs || 30000;
  retries = retries || 2;

  console.log("fetchAPI called, URL:", url);

  try {
    const data = await fetchWithTimeout(url, timeoutMs);
    console.log("fetchAPI: fetch exitoso");
    return data;
  } catch (fetchError) {
    console.warn("fetchAPI: fetch falló:", fetchError.message);

    if (retries > 0) {
      console.log("fetchAPI: intentando JSONP fallback...");
      return fetchWithJSONP(url, timeoutMs, retries);
    }

    throw fetchError;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const separator = url.indexOf('?') !== -1 ? '&' : '?';
    const urlWithCache = url + separator + '_cb=' + Date.now();

    const response = await fetch(urlWithCache, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' ' + response.statusText);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return await response.json();
    }

    const text = await response.text();
    console.log("Response text preview:", text.substring(0, 100));

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Respuesta no es JSON válido: ' + text.substring(0, 100));
    }

  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function fetchWithJSONP(url, timeoutMs, retries) {
  timeoutMs = timeoutMs || 30000;
  retries = retries || 2;

  return new Promise(function(resolve, reject) {
    var attempt = function(remainingRetries) {
      var scriptId = 'jsonp_' + Date.now() + '_' + Math.random();
      var script = document.createElement('script');
      var timeoutId;
      var cleanedUp = false;

      window[scriptId] = function(data) {
        if (cleanedUp) return;
        cleanedUp = true;
        cleanup();
        resolve(data);
      };

      timeoutId = setTimeout(function() {
        if (cleanedUp) return;
        cleanedUp = true;
        cleanup();
        if (remainingRetries > 0) {
          console.log('JSONP Retrying... remaining:', remainingRetries);
          attempt(remainingRetries - 1);
        } else {
          reject(new Error('Timeout - La API no respondió en ' + timeoutMs + 'ms.'));
        }
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timeoutId);
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[scriptId];
      }

      script.onerror = function() {
        if (cleanedUp) return;
        cleanedUp = true;
        cleanup();
        if (remainingRetries > 0) {
          attempt(remainingRetries - 1);
        } else {
          reject(new Error('Fallo de red al intentar contactar Google Apps Script.'));
        }
      };

      var separator = url.indexOf('?') !== -1 ? '&' : '?';
      script.src = url + separator + 'callback=' + scriptId;

      document.head.appendChild(script);
    };

    attempt(retries);
  });
}

// ============================================================
// CÁLCULO DE PERÍODOS
// ============================================================
function calculatePeriodsFromHistory(historyData, transactions, currentTotalValue, currentCash) {
  if (!historyData || historyData.length === 0 || !window.monthlyPL) return [];

  var now = new Date();
  var currentYear = now.getFullYear();
  var currentMonth = now.getMonth() + 1;
  var currentKey = currentYear + '-' + String(currentMonth).padStart(2, '0');

  var allMonths = Object.keys(window.monthlyPL).sort();
  var last12Months = [];

  var currentIdx = -1;
  for (var i = allMonths.length - 1; i >= 0; i--) {
    if (allMonths[i] <= currentKey) {
      currentIdx = i;
      break;
    }
  }

  if (currentIdx < 0) currentIdx = allMonths.length - 1;

  var startIdx = Math.max(0, currentIdx - 11);
  for (var i = startIdx; i <= currentIdx; i++) {
    last12Months.push(allMonths[i]);
  }

  var monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  var result = last12Months.map(function(dateKey, idx) {
    var plData = window.monthlyPL[dateKey];
    var portfolioData = null;

    for (var i = 0; i < historyData.length; i++) {
      if (historyData[i].date === dateKey) {
        portfolioData = historyData[i];
        break;
      }
    }

    var parts = dateKey.split('-');
    var year = parts[0];
    var month = parseInt(parts[1]);
    var label = monthNames[month - 1] + " '" + year.slice(2);

    var realizedPL = plData ? (plData.realizedPL || 0) : 0;
    var unrealizedPL = plData ? (plData.unrealizedPL || 0) : 0;
    var totalPL = plData ? (plData.pl || 0) : 0;
    var startValue = portfolioData ? portfolioData.invested : 0;
    var endValue = portfolioData ? portfolioData.total : 0;
    var marketValue = portfolioData ? portfolioData.marketValue : 0;
    var cash = portfolioData ? portfolioData.cash : 0;

    return {
      key: dateKey,
      label: label,
      yearMonth: dateKey,
      startValue: Math.round(startValue * 100) / 100,
      endValue: Math.round(endValue * 100) / 100,
      realizedPL: Math.round(realizedPL * 100) / 100,
      unrealizedPL: Math.round(unrealizedPL * 100) / 100,
      totalPL: Math.round(totalPL * 100) / 100,
      marketValue: Math.round(marketValue * 100) / 100,
      cash: Math.round(cash * 100) / 100
    };
  });

  if (result.length > 0 && currentTotalValue > 0) {
    var last = result[result.length - 1];
    var prevTotal = result.length > 1 ? result[result.length - 2].endValue : last.startValue;

    last.endValue = Math.round(currentTotalValue * 100) / 100;
    last.cash = Math.round((currentCash || 0) * 100) / 100;
    last.marketValue = Math.round((last.endValue - last.cash) * 100) / 100;

    var adjustedTotalPL = last.endValue - prevTotal;
    last.totalPL = Math.round(adjustedTotalPL * 100) / 100;
    last.unrealizedPL = Math.round((adjustedTotalPL - last.realizedPL) * 100) / 100;
  }

  return result;
}

// ============================================================
// RENDER PRINCIPAL
// ============================================================
function renderDashboard(data) {
  if (!data || typeof data !== 'object') {
    console.error("renderDashboard: data inválida", data);
    return;
  }

  window.dashboardData = data;

  var rateInfo = document.getElementById('rateInfo');
  var rateText = document.getElementById('rateText');

  if (currentCurrency === 'DOP' && currentRate) {
    rateInfo.classList.remove('hidden');
    rateText.textContent = '1 USD = ' + currentRate.toFixed(2) + ' DOP';
  } else {
    rateInfo.classList.add('hidden');
  }

  if (data.portfolio && data.portfolio.summary) {
    renderPortfolioSummary(data.portfolio.summary, data.metrics);
  } else if (data.summary) {
    renderPortfolioSummary(data.summary, data.metrics);
  }

  if (data.portfolio && data.portfolio.summary) {
    renderPortfolioCharts(data.portfolio.summary);
    renderTopPositions(data.portfolio.summary);
    renderLargestPositions(data.portfolio.summary);
  }

  if (data.portfolio && data.portfolio.portfolio && data.portfolio.portfolio.length > 0) {
    renderBuffettPortfolio(data.portfolio.portfolio);
  }

  if (data.historicoBrokers && data.historicoBrokers.dates && data.historicoBrokers.dates.length > 0) {
    console.log("Usando HISTORICO BROKERS para evolución del patrimonio");

    var hb = data.historicoBrokers;
    historyData = [];

    for (var i = 0; i < hb.dates.length; i++) {
      historyData.push({
        date: hb.dates[i],
        total: hb.totals[i] || 0,
        marketValue: hb.totals[i] || 0,
        cash: 0,
        invested: 0
      });
    }

    renderHistoryChart();
  } else if (data.history && data.history.dates && data.history.dates.length > 0) {
    historicalDates = data.history.dates;
    historicalPrices = data.history.prices || {};
    buildRealHistoryFromPrices(data.allTransactions || []);
    renderHistoryChart();
  } else {
    historicalDates = [];
    historicalPrices = {};
    buildHistoryFromTransactions(data.allTransactions || []);
    renderHistoryChart();
  }

  if (data.portfolio && data.portfolio.portfolio) {
    window.lastPortfolioData = data.portfolio.portfolio;
    portfolioData = data.portfolio.portfolio;
  }

  if (data.portfolio && data.portfolio.portfolio) {
    renderPortfolioTable(data.portfolio.portfolio);
  }

  if (data.currentAssets) {
    renderAssetsTable(data.currentAssets);
  }

  renderTransactionsTable();

  if (data.platforms) {
    renderBrokersSummary(data.platforms);
  }

  if (data.performance) {
    renderPerformance(data.performance);
  }
}

// ============================================================
// RESUMEN DEL PORTAFOLIO
// ============================================================
function renderPortfolioSummary(summary, metrics) {
  if (!summary || typeof summary !== 'object') {
    console.error("renderPortfolioSummary: summary inválido", summary);
    return;
  }

  var marketValue = summary.totalCurrentValue || summary.marketValue || 0;
  var totalCash = metrics ? (metrics.totalCash || 0) : (summary.totalCash || 0);
  var totalBalance = summary.totalBalance || (marketValue + totalCash);

  document.getElementById('pfTotalBalance').textContent = formatCurrency(totalBalance);
  document.getElementById('pfMarketValue').textContent = formatCurrency(marketValue);
  document.getElementById('pfTotalCash').textContent = formatCurrency(totalCash);

  document.getElementById('pfTotalCost').textContent = formatCurrency(summary.totalCost || summary.costBasis || 0);

  var unrealizedPL = summary.totalUnrealizedPL || summary.unrealizedPL || 0;
  document.getElementById('pfUnrealizedPL').textContent = (unrealizedPL >= 0 ? '+' : '') + formatCurrency(unrealizedPL);
  document.getElementById('pfUnrealizedPL').className = 'font-bold text-sm sm:text-base leading-none ' + (unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400');

  var roi = (summary.overallUnrealizedROI || summary.unrealizedROI || 0);
  if (Math.abs(roi) < 1 && roi !== 0) roi = roi * 100;
  document.getElementById('pfUnrealizedROI').textContent = (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%';
  document.getElementById('pfUnrealizedROIContainer').className = 'px-2 py-1 rounded-md text-[10px] sm:text-xs font-bold ' + (roi >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400');

  var realizedPL = summary.totalRealizedPL || summary.realizedPL || 0;
  document.getElementById('pfRealizedPL').textContent = (realizedPL >= 0 ? '+' : '') + formatCurrency(realizedPL);
  document.getElementById('pfRealizedPL').className = 'mobile-stat-value ' + (realizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400');

  var totalPL = summary.totalPL || (unrealizedPL + realizedPL) || 0;
  document.getElementById('pfTotalPL').textContent = 'P/L Histórico: ' + (totalPL >= 0 ? '+' : '') + formatCurrency(totalPL);

  var dailyChange = summary.totalDailyChange || 0;
  document.getElementById('pfDailyChange').textContent = (dailyChange >= 0 ? '+' : '') + formatCurrency(dailyChange);
  document.getElementById('pfDailyChange').className = 'font-bold text-sm sm:text-base leading-none ' + (dailyChange >= 0 ? 'text-emerald-400' : 'text-rose-400');

  var dailyBase = marketValue - dailyChange;
  var dailyPct = dailyBase > 0 ? (dailyChange / dailyBase) * 100 : 0;
  document.getElementById('pfDailyChangePct').textContent = (dailyPct >= 0 ? '+' : '') + dailyPct.toFixed(2) + '%';
  document.getElementById('pfDailyChangePctContainer').className = 'px-2 py-1 rounded-md text-[10px] sm:text-xs font-bold ' + (dailyPct >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400');

  document.getElementById('pfHoldings').textContent = summary.currentHoldings || summary.activePositions || 0;
  document.getElementById('pfSold').textContent = 'Liquidadas: ' + (summary.soldPositions || 0) + ' | Total: ' + ((summary.currentHoldings || 0) + (summary.soldPositions || 0));

  if (summary.topGainers && summary.topGainers.length > 0) {
    var best = summary.topGainers[0];
    document.getElementById('pfBestPosition').textContent = best.ticker;
    document.getElementById('pfBestROI').textContent = '+' + (best.unrealizedROI * 100 || 0).toFixed(2) + '%';
  } else if (portfolioData && portfolioData.length > 0) {
    var sorted = portfolioData.slice().sort(function(a, b) { return b.unrealizedROI - a.unrealizedROI; });
    var best = sorted[0];
    if (best && best.unrealizedROI > 0) {
      document.getElementById('pfBestPosition').textContent = best.ticker;
      document.getElementById('pfBestROI').textContent = '+' + (best.unrealizedROI * 100).toFixed(2) + '%';
    } else {
      document.getElementById('pfBestPosition').textContent = '-';
      document.getElementById('pfBestROI').textContent = '0%';
    }
  } else {
    document.getElementById('pfBestPosition').textContent = '-';
    document.getElementById('pfBestROI').textContent = '0%';
  }

  if (summary.topLosers && summary.topLosers.length > 0) {
    var worst = summary.topLosers[0];
    document.getElementById('pfWorstPosition').textContent = worst.ticker;
    document.getElementById('pfWorstROI').textContent = (worst.unrealizedROI * 100 || 0).toFixed(2) + '%';
  } else if (portfolioData && portfolioData.length > 0) {
    var sorted = portfolioData.slice().sort(function(a, b) { return a.unrealizedROI - b.unrealizedROI; });
    var worst = sorted[0];
    if (worst && worst.unrealizedROI < 0) {
      document.getElementById('pfWorstPosition').textContent = worst.ticker;
      document.getElementById('pfWorstROI').textContent = (worst.unrealizedROI * 100).toFixed(2) + '%';
    } else {
      document.getElementById('pfWorstPosition').textContent = '-';
      document.getElementById('pfWorstROI').textContent = '0%';
    }
  } else {
    document.getElementById('pfWorstPosition').textContent = '-';
    document.getElementById('pfWorstROI').textContent = '0%';
  }
}

function renderTopPositions(summary) {
  var gainersEl = document.getElementById('topGainersList');
  var losersEl = document.getElementById('topLosersList');

  if (summary.topGainers && summary.topGainers.length > 0) {
    gainersEl.innerHTML = summary.topGainers.map(function(p) {
      return '<div class="flex items-center justify-between group">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-2 h-2 rounded-full bg-emerald-500"></div>' +
          '<div><p class="font-bold text-xs text-slate-200">' + p.ticker + '</p></div>' +
        '</div>' +
        '<div class="text-right">' +
          '<p class="font-bold text-xs text-emerald-400">+' + (p.unrealizedROI * 100 || 0).toFixed(2) + '%</p>' +
        '</div>' +
      '</div>';
    }).join('');
  } else { gainersEl.innerHTML = '<p class="text-slate-600 text-xs italic">N/A</p>'; }

  if (summary.topLosers && summary.topLosers.length > 0) {
    losersEl.innerHTML = summary.topLosers.map(function(p) {
      return '<div class="flex items-center justify-between group">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-2 h-2 rounded-full bg-rose-500"></div>' +
          '<div><p class="font-bold text-xs text-slate-200">' + p.ticker + '</p></div>' +
        '</div>' +
        '<div class="text-right">' +
          '<p class="font-bold text-xs text-rose-400">' + (p.unrealizedROI * 100 || 0).toFixed(2) + '%</p>' +
        '</div>' +
      '</div>';
    }).join('');
  } else { losersEl.innerHTML = '<p class="text-slate-600 text-xs italic">N/A</p>'; }
}

function renderLargestPositions(summary) {
  var el = document.getElementById('largestPositionsList');
  var data = summary.largestPositions;
  var title = 'Top Posiciones';
  var totalValue = summary.totalCurrentValue || 0;

  if ((!data || data.length === 0) && summary.byAssetClass && summary.byAssetClass.length > 0) {
    data = summary.byAssetClass;
    title = 'Por Clase de Activo';
    totalValue = data.reduce(function(s, item) { return s + (item.value || 0); }, 0);
  }

  if (data && data.length > 0) {
    el.innerHTML = data.map(function(p, idx) {
      var displayName = p.ticker || p.name || 'Sin nombre';
      var value = p.currentValue !== undefined ? p.currentValue : p.value;
      var weight = totalValue > 0 ? ((value || 0) / totalValue * 100).toFixed(1) : 0;
      var palette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#6366f1'];
      var color = p.ticker ? '#3b82f6' : (palette[idx % palette.length]);
      var lpIcon = p.iconUrl ?
        '<img src="' + p.iconUrl + '" alt="" class="asset-icon-sm mr-1.5" loading="lazy" onerror="this.style.display=\'none\'">' :
        '';

      return '<div class="bg-slate-800/40 rounded-xl p-3 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">' +
        '<div class="flex items-center justify-between mb-1.5">' +
          '<div class="flex items-center">' + lpIcon + '<span class="font-bold text-sm text-slate-200">' + displayName + '</span></div>' +
          '<span class="text-[10px] font-medium text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">' + weight + '%</span>' +
        '</div>' +
        '<p class="text-sm font-semibold text-slate-300 mb-2">' + formatCurrency(value) + '</p>' +
        '<div class="w-full bg-slate-900 rounded-full h-1 overflow-hidden">' +
          '<div class="h-1 rounded-full" style="width:' + weight + '%; background-color: ' + color + '"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    el.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center py-8 text-center">' +
      '<div class="w-12 h-12 bg-slate-800/60 rounded-full flex items-center justify-center mb-3">' +
        '<i class="fas fa-pie-chart text-slate-500 text-lg"></i>' +
      '</div>' +
      '<p class="text-slate-400 text-sm font-medium mb-1">Sin datos de exposición</p>' +
      '<p class="text-slate-600 text-xs">Agrega activos a tu portafolio para ver la distribución</p>' +
    '</div>';
  }
}

// ============================================================
// GRÁFICOS DEL PORTAFOLIO
// ============================================================
function renderPortfolioCharts(summary) {
  var palette = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#6366f1'];

  var totalAssetValue = 0;
  var totalSectorValue = 0;

  if (summary.byAssetClass && summary.byAssetClass.length > 0) {
    totalAssetValue = summary.byAssetClass.reduce(function(sum, item) {
      return sum + (item.value || 0);
    }, 0);
  }

  if (summary.bySector && summary.bySector.length > 0) {
    totalSectorValue = summary.bySector.reduce(function(sum, item) {
      return sum + (item.value || 0);
    }, 0);
  }

  if (summary.byAssetClass && summary.byAssetClass.length > 0) {
    var ctx = document.getElementById('portfolioAssetClassChart').getContext('2d');
    if (charts.portfolioAssetClass) charts.portfolioAssetClass.destroy();
    charts.portfolioAssetClass = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: summary.byAssetClass.map(function(d) { return d.name; }),
        datasets: [{
          data: summary.byAssetClass.map(function(d) { return d.value; }),
          backgroundColor: palette,
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? 'bottom' : 'right',
            labels: {
              color: '#94a3b8',
              usePointStyle: true,
              pointStyle: 'circle',
              font: { size: window.innerWidth < 640 ? 10 : 11 },
              padding: window.innerWidth < 640 ? 10 : 16,
              boxWidth: window.innerWidth < 640 ? 8 : 10,
              generateLabels: function(chart) {
                var data = chart.data;
                if (data.labels.length && data.datasets.length) {
                  return data.labels.map(function(label, i) {
                    var meta = chart.getDatasetMeta(0);
                    var style = meta.controller.getStyle(i);
                    var value = data.datasets[0].data[i] || 0;
                    var percentage = totalAssetValue > 0 ? ((value / totalAssetValue) * 100).toFixed(1) : '0.0';
                    return {
                      text: label + ' (' + percentage + '%)',
                      fillStyle: style.backgroundColor,
                      strokeStyle: style.borderColor,
                      lineWidth: style.borderWidth,
                      hidden: isNaN(data.datasets[0].data[i]) || meta.data[i].hidden,
                      index: i,
                      fontColor: '#94a3b8'
                    };
                  });
                }
                return [];
              }
            }
          },
          tooltip: chartTooltipConfig
        }
      },
      plugins: [{
        id: 'customLegendColor',
        afterUpdate: function(chart) {
          var legend = chart.legend;
          if (legend && legend.legendItems) {
            legend.legendItems.forEach(function(item) {
              item.fontColor = '#94a3b8';
              item.color = '#94a3b8';
            });
          }
        }
      }]
    });
  }

  if (summary.bySector && summary.bySector.length > 0) {
    var ctx = document.getElementById('portfolioSectorChart').getContext('2d');
    if (charts.portfolioSector) charts.portfolioSector.destroy();
    charts.portfolioSector = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: summary.bySector.map(function(d) { return d.name; }),
        datasets: [{
          data: summary.bySector.map(function(d) { return d.value; }),
          backgroundColor: palette.slice().reverse(),
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: window.innerWidth < 640 ? 'bottom' : 'right',
            labels: {
              color: '#94a3b8',
              usePointStyle: true,
              pointStyle: 'circle',
              font: { size: window.innerWidth < 640 ? 10 : 11 },
              padding: window.innerWidth < 640 ? 10 : 16,
              boxWidth: window.innerWidth < 640 ? 8 : 10,
              generateLabels: function(chart) {
                var data = chart.data;
                if (data.labels.length && data.datasets.length) {
                  return data.labels.map(function(label, i) {
                    var meta = chart.getDatasetMeta(0);
                    var style = meta.controller.getStyle(i);
                    var value = data.datasets[0].data[i] || 0;
                    var percentage = totalSectorValue > 0 ? ((value / totalSectorValue) * 100).toFixed(1) : '0.0';
                    return {
                      text: label + ' (' + percentage + '%)',
                      fillStyle: style.backgroundColor,
                      strokeStyle: style.borderColor,
                      lineWidth: style.borderWidth,
                      hidden: isNaN(data.datasets[0].data[i]) || meta.data[i].hidden,
                      index: i,
                      fontColor: '#94a3b8'
                    };
                  });
                }
                return [];
              }
            }
          },
          tooltip: chartTooltipConfig
        }
      },
      plugins: [{
        id: 'customLegendColor',
        afterUpdate: function(chart) {
          var legend = chart.legend;
          if (legend && legend.legendItems) {
            legend.legendItems.forEach(function(item) {
              item.fontColor = '#94a3b8';
              item.color = '#94a3b8';
            });
          }
        }
      }]
    });
  }
}

// ============================================================
// TABLA PORTAFOLIO
// ============================================================
function renderPortfolioTable(portfolio) {
  var tbody = document.getElementById('portfolioTable');
  var mobileContainer = document.getElementById('portfolioMobileCards');
  var countSpan = document.getElementById('pfCount');

  if (!portfolio || portfolio.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="py-12 text-center text-slate-500 text-sm">No hay activos registrados en el portafolio.</td></tr>';
    mobileContainer.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No hay activos registrados.</p>';
    countSpan.textContent = '0';
    return;
  }

  var filtered = portfolio.filter(function(p) {
    if (!showSoldPositionsFlag && p.isSold) return false;
    if (portfolioFilter) {
      var search = portfolioFilter.toLowerCase();
      return (p.ticker && p.ticker.toLowerCase().includes(search)) ||
             (p.assetName && p.assetName.toLowerCase().includes(search));
    }
    return true;
  });

  filtered.sort(function(a, b) {
    var va = a[portfolioSort.field];
    var vb = b[portfolioSort.field];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va === null || va === undefined) va = -Infinity;
    if (vb === null || vb === undefined) vb = -Infinity;
    return portfolioSort.dir === 'asc' ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0);
  });

  countSpan.textContent = filtered.length;

  tbody.innerHTML = filtered.map(function(p) {
    var roiClass = p.unrealizedROI > 0 ? 'text-emerald-400' : p.unrealizedROI < 0 ? 'text-rose-400' : 'text-slate-400';
    var plClass = p.unrealizedPL > 0 ? 'text-emerald-400' : p.unrealizedPL < 0 ? 'text-rose-400' : 'text-slate-400';
    var realizedClass = p.realizedPL > 0 ? 'text-emerald-400' : p.realizedPL < 0 ? 'text-rose-400' : 'text-slate-400';
    var totalPLClass = p.totalPL > 0 ? 'text-emerald-400' : p.totalPL < 0 ? 'text-rose-400' : 'text-slate-400';
    var dailyClass = p.dailyChange > 0 ? 'text-emerald-400' : p.dailyChange < 0 ? 'text-rose-400' : 'text-slate-400';
    var soldBadge = p.isSold ? '<span class="ml-2 px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded text-[9px] font-bold tracking-wider">CERRADA</span>' : '';

    var iconHtml = p.iconUrl ?
      '<img src="' + p.iconUrl + '" alt="" class="asset-icon mr-2" loading="lazy" onerror="this.style.display=\'none\'">' :
      '<div class="w-5 h-5 mr-2 rounded bg-slate-700/50 flex items-center justify-center text-[9px] text-slate-500 font-bold">' + (p.ticker ? p.ticker.charAt(0) : '?') + '</div>';

    return '<tr class="hover:bg-slate-800/40 transition-colors group">' +
      '<td class="py-3 px-3 sm:px-4 font-bold text-brand-400 flex items-center">' + iconHtml + (p.ticker || '-') + soldBadge + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-slate-300 truncate max-w-[120px] sm:max-w-[150px]">' + (p.assetName || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4"><span class="badge bg-slate-800 border-slate-700/50 text-slate-400">' + (p.assetClass || '-') + '</span></td>' +
      '<td class="py-3 px-3 sm:px-4 text-slate-500 hidden lg:table-cell text-[11px]">' + (p.sector || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-300">' + (p.isSold ? '<span class="text-slate-600">0.0000</span>' : (p.quantityNum || 0).toFixed(4)) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-400">' + formatCurrency(p.avgPurchasePrice) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-200">' + formatCurrency(p.currentPrice) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-400">' + formatCurrency(p.cost) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold text-white">' + formatCurrency(p.currentValue) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + roiClass + '">' + (p.unrealizedROI !== null ? (p.unrealizedROI > 0 ? '+' : '') + p.unrealizedROI.toFixed(2) + '%' : '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + plClass + '">' + (p.unrealizedPL !== null ? (p.unrealizedPL > 0 ? '+' : '') + formatCurrency(p.unrealizedPL) : '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + realizedClass + '">' + (p.realizedPL !== null ? (p.realizedPL > 0 ? '+' : '') + formatCurrency(p.realizedPL) : '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold ' + totalPLClass + '">' + (p.totalPL !== null ? (p.totalPL > 0 ? '+' : '') + formatCurrency(p.totalPL) : '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + dailyClass + '">' + (p.dailyChange !== null ? (p.dailyChange > 0 ? '+' : '') + formatCurrency(p.dailyChange) : '-') + '</td>' +
    '</tr>';
  }).join('');

  mobileContainer.innerHTML = filtered.map(function(p, idx) {
    var roiClass = p.unrealizedROI > 0 ? 'text-emerald-400' : p.unrealizedROI < 0 ? 'text-rose-400' : 'text-slate-400';
    var plClass = p.unrealizedPL > 0 ? 'text-emerald-400' : p.unrealizedPL < 0 ? 'text-rose-400' : 'text-slate-400';
    var realizedClass = p.realizedPL > 0 ? 'text-emerald-400' : p.realizedPL < 0 ? 'text-rose-400' : 'text-slate-400';
    var totalPLClass = p.totalPL > 0 ? 'text-emerald-400' : p.totalPL < 0 ? 'text-rose-400' : 'text-slate-400';
    var dailyClass = p.dailyChange > 0 ? 'text-emerald-400' : p.dailyChange < 0 ? 'text-rose-400' : 'text-slate-400';
    var soldBadge = p.isSold ? '<span class="ml-2 px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded text-[9px] font-bold tracking-wider">CERRADA</span>' : '';

    var mobileIconHtml = p.iconUrl ?
      '<img src="' + p.iconUrl + '" alt="" class="asset-icon-lg mr-2" loading="lazy" onerror="this.style.display=\'none\'">' :
      '<div class="w-6 h-6 mr-2 rounded bg-slate-700/50 flex items-center justify-center text-[10px] text-slate-500 font-bold">' + (p.ticker ? p.ticker.charAt(0) : '?') + '</div>';

    return '<div class="position-mobile-card" onclick="toggleCardDetails(this)">' +
      '<div class="flex items-center justify-between">' +
        '<div class="flex items-center gap-2 flex items-center">' + mobileIconHtml +
          '<span class="font-bold text-sm text-brand-400">' + (p.ticker || '-') + '</span>' + soldBadge +
          '<span class="badge bg-slate-800 border-slate-700/50 text-slate-400">' + (p.assetClass || '-') + '</span>' +
        '</div>' +
        '<div class="text-right">' +
          '<p class="font-bold text-sm text-white">' + formatCurrency(p.currentValue) + '</p>' +
          '<p class="text-[10px] font-mono ' + roiClass + '">' + (p.unrealizedROI !== null ? (p.unrealizedROI > 0 ? '+' : '') + p.unrealizedROI.toFixed(2) + '%' : '-') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="card-details">' +
        '<div class="grid grid-cols-2 gap-3 text-xs">' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Activo</p><p class="text-slate-300 font-medium truncate">' + (p.assetName || '-') + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Sector</p><p class="text-slate-300 font-medium">' + (p.sector || '-') + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Región / País</p><p class="text-slate-300 font-medium">' + ((p.region || '-') + ' / ' + (p.country || '-')) + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Industria</p><p class="text-slate-300 font-medium">' + (p.industry || '-') + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Cantidad</p><p class="text-slate-300 font-mono">' + (p.isSold ? '0.0000' : (p.quantityNum || 0).toFixed(4)) + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Precio Prom.</p><p class="text-slate-300 font-mono">' + formatCurrency(p.avgPurchasePrice) + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Precio Mercado</p><p class="text-slate-300 font-mono">' + formatCurrency(p.currentPrice) + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Costo</p><p class="text-slate-300 font-mono">' + formatCurrency(p.cost) + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">P/L</p><p class="font-mono font-medium ' + plClass + '">' + (p.unrealizedPL !== null ? (p.unrealizedPL > 0 ? '+' : '') + formatCurrency(p.unrealizedPL) : '-') + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">P/L Realizado</p><p class="font-mono font-medium ' + realizedClass + '">' + (p.realizedPL !== null ? (p.realizedPL > 0 ? '+' : '') + formatCurrency(p.realizedPL) : '-') + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">P/L Total</p><p class="font-mono font-bold ' + totalPLClass + '">' + (p.totalPL !== null ? (p.totalPL > 0 ? '+' : '') + formatCurrency(p.totalPL) : '-') + '</p></div>' +
          '<div><p class="text-[10px] text-slate-500 uppercase">Día</p><p class="font-mono font-medium ' + dailyClass + '">' + (p.dailyChange !== null ? (p.dailyChange > 0 ? '+' : '') + formatCurrency(p.dailyChange) : '-') + '</p></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleCardDetails(card) {
  var details = card.querySelector('.card-details');
  var isExpanded = details.classList.contains('expanded');

  document.querySelectorAll('.card-details.expanded').forEach(function(el) {
    if (el !== details) el.classList.remove('expanded');
  });

  details.classList.toggle('expanded', !isExpanded);
}

function sortPortfolio(field) {
  if (portfolioSort.field === field) {
    portfolioSort.dir = portfolioSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    portfolioSort.field = field;
    portfolioSort.dir = 'desc';
  }
  renderPortfolioTable(portfolioData);
}

function toggleSoldPositions() {
  showSoldPositionsFlag = document.getElementById('showSold').checked;
  renderPortfolioTable(portfolioData);
}

function filterPortfolio() {
  portfolioFilter = document.getElementById('pfSearch').value;
  renderPortfolioTable(portfolioData);
}

// ============================================================
// RESUMEN POR BROKER
// ============================================================
function renderBrokersSummary(platforms) {
  var section = document.getElementById('brokersSummarySection');
  var grid = document.getElementById('brokersSummaryGrid');

  if (!platforms || platforms.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  var colors = {
    'ETORO': { bg: 'rgba(59, 130, 246, 0.15)', icon: 'fa-globe', color: '#60a5fa' },
    'HAPI':  { bg: 'rgba(16, 185, 129, 0.15)', icon: 'fa-bolt', color: '#34d399' },
    'TRADESTATION': { bg: 'rgba(245, 158, 11, 0.15)', icon: 'fa-chart-line', color: '#fbbf24' },
    'ALPHA': { bg: 'rgba(139, 92, 246, 0.15)', icon: 'fa-building', color: '#a78bfa' },
    'SIEMBRA': { bg: 'rgba(34, 197, 94, 0.15)', icon: 'fa-seedling', color: '#4ade80' },
    'CCI': { bg: 'rgba(239, 68, 68, 0.15)', icon: 'fa-credit-card', color: '#f87171' },
    'BANRESERVAS': { bg: 'rgba(59, 130, 246, 0.15)', icon: 'fa-university', color: '#60a5fa' },
    'UNITED': { bg: 'rgba(99, 102, 241, 0.15)', icon: 'fa-plane', color: '#818cf8' },
    'default': { bg: 'rgba(99, 102, 241, 0.15)', icon: 'fa-building', color: '#818cf8' }
  };

  grid.innerHTML = platforms.map(function(p) {
    var key = (p.platform || p.name || 'default').toUpperCase();
    var style = colors[key] || colors['default'];

    var marketValue = p.marketValue || 0;
    var costBasis = p.costBasis || p.totalInvested || 0;
    var cash = p.cash || 0;
    var unrealizedPL = p.unrealizedPL || 0;
    var realizedPL = p.realizedPL || 0;
    var totalValue = marketValue + cash;
    var unrealizedROI = p.unrealizedROI || 0;
    var realizedROI = p.realizedROI || 0;
    var totalPL = p.totalPL || (unrealizedPL + realizedPL);
    var totalROI = p.totalROI || (costBasis > 0 ? totalPL / costBasis : 0);
    var activePositions = p.activePositions || p.symbols || 0;
    var soldPositions = p.soldPositions || 0;

    var unrealizedClass = unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var realizedClass = realizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var totalClass = totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var cashClass = cash >= 0 ? 'text-slate-300' : 'text-rose-400';

    return '<div class="broker-summary-card">' +
      '<div class="broker-header">' +
        '<div class="broker-icon" style="background:' + style.bg + '; color:' + style.color + '">' +
          '<i class="fas ' + style.icon + '"></i>' +
        '</div>' +
        '<span class="broker-name">' + (p.platform || p.name || 'Sin nombre') + '</span>' +
      '</div>' +
      '<div class="text-center mb-3">' +
        '<p class="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Valor Total</p>' +
        '<p class="text-xl sm:text-2xl font-extrabold text-white tracking-tight">' + formatCurrency(totalValue) + '</p>' +
      '</div>' +
      '<div class="broker-grid">' +
        '<div class="broker-stat">' +
          '<div class="broker-stat-label">Cost Basis</div>' +
          '<div class="broker-stat-value text-slate-300">' + formatCurrency(costBasis) + '</div>' +
        '</div>' +
        '<div class="broker-stat">' +
          '<div class="broker-stat-label">Market Value</div>' +
          '<div class="broker-stat-value text-white">' + formatCurrency(marketValue) + '</div>' +
        '</div>' +
        '<div class="broker-stat">' +
          '<div class="broker-stat-label">Cash</div>' +
          '<div class="broker-stat-value ' + cashClass + '">' + formatCurrency(cash) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="broker-divider"></div>' +
      '<div class="broker-grid">' +
        '<div class="broker-stat">' +
          '<div class="broker-stat-label">Unrealized</div>' +
          '<div class="broker-stat-value ' + unrealizedClass + '">' + (unrealizedPL >= 0 ? '+' : '') + formatCurrency(unrealizedPL) + '</div>' +
          '<div class="broker-stat-sub ' + unrealizedClass + '">' + (unrealizedROI >= 0 ? '+' : '') + (unrealizedROI * 100).toFixed(2) + '%</div>' +
        '</div>' +
        '<div class="broker-stat">' +
          '<div class="broker-stat-label">Realized</div>' +
          '<div class="broker-stat-value ' + realizedClass + '">' + (realizedPL >= 0 ? '+' : '') + formatCurrency(realizedPL) + '</div>' +
          '<div class="broker-stat-sub ' + realizedClass + '">' + (realizedROI >= 0 ? '+' : '') + (realizedROI * 100).toFixed(2) + '%</div>' +
        '</div>' +
        '<div class="broker-stat">' +
          '<div class="broker-stat-label">Total P/L</div>' +
          '<div class="broker-stat-value ' + totalClass + '">' + (totalPL >= 0 ? '+' : '') + formatCurrency(totalPL) + '</div>' +
          '<div class="broker-stat-sub ' + totalClass + '">' + (totalROI >= 0 ? '+' : '') + (totalROI * 100).toFixed(2) + '%</div>' +
        '</div>' +
      '</div>' +
      '<div class="mt-2 text-center">' +
        '<span class="text-[10px] text-slate-500 font-medium">' + activePositions + ' activas / ' + soldPositions + ' vendidas</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// TRANSACCIONES
// ============================================================
function changeTxPage(delta) {
  var maxPage = Math.ceil(allTransactions.length / TX_PER_PAGE) - 1;
  txPage = Math.max(0, Math.min(txPage + delta, maxPage));
  renderTransactionsTable();
}

function renderTransactionsTable() {
  var tbody = document.getElementById('transactionsTable');
  var mobileContainer = document.getElementById('transactionsMobileCards');
  var countSpan = document.getElementById('txCount');
  var pageSpan = document.getElementById('txPage');
  var prevBtn = document.getElementById('txPrev');
  var nextBtn = document.getElementById('txNext');

  if (!allTransactions || allTransactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-12 text-center text-slate-500 text-sm">No hay transacciones registradas</td></tr>';
    mobileContainer.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No hay transacciones registradas.</p>';
    countSpan.textContent = '0';
    return;
  }

  countSpan.textContent = allTransactions.length;

  var start = txPage * TX_PER_PAGE;
  var end = Math.min(start + TX_PER_PAGE, allTransactions.length);
  var pageTransactions = allTransactions.slice(start, end);

  pageSpan.textContent = 'Pág. ' + (txPage + 1) + ' / ' + Math.ceil(allTransactions.length / TX_PER_PAGE);
  prevBtn.disabled = txPage === 0;
  nextBtn.disabled = end >= allTransactions.length;

  tbody.innerHTML = pageTransactions.map(function(t) {
    return '<tr class="hover:bg-slate-800/40 transition-colors">' +
      '<td class="py-3 px-3 sm:px-4 text-slate-400 text-[11px] font-mono">' + (t.date || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 font-bold text-slate-200">' + (t.ticker || t.assetName || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-center">' + getActionBadge(t.action) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-300">' + (t.quantity || 0) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-400">' + formatCurrency(t.displayPrice || t.price) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-semibold text-white">' + formatCurrency(Math.abs(t.displayTotal || t.totalUSD || t.total || 0)) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-center text-slate-500 text-[11px]">' + (t.platform || '-') + '</td>' +
    '</tr>';
  }).join('');

  mobileContainer.innerHTML = pageTransactions.map(function(t) {
    return '<div class="tx-mobile-card">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<div class="flex items-center gap-2">' +
          '<span class="font-bold text-sm text-slate-200">' + (t.ticker || t.assetName || '-') + '</span>' +
          getActionBadge(t.action) +
        '</div>' +
        '<span class="text-[10px] text-slate-500 font-mono">' + (t.date || '-') + '</span>' +
      '</div>' +
      '<div class="grid grid-cols-3 gap-2 text-xs">' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Cantidad</p><p class="text-slate-300 font-mono">' + (t.quantity || 0) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Precio</p><p class="text-slate-300 font-mono">' + formatCurrency(t.displayPrice || t.price) + '</p></div>' +
        '<div class="text-right"><p class="text-[10px] text-slate-500 uppercase">Total</p><p class="text-white font-mono font-semibold">' + formatCurrency(Math.abs(t.displayTotal || t.totalUSD || t.total || 0)) + '</p></div>' +
      '</div>' +
      '<div class="mt-2 pt-2 border-t border-slate-700/30 flex justify-between items-center">' +
        '<span class="text-[10px] text-slate-500">' + (t.platform || '-') + '</span>' +
        '<span class="text-[10px] text-slate-500 font-mono">' + (t.currency || 'USD') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// ACTIVOS
// ============================================================
function renderAssetsTable(assets) {
  var tbody = document.getElementById('assetsTable');
  var mobileContainer = document.getElementById('assetsMobileCards');

  if (!assets || assets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="py-12 text-center text-slate-500 text-sm">No hay activos en cartera</td></tr>';
    mobileContainer.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No hay activos en cartera.</p>';
    return;
  }

  tbody.innerHTML = assets.map(function(a) {
    var assetIcon = a.iconUrl ?
      '<img src="' + a.iconUrl + '" alt="" class="asset-icon mr-2" loading="lazy" onerror="this.style.display=\'none\'">' :
      '<div class="w-5 h-5 mr-2 rounded bg-slate-700/50 flex items-center justify-center text-[9px] text-slate-500 font-bold">' + (a.ticker ? a.ticker.charAt(0) : '?') + '</div>';

    return '<tr class="hover:bg-slate-800/40 transition-colors">' +
      '<td class="py-3 px-3 sm:px-4 font-bold text-brand-400 flex items-center">' + assetIcon + (a.ticker || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-slate-300">' + (a.name || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4"><span class="badge bg-slate-800 border-slate-700/50 text-slate-400">' + (a.class || '-') + '</span></td>' +
      '<td class="py-3 px-3 sm:px-4 text-slate-500 text-[11px]">' + (a.sector || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-200">' + ((a.quantity || 0).toFixed(4)) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-400">' + formatCurrency(a.costBasis) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-center font-mono text-[10px] text-slate-500">' + (a.originalCurrency || a.currency || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-center text-slate-400 text-[11px]">' + (a.platform || '-') + '</td>' +
    '</tr>';
  }).join('');

  mobileContainer.innerHTML = assets.map(function(a) {
    var assetMobileIcon = a.iconUrl ?
      '<img src="' + a.iconUrl + '" alt="" class="asset-icon-lg mr-2" loading="lazy" onerror="this.style.display=\'none\'">' :
      '<div class="w-6 h-6 mr-2 rounded bg-slate-700/50 flex items-center justify-center text-[10px] text-slate-500 font-bold">' + (a.ticker ? a.ticker.charAt(0) : '?') + '</div>';

    return '<div class="position-mobile-card">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<div class="flex items-center gap-2 flex items-center">' + assetMobileIcon +
          '<span class="font-bold text-sm text-brand-400">' + (a.ticker || '-') + '</span>' +
          '<span class="badge bg-slate-800 border-slate-700/50 text-slate-400">' + (a.class || '-') + '</span>' +
        '</div>' +
        '<span class="text-[10px] text-slate-500 font-mono">' + (a.originalCurrency || a.currency || '-') + '</span>' +
      '</div>' +
      '<p class="text-xs text-slate-300 mb-2 truncate">' + (a.name || '-') + '</p>' +
      '<div class="grid grid-cols-2 gap-2 text-xs">' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Cantidad</p><p class="text-slate-300 font-mono">' + ((a.quantity || 0).toFixed(4)) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Costo Base</p><p class="text-slate-300 font-mono">' + formatCurrency(a.costBasis) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Sector</p><p class="text-slate-300">' + (a.sector || '-') + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Plataforma</p><p class="text-slate-300">' + (a.platform || '-') + '</p></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// RENDIMIENTO
// ============================================================
function renderPerformance(data) {
  if (!data) {
    console.warn("renderPerformance: data es null/undefined");
    return;
  }

  var perfData = data.performance || data;
  var summary = perfData.summary || {};
  var periods = perfData.periods || [];
  var assetPerformance = perfData.assetPerformance || [];
  var platformPerformance = perfData.platformPerformance || [];
  var distribution = perfData.distribution || {};
  var riskMetrics = perfData.riskMetrics || {};

  function safeNumber(val, fallback) {
    if (val === undefined || val === null || isNaN(val) || !isFinite(val)) {
      return fallback !== undefined ? fallback : 0;
    }
    return val;
  }

  var totalReturn = safeNumber(summary.totalReturn);
  var totalReturnPct = safeNumber(summary.totalReturnPct);

  var totalReturnEl = document.getElementById('perfTotalReturn');
  if (totalReturnEl) {
    totalReturnEl.textContent = (totalReturn >= 0 ? '+' : '') + formatCurrency(totalReturn);
    totalReturnEl.className = 'mobile-stat-value ' + (totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400');
  }

  var totalReturnPctEl = document.getElementById('perfTotalReturnPct');
  if (totalReturnPctEl) {
    totalReturnPctEl.textContent = (totalReturnPct >= 0 ? '+' : '') + totalReturnPct.toFixed(2) + '%';
    totalReturnPctEl.className = 'text-[10px] font-bold mt-1 ' + (totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400');
  }

  var perfTotalInvested = document.getElementById('perfTotalInvested');
  if (perfTotalInvested) {
    perfTotalInvested.textContent = formatCurrency(safeNumber(summary.totalInvested));
  }

  var perfTotalValue = document.getElementById('perfTotalValue');
  if (perfTotalValue) {
    perfTotalValue.textContent = formatCurrency(safeNumber(summary.totalPortfolioValue));
  }

  var perfMaxDrawdown = document.getElementById('perfMaxDrawdown');
  if (perfMaxDrawdown) {
    var maxDrawdown = safeNumber(riskMetrics.maxDrawdown, null);
    perfMaxDrawdown.textContent = maxDrawdown !== null ? maxDrawdown.toFixed(2) + '%' : 'N/A';
  }

  renderPerformancePeriods(periods);
  renderPerformancePeriodChart(periods);
  renderPerformanceDistribution(distribution);
  renderTopPerformers(assetPerformance);
  renderPerformancePlatforms(platformPerformance);
}

function renderPerformancePeriodChart(periods) {
  var ctx = document.getElementById('performancePeriodChart');
  if (!ctx) return;

  if (charts.performancePeriod) charts.performancePeriod.destroy();

  var labels = periods.map(function(p) { return p.label; });
  var unrealized = periods.map(function(p) { return p.unrealizedPL; });
  var realized = periods.map(function(p) { return p.realizedPL; });

  charts.performancePeriod = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'No Realizado',
          data: unrealized,
          backgroundColor: unrealized.map(function(v) { return v >= 0 ? 'rgba(59, 130, 246, 0.7)' : 'rgba(244, 63, 94, 0.7)'; }),
          borderColor: unrealized.map(function(v) { return v >= 0 ? '#3b82f6' : '#f43f5e'; }),
          borderWidth: 1,
          borderRadius: 4,
          stack: 'stack1'
        },
        {
          label: 'Realizado',
          data: realized,
          backgroundColor: realized.map(function(v) { return v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(245, 158, 11, 0.7)'; }),
          borderColor: realized.map(function(v) { return v >= 0 ? '#10b981' : '#f59e0b'; }),
          borderWidth: 1,
          borderRadius: 4,
          stack: 'stack1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#94a3b8', usePointStyle: true, font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              var val = context.parsed.y;
              return context.dataset.label + ': ' + (val >= 0 ? '+' : '') + formatCurrency(val);
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { color: 'rgba(51, 65, 85, 0.15)', drawBorder: false },
          ticks: { color: '#64748b', font: { size: 10 } }
        },
        y: {
          stacked: true,
          grid: { color: 'rgba(51, 65, 85, 0.15)', drawBorder: false },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            callback: function(value) { return formatCurrency(value); }
          }
        }
      }
    }
  });
}

function renderPerformancePeriods(periods) {
  var tbody = document.getElementById('performancePeriodsTable');
  var mobileContainer = document.getElementById('performancePeriodsMobile');

  if (!periods || periods.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-12 text-center text-slate-500 text-sm">No hay datos de rendimiento</td></tr>';
    mobileContainer.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No hay datos de rendimiento.</p>';
    return;
  }

  tbody.innerHTML = periods.map(function(p) {
    var realizedClass = p.realizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var realizedSign = p.realizedPL >= 0 ? '+' : '';
    var unrealizedClass = p.unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var unrealizedSign = p.unrealizedPL >= 0 ? '+' : '';
    var totalClass = p.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var totalSign = p.totalPL >= 0 ? '+' : '';

    return '<tr class="hover:bg-slate-800/40 transition-colors">' +
      '<td class="py-3 px-3 sm:px-4 font-bold text-slate-200">' + p.label + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-400">' + formatCurrency(p.startValue) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-white">' + formatCurrency(p.endValue) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold ' + unrealizedClass + '">' + unrealizedSign + formatCurrency(p.unrealizedPL) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold ' + realizedClass + '">' + realizedSign + formatCurrency(p.realizedPL) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold ' + totalClass + '">' + totalSign + formatCurrency(p.totalPL) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-500 text-[10px]">' + formatCurrency(p.marketValue) + ' / ' + formatCurrency(p.cash) + '</td>' +
    '</tr>';
  }).join('');

  mobileContainer.innerHTML = periods.map(function(p) {
    var totalClass = p.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var totalSign = p.totalPL >= 0 ? '+' : '';
    var unrealizedClass = p.unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var realizedClass = p.realizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';

    return '<div class="tx-mobile-card">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<span class="font-bold text-sm text-slate-200">' + p.label + '</span>' +
        '<span class="font-mono font-bold ' + totalClass + '">' + totalSign + formatCurrency(p.totalPL) + '</span>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-2 text-xs">' +
        '<div><p class="text-[10px] text-slate-500 uppercase">No Realizado</p><p class="font-mono font-bold ' + unrealizedClass + '">' + (p.unrealizedPL >= 0 ? '+' : '') + formatCurrency(p.unrealizedPL) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Realizado</p><p class="font-mono font-bold ' + realizedClass + '">' + (p.realizedPL >= 0 ? '+' : '') + formatCurrency(p.realizedPL) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Mercado</p><p class="text-slate-300 font-mono">' + formatCurrency(p.marketValue) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Cash</p><p class="text-slate-300 font-mono">' + formatCurrency(p.cash) + '</p></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderPerformanceDistribution(distribution) {
  var ctx = document.getElementById('performanceDistributionChart');
  if (!ctx) return;

  if (charts.performanceDistribution) charts.performanceDistribution.destroy();

  var data = [
    distribution.excellentCount || 0,
    distribution.goodCount || 0,
    distribution.neutralCount || 0,
    distribution.badCount || 0,
    distribution.terribleCount || 0
  ];

  var total = data.reduce(function(a, b) { return a + b; }, 0);
  if (total === 0) {
    ctx.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 text-sm">Sin datos de distribución</div>';
    return;
  }

  charts.performanceDistribution = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Excelente (+50%)', 'Bueno (+10%)', 'Neutral (±10%)', 'Malo (-10%)', 'Pésimo (-30%)'],
      datasets: [{
        data: data,
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#f43f5e', '#7c2d12'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: window.innerWidth < 640 ? 'bottom' : 'right',
          labels: {
            color: '#94a3b8',
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: window.innerWidth < 640 ? 10 : 11 },
            padding: window.innerWidth < 640 ? 10 : 16,
            boxWidth: window.innerWidth < 640 ? 8 : 10
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              var value = context.parsed;
              var pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return context.label + ': ' + value + ' posiciones (' + pct + '%)';
            }
          }
        }
      }
    }
  });
}

function renderTopPerformers(assets) {
  var el = document.getElementById('topPerformersList');

  if (!assets || assets.length === 0) {
    el.innerHTML = '<p class="text-slate-500 text-sm text-center py-4">No hay datos de performers</p>';
    return;
  }

  var top5 = assets.slice(0, 5);
  var bottom5 = assets.slice(-5).reverse();

  el.innerHTML = '<div class="mb-4"><p class="text-[10px] text-emerald-400 uppercase font-bold mb-2">Mejores</p>' +
    top5.map(function(p) {
      var roiClass = p.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
      var sign = p.totalPL >= 0 ? '+' : '';
      var perfIcon = p.iconUrl ?
        '<img src="' + p.iconUrl + '" alt="" class="asset-icon-sm mr-1.5" loading="lazy" onerror="this.style.display=\'none\'">' :
        '<div class="w-4 h-4 mr-1.5 rounded bg-slate-700/50 flex items-center justify-center text-[8px] text-slate-500 font-bold">' + (p.ticker ? p.ticker.charAt(0) : '?') + '</div>';
      return '<div class="flex items-center justify-between py-1.5">' +
        '<div class="flex items-center gap-2">' + perfIcon +
          '<span class="font-bold text-xs text-slate-200">' + p.ticker + '</span>' +
          '<span class="text-[10px] text-slate-500">' + (p.assetClass || '') + '</span>' +
        '</div>' +
        '<div class="text-right">' +
          '<p class="font-bold text-xs ' + roiClass + '">' + sign + formatCurrency(p.totalPL) + '</p>' +
          '<p class="text-[10px] text-slate-500">' + (p.weight || 0).toFixed(1) + '% del portafolio</p>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>' +
  '<div class="w-full h-px bg-slate-700/30 my-3"></div>' +
  '<div><p class="text-[10px] text-rose-400 uppercase font-bold mb-2">Peores</p>' +
    bottom5.map(function(p) {
      var roiClass = p.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
      var sign = p.totalPL >= 0 ? '+' : '';
      var perfIcon2 = p.iconUrl ?
        '<img src="' + p.iconUrl + '" alt="" class="asset-icon-sm mr-1.5" loading="lazy" onerror="this.style.display=\'none\'">' :
        '<div class="w-4 h-4 mr-1.5 rounded bg-slate-700/50 flex items-center justify-center text-[8px] text-slate-500 font-bold">' + (p.ticker ? p.ticker.charAt(0) : '?') + '</div>';
      return '<div class="flex items-center justify-between py-1.5">' +
        '<div class="flex items-center gap-2">' + perfIcon2 +
          '<span class="font-bold text-xs text-slate-200">' + p.ticker + '</span>' +
          '<span class="text-[10px] text-slate-500">' + (p.assetClass || '') + '</span>' +
        '</div>' +
        '<div class="text-right">' +
          '<p class="font-bold text-xs ' + roiClass + '">' + sign + formatCurrency(p.totalPL) + '</p>' +
          '<p class="text-[10px] text-slate-500">' + (p.weight || 0).toFixed(1) + '% del portafolio</p>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

function renderPerformancePlatforms(platforms) {
  var tbody = document.getElementById('performancePlatformsTable');
  var mobileContainer = document.getElementById('performancePlatformsMobile');

  if (!platforms || platforms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="py-12 text-center text-slate-500 text-sm">No hay datos por plataforma</td></tr>';
    mobileContainer.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No hay datos por plataforma.</p>';
    return;
  }

  tbody.innerHTML = platforms.map(function(p) {
    var unrealizedClass = p.unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var realizedClass = p.realizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var totalClass = p.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    var totalROIColor = p.totalROI >= 0 ? 'text-emerald-400' : 'text-rose-400';

    return '<tr class="hover:bg-slate-800/40 transition-colors">' +
      '<td class="py-3 px-3 sm:px-4 font-bold text-slate-200">' + (p.platform || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-400">' + formatCurrency(p.totalInvested) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-white">' + formatCurrency(p.totalValue) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + unrealizedClass + '">' + (p.unrealizedPL >= 0 ? '+' : '') + formatCurrency(p.unrealizedPL) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + (p.unrealizedROI >= 0 ? 'text-emerald-400' : 'text-rose-400') + '">' + (p.unrealizedROI >= 0 ? '+' : '') + p.unrealizedROI.toFixed(2) + '%</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-medium ' + realizedClass + '">' + (p.realizedPL >= 0 ? '+' : '') + formatCurrency(p.realizedPL) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold ' + totalClass + '">' + (p.totalPL >= 0 ? '+' : '') + formatCurrency(p.totalPL) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold ' + totalROIColor + '">' + (p.totalROI >= 0 ? '+' : '') + p.totalROI.toFixed(2) + '%</td>' +
    '</tr>';
  }).join('');

  mobileContainer.innerHTML = platforms.map(function(p) {
    var totalClass = p.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
    return '<div class="platform-mobile-card">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<span class="font-bold text-sm text-slate-200">' + (p.platform || '-') + '</span>' +
        '<span class="font-mono font-bold ' + totalClass + '">' + (p.totalPL >= 0 ? '+' : '') + formatCurrency(p.totalPL) + '</span>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-2 text-xs">' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Invertido</p><p class="text-slate-300 font-mono">' + formatCurrency(p.totalInvested) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Valor Actual</p><p class="text-white font-mono">' + formatCurrency(p.totalValue) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">ROI</p><p class="text-slate-300 font-mono">' + (p.totalROI >= 0 ? '+' : '') + p.totalROI.toFixed(2) + '%</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Símbolos</p><p class="text-slate-300 font-mono">' + (p.symbols || 0) + '</p></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// PLATAFORMAS
// ============================================================
function renderPlatformsTable(platforms) {
  var tbody = document.getElementById('platformsTable');
  var mobileContainer = document.getElementById('platformsMobileCards');

  if (!platforms || platforms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="py-12 text-center text-slate-500 text-sm">No hay plataformas registradas</td></tr>';
    mobileContainer.innerHTML = '<p class="text-slate-500 text-sm text-center py-8">No hay plataformas registradas.</p>';
    return;
  }

  tbody.innerHTML = platforms.map(function(p) {
    return '<tr class="hover:bg-slate-800/40 transition-colors">' +
      '<td class="py-3 px-3 sm:px-4 font-bold text-slate-200">' + (p.platform || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-center font-mono text-[10px] text-slate-500">' + (p.originalCurrency || p.currency || '-') + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-slate-300">' + (p.transactions || 0) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-emerald-400/80">' + formatCurrency(p.totalDeposits) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-brand-400/80">' + formatCurrency(p.totalInvested) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono text-purple-400/80">' + formatCurrency(p.totalSold + p.totalDividends) + '</td>' +
      '<td class="py-3 px-3 sm:px-4 text-right font-mono font-bold text-white">' + formatCurrency(p.netFlow) + '</td>' +
    '</tr>';
  }).join('');

  mobileContainer.innerHTML = platforms.map(function(p) {
    var netFlowClass = p.netFlow >= 0 ? 'text-emerald-400' : 'text-rose-400';
    return '<div class="platform-mobile-card">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<span class="font-bold text-sm text-slate-200">' + (p.platform || '-') + '</span>' +
        '<span class="text-[10px] text-slate-500 font-mono">' + (p.originalCurrency || p.currency || '-') + '</span>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-3 text-xs">' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Órdenes</p><p class="text-slate-300 font-mono">' + (p.transactions || 0) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Fondeo</p><p class="text-emerald-400/80 font-mono">' + formatCurrency(p.totalDeposits) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Invertido</p><p class="text-brand-400/80 font-mono">' + formatCurrency(p.totalInvested) + '</p></div>' +
        '<div><p class="text-[10px] text-slate-500 uppercase">Retornos</p><p class="text-purple-400/80 font-mono">' + formatCurrency(p.totalSold + p.totalDividends) + '</p></div>' +
      '</div>' +
      '<div class="mt-3 pt-3 border-t border-slate-700/30 flex justify-between items-center">' +
        '<span class="text-[10px] text-slate-500 uppercase">Flujo Neto</span>' +
        '<span class="font-mono font-bold ' + netFlowClass + '">' + formatCurrency(p.netFlow) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ============================================================
// BUFFETT CHART
// ============================================================
function renderBuffettPortfolio(portfolio) {
  var ctx = document.getElementById('buffettPortfolioChart');
  if (!ctx) return;

  var activePositions = (portfolio || []).filter(function(p) {
    return !p.isSold && (p.currentValue || 0) > 0;
  }).sort(function(a, b) {
    return (b.currentValue || 0) - (a.currentValue || 0);
  });

  if (activePositions.length === 0) {
    ctx.parentElement.innerHTML = '<div class="flex items-center justify-center h-[300px] text-slate-500 text-sm">Sin posiciones activas</div>';
    return;
  }

  var totalValue = activePositions.reduce(function(sum, p) {
    return sum + (p.currentValue || 0);
  }, 0);

  var brandColors = {
      'NVDA': '#76b900',
      'ALCANZA 2': '#8D5578',
      'HAINA': '#142B37',
      'ALTIO': '#449E40',
      'BLK': '#000000',
      'AMZN': '#ff9900',
      'MA': '#eb001b',
      'MSFT': '#00a4ef',
      'META': '#0866ff',
      'BKNG': '#003580',
      'V': '#1434cb',
      'ANET': '#005eb8',
      'VRT': '#0072ce',
      'GOOG': '#4285f4',
      'AAPL': '#a2aaad',
      'VOO': '#D04C55',
      'AOCISA': '#c62828',
      'UBER': '#000000',
      'ASML': '#00a651',
      'APH': '#005b96',
      'DUOL': '#58cc02',
      'ALCANZA': '#8D5578',
      'CRM': '#1798c1',
      'YMM': '#00a651',
      'BABA': '#ff6a00',
      'CBANR': '#007a3d',
      'BTCUSD': '#f7931a',
      'NOW': '#81b441',
      'NFLX': '#e50914',
      'METU': '#0866ff',
      'ETHUSD': '#627eea',
      'default': '#3b82f6'
  };

  var labels = [];
  var data = [];
  var colors = [];
  var tickers = [];
  var iconUrls = [];

  activePositions.forEach(function(p) {
    var ticker = (p.ticker || 'OTRO').toUpperCase();
    labels.push(p.assetName || ticker);
    data.push(p.currentValue || 0);
    colors.push(brandColors[ticker] || brandColors['default']);
    tickers.push(ticker);
    iconUrls.push(p.iconUrl || '');
  });

  if (charts.buffettPortfolio) {
    charts.buffettPortfolio.destroy();
  }

  charts.buffettPortfolio = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: '#0f172a',
        borderWidth: 3,
        hoverOffset: 12,
        hoverBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      animation: {
        animateRotate: true,
        animateScale: true,
        duration: 1200,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              var idx = context.dataIndex;
              var value = context.parsed;
              var pct = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0;
              return tickers[idx] + ': ' + formatCurrency(value) + ' (' + pct + '%)';
            }
          }
        }
      },
      onHover: function(event, elements) {
        event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      }
    },
    plugins: [{
      id: 'sliceIcons',
      afterDraw: function(chart) {
        var ctx = chart.ctx;
        var meta = chart.getDatasetMeta(0);

        meta.data.forEach(function(arc, index) {
          var center = arc.tooltipPosition();
          var value = data[index];
          var pct = totalValue > 0 ? ((value / totalValue) * 100) : 0;

          if (pct < 4) return;

          var size = Math.min(26, Math.max(18, pct * 0.6));

          ctx.save();
          ctx.beginPath();
          ctx.arc(center.x, center.y, size/2 + 2, 0, 2 * Math.PI);
          ctx.fillStyle = '#0f172a';
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();

          var ticker = tickers[index];
          ctx.save();
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold ' + (size * 0.35) + 'px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(ticker.substring(0, 3), center.x, center.y);
          ctx.restore();
        });
      }
    }]
  });

  renderBuffettLegend(activePositions, totalValue, colors, tickers, iconUrls);
}

function renderBuffettLegend(positions, totalValue, colors, tickers, iconUrls) {
  var el = document.getElementById('buffettLegend');
  if (!el) return;

  el.innerHTML = positions.map(function(p, idx) {
    var ticker = tickers[idx];
    var weight = totalValue > 0 ? ((p.currentValue || 0) / totalValue * 100).toFixed(1) : 0;
    var color = colors[idx];
    var iconUrl = iconUrls[idx];

    var iconHtml = iconUrl ?
      '<img src="' + iconUrl + '" alt="" class="asset-icon-lg" loading="lazy" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\'">' :
      '';

    var fallbackHtml = '<div class="w-6 h-6 rounded-lg bg-slate-700/50 flex items-center justify-center text-[10px] text-slate-500 font-bold" style="display:' + (iconUrl ? 'none' : 'flex') + '">' +
      (ticker ? ticker.charAt(0) : '?') + '</div>';

    return '<div class="buffett-legend-item">' +
      '<div class="flex-shrink-0">' + iconHtml + fallbackHtml + '</div>' +
      '<div class="buffett-legend-info">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<span class="buffett-ticker truncate">' + ticker + '</span>' +
          '<span class="buffett-percent flex-shrink-0">' + weight + '%</span>' +
        '</div>' +
        '<p class="buffett-value truncate">' + formatCurrency(p.currentValue || 0) + '</p>' +
      '</div>' +
      '<div class="w-1 h-8 rounded-full flex-shrink-0" style="background-color: ' + color + '"></div>' +
    '</div>';
  }).join('');
}

// ============================================================
// HELPERS
// ============================================================
function getActionBadge(action) {
  var b = 'px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ';
  var badges = {
    'Buy': '<span class="' + b + 'bg-brand-500/20 text-brand-400 border border-brand-500/30">COMPRA</span>',
    'Sell': '<span class="' + b + 'bg-rose-500/20 text-rose-400 border border-rose-500/30">VENTA</span>',
    'Cash Deposit': '<span class="' + b + 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">FONDEO</span>',
    'Cash Withdrawal': '<span class="' + b + 'bg-orange-500/20 text-orange-400 border border-orange-500/30">RETIRO</span>',
    'Transfer Send': '<span class="' + b + 'bg-slate-500/20 text-slate-400 border border-slate-500/30">TRF OUT</span>',
    'Transfer Deposit': '<span class="' + b + 'bg-slate-500/20 text-slate-400 border border-slate-500/30">TRF IN</span>',
    'Dividend': '<span class="' + b + 'bg-purple-500/20 text-purple-400 border border-purple-500/30">DIVIDENDO</span>',
    'DRIP': '<span class="' + b + 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">DRIP</span>',
    'Crypto Interest': '<span class="' + b + 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">YIELD</span>'
  };
  return badges[action] || '<span class="' + b + 'bg-slate-800 text-slate-400">' + (action || '-') + '</span>';
}

function formatCurrency(value) {
  if (value === undefined || value === null || isNaN(value)) {
    return currentCurrency === 'DOP' ? 'DOP$0.00' : '$0.00';
  }

  if (currentCurrency === 'DOP') {
    return 'DOP$' + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  return '$' + new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showLoading() {
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('content').classList.add('hidden');
}

function showContent() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.remove('hidden');
  document.getElementById('errorMessage').textContent = msg;
}

// ============================================================
// HISTORIAL
// ============================================================
function buildHistoryFromTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    historyData = [];
    return;
  }

  var sorted = transactions.slice().sort(function(a, b) {
    return new Date(a.dateRaw || a.date) - new Date(b.dateRaw || b.date);
  });

  var monthlyData = {};
  var runningInvested = 0;
  var runningCash = 0;

  sorted.forEach(function(tx) {
    var date = new Date(tx.dateRaw || tx.date);
    var monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    var amount = Math.abs(tx.displayTotal || tx.totalUSD || tx.total || 0);
    var action = tx.action || '';

    if (action === 'Buy') {
      runningInvested += amount;
      runningCash -= amount;
    } else if (action === 'Sell') {
      runningInvested -= amount;
      runningCash += amount;
    } else if (action === 'Cash Deposit' || action === 'Transfer Deposit') {
      runningCash += amount;
    } else if (action === 'Cash Withdrawal') {
      runningCash -= amount;
    } else if (action === 'Dividend' || action === 'Crypto Interest') {
      runningCash += amount;
    }

    monthlyData[monthKey] = {
      date: monthKey,
      marketValue: runningInvested,
      cash: runningCash,
      total: runningInvested + runningCash,
      invested: runningInvested
    };
  });

  historyData = Object.keys(monthlyData).sort().map(function(key) {
    return monthlyData[key];
  });
}

function buildRealHistoryFromPrices(transactions) {
  if (!transactions || transactions.length === 0 || historicalDates.length === 0) {
    historyData = [];
    window.monthlyPL = {};
    return;
  }

  var currentPricesFromPortfolio = {};
  if (typeof portfolioData !== 'undefined' && portfolioData && portfolioData.length > 0) {
    portfolioData.forEach(function(p) {
      if (!p.isSold && p.ticker) {
        currentPricesFromPortfolio[p.ticker.toUpperCase()] = {
          price: p.currentPrice,
          quantity: p.quantityNum,
          currency: p.currency || 'USD'
        };
      }
    });
  } else if (typeof window.lastPortfolioData !== 'undefined' && window.lastPortfolioData) {
    window.lastPortfolioData.forEach(function(p) {
      if (!p.isSold && p.ticker) {
        currentPricesFromPortfolio[p.ticker.toUpperCase()] = {
          price: p.currentPrice,
          quantity: p.quantityNum,
          currency: p.currency || 'USD'
        };
      }
    });
  }

  var sorted = transactions.slice().sort(function(a, b) {
    return new Date(a.dateRaw || a.date) - new Date(b.dateRaw || b.date);
  });

  var monthlyPortfolio = {};
  var lastDateKey = historicalDates[historicalDates.length - 1];
  var monthlyTickerDetail = {};

  historicalDates.forEach(function(dateKey) {
    var cashByBroker = {};
    var runningPositions = {};
    var monthlyDividends = 0;
    var monthlyBuys = [];
    var monthlySells = [];

    sorted.forEach(function(tx) {
      var txDate = new Date(tx.dateRaw || tx.date);
      var txYear = txDate.getFullYear();
      var txMonth = txDate.getMonth() + 1;
      var txKey = txYear + '-' + String(txMonth).padStart(2, '0');

      if (txKey > dateKey) return;

      var broker = (tx.platform || "Sin Plataforma").toUpperCase();
      var action = tx.action || '';
      var amount = Math.abs(tx.displayTotal || tx.totalUSD || tx.total || 0);
      var ticker = (tx.ticker || "").toUpperCase();
      var quantity = parseFloat(tx.quantity) || 0;

      if (!cashByBroker[broker]) cashByBroker[broker] = 0;

      if (action === 'Cash Deposit') {
        cashByBroker[broker] += amount;
      } else if (action === 'Transfer Deposit') {
        if (!ticker) cashByBroker[broker] += amount;
      } else if (action === 'Cash Withdrawal') {
        cashByBroker[broker] -= amount;
      } else if (action === 'Dividend' || action === 'Crypto Interest') {
        cashByBroker[broker] += amount;
        monthlyDividends += amount;
      } else if (action === 'Buy') {
        cashByBroker[broker] -= amount;
        if (!runningPositions[ticker]) runningPositions[ticker] = {};
        if (!runningPositions[ticker][broker]) {
          runningPositions[ticker][broker] = { quantity: 0, invested: 0, avgCost: 0 };
        }
        var pos = runningPositions[ticker][broker];
        var newTotalCost = pos.invested + amount;
        var newQty = pos.quantity + quantity;
        pos.avgCost = newQty > 0 ? newTotalCost / newQty : 0;
        pos.quantity = newQty;
        pos.invested = newTotalCost;

        if (txKey === dateKey) {
          monthlyBuys.push({ ticker: ticker, broker: broker, quantity: quantity, price: amount/quantity, total: amount });
        }
      } else if (action === 'Sell') {
        cashByBroker[broker] += amount;
        if (runningPositions[ticker] && runningPositions[ticker][broker]) {
          var pos = runningPositions[ticker][broker];
          var costBasisSold = pos.avgCost * quantity;
          pos.quantity -= quantity;
          pos.invested -= costBasisSold;
          if (pos.quantity <= 0) {
            delete runningPositions[ticker][broker];
            if (Object.keys(runningPositions[ticker]).length === 0) {
              delete runningPositions[ticker];
            }
          }

          if (txKey === dateKey) {
            monthlySells.push({ ticker: ticker, broker: broker, quantity: quantity, total: amount, costBasis: costBasisSold });
          }
        }
      } else if (action === 'DRIP') {
        if (!runningPositions[ticker]) runningPositions[ticker] = {};
        if (!runningPositions[ticker][broker]) {
          runningPositions[ticker][broker] = { quantity: 0, invested: 0, avgCost: 0 };
        }
        runningPositions[ticker][broker].quantity += quantity;

        if (txKey === dateKey) {
          monthlyBuys.push({ ticker: ticker, broker: broker, quantity: quantity, price: 0, total: 0, isDRIP: true });
        }
      }
    });

    var marketValue = 0;
    var currentInvested = 0;
    var tickerValues = {};

    for (var ticker in runningPositions) {
      for (var broker in runningPositions[ticker]) {
        var pos = runningPositions[ticker][broker];
        if (pos.quantity > 0) {
          currentInvested += pos.invested;

          var price = null;

          if (dateKey === lastDateKey && currentPricesFromPortfolio[ticker]) {
            price = currentPricesFromPortfolio[ticker].price;
          }

          if (price === null && historicalPrices[ticker] && historicalPrices[ticker][broker] && historicalPrices[ticker][broker][dateKey]) {
            price = historicalPrices[ticker][broker][dateKey];
          }

          if (price === null) {
            var tickerPrices = historicalPrices[ticker];
            if (tickerPrices && tickerPrices[broker]) {
              var brokerPrices = tickerPrices[broker];
              var availableDates = Object.keys(brokerPrices).sort();
              for (var i = availableDates.length - 1; i >= 0; i--) {
                if (availableDates[i] <= dateKey) {
                  price = brokerPrices[availableDates[i]];
                  break;
                }
              }
            }
          }

          if (price === null) {
            price = pos.avgCost;
          }

          if (price !== null) {
            var val = pos.quantity * price;
            marketValue += val;

            if (!tickerValues[ticker]) tickerValues[ticker] = {};
            tickerValues[ticker][broker] = {
              quantity: pos.quantity,
              price: price,
              invested: pos.invested,
              avgCost: pos.avgCost,
              value: val
            };
          }
        }
      }
    }

    var cash = 0;
    for (var broker in cashByBroker) {
      cash += cashByBroker[broker];
    }

    monthlyPortfolio[dateKey] = {
      date: dateKey,
      marketValue: marketValue,
      cash: cash,
      total: marketValue + cash,
      invested: currentInvested,
      dividends: monthlyDividends,
      buys: monthlyBuys,
      sells: monthlySells
    };

    monthlyTickerDetail[dateKey] = tickerValues;
  });

  window.monthlyPL = {};
  var monthlyKeys = historicalDates.slice().sort();

  monthlyKeys.forEach(function(dateKey, idx) {
    var current = monthlyPortfolio[dateKey];
    var currentTickers = monthlyTickerDetail[dateKey];
    if (!current) return;

    var pl = 0;

    if (idx === 0) {
      pl = current.marketValue - current.invested + current.dividends;
    } else {
      var prevKey = monthlyKeys[idx - 1];
      var prev = monthlyPortfolio[prevKey];
      var prevTickers = monthlyTickerDetail[prevKey];

      if (!prev || !prevTickers) {
        pl = current.marketValue - current.invested + current.dividends;
      } else {
        for (var ticker in prevTickers) {
          for (var broker in prevTickers[ticker]) {
            var prevPos = prevTickers[ticker][broker];
            var currentPos = currentTickers && currentTickers[ticker] && currentTickers[ticker][broker];

            if (currentPos) {
              var qtyCarried = Math.min(prevPos.quantity, currentPos.quantity);
              pl += (currentPos.price - prevPos.price) * qtyCarried;
            }
          }
        }

        current.buys.forEach(function(buy) {
          var currentPos = currentTickers && currentTickers[buy.ticker] && currentTickers[buy.ticker][buy.broker];
          if (currentPos && !buy.isDRIP) {
            pl += (currentPos.price - buy.price) * buy.quantity;
          }
        });

        current.sells.forEach(function(sell) {
          pl += sell.total - sell.costBasis;
        });

        pl += current.dividends;
      }
    }

    var monthlyRealizedPL = 0;

    current.sells.forEach(function(sell) {
      monthlyRealizedPL += (sell.total - sell.costBasis);
    });

    monthlyRealizedPL += current.dividends;

    var monthlyUnrealizedPL = pl - monthlyRealizedPL;

    window.monthlyPL[dateKey] = {
      date: dateKey,
      pl: pl,
      realizedPL: monthlyRealizedPL,
      unrealizedPL: monthlyUnrealizedPL,
      marketValue: current.marketValue,
      invested: current.invested,
      cash: current.cash,
      total: current.total,
      buys: current.buys.length,
      sells: current.sells.length,
      dividends: current.dividends
    };
  });

  historyData = historicalDates.map(function(dateKey) {
    return monthlyPortfolio[dateKey] || { date: dateKey, marketValue: 0, cash: 0, total: 0, invested: 0 };
  }).filter(function(d) { return d.total !== 0 || d.invested !== 0; });
}

function setHistoryRange(range) {
  historyRange = range;

  ['1M','3M','6M','1Y','ALL'].forEach(function(r) {
    var btn = document.getElementById('range-' + r);
    if (btn) {
      if (r === range) {
        btn.classList.add('active');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('active');
        btn.classList.add('text-slate-400');
      }
    }
  });

  renderHistoryChart();
}

function renderHistoryChart() {
  var ctx = document.getElementById('portfolioHistoryChart');
  if (!ctx) return;

  var filteredData = filterHistoryByRange(historyData, historyRange);

  if (filteredData.length === 0) {
    if (charts.history) charts.history.destroy();
    return;
  }

  var labels = filteredData.map(function(d) {
    var parts = d.date.split('-');
    var monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return monthNames[parseInt(parts[1]) - 1] + " '" + parts[0].slice(2);
  });

  var totalValues = filteredData.map(function(d) { return d.total; });

  var maxVal = Math.max.apply(null, totalValues);
  var minVal = Math.min.apply(null, totalValues);
  var firstVal = totalValues[0] || 0;
  var lastVal = totalValues[totalValues.length - 1] || 0;
  var growth = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;

  document.getElementById('historyMax').textContent = formatCurrency(maxVal);
  document.getElementById('historyMin').textContent = formatCurrency(minVal);
  document.getElementById('historyGrowth').textContent = (growth >= 0 ? '+' : '') + growth.toFixed(2) + '%';
  document.getElementById('historyGrowth').className = 'text-sm font-bold ' + (growth >= 0 ? 'text-emerald-400' : 'text-rose-400');

  if (charts.history) charts.history.destroy();

  var datasets = [
    {
      label: 'Patrimonio Total',
      data: totalValues,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.08)',
      borderWidth: 2.5,
      tension: 0.3,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: '#3b82f6',
      pointBorderColor: '#0f172a',
      pointBorderWidth: 2,
      order: 1
    }
  ];

  if (window.dashboardData && window.dashboardData.historicoBrokers &&
      window.dashboardData.historicoBrokers.brokers) {

    var hb = window.dashboardData.historicoBrokers;
    var brokerColors = {
      'Etoro': '#60a5fa',
      'Hapi': '#34d399',
      'TradeStation': '#fbbf24',
      'Alpha': '#a78bfa',
      'SIEMBRA': '#4ade80',
      'Banreservas': '#60a5fa',
      'UNITED': '#818cf8',
      'Goarbit': '#f87171',
      'R-Company': '#f472b6',
      'BDI y QIK Ahorro': '#94a3b8'
    };

    var colorIdx = 0;
    var palette = ['#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#84cc16', '#06b6d4'];

    for (var brokerName in hb.brokers) {
      var brokerValues = hb.brokers[brokerName];

      var filteredBrokerValues = [];
      var allDates = hb.dates;

      for (var i = 0; i < filteredData.length; i++) {
        var targetDate = filteredData[i].date;
        var dateIdx = allDates.indexOf(targetDate);
        if (dateIdx >= 0 && dateIdx < brokerValues.length) {
          filteredBrokerValues.push(brokerValues[dateIdx]);
        } else {
          filteredBrokerValues.push(null);
        }
      }

      var hasData = filteredBrokerValues.some(function(v) { return v && v > 0; });
      if (!hasData) continue;

      var color = brokerColors[brokerName] || palette[colorIdx % palette.length];
      colorIdx++;

      datasets.push({
        label: brokerName,
        data: filteredBrokerValues,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [3, 3],
        tension: 0.3,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        hidden: true,
        order: 2 + colorIdx
      });
    }
  }

  charts.history = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: '#94a3b8',
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 11 },
            padding: 16,
            boxWidth: 8
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(51, 65, 85, 0.15)',
            drawBorder: false
          },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxRotation: 45,
            minRotation: 45
          }
        },
        y: {
          grid: {
            color: 'rgba(51, 65, 85, 0.15)',
            drawBorder: false
          },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            callback: function(value) {
              if (Math.abs(value) >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
              if (Math.abs(value) >= 1000) return '$' + (value / 1000).toFixed(1) + 'k';
              return '$' + value.toFixed(0);
            }
          }
        }
      }
    }
  });
}

function filterHistoryByRange(data, range) {
  if (range === 'ALL' || data.length === 0) return data;

  var now = new Date();
  var cutoff = new Date();

  switch(range) {
    case '1M': cutoff.setMonth(now.getMonth() - 1); break;
    case '3M': cutoff.setMonth(now.getMonth() - 3); break;
    case '6M': cutoff.setMonth(now.getMonth() - 6); break;
    case '1Y': cutoff.setFullYear(now.getFullYear() - 1); break;
    default: return data;
  }

  var cutoffStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0');

  var filtered = data.filter(function(d) {
    return d.date >= cutoffStr;
  });

  if (filtered.length < 2) {
    return data.slice(-3);
  }

  return filtered;
}

// ============================================================
// OPTIMIZACIONES
// ============================================================
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

const chartCache = {
  data: new Map(),
  lastHash: new Map(),

  hash: function(data) {
    return JSON.stringify(data).length;
  },

  shouldUpdate: function(key, newData) {
    const newHash = this.hash(newData);
    const oldHash = this.lastHash.get(key);
    const hasChanged = newHash !== oldHash;
    if (hasChanged) {
      this.lastHash.set(key, newHash);
    }
    return hasChanged;
  }
};

// ============================================================
// INICIALIZACIÓN
// ============================================================
setHistoryRange('ALL');
loadData();

// Resize handling
var resizeTimeout;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(function() {
    if (portfolioSummary && portfolioSummary.byAssetClass) {
      renderPortfolioCharts(portfolioSummary);
    }
  }, 250);
});

const debouncedResize = debounce(() => {
  if (charts.history) {
    renderHistoryChart();
  }
}, 300);

window.addEventListener('resize', debouncedResize, { passive: true });

// Detectar scroll y desactivar blur dinámicamente
let scrollTimeout;
const scrollListener = throttle(() => {
  document.body.classList.add('is-scrolling');
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    document.body.classList.remove('is-scrolling');
  }, 150);
}, 100);

document.addEventListener('scroll', scrollListener, { passive: true });

// Lazy load de gráficos con Intersection Observer
const chartContainers = document.querySelectorAll('[data-chart]');
if ('IntersectionObserver' in window) {
  const chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const chartId = entry.target.id;
        if (chartId === 'portfolioHistoryChart') {
          renderHistoryChart();
        }
        chartObserver.unobserve(entry.target);
      }
    });
  }, {
    rootMargin: '50px',
    threshold: 0.01
  });

  chartContainers.forEach(el => {
    if (el.dataset.chart) {
      chartObserver.observe(el);
    }
  });
}

// ============================================================
// ALLOCATION — Con drill-down (Fase 2)
// ============================================================

let allocationCurrentTab = 'positions';
let allocationChartInstance = null;

// Stack de navegación: [{tab, field, value, label}, ...]
// Vacío = vista raíz. Con items = drill-down activo.
let allocationDrillStack = [];

// Nombres bonitos para monedas
const CURRENCY_NAMES = {
  'USD': 'US Dollar',
  'DOP': 'Dominican Peso',
  'EUR': 'Euro',
  'GBP': 'British Pound',
  'JPY': 'Japanese Yen',
  'CAD': 'Canadian Dollar',
  'CHF': 'Swiss Franc',
  'MXN': 'Mexican Peso',
  'BRL': 'Brazilian Real',
  'CNY': 'Chinese Yuan',
  'ARS': 'Argentine Peso',
  'COP': 'Colombian Peso',
  'CLP': 'Chilean Peso',
  'PEN': 'Peruvian Sol'
};

const CURRENCY_SYMBOLS = {
  'USD': '$', 'DOP': 'RD$', 'EUR': '€', 'GBP': '£',
  'JPY': '¥', 'CAD': 'C$', 'CHF': 'CHF', 'MXN': 'MX$',
  'BRL': 'R$', 'CNY': '¥', 'ARS': 'AR$', 'COP': 'CO$',
  'CLP': 'CL$', 'PEN': 'S/'
};

function getCurrencyDisplayName(code) {
  if (!code) return 'Sin Moneda';
  var upper = String(code).toUpperCase().trim();
  var name = CURRENCY_NAMES[upper] || upper;
  var symbol = CURRENCY_SYMBOLS[upper] || '';
  return symbol ? (name + ' (' + symbol + ')') : name;
}

/**
 * Formatea el total del centro del donut respetando la moneda activa del drill.
 */
function formatAllocationCenterTotal(total) {
  // Si estamos en drill-down de currency, usar el símbolo de esa moneda
  if (allocationDrillStack.length > 0) {
    var lastStep = allocationDrillStack[allocationDrillStack.length - 1];
    if (lastStep.field === 'currency') {
      var symbol = CURRENCY_SYMBOLS[lastStep.value.toUpperCase()] || '';
      if (symbol) {
        return symbol + new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(total);
      }
    }
  }
  // Fallback: usar formatCurrency normal
  return formatCurrency(total);
}


const ALLOC_PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e',
  '#0ea5e9', '#6366f1', '#ec4899', '#84cc16', '#06b6d4',
  '#a855f7', '#22c55e', '#eab308', '#ef4444', '#14b8a6',
  '#f97316', '#a78bfa', '#34d399', '#fbbf24', '#fb7185'
];

const ALLOC_BRAND_COLORS = {
  'NVDA': '#76b900', 'AMZN': '#ff9900', 'MA': '#eb001b', 'MSFT': '#00a4ef',
  'META': '#0866ff', 'BKNG': '#003580', 'V': '#1434cb', 'ANET': '#005eb8',
  'VRT': '#0072ce', 'GOOG': '#4285f4', 'AAPL': '#a2aaad', 'VOO': '#D04C55',
  'UBER': '#000000', 'ASML': '#00a651', 'APH': '#005b96', 'DUOL': '#58cc02',
  'CRM': '#1798c1', 'YMM': '#00a651', 'BABA': '#ff6a00', 'CBANR': '#007a3d',
  'BTCUSD': '#f7931a', 'NOW': '#81b441', 'NFLX': '#e50914', 'METU': '#0866ff',
  'ETHUSD': '#627eea', 'BLK': '#000000', 'HAINA': '#142B37', 'ALCANZA': '#8D5578',
  'ALCANZA 2': '#8D5578', 'ALTIO': '#449E40', 'AOCISA': '#c62828'
};

// Mapeo: cada sub-tab sabe a qué CAMPO de la posición filtrar al hacer drill-down
const ALLOC_TAB_TO_FIELD = {
  'positions': null,        // no filtrable
  'type': 'assetClass',
  'sectors': 'sector',
  'industries': 'industry',  // ⚠️ ver nota al final
  'marketcap': 'marketcap',
  'currencies': 'currency',
  'regions': 'region',       // ⚠️ ver nota al final
  'countries': 'country'     // ⚠️ ver nota al final
};

const ALLOC_TAB_LABELS = {
  positions: 'Positions', type: 'Type', sectors: 'Sectors',
  industries: 'Industries', marketcap: 'Market cap',
  currencies: 'Currencies', regions: 'Regions', countries: 'Countries'
};

/**
 * Obtiene las posiciones activas del portafolio.
 */
function getAllActivePositions() {
  var data = window.dashboardData;
  if (!data || !data.portfolio || !data.portfolio.portfolio) return [];
  return data.portfolio.portfolio.filter(function(p) {
    return !p.isSold && (p.currentValue || 0) > 0;
  });
}

/**
 * Aplica todos los filtros del drillStack a un array de posiciones.
 */
function applyDrillFilters(positions) {
  if (allocationDrillStack.length === 0) return positions;

  return positions.filter(function(p) {
    return allocationDrillStack.every(function(step) {
      var field = step.field;
      var value = step.value;
      var posValue = p[field];

      if (posValue === undefined || posValue === null) return false;

      // Normalizar comparación (case + trim) — funciona bien para currency también
      var posNorm = String(posValue).trim().toLowerCase();
      var valNorm = String(value).trim().toLowerCase();
      return posNorm === valNorm;
    });
  });
}

/**
 * Obtiene el dataset para el sub-tab actual, considerando drill-down.
 */
function getAllocationDataset(tab) {
  var data = window.dashboardData;
  if (!data || !data.portfolio) return [];
  var summary = data.portfolio.summary || {};

  var allPositions = getAllActivePositions();
  var filtered = applyDrillFilters(allPositions);

  // Si estamos en la vista raíz → agregamos por categoría
  if (allocationDrillStack.length === 0) {
    switch(tab) {
      case 'positions':
        return groupPositionsAsItems(filtered);
      case 'type':
        return aggregatePositionsByField(filtered, 'assetClass', 'Sin Clase');
      case 'sectors':
        return aggregatePositionsByField(filtered, 'sector', 'Sin Sector');
      case 'industries':
        return aggregatePositionsByField(filtered, 'industry', 'Sin Industria');
      case 'marketcap':
        return aggregatePositionsByField(filtered, 'marketcap', 'Sin Cap');
      case 'currencies':
        return aggregatePositionsByField(filtered, 'currency', 'Sin Moneda');
      case 'regions':
        return aggregatePositionsByField(filtered, 'region', 'Sin Región');
      case 'countries':
        return aggregatePositionsByField(filtered, 'country', 'Sin País');
      default:
        return [];
    }
  }

  // Si estamos en drill-down → mostramos las posiciones individuales del subconjunto
  return groupPositionsAsItems(filtered);
}

/**
 * Convierte posiciones individuales en items de donut.
 */
function groupPositionsAsItems(positions) {
  return positions
    .slice()
    .sort(function(a, b) { return (b.currentValue || 0) - (a.currentValue || 0); })
    .map(function(p) {
      var ticker = (p.ticker || 'OTRO').toUpperCase();
      return {
        name: p.assetName || p.ticker || 'Sin nombre',
        ticker: p.ticker,
        value: p.currentValue || 0,
        roi: p.unrealizedROI || 0,
        dailyChange: p.dailyPctChange || 0,
        iconUrl: p.iconUrl || null,
        color: ALLOC_BRAND_COLORS[ticker] || null,
        raw: p
      };
    });
}

/**
 * Agrupa posiciones por un campo (assetClass, sector, etc.) y devuelve
 * items { name, value, roi (promedio ponderado), count, color }.
 */
function aggregatePositionsByField(positions, field, fallbackName) {
  var groups = {};
  var total = 0;

  positions.forEach(function(p) {
    var key = p[field];
    if (key === undefined || key === null || String(key).trim() === '') {
      key = fallbackName;
    } else {
      key = String(key).trim();
      // Normalizar solo para currency (mayúsculas)
      if (field === 'currency') key = key.toUpperCase();
    }
    if (!groups[key]) {
      groups[key] = { name: key, value: 0, cost: 0, pl: 0, count: 0 };
    }
    groups[key].value += p.currentValue || 0;
    groups[key].cost += p.cost || 0;
    groups[key].pl += p.unrealizedPL || 0;
    groups[key].count++;
    total += p.currentValue || 0;
  });

  var result = Object.keys(groups).map(function(k) {
    var g = groups[k];
    var roi = g.cost > 0 ? (g.pl / g.cost) * 100 : 0;

    // Si es currency, mostrar nombre bonito; si no, el nombre tal cual
    var displayName = (field === 'currency')
      ? getCurrencyDisplayName(g.name)
      : g.name;

    return {
      name: displayName,
      rawName: g.name,        // ← Guardamos el original para el filtro
      value: g.value,
      roi: roi,
      count: g.count,
      iconUrl: null,
      color: null,
      isCurrency: field === 'currency'
    };
  });

  result.sort(function(a, b) { return b.value - a.value; });

  result.forEach(function(item, idx) {
    if (!item.color) {
      item.color = ALLOC_PALETTE[idx % ALLOC_PALETTE.length];
    }
  });

  return result;
}

/**
 * Cambia de sub-tab. Resetea el drill.
 */
function switchAllocationTab(tab) {
  allocationCurrentTab = tab;
  allocationDrillStack = [];

  var tabs = ['positions','type','sectors','industries','marketcap','currencies','regions','countries'];
  tabs.forEach(function(t) {
    var btn = document.getElementById('alloc-tab-' + t);
    if (!btn) return;
    btn.classList.toggle('alloc-tab-active', t === tab);
  });

  updateAllocationLabels();
  updateAllocationBreadcrumb();
  renderAllocation();
}

/**
 * Actualiza los labels de título y centro según el tab activo.
 */
function updateAllocationLabels() {
  var centerLabel = document.getElementById('allocationCenterLabel');
  var legendTitle = document.getElementById('allocationLegendTitle');

  var label;
  if (allocationDrillStack.length > 0) {
    // En drill-down: mostramos "Positions in <X>"
    label = allocationDrillStack[allocationDrillStack.length - 1].label;
  } else {
    label = ALLOC_TAB_LABELS[allocationCurrentTab] || allocationCurrentTab;
  }

  if (centerLabel) centerLabel.textContent = label;
  if (legendTitle) legendTitle.textContent = label;
}

/**
 * Actualiza el breadcrumb de navegación.
 */
function updateAllocationBreadcrumb() {
  var bc = document.getElementById('allocationBreadcrumb');
  var parentLabelEl = document.getElementById('allocationParentLabel');
  var drillLabelEl = document.getElementById('allocationDrillLabel');

  if (!bc) return;

  if (allocationDrillStack.length === 0) {
    bc.classList.add('hidden');
    return;
  }

  bc.classList.remove('hidden');

  // El "volver a" siempre es el sub-tab raíz
  var rootLabel = ALLOC_TAB_LABELS[allocationCurrentTab] || allocationCurrentTab;
  if (parentLabelEl) parentLabelEl.textContent = rootLabel;

  // Cadena del drill actual
  if (drillLabelEl) {
    var chain = allocationDrillStack.map(function(s) { return s.label; }).join(' › ');
    drillLabelEl.textContent = chain;
  }
}

/**
 * Render principal.
 */
function renderAllocation() {
  var canvas = document.getElementById('allocationChart');
  if (!canvas) return;

  var dataset = getAllocationDataset(allocationCurrentTab);

  if (dataset.length === 0) {
    if (allocationChartInstance) {
      allocationChartInstance.destroy();
      allocationChartInstance = null;
    }
    document.getElementById('allocationCenterTotal').textContent = formatCurrency(0);
    document.getElementById('allocationLegend').innerHTML =
      '<div class="flex flex-col items-center justify-center py-10 text-center px-4">' +
        '<div class="w-12 h-12 bg-slate-800/60 rounded-full flex items-center justify-center mb-3">' +
          '<i class="fas fa-inbox text-slate-500"></i>' +
        '</div>' +
        '<p class="text-slate-400 text-xs font-medium">Sin datos para esta vista</p>' +
        '<p class="text-slate-600 text-[10px] mt-1">' +
          (allocationDrillStack.length > 0 ?
            'Este filtro no tiene posiciones. Vuelve atrás.' :
            'Agrega datos en Dashboard_Summary') +
        '</p>' +
      '</div>';
    document.getElementById('allocationLegendCount').textContent = '0 items';
    return;
  }

  var total = dataset.reduce(function(s, d) { return s + d.value; }, 0);
  var colors = dataset.map(function(d, idx) {
    return d.color || ALLOC_PALETTE[idx % ALLOC_PALETTE.length];
  });

    document.getElementById('allocationCenterTotal').textContent = formatAllocationCenterTotal(total);
    document.getElementById('allocationTotalBadge').textContent = formatCurrency(total);
    document.getElementById('allocationLegendCount').textContent = dataset.length + ' items';

  if (allocationChartInstance) {
    allocationChartInstance.destroy();
  }

  allocationChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: dataset.map(function(d) { return d.name; }),
      datasets: [{
        data: dataset.map(function(d) { return d.value; }),
        backgroundColor: colors,
        borderColor: '#0f172a',
        borderWidth: 2,
        hoverOffset: 10,
        hoverBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      animation: {
        animateRotate: true,
        animateScale: false,
        duration: 700,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function(context) {
              var idx = context.dataIndex;
              var d = dataset[idx];
              var pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : 0;
              var lines = [d.name + ': ' + formatCurrency(d.value) + ' (' + pct + '%)'];
              if (d.count && d.count > 1) lines.push('  ' + d.count + ' posiciones');
              return lines;
            }
          }
        }
      },
      onHover: function(event, elements) {
        event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
        if (elements.length > 0) {
          highlightLegendItem(elements[0].index, true);
        } else {
          clearAllLegendHighlights();
        }
      },
      onClick: function(event, elements) {
        if (elements.length > 0) {
          onAllocationItemClick(dataset[elements[0].index]);
        }
      }
    }
  });

  renderAllocationLegend(dataset, colors, total);

  var container = document.getElementById('allocationLegend');
  if (container) {
    container.classList.remove('alloc-fade-in');
    void container.offsetWidth;
    container.classList.add('alloc-fade-in');
  }
}

/**
 * Leyenda lateral — ahora con indicador de "drillable".
 */
function renderAllocationLegend(dataset, colors, total) {
  var el = document.getElementById('allocationLegend');
  if (!el) return;

  // ¿Se puede hacer drill? Sí, excepto cuando ya estamos viendo posiciones individuales
  var canDrill = allocationDrillStack.length === 0 && allocationCurrentTab !== 'positions';

  el.innerHTML = dataset.map(function(d, idx) {
    var pct = total > 0 ? ((d.value / total) * 100) : 0;
    var pctDisplay = pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
    var color = colors[idx];

    var iconHtml = '';
    if (d.iconUrl) {
      iconHtml = '<img src="' + d.iconUrl + '" alt="" class="alloc-legend-icon" loading="lazy" ' +
                 'onerror="this.outerHTML=\'<div class=&quot;alloc-legend-icon-fallback&quot;>' +
                 escapeHtml((d.ticker || d.name || '?').charAt(0).toUpperCase()) + '</div>\'">';
    } else {
      iconHtml = '<div class="alloc-legend-icon-fallback">' +
                 escapeHtml((d.ticker || d.name || '?').charAt(0).toUpperCase()) + '</div>';
    }

    var roiHtml = '';
    if (d.roi !== null && d.roi !== undefined && isFinite(d.roi)) {
      var roiSign = d.roi >= 0 ? '↗' : '↘';
      var roiClass = d.roi >= 0 ? 'alloc-legend-roi-up' : 'alloc-legend-roi-down';
      roiHtml = '<span class="' + roiClass + '">' + roiSign + ' ' +
                (d.roi >= 0 ? '+' : '') + d.roi.toFixed(2) + '%</span>';
    }

    // Si tiene count > 1, mostrar "N posiciones" en lugar del ROI
    var subHtml = '';
    if (canDrill && d.count && d.count > 0) {
      subHtml = '<div class="alloc-legend-sub">' +
                  '<i class="fas fa-layer-group text-slate-600 text-[9px]"></i>' +
                  '<span>' + d.count + ' posición' + (d.count > 1 ? 'es' : '') + '</span>' +
                '</div>';
    } else if (roiHtml) {
      subHtml = '<div class="alloc-legend-sub">' + roiHtml + '</div>';
    }

    var barWidth = Math.min(pct, 100);
    var drillIndicator = canDrill ? '<i class="fas fa-chevron-right alloc-drill-chevron"></i>' : '';

    return '<div class="alloc-legend-item' + (canDrill ? ' alloc-legend-drillable' : '') + '" ' +
           'data-alloc-idx="' + idx + '" ' +
           'onclick="onAllocationLegendClick(' + idx + ')" ' +
           'onmouseenter="highlightLegendItem(' + idx + ', true)" ' +
           'onmouseleave="highlightLegendItem(' + idx + ', false)">' +
      '<div class="alloc-legend-color" style="background-color:' + color + '"></div>' +
      '<div class="flex-shrink-0">' + iconHtml + '</div>' +
      '<div class="alloc-legend-body">' +
        '<div class="alloc-legend-name">' + escapeHtml(d.name) + '</div>' +
        subHtml +
        '<div class="alloc-legend-bar">' +
          '<div class="alloc-legend-bar-fill" style="width:' + barWidth + '%; background-color:' + color + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="alloc-legend-value">' +
        '<div class="alloc-legend-value-pct">' + pctDisplay + '%</div>' +
        '<div class="alloc-legend-value-amount">' + formatCurrency(d.value) + '</div>' +
      '</div>' +
      drillIndicator +
    '</div>';
  }).join('');
}

function highlightLegendItem(idx, on) {
  document.querySelectorAll('.alloc-legend-item').forEach(function(el) {
    el.classList.remove('alloc-active');
  });
  if (on) {
    var item = document.querySelector('.alloc-legend-item[data-alloc-idx="' + idx + '"]');
    if (item) item.classList.add('alloc-active');
  }
}

function clearAllLegendHighlights() {
  document.querySelectorAll('.alloc-legend-item').forEach(function(el) {
    el.classList.remove('alloc-active');
  });
}

/**
 * Click en item de leyenda.
 */
function onAllocationLegendClick(idx) {
  var dataset = getAllocationDataset(allocationCurrentTab);
  if (!dataset[idx]) return;
  onAllocationItemClick(dataset[idx]);
}

/**
 * Lógica central del drill-down.
 */
function onAllocationItemClick(item) {
  if (!item) return;

  var canDrill = allocationDrillStack.length === 0 && allocationCurrentTab !== 'positions';

  // Si no se puede drill (ya estamos en posiciones finales), solo logueamos
  if (!canDrill) {
    console.log('[Allocation] Click en hoja final:', item);
    return;
  }

  var field = ALLOC_TAB_TO_FIELD[allocationCurrentTab];
  if (!field) return;

  // Push al stack — usar rawName si existe (para currency), si no, el name
  var filterValue = item.rawName || item.name;

  allocationDrillStack.push({
    tab: allocationCurrentTab,
    field: field,
    value: filterValue,
    label: item.name
  });

  updateAllocationLabels();
  updateAllocationBreadcrumb();
  renderAllocation();
}

/**
 * Volver atrás (pop del stack).
 */
function clearAllocationDrill() {
  if (allocationDrillStack.length === 0) return;
  allocationDrillStack.pop();
  updateAllocationLabels();
  updateAllocationBreadcrumb();
  renderAllocation();
}



/**
 * Init.
 */
function initAllocation() {
  if (document.getElementById('allocationSection')) {
    renderAllocation();
  }
}


// ============================================================
// PERFORMANCE OVERVIEW (getquin style)
// ============================================================

let perfCurrentYear = 'ALL';
let perfRendimiento = null;
let perfSelectedMonth = null;


function setPerfYear(year) {
  perfCurrentYear = year;
  perfSelectedMonth = null;  // ← Reset drill al cambiar de año
  document.querySelectorAll('.perf-year-tab').forEach(function(btn) {
    btn.classList.remove('perf-year-active');
  });
  var activeBtn = document.getElementById('perf-year-' + year);
  if (activeBtn) activeBtn.classList.add('perf-year-active');
  renderPerformanceMonthly();
  renderPerfMonthDetail();  // ← Refresca el panel (lo oculta si no hay mes seleccionado)
}

function renderPerformanceOverview() {
  var data = window.dashboardData;
  if (!data || !data.rendimiento || data.rendimiento.error) {
    console.warn('[Performance] Sin datos de rendimiento:', data && data.rendimiento);
    return;
  }
  
  perfRendimiento = data.rendimiento;
  
  // Generar tabs de años dinámicamente
  var yearsSet = {};
  perfRendimiento.months.forEach(function(key) {
    var y = key.split('-')[0];
    yearsSet[y] = true;
  });
  var sortedYears = Object.keys(yearsSet).sort().reverse();
  
  var yearTabsHtml = sortedYears.map(function(y) {
    return '<button onclick="setPerfYear(\'' + y + '\')" id="perf-year-' + y + '" class="perf-year-tab">' + y + '</button>';
  }).join('');
  
  var container = document.getElementById('perfYearTabs');
  if (container) container.innerHTML = yearTabsHtml;
  
  // Resetear el tab activo (por defecto ALL)
  perfCurrentYear = 'ALL';
  var allBtn = document.getElementById('perf-year-ALL');
  if (allBtn) allBtn.classList.add('perf-year-active');
  
  renderPerformanceMonthly();
}

function renderPerformanceMonthly() {
  if (!perfRendimiento) return;
  
  var months = perfRendimiento.months;
  var labels = perfRendimiento.monthLabels;
  var totals = perfRendimiento.totals;
  
  // Filtrar por año
  var filtered = [];
  for (var i = 0; i < months.length; i++) {
    var key = months[i];
    if (perfCurrentYear === 'ALL' || key.startsWith(perfCurrentYear)) {
      filtered.push({
        key: key,
        label: labels[i],
        value: totals[key] || 0
      });
    }
  }
  
  // Ordenar cronológicamente (más antiguo → más nuevo)
  filtered.sort(function(a, b) { return a.key.localeCompare(b.key); });
  
  if (filtered.length === 0) return;
  
  // Chart
  var ctx = document.getElementById('perfMonthlyChart');
  if (!ctx) return;
  
  if (charts.perfMonthly) charts.perfMonthly.destroy();
  
  var values = filtered.map(function(d) { return d.value; });
  var bgColors = values.map(function(v) { return v >= 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(244, 63, 94, 0.75)'; });
  var borderColors = values.map(function(v) { return v >= 0 ? '#10b981' : '#f43f5e'; });
  
    // Construir mapa de desglose por mes para tooltips
  var monthDetails = {};
  if (perfRendimiento.tickers) {
    perfRendimiento.tickers.forEach(function(t) {
      Object.keys(t.months).forEach(function(k) {
        var v = t.months[k];
        if (!v || v === 0) return;
        if (!monthDetails[k]) monthDetails[k] = { winners: [], losers: [] };
        if (v > 0) {
          monthDetails[k].winners.push({ ticker: t.ticker, value: v });
        } else {
          monthDetails[k].losers.push({ ticker: t.ticker, value: v });
        }
      });
    });
    
    // Ordenar winners/losers por valor absoluto
    Object.keys(monthDetails).forEach(function(k) {
      monthDetails[k].winners.sort(function(a, b) { return b.value - a.value; });
      monthDetails[k].losers.sort(function(a, b) { return a.value - b.value; });
    });
  }

  charts.perfMonthly = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: filtered.map(function(d) { return d.label; }),
      datasets: [{
        label: 'P/L',
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.7,
        categoryPercentage: 0.85
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {

        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: function(context) {
              return context[0].label;
            },
            label: function(context) {
              var val = context.parsed.y;
              return (val >= 0 ? '+' : '') + formatCurrency(val);
            },
            afterLabel: function(context) {
              var monthKey = filtered[context.dataIndex].key;
              var detail = monthDetails[monthKey];
              if (!detail) return '';
              
              var lines = [];
              
              if (detail.winners.length > 0) {
                var best = detail.winners[0];
                lines.push('  ▲ Top: ' + best.ticker + ' ' + (best.value >= 0 ? '+' : '') + formatCurrency(best.value));
                if (detail.winners.length > 1) {
                  lines.push('  ' + detail.winners.length + ' ganadores');
                }
              }
              
              if (detail.losers.length > 0) {
                var worst = detail.losers[0];
                lines.push('  ▼ Peor: ' + worst.ticker + ' ' + formatCurrency(worst.value));
                if (detail.losers.length > 1) {
                  lines.push('  ' + detail.losers.length + ' perdedores');
                }
              }
              
              return lines;
            }
          }
        }
      },
     onClick: function(event, elements) {
        if (elements.length > 0) {
          var idx = elements[0].index;
          var monthKey = filtered[idx].key;
          
          // Toggle: si clickeas el mismo mes, se cierra
          if (perfSelectedMonth === monthKey) {
            perfSelectedMonth = null;
          } else {
            perfSelectedMonth = monthKey;
          }
          
          renderPerfMonthDetail();
        }
      },
      onHover: function(event, elements) {
        event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12   // máximo 12 labels visibles
          }
        },
        y: {
          grid: {
            color: 'rgba(51, 65, 85, 0.15)',
            drawBorder: false
          },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            callback: function(v) {
              if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1) + 'k';
              return '$' + v.toFixed(0);
            }
          }
        }
      }
    }
  });
  
  // Métricas
  var totalPL = values.reduce(function(s, v) { return s + v; }, 0);
  var invested = (portfolioSummary && portfolioSummary.totalCost) ? portfolioSummary.totalCost : 0;
  var roi = invested > 0 ? (totalPL / invested) * 100 : 0;
  var avg = filtered.length > 0 ? totalPL / filtered.length : 0;
  
  // Best/Worst
  var best = filtered.reduce(function(a, b) { return (b.value > a.value) ? b : a; }, filtered[0]);
  var worst = filtered.reduce(function(a, b) { return (b.value < a.value) ? b : a; }, filtered[0]);
  
  var totalPLEl = document.getElementById('perfTotalPL');
  if (totalPLEl) {
    totalPLEl.textContent = (totalPL >= 0 ? '+' : '') + formatCurrency(totalPL);
    totalPLEl.className = 'text-base sm:text-lg font-bold ' + (totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400');
  }
  
  var roiEl = document.getElementById('perfROIPct');
  if (roiEl) {
    roiEl.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%';
    roiEl.className = 'text-base sm:text-lg font-bold ' + (roi >= 0 ? 'text-emerald-400' : 'text-rose-400');
  }
  
  var avgEl = document.getElementById('perfAvgMonthly');
  if (avgEl) {
    avgEl.textContent = (avg >= 0 ? '+' : '') + formatCurrency(avg);
    avgEl.className = 'text-base sm:text-lg font-bold ' + (avg >= 0 ? 'text-emerald-400' : 'text-rose-400');
  }
  
  var capEl = document.getElementById('perfCapitalInvested');
  if (capEl) capEl.textContent = formatCurrency(invested);
  
  var bestEl = document.getElementById('perfBestMonth');
  var bestValEl = document.getElementById('perfBestMonthValue');
  if (bestEl && bestValEl) {
    bestEl.textContent = best.label || '-';
    bestValEl.textContent = (best.value >= 0 ? '+' : '') + formatCurrency(best.value);
  }
  
  var worstEl = document.getElementById('perfWorstMonth');
  var worstValEl = document.getElementById('perfWorstMonthValue');
  if (worstEl && worstValEl) {
    worstEl.textContent = worst.label || '-';
    worstValEl.textContent = (worst.value >= 0 ? '+' : '') + formatCurrency(worst.value);
  }
  
  var countEl = document.getElementById('perfMonthCount');
  if (countEl) countEl.textContent = filtered.length;
  
  var badgeEl = document.getElementById('perfTotalBadge');
  if (badgeEl) badgeEl.textContent = 'Total: ' + formatCurrency(totalPL);
}

function renderPerfMonthDetail() {
  var container = document.getElementById('perfMonthDetail');
  if (!container) return;
  
  // Si no hay mes seleccionado → ocultar
  if (!perfSelectedMonth || !perfRendimiento) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  
  var monthKey = perfSelectedMonth;
  var monthLabel = (perfRendimiento.monthLabels && perfRendimiento.months) 
    ? perfRendimiento.monthLabels[perfRendimiento.months.indexOf(monthKey)] 
    : monthKey;
  var totalPL = perfRendimiento.totals[monthKey] || 0;
  
  // Filtrar tickers que tienen movimiento ese mes
  var tickersWithData = [];
  (perfRendimiento.tickers || []).forEach(function(t) {
    var v = t.months[monthKey];
    if (v !== undefined && v !== null && v !== 0) {
      tickersWithData.push({
        ticker: t.ticker,
        broker: t.broker,
        value: v
      });
    }
  });
  
  var winners = tickersWithData.filter(function(t) { return t.value > 0; })
    .sort(function(a, b) { return b.value - a.value; });
  var losers = tickersWithData.filter(function(t) { return t.value < 0; })
    .sort(function(a, b) { return a.value - b.value; });
  
  var totalClass = totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400';
  var totalSign = totalPL >= 0 ? '+' : '';
  
  // Generar filas de ganadores
  var winnerRowsHtml = winners.length > 0 
    ? winners.map(function(t) {
        var maxVal = winners[0].value;
        var pct = maxVal > 0 ? (t.value / maxVal) * 100 : 0;
        return '<div class="perf-detail-row">' +
          '<div class="flex items-center gap-2 min-w-0 flex-1">' +
            '<div class="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"></div>' +
            '<span class="font-bold text-xs text-slate-200 truncate">' + escapeHtml(t.ticker) + '</span>' +
            '<span class="text-[9px] text-slate-600 truncate hidden sm:inline">' + escapeHtml(t.broker) + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-3 flex-shrink-0">' +
            '<div class="hidden sm:block w-20 h-1 bg-slate-800 rounded-full overflow-hidden">' +
              '<div class="h-1 bg-emerald-500 rounded-full" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<span class="font-mono font-bold text-xs text-emerald-400 whitespace-nowrap">' +
              '+ ' + formatCurrency(t.value) +
            '</span>' +
          '</div>' +
        '</div>';
      }).join('')
    : '<p class="text-slate-600 text-xs italic px-4 py-2">Sin ganadores este mes</p>';
  
  // Generar filas de perdedores
  var loserRowsHtml = losers.length > 0
    ? losers.map(function(t) {
        var minVal = losers[0].value;
        var pct = minVal < 0 ? (t.value / minVal) * 100 : 0;
        return '<div class="perf-detail-row">' +
          '<div class="flex items-center gap-2 min-w-0 flex-1">' +
            '<div class="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0"></div>' +
            '<span class="font-bold text-xs text-slate-200 truncate">' + escapeHtml(t.ticker) + '</span>' +
            '<span class="text-[9px] text-slate-600 truncate hidden sm:inline">' + escapeHtml(t.broker) + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-3 flex-shrink-0">' +
            '<div class="hidden sm:block w-20 h-1 bg-slate-800 rounded-full overflow-hidden">' +
              '<div class="h-1 bg-rose-500 rounded-full" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<span class="font-mono font-bold text-xs text-rose-400 whitespace-nowrap">' +
              formatCurrency(t.value) +
            '</span>' +
          '</div>' +
        '</div>';
      }).join('')
    : '<p class="text-slate-600 text-xs italic px-4 py-2">Sin perdedores este mes</p>';
  
  container.classList.remove('hidden');
  container.innerHTML =
    '<div class="glass-card rounded-2xl overflow-hidden perf-fade-in">' +
      
      // Header con breadcrumb
      '<div class="px-4 sm:px-5 py-3 border-b border-slate-700/50 bg-slate-900/40 flex items-center justify-between flex-wrap gap-2">' +
        '<div class="flex items-center gap-3">' +
          '<button onclick="perfSelectedMonth=null; renderPerfMonthDetail();" class="inline-flex items-center gap-2 text-[11px] text-brand-400 hover:text-brand-300 font-semibold transition-colors">' +
            '<i class="fas fa-arrow-left text-[10px]"></i>' +
            '<span>Volver al resumen</span>' +
          '</button>' +
          '<span class="text-slate-600">•</span>' +
          '<span class="text-xs font-bold text-slate-200">' + escapeHtml(monthLabel) + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-[10px] text-slate-500 uppercase font-bold">P/L Total:</span>' +
          '<span class="font-mono font-bold text-sm ' + totalClass + '">' + totalSign + formatCurrency(totalPL) + '</span>' +
        '</div>' +
      '</div>' +
      
      // Stats rápidas
      '<div class="grid grid-cols-3 gap-0 border-b border-slate-700/50">' +
        '<div class="text-center py-3 border-r border-slate-700/30">' +
          '<p class="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Ganadores</p>' +
          '<p class="text-sm font-bold text-emerald-400 mt-0.5">' + winners.length + '</p>' +
        '</div>' +
        '<div class="text-center py-3 border-r border-slate-700/30">' +
          '<p class="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Perdedores</p>' +
          '<p class="text-sm font-bold text-rose-400 mt-0.5">' + losers.length + '</p>' +
        '</div>' +
        '<div class="text-center py-3">' +
          '<p class="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Total activos</p>' +
          '<p class="text-sm font-bold text-white mt-0.5">' + tickersWithData.length + '</p>' +
        '</div>' +
      '</div>' +
      
      // Grid de ganadores/perdedores
      '<div class="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-700/30">' +
        
        // Ganadores
        '<div>' +
          '<div class="px-4 sm:px-5 py-2.5 bg-emerald-500/5 border-b border-slate-700/30 flex items-center justify-between">' +
            '<span class="text-[10px] text-emerald-400 uppercase font-bold tracking-wider">' +
              '<i class="fas fa-caret-up mr-1"></i>Ganadores' +
            '</span>' +
            '<span class="text-[10px] text-slate-500 font-medium">' + winners.length + '</span>' +
          '</div>' +
          '<div class="max-h-[280px] overflow-y-auto allocation-legend-scroll">' +
            winnerRowsHtml +
          '</div>' +
        '</div>' +
        
        // Perdedores
        '<div>' +
          '<div class="px-4 sm:px-5 py-2.5 bg-rose-500/5 border-b border-slate-700/30 flex items-center justify-between">' +
            '<span class="text-[10px] text-rose-400 uppercase font-bold tracking-wider">' +
              '<i class="fas fa-caret-down mr-1"></i>Perdedores' +
            '</span>' +
            '<span class="text-[10px] text-slate-500 font-medium">' + losers.length + '</span>' +
          '</div>' +
          '<div class="max-h-[280px] overflow-y-auto allocation-legend-scroll">' +
            loserRowsHtml +
          '</div>' +
        '</div>' +
        
      '</div>' +
    '</div>';
}

// Hook a renderDashboard
(function hookRenderPerformance() {
  if (typeof renderDashboard !== 'function') return;
  var _original = renderDashboard;
  window.renderDashboard = function(data) {
    _original.apply(this, arguments);
    try {
      renderPerformanceOverview();
    } catch (e) {
      console.warn('[Performance] Error:', e);
    }
  };
})();

// Hook a renderDashboard
(function hookRenderDashboard() {
  if (typeof renderDashboard !== 'function') return;
  var _originalRenderDashboard = renderDashboard;
  window.renderDashboard = function(data) {
    _originalRenderDashboard.apply(this, arguments);
    try {
      initAllocation();
    } catch (e) {
      console.warn('[Allocation] Error al renderizar:', e);
    }
  };
})();