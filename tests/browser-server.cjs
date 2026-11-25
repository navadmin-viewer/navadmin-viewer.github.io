const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const requests = [];
const pendingFirebase = new Map();
const firebaseCases = /^(firebaseorder|firebasecorefailure|firebaseanalyticsfailure)_/;
const firebaseSDKs = {
  'firebase-app-compat.js': [
    'window.fixtureFirebaseTrace.push("app-sdk");',
    'window.firebase = { initializeApp: function() { window.fixtureFirebaseTrace.push("initializeApp"); } };'
  ].join('\n'),
  'firebase-analytics-compat.js': [
    'window.fixtureFirebaseTrace.push("analytics-sdk");',
    'window.firebase.analytics = function() {',
    '  window.fixtureFirebaseTrace.push("analytics");',
    '  return { logEvent: function(name) { window.fixtureFirebaseTrace.push(name); } };',
    '};'
  ].join('\n')
};
const types = ['NAVADMIN', 'ALNAV', 'MARADMIN', 'ALMAR'];
const linkedMessageBody = 'Literal <tag> & source text\nSee NAVADMIN 002/25 and OPNAVINST 10126.5.';
const searchMessageBody = 'A literal [Needle]+ <img src=x onerror="window.fixtureMarkupRan=true"> & more.\nSecond line.';
const sharedStorage = {
  offline: 'main',
  bulkresume: 'bulk',
  bulkoffline: 'bulk',
  fuzzylateload: 'fuzzyoffline',
  fuzzyunavailable: 'fuzzyoffline',
  quotaevictionoffline: 'quotaeviction',
  quotaoffline: 'quota',
  writefallbackseed: 'writefallback',
  writefallbackoffline: 'writefallback'
};
const offlineCases = ['offline', 'bulkoffline', 'fuzzyoffline', 'fuzzylateload', 'fuzzyunavailable',
  'quotaevictionoffline', 'quotaoffline', 'writefallbackoffline'];

function respond(response, status, contentType, content) {
  response.writeHead(status, {
    'Content-Type': contentType + '; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(content);
}

function json(response, data) {
  respond(response, 200, 'application/json', JSON.stringify(data));
}

function skeletons(type, year, caseName) {
  const titles = type === 'NAVADMIN' && year === 2025
    ? ['First [Campaign]', 'Second [Campaign]', 'Missing body', 'Slow missing body']
    : [type + ' ' + year + ' subject'];
  if ((caseName === 'priority' || caseName === 'waitinganimation') && type === 'NAVADMIN' && year === 2025) {
    // Keep old-year work queued even in IE11 while its connection pool serves the new year list.
    titles.push('Third cached body', 'Fourth cached body', 'Queued body 7', 'Queued body 8',
      'Queued body 9', 'Queued body 10', 'Fast body');
  }
  if (caseName === 'waitinganimation' && type === 'NAVADMIN' && year === 2024) {
    titles.push('2024 queued body 2', '2024 queued body 3', '2024 queued body 4');
  }
  return titles.map((title, index) => ({
    type: types.indexOf(type), year, number: index + 1, title,
    cancelled: index === 0,
    actSum: index === 0 ? [{ actType: 'view', actNumber: 37 }] : []
  }));
}

const api = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  const route = request.url.match(/^\/([\w-]+)\/(messages|message|broadcast|updateUserInfo|updateUserActivity)$/);
  if (!route) {
    respond(response, 404, 'text/plain', 'Unknown API route');
    return;
  }

  const [ , scenario, endpoint ] = route;
  const caseName = scenario.split('_')[0];
  let input = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { input += chunk; });
  request.on('end', () => {
    const fields = new URLSearchParams(input);
    const form = Object.fromEntries(fields);
    const requestedYears = fields.getAll('yearsMetadata').map(Number);
    if (requestedYears.length > 1) form.yearsMetadata = fields.getAll('yearsMetadata');
    const recorded = { scenario, endpoint, form };
    requests.push(recorded);

    if (endpoint === 'messages') {
      if (offlineCases.includes(caseName)) {
        respond(response, 503, 'text/plain', 'Offline fixture');
        return;
      }
      const years = {};
      const availableYears = caseName === 'empty' ? [2025, 2026, 2027] : [2022, 2023, 2024, 2025];
      for (const year of availableYears) {
        let msgSkeletons = null;
        if (requestedYears.includes(year)) {
          if (caseName === 'empty' && year === 2026) {
            msgSkeletons = [];
          } else if (caseName !== 'empty' || year !== 2027) {
            msgSkeletons = skeletons(form.type, year, caseName);
          }
        }
        years[year] = { msgSkeletons };
      }
      const delay = requestedYears.length === 1 && (requestedYears[0] === 2022 || requestedYears[0] === 2024) ? 400 : 25;
      setTimeout(() => json(response, { status: 0, error: '', years }), delay);
    } else if (endpoint === 'message') {
      const number = Number(form.number);
      const bulk = caseName === 'bulk' || caseName === 'bulkresume';
      const bulkSelectedYear = bulk && form.type === 'NAVADMIN' && form.year === '2025';
      const attempt = requests.filter(row => row.scenario === scenario && row.endpoint === endpoint &&
        row.form.type === form.type && row.form.year === form.year && row.form.number === form.number).length;
      let status = number === 3 || number === 4 ? 404 : 200;
      if (offlineCases.includes(caseName) || (bulkSelectedYear && number === 4 && (caseName === 'bulk' || attempt === 1))) {
        status = 503;
      } else if (bulkSelectedYear && number === 4) {
        status = 200;
      }
      if (caseName === 'restoredsearch' && number === 3) status = 200;
      let delay = number === 4 ? 450 : number === 2 ? 90 : 20;
      if (caseName === 'modal' && number === 3) delay = 350;
      if (caseName === 'modal' && number === 4) delay = 1300;
      if (caseName.indexOf('blank') === 0 && number === 2) delay = 350;
      if (bulkSelectedYear) delay = number * 125;
      if (caseName === 'priority' && form.year === '2025') {
        delay = { 9: 1900, 11: 130 }[number] || (number >= 8 ? 900 : 250);
      }
      if (caseName === 'waitinganimation') delay = form.year === '2024' ? 1600 : number === 11 ? 130 : 750;
      if (caseName === 'searchburst') delay = 600;
      if (caseName === 'sessioncache') delay += 300;
      let messageBody = bulkSelectedYear && number === 2 ? searchMessageBody : number === 1 ? linkedMessageBody : 'Body of message ' + number;
      if (caseName === 'searchburst') messageBody += '\nAnother cross-year hit';
      if (caseName === 'restoredsearch') messageBody = linkedMessageBody;
      setTimeout(() => {
        recorded.httpStatus = status;
        respond(response, status, 'text/plain', status === 200 ? messageBody : '');
      }, delay);
    } else if (endpoint === 'updateUserInfo') {
      const attempts = requests.filter(row => row.scenario === scenario && row.endpoint === endpoint).length;
      const fail = caseName === 'activity' && attempts === 1;
      setTimeout(() => json(response, { status: fail ? 1 : 0 }), fail ? 20 : 250);
    } else if (endpoint === 'updateUserActivity') {
      json(response, { status: 0 });
    } else {
      respond(response, 200, 'text/plain', '');
    }
  });
});

