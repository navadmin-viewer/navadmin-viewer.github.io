const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const requests = [];
const types = ['NAVADMIN', 'ALNAV', 'MARADMIN', 'ALMAR'];
const linkedBody = 'Literal <tag> & source text\nSee NAVADMIN 002/25 and OPNAVINST 10126.5.';

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

function skeletons(type, year) {
  const titles = type === 'NAVADMIN' && year === 2025
    ? ['First [Campaign]', 'Second [Campaign]', 'Missing body', 'Slow missing body']
    : [type + ' ' + year + ' subject'];
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
    const form = Object.fromEntries(new URLSearchParams(input));
    requests.push({ scenario, endpoint, form });

    if (endpoint === 'messages') {
      if (caseName === 'offline') {
        respond(response, 503, 'text/plain', 'Offline fixture');
        return;
      }
      const years = {};
      const requestedYear = Number(form.yearsMetadata);
      const availableYears = caseName === 'empty' ? [2025, 2026, 2027] : [2022, 2023, 2024, 2025];
      for (const year of availableYears) {
        let msgSkeletons = null;
        if (requestedYear === year) {
          if (caseName === 'empty' && year === 2026) {
            msgSkeletons = [];
          } else if (caseName !== 'empty' || year !== 2027) {
            msgSkeletons = skeletons(form.type, year);
          }
        }
        years[year] = { msgSkeletons };
      }
      const delay = requestedYear === 2022 || requestedYear === 2024 ? 400 : 25;
      setTimeout(() => json(response, { status: 0, error: '', years }), delay);
    } else if (endpoint === 'message') {
      const number = Number(form.number);
      const missing = number === 3 || number === 4 || caseName === 'offline';
      const delay = number === 4 ? 450 : number === 2 ? 90 : 20;
      const message = number === 1 ? linkedBody : 'Body of message ' + number;
      setTimeout(() => respond(response, missing ? 404 : 200, 'text/plain', missing ? '' : message), delay);
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
  if (scenario && relative === '') {
    const endpoint = 'http://' + host + ':' + api.address().port + '/' + scenario[1];
    const denyCacheRead = scenario[1].startsWith('cacheread_') ? [
      'window.cacheReadAttempts = 0;',
      'var originalGetItem = Storage.prototype.getItem;',
      'Storage.prototype.getItem = function(key) {',
      '  if (key === "nv-cachedMessages") {',
      '    window.cacheReadAttempts++;',
      '    throw new Error("Test cache read denied");',
      '  }',
      '  return originalGetItem.call(this, key);',
      '};'
    ].join('\n') : '';
    const testSettings = '<script>server=' + JSON.stringify(endpoint) + ';' + denyCacheRead + '</script>';
    const index = fs.readFileSync(path.join(project, 'index.html'), 'utf8')
      .replace(/<script src="https:\/\/www\.gstatic\.com\/[^"]+"><\/script>/g, '')
      .replace(/<script>\s*\/\/ Your web app's Firebase configuration[\s\S]*?<\/script>/, '')
      .replace('<script src="js/custom.js"></script>', testSettings + '<script src="js/custom.js"></script>');
    respond(response, 200, 'text/html', index);
    return;
  }
  const name = path.resolve(project, relative.endsWith('/') ? relative + 'index.html' : relative);
  const contentType = fileTypes[path.extname(name)];
  const asset = /^(?:js\/|css\/|assets\/|view-message\/|tests\/browser-tests\.js$|manifest\.json$|favicon\.ico$)/;
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