const fileTypes = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function storageSettings(scenario) {
  const separator = scenario.indexOf('_');
  const caseName = scenario.slice(0, separator);
  const storageCase = sharedStorage[caseName] || caseName;
  const namespace = JSON.stringify(storageCase + scenario.slice(separator) + ':');
  const denyStorage = caseName === 'nostorage';
  const denyIndexedDB = denyStorage || caseName === 'sessioncache';
  const denyCacheRead = caseName === 'cacheread';
  const denyMessageBodyWrites = caseName === 'writefallback';
  const fillStorage = caseName === 'quota';
  return [
    '(function() {',
    '  var namespace = ' + namespace + ';',
    '  var database = window.indexedDB || window.msIndexedDB;',
    '  if (database) {',
    '    var originalOpen = database.open;',
    '    database.open = function(name, version) {',
    denyIndexedDB ? '      throw new Error("Test IndexedDB disabled");' : '',
    '      return version === undefined ? originalOpen.call(this, namespace + name) :',
    '        originalOpen.call(this, namespace + name, version);',
    '    };',
    '  }',
    denyCacheRead || fillStorage ? [
      '  var messageBodyWrites = 0;',
      '  var originalTransaction = IDBDatabase.prototype.transaction;',
      '  IDBDatabase.prototype.transaction = function(stores, mode) {',
      denyCacheRead ? '    if (mode === "readonly" && stores.indexOf("statuses") !== -1) {' +
        ' window.cacheReadAttempts = 1; throw new Error("Test IndexedDB cache read denied"); }' : '',
      fillStorage ? '    if (mode === "readwrite" && stores.indexOf("bodies") !== -1 && ++messageBodyWrites > 2) {' +
        ' var error = new Error("Test IndexedDB cache is full"); error.name = "QuotaExceededError"; throw error; }' : '',
      '    return originalTransaction.apply(this, arguments);',
      '  };'
    ].join('\n') : '',
    denyMessageBodyWrites ? [
      '  window.deniedDatabaseMessageBodyWrites = 0;',
      '  var originalPut = IDBObjectStore.prototype.put;',
      '  IDBObjectStore.prototype.put = function() {',
      '    var request = originalPut.apply(this, arguments);',
      '    if (this.name === "bodies") {',
      '      var transaction = this.transaction;',
      '      request.onsuccess = function() {',
      '        window.deniedDatabaseMessageBodyWrites++;',
      '        transaction.abort();',
      '      };',
      '    }',
      '    return request;',
      '  };'
    ].join('\n') : '',
    denyStorage ? [
      '  ["getItem", "setItem", "removeItem"].forEach(function(method) {',
      '    Storage.prototype[method] = function() { throw new Error("Test localStorage disabled"); };',
      '  });'
    ].join('\n') : '',
    '}());'
  ].join('\n');
}

const web = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://' + host);
  if (url.pathname === '/__results') {
    let result = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { result += chunk; });
    request.on('end', () => {
      process.stdout.write(result + '\n');
      respond(response, 200, 'text/plain', 'Recorded');
    });
    return;
  }
  if (url.pathname === '/__requests') {
    json(response, requests.filter(row => row.scenario === url.searchParams.get('case')));
    return;
  }
  if (url.pathname === '/__releaseFirebase') {
    const key = url.searchParams.get('case') + '/' + url.searchParams.get('sdk');
    const send = pendingFirebase.get(key);
    pendingFirebase.set(key, true);
    if (typeof send === 'function') send();
    respond(response, 200, 'text/plain', 'Released');
    return;
  }
  if (url.pathname === '/') {
    respond(response, 200, 'text/html',
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge">' +
      '<title>Viewer browser regressions</title></head><body>' +
      '<h1>Viewer browser regressions</h1><pre id="results">Running…</pre>' +
      '<script src="/tests/browser-tests.js"></script></body></html>');
    return;
  }

  const scenario = url.pathname.match(/^\/case\/([\w-]+)\/(.*)$/);
  const relative = scenario ? scenario[2] : url.pathname.slice(1);
  const firebaseCase = scenario && firebaseCases.exec(scenario[1]);
  const firebaseSDK = firebaseCase && /^firebase-fixture\/(firebase-(?:app|analytics)-compat\.js)$/.exec(relative);
  if (firebaseSDK) {
    const sdk = firebaseSDK[1];
    const caseName = firebaseCase[1];
    if (caseName === 'firebasecorefailure' || (caseName === 'firebaseanalyticsfailure' && sdk === 'firebase-analytics-compat.js')) {
      respond(response, 503, 'text/plain', 'Firebase SDK unavailable');
      return;
    }

    const key = scenario[1] + '/' + sdk;
    const send = () => respond(response, 200, 'application/javascript', firebaseSDKs[sdk]);
    if (caseName === 'firebaseorder' && pendingFirebase.get(key) !== true) {
      pendingFirebase.set(key, send);
      response.once('close', () => {
        if (pendingFirebase.get(key) === send) pendingFirebase.delete(key);
      });
      return;
    }
    send();
    return;
  }
  if (scenario && scenario[1].startsWith('fuzzyunavailable_') && relative === 'js/message-search-fuzzy.js') {
    respond(response, 404, 'text/plain', 'Optional search module unavailable');
    return;
  }
  if (scenario && (relative === '' || relative === 'index.html')) {
    const endpoint = 'http://' + host + ':' + api.address().port + '/' + scenario[1];
    const queueTrace = /^(priority|waitinganimation)_/.test(scenario[1]) ? [
      'window.fixtureQueueStarts = [];',
      'window.fixtureQueuePeak = 0;',
      'var fixtureGetMessageBody = getMessageBody;',
      'getMessageBody = function(type, year, number, onDone, background) {',
      '  var trace = {',
      '    key: year + "/" + number,',
      '    selectedYear: document.getElementById("msg-year-dropdown-label").textContent,',
      '    selectedListReady: !!Navadmin.messageStore.messages(type, 2024)',
      '  };',
      '  window.fixtureQueueStarts.push(trace);',
      '  var active = window.fixtureQueueStarts.filter(function(item) { return !item.settled; }).length;',
      '  window.fixtureQueuePeak = Math.max(window.fixtureQueuePeak, active);',
      '  return fixtureGetMessageBody(type, year, number, function() {',
      '    trace.settled = true;',
      '    if (onDone) onDone.apply(this, arguments);',
      '  }, background);',
      '};'
    ].join('\n') : '';
    const restoredSearch = /^restoredsearch_/.test(scenario[1]) ? [
      'document.getElementById("msg-search-input").value = "source text";',
      'window.fixtureSearchSpinnerShows = 0;',
      'var fixtureSearchObserver = new MutationObserver(function(records) {',
      '  records.forEach(function(record) {',
      '    if (record.oldValue !== null) window.fixtureSearchSpinnerShows++;',
      '  });',
      '});',
      'fixtureSearchObserver.observe(document.getElementById("message-search-spinner"), {',
      '  attributes: true, attributeFilter: ["hidden"], attributeOldValue: true',
      '});',
      'window.fixtureHeldMessageBodyWrites = {};',
      'var fixtureStore = Navadmin.messageStore;',
      'var fixtureListMessageBodyRecords = fixtureStore.listMessageBodyRecords;',
      'var fixtureSaveMessageBodyResult = fixtureStore.saveMessageBodyResult;',
      'fixtureStore.listMessageBodyRecords = function(type, year, callback) {',
      '  fixtureStore.listMessageBodyRecords = fixtureListMessageBodyRecords;',
      '  fixtureListMessageBodyRecords(type, year, function(records) {',
      '    window.fixtureFinishMessageBodyRead = function() { callback(records); };',
      '  });',
      '};',
      'fixtureStore.saveMessageBodyResult = function(type, year, number) {',
      '  var args = arguments;',
      '  if (year === 2025 && (number === 2 || number === 3)) {',
      '    window.fixtureHeldMessageBodyWrites[number] = function() { fixtureSaveMessageBodyResult.apply(fixtureStore, args); };',
      '  } else {',
      '    fixtureSaveMessageBodyResult.apply(fixtureStore, args);',
      '  }',
      '};'
    ].join('\n') : '';
    const holdMiniSearch = scenario[1].startsWith('fuzzylateload_') ? [
      '<script>(function() {',
      '  var head = document.head;',
      '  var appendChild = head.appendChild;',
      '  head.appendChild = function(node) {',
      '    if (!/\\/external\\/minisearch-[^/]+\\.js$/.test(node.src)) return appendChild.call(head, node);',
      '    head.appendChild = appendChild;',
      '    window.fixtureReleaseMiniSearch = function() { appendChild.call(head, node); };',
      '    return node;',
      '  };',
      '}());</script>'
    ].join('\n') : '';
    const firebaseTrace = firebaseCase ? [
      'window.fixtureFirebaseTrace = [];',
      'window.fixtureFirebaseFailures = [];',
      'window.fixtureFirebaseErrors = [];',
      'window.addEventListener("error", function(event) {',
      '  if (event.message) window.fixtureFirebaseErrors.push(event.message);',
      '  var source = event.target && event.target.src;',
      '  if (source && source.indexOf("/firebase-fixture/") !== -1) {',
      '    window.fixtureFirebaseFailures.push(source.split("/").pop());',
      '  }',
      '}, true);'
    ].join('\n') : '';
    const testSettings = '<script>server=' + JSON.stringify(endpoint) + ';\n' + queueTrace + '\n' + restoredSearch + '\n' + firebaseTrace + '</script>';
    const index = fs.readFileSync(path.join(project, 'index.html'), 'utf8')
      .replace(/<script id="firebase-analytics-bootstrap">[\s\S]*?<\/script>/, script => firebaseCase
        ? script.replace(/https:\/\/www\.gstatic\.com\/firebasejs\/9\.8\.0\/(firebase-(?:app|analytics)-compat\.js)/g, 'firebase-fixture/$1')
        : '')
      .replace('<script src="js/message-store.js"></script>',
        '<script>' + storageSettings(scenario[1]) + '</script><script src="js/message-store.js"></script>')
      .replace('<script src="js/message-search-fuzzy.js"></script>',
        holdMiniSearch + '<script src="js/message-search-fuzzy.js"></script>')
      .replace('<script src="js/custom.js"></script>', testSettings + '<script src="js/custom.js"></script>');
    respond(response, 200, 'text/html', index);
    return;
  }
  const name = path.resolve(project, relative.endsWith('/') ? relative + 'index.html' : relative);
  const contentType = fileTypes[path.extname(name)];
  const asset = /^(?:js\/|css\/|assets\/|view-message\/|pfa-calculator\/|tests\/browser-tests\.js$|manifest\.json$|favicon\.ico$)/;
  if (!asset.test(relative) || !name.startsWith(project + path.sep) || !contentType || !fs.existsSync(name)) {
    respond(response, 404, 'text/plain', 'Not found');
    return;
  }
  respond(response, 200, contentType, fs.readFileSync(name));
});

api.listen(0, host, () => {
  web.listen(Number(process.env.VIEWER_TEST_PORT || 0), host, () => {
    console.log('Open http://' + host + ':' + web.address().port + '/ to run viewer browser regressions.');
  });
});
