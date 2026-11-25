// Run with node tests/browser-server.cjs and open its printed URL.
// This driver uses ES5 so the same cases can run inside IE11 document mode.
(function () {
  var output = document.getElementById('results');
  var frame = document.createElement('iframe');
  var steps = [];
  var passed = [];
  var app;
  var reported = false;
  var mode = document.documentMode || 'modern';
  var cacheKey = 'nv-cachedMessages';
  var runId = '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  var linkedMessageBody = 'Literal <tag> & source text\nSee NAVADMIN 002/25 and OPNAVINST 10126.5.';
  var searchMessageBody = 'A literal [Needle]+ <img src=x onerror="window.fixtureMarkupRan=true"> & more.\nSecond line.';
  var viewerURL = 'https://navadmin-viewer.github.io/';
  var homeTitle = 'NAVADMIN Viewer | Search Navy & Marine Corps Messages';
  var homeDescription = 'Read U.S. Navy and Marine Corps messages online. Search NAVADMIN, ALNAV, MARADMIN, and ALMAR by title or full text.';
  var firstMessageTitle = 'NAVADMIN 001/25 \u2013 First [Campaign] | NAVADMIN Viewer App';

  frame.title = 'Viewer under test';
  frame.style.width = '100%';
  frame.style.height = '560px';
  document.body.appendChild(frame);

  function report(message) {
    if (reported) return;
    reported = true;
    var result = message + ' (document mode ' + mode + ')\n' + passed.join('\n');
    output.textContent = result;
    var request = new XMLHttpRequest();
    request.open('POST', '/__results', true);
    request.send(result);
  }

  window.onerror = function (message) {
    report('FAIL: ' + message);
  };

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function waitFor(condition, next) {
    var deadline = Date.now() + 8000;
    function check() {
      if (reported) return;
      try {
        if (condition()) return next();
        if (Date.now() > deadline) {
          var state = app && app.jQuery ? ' at ' + app.location.search + ' with modal text ' + modalText() : '';
          throw new Error('Timed out waiting for the expected viewer state' + state);
        }
        setTimeout(check, 20);
      } catch (error) {
        report('FAIL: ' + currentStep + ': ' + error.message);
      }
    }
    check();
  }

  function watchViewerLoad(ready, next) {
    frame.onload = function () {
      app = frame.contentWindow;
      if (!app.jQuery) return;
      frame.onload = null;
      app.onerror = function (message) { report('FAIL: ' + currentStep + ': ' + message); };
      assert((app.document.documentMode || 'modern') === mode, 'The viewer used a different document mode from the test page');
      waitFor(ready, next);
    };
  }

  function open(scenario, url, ready, next) {
    watchViewerLoad(ready, next);
    frame.src = '/case/' + scenario + runId + '/' + url;
  }

  function select(selector) {
    return app.jQuery(selector);
  }

  function menuItem(id, label) {
    var item = select('#' + id + '-dropdown-menu a').filter(function () {
      var link = app.jQuery(this);
      var yearLabel = link.find('.message-year-label');
      return (yearLabel.length ? yearLabel.text() : link.text()) === label;
    });
    assert(item.length === 1, 'Expected one menu item for ' + label);
    return item;
  }

  function clickMenu(id, label) {
    menuItem(id, label).trigger('click');
  }

  function messageLink(title) {
    var link = select('#msg-list-table-body a').filter(function () {
      return app.jQuery(this).text() === title;
    });
    assert(link.length === 1, 'Expected one message titled ' + title);
    return link;
  }

  function clickRow(title) {
    messageLink(title).trigger('click');
  }

  function isFocused(element) {
    return app.document.activeElement === element;
  }

  function focus(element) {
    element.focus();
    assert(isFocused(element), 'Could not focus the test control');
  }

  function tableHas(title) {
    return select('#msg-list-table-body').text().indexOf(title) !== -1;
  }

  function visibleRows() {
    return select('#msg-list-table-body tr:visible');
  }

  function searchSpinnerVisible() {
    return select('#message-search-spinner').is(':visible');
  }

  function assertSearchLoading() {
    var spinner = select('span#message-search-spinner');
    var header = spinner.parent('th');
    var titleHeader = select('#msg-list-table-body').closest('table').find('thead th')[1];
    var title = spinner[0] && spinner[0].previousSibling;
    assert(spinner.length === 1 && spinner.is(':visible') && spinner.attr('role') === 'status' &&
      header[0] === titleHeader && title && title.textContent.trim() === 'Title',
      'Expected one visible search spinner after Title in the column header');
    assert(!select('#msg-list-table-body').find('#message-search-loading-row, .spinner-border').length,
      'The search spinner added a loading row to the results');
  }

  function searchFor(query) {
    select('#msg-search-input').val(query).trigger('input');
  }

  function supportsFuzzySearch() {
    try {
      return !document.documentMode && new RegExp('\\p{L}', 'u').test('A');
    } catch (error) {
      return false;
    }
  }

  function listMessageBodyRequests(requests) {
    return requests.filter(function (request) { return request.endpoint === 'message'; });
  }

  function yearProgress(year) {
    return menuItem('msg-year', year).find('.message-year-progress').text().trim();
  }

  function yearComplete(year) {
    return menuItem('msg-year', year).find('.message-year-complete').text().trim() === '\u2713';
  }

  function warningProgress(year, count) {
    return yearProgress(year) === count &&
      menuItem('msg-year', year).find('.message-year-progress-fill').hasClass('bg-warning');
  }

  function assertYearButtonProgress(year) {
    var button = select('#msg-year-dropdown');
    var strip = button.find('#msg-year-dropdown-progress');
    var menuProgress = menuItem('msg-year', year).find('.message-year-progress');
    assert(strip.length === 1 && !strip.prop('hidden') && strip.is(':visible') &&
      button.find('#msg-year-dropdown-label').text() === year,
      'Expected a visible progress strip with an unchanged year label');
    var checkmark = button.find('#msg-year-dropdown-complete');
    assert(checkmark.prop('hidden') && !checkmark.is(':visible'), 'The year toggle showed completion while displaying progress');
    ['aria-valuenow', 'aria-valuemax', 'aria-valuetext'].forEach(function (name) {
      assert(strip.attr(name) === menuProgress.attr(name), 'The year toggle progress did not match the menu for ' + name);
    });
    ['message-year-progress-active', 'message-year-progress-temporary'].forEach(function (name) {
      assert(strip.hasClass(name) === menuProgress.hasClass(name), 'The year toggle progress did not match the menu for ' + name);
    });
    var descriptionId = 'msg-year-dropdown-progress-description';
    assert(strip.attr('aria-hidden') === 'true' && button.attr('aria-describedby') === descriptionId &&
      select('#' + descriptionId).text().indexOf(menuProgress.attr('aria-valuetext')) !== -1,
      'The year toggle did not describe its download progress outside the visual strip');
  }

  function modalShown() {
    var modal = select('#message-body-modal');
    var controller = modal.data('bs.modal');
    return modal.hasClass('show') && controller && !controller._isTransitioning;
  }

  function modalText() {
    var modalBody = select('#message-body-modal .modal-body');
    var field = modalBody.find('textarea');
    return field.length ? field.val() : modalBody.text();
  }

  function closeModal() {
    select('#message-body-modal button[data-dismiss="modal"]').last().trigger('click');
  }

  function messageRoute(number) {
    return app.location.search.indexOf('&number=' + number) !== -1;
  }

  function assertCanonical(query) {
    var links = app.document.querySelectorAll('link[rel="canonical"]');
    var expected = viewerURL + (query || '');
    assert(links.length === 1, 'Unexpected canonical link count for ' + app.location.search + ': ' + links.length);
    assert(links[0].parentNode === app.document.head && links[0].getAttribute('href') === expected,
      'Expected canonical ' + expected + ' but found ' + links[0].getAttribute('href'));
  }

  function assertTitle(viewerDocument, expected) {
    assert(viewerDocument.title === expected, 'Expected title ' + expected + ' but found ' + viewerDocument.title);
  }

  function assertHomeMetadata(viewerDocument) {
    var description = viewerDocument.querySelector('meta[name="description"]');
    assertTitle(viewerDocument, homeTitle);
    assert(description && description.getAttribute('content') === homeDescription, 'The homepage description was incorrect');
    assertOpenGraphMetadata(viewerDocument, homeDescription);
  }

  function assertOpenGraphMetadata(viewerDocument, description) {
    var ogTitle = viewerDocument.querySelector('meta[property="og:title"]');
    var ogDescription = viewerDocument.querySelector('meta[property="og:description"]');
    assert(ogTitle && ogTitle.getAttribute('content') === viewerDocument.title, 'Open Graph should match the page title');
    assert(ogDescription && ogDescription.getAttribute('content') === description, 'Open Graph should match the page description');
  }

  function assertWebsiteStructuredData(viewerDocument) {
    var scripts = viewerDocument.head.querySelectorAll('script[type="application/ld+json"]');
    assert(scripts.length === 1, 'The homepage should declare one structured data block');
    var website = JSON.parse(scripts[0].textContent);
    assert(website['@context'] === 'https://schema.org' && website['@type'] === 'WebSite' &&
      website.name === 'NAVADMIN Viewer' && website.url === viewerURL, 'The homepage WebSite data was incorrect');
  }

  function assertNoBreadcrumbStructuredData() {
    assert(!app.document.getElementById('viewer-breadcrumb-structured-data'),
      'Unexpected breadcrumb structured data at ' + app.location.pathname + app.location.search);
  }

  function assertBreadcrumbStructuredData(expected) {
    var scripts = app.document.querySelectorAll('script#viewer-breadcrumb-structured-data[type="application/ld+json"]');
    assert(scripts.length === 1, 'Expected one breadcrumb structured data block');
    var schema = JSON.parse(scripts[0].textContent);
    assert(schema['@context'] === 'https://schema.org' && schema['@type'] === 'BreadcrumbList' &&
      schema.itemListElement.length === expected.length, 'The breadcrumb structured data did not describe the current route');
    expected.forEach(function (crumb, index) {
      var label = crumb[0];
      var url = viewerURL + crumb[1];
      var item = schema.itemListElement[index];
      assert(item['@type'] === 'ListItem' && item.position === index + 1 && item.name === label && item.item === url,
        'The structured data entry for ' + label + ' was incorrect');
    });
  }

  function recordRequests(scenario, done) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__requests?case=' + scenario + runId, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        assert(xhr.status === 200, 'Failed to read fixture requests');
        done(JSON.parse(xhr.responseText));
      }
    };
    xhr.send();
  }

  function openFirebaseMessage(scenario, sdkReady, next) {
    var viewerPath = '/case/' + scenario + runId + '/';
    frame.onload = null;
    frame.src = viewerPath + '?type=NAVADMIN&year=2025&number=1';
    // An outstanding script can hold the iframe load event even after the viewer can be used.
    waitFor(function () {
      app = frame.contentWindow;
      return app.location.pathname === viewerPath && app.fixtureFirebaseTrace && app.jQuery &&
        modalShown() && modalText() === linkedMessageBody && app.viewRegistrationSucceeded &&
        app.jQuery.active === 0 && sdkReady();
    }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=1');
      assertBreadcrumbStructuredData([['NAVADMIN', '?type=NAVADMIN'], ['2025', '?type=NAVADMIN&year=2025'],
        ['NAVADMIN 001/25', '?type=NAVADMIN&year=2025&number=1']]);
      recordRequests(scenario, function (requests) {
        assert(requests.some(function (request) {
          return request.endpoint === 'updateUserActivity' && request.form.activityMsgNumber === '1';
        }), 'Firebase delayed or prevented the viewer API from recording a view');
        next();
      });
    });
  }

  function firebaseScripts(sdk) {
    return app.document.querySelectorAll('script[src$="firebase-fixture/' + sdk + '"]');
  }

  function releaseFirebase(scenario, sdk, next) {
    var request = new XMLHttpRequest();
    request.open('POST', '/__releaseFirebase?case=' + scenario + runId + '&sdk=' + sdk, true);
    request.onload = function () {
      assert(request.status === 200, 'Could not release the held Firebase response');
      next();
    };
    request.onerror = function () { report('FAIL: Could not release the held Firebase response'); };
    request.send();
  }

  function firstCacheMessages() {
    var messages = ['Old subject', 'Second [Campaign]', 'Missing body', 'Slow missing body'].map(function (title, index) {
      return { type: 0, year: 2025, number: index + 1, title: title, cancelled: false, actSum: [] };
    });
    messages[0].Body = linkedMessageBody;
    return messages;
  }

  function messagesWithBlankCachedBodies() {
    var messageBodies = [linkedMessageBody, '', '\r\n \t'];
    return ['First [Campaign]', 'Second [Campaign]', 'Missing body'].map(function (title, index) {
      return { type: 0, year: 2025, number: index + 1, title: title, Body: messageBodies[index] };
    });
  }

  function seedMessageDatabase(scenario, version, years, done) {
    var database = window.indexedDB || window.msIndexedDB;
    var request = database.open(scenario + runId + ':nv-messageCache', version);
    request.onupgradeneeded = function () {
      var db = request.result;
      var metadata = db.createObjectStore('metadata');
      var persistentMessageBodyRecordStore = db.createObjectStore('bodies');
      var statuses = db.createObjectStore('statuses');
      var now = Date.now();
      years.forEach(function (entry) {
        entry.messages.forEach(function (message) {
          if (typeof message.Body !== 'string') return;
          var key = 'NAVADMIN/' + entry.year + '/' + message.number;
          persistentMessageBodyRecordStore.put({ type: 0, year: entry.year, number: message.number, status: 200, body: message.Body, savedAt: now }, key);
          statuses.put({ status: 200, savedAt: now }, key);
          delete message.Body;
        });
        metadata.put({ type: 0, year: entry.year, messages: entry.messages }, 'NAVADMIN/' + entry.year);
      });
    };
    request.onsuccess = function () {
      request.result.close();
      done();
    };
    request.onerror = function () { report('FAIL: Could not seed message records'); };
  }

  function verifyBlankCacheRepair(scenario, done) {
    open(scenario, '?type=NAVADMIN&year=2025', function () { return tableHas('First [Campaign]'); }, function () {
      function isDownloaded(title) {
        return messageLink(title).closest('tr').find('th').hasClass('offline-enabled');
      }
      assert(isDownloaded('First [Campaign]'), 'Repair lost a valid cached message body');
      assert(!isDownloaded('Second [Campaign]') && !isDownloaded('Missing body'), 'A blank message body was marked downloaded');
      clickRow('Second [Campaign]');
      waitFor(function () {
        return modalShown() && modalText() === 'Body of message 2' && yearComplete('2025');
      }, function () {
        assert(isDownloaded('Second [Campaign]') && !isDownloaded('Missing body'), 'Message body and 404 statuses were confused');
        recordRequests(scenario, function (requests) {
          var messageBodyRequests = listMessageBodyRequests(requests);
          assert(!messageBodyRequests.some(function (request) { return request.form.number === '1'; }), 'Repair redownloaded valid text');
          assert(messageBodyRequests.some(function (request) { return request.form.number === '2' && request.httpStatus === 200; }) &&
            messageBodyRequests.some(function (request) { return request.form.number === '3' && request.httpStatus === 404; }),
            'An invalid cached message body did not trigger a fresh request');
          done();
        });
      });
    });
  }

  steps.push(['Serve descriptive homepage metadata in the initial HTML', function (done) {
    var request = new XMLHttpRequest();
    request.open('GET', '/case/metadata' + runId + '/', true);
    request.responseType = 'document';
    request.onload = function () {
      assert(request.status === 200 && request.response, 'Could not read the homepage document');
      assertHomeMetadata(request.response);
      assertWebsiteStructuredData(request.response);
      done();
    };
    request.onerror = function () { report('FAIL: Could not load the homepage HTML'); };
    request.send();
  }]);

  steps.push(['Repair blank entries already stored by IndexedDB version 1', function (done) {
    seedMessageDatabase('blankidb', 1, [{ year: 2025, messages: messagesWithBlankCachedBodies() }], function () {
      verifyBlankCacheRepair('blankidb', done);
    });
  }]);

  steps.push(['Reload the repaired persistent store and search the preserved message text', function (done) {
    closeModal();
    waitFor(function () { return !modalShown() && !messageRoute(2); }, function () {
      recordRequests('blankidb', function (initialRequests) {
        watchViewerLoad(function () { return tableHas('First [Campaign]') && yearComplete('2025'); }, function () {
          assert(messageLink('First [Campaign]').closest('tr').find('th').hasClass('offline-enabled'),
            'The saved download indicator was lost on reload');
          assert(messageLink('Second [Campaign]').closest('tr').find('th').hasClass('offline-enabled'),
            'The downloaded replacement message body was lost on reload');
          assert(!messageLink('Missing body').closest('tr').find('th').hasClass('offline-enabled'),
            'Reload marked an unavailable message body downloaded');
          assert(select('#msg-search-scope-dropdown .message-search-scope-label').text() === 'Full Message' &&
            select('#msg-search-scope-full-message').attr('aria-checked') === 'true', 'Full Message was not selected by default');
          searchFor('SOURCE TEXT');
          waitFor(function () { return visibleRows().find('.message-search-snippet mark').text() === 'source text'; }, function () {
            assert(visibleRows().length === 1 && visibleRows().find('a').text() === 'First [Campaign]',
              'Full Message did not match the preserved message body after reload');
            recordRequests('blankidb', function (requests) {
              assert(listMessageBodyRequests(requests).length === listMessageBodyRequests(initialRequests).length,
                'Reload or Full Message search re-requested a settled message body');
              done();
            });
          });
        });
        app.location.reload();
      });
    });
  }]);

  steps.push(['Refresh existing metadata and preserve an old offline cache', function (done) {
    seedMessageDatabase('main', 2, [{ year: 2025, messages: firstCacheMessages() }], function () {
      open('main', '', function () { return tableHas('First [Campaign]'); }, function () {
        assertCanonical();
        assertHomeMetadata(app.document);
        assertNoBreadcrumbStructuredData();
        var row = select('#msg-list-table-body tr').last();
        assert(row.hasClass('table-danger'), 'Cancellation was not refreshed');
        assert(row.text().indexOf('37') >= 0, 'View count was not refreshed');
        assert(row.find('th').hasClass('offline-enabled'), 'Existing offline message body was lost');
        done();
      });
    });
  }]);

  steps.push(['Search titles literally and clear the filter', function (done) {
    var spinner = select('#message-search-spinner')[0];
    assert(spinner && spinner.hidden && !searchSpinnerVisible(), 'Expected the header spinner to start hidden');
    select('#msg-search-scope-title').trigger('click');
    var search = select('#msg-search-input');
    var existingRow = messageLink('First [Campaign]').closest('tr')[0];
    search.val('[campaign]').trigger('paste');
    waitFor(searchSpinnerVisible, function () {
      assertSearchLoading();
      assert(visibleRows().length === 4 && messageLink('First [Campaign]').closest('tr')[0] === existingRow,
        'Showing the search spinner replaced the existing message rows');
      waitFor(function () { return !searchSpinnerVisible() && visibleRows().length === 2; }, function () {
        assert(select('#message-search-spinner')[0] === spinner, 'Finishing the search replaced the header spinner');
        search.val('').trigger('input').trigger('keyup');
        assert(visibleRows().length === 4, 'Clearing search did not restore all rows');
        search.val('[').trigger('input').trigger('keyup');
        assertSearchLoading();
        searchFor('');
        assert(!searchSpinnerVisible() && visibleRows().length === 4,
          'Clearing a pending search did not immediately restore the complete list');
        searchFor('[');
        waitFor(function () { return !searchSpinnerVisible() && visibleRows().length === 2; }, function () {
          searchFor('');
          done();
        });
      });
    });
  }]);

  steps.push(['Search titles in every year of the selected message type', function (done) {
    open('crossyearsearch', '?type=NAVADMIN&year=2025', function () { return tableHas('First [Campaign]'); }, function () {
      select('#msg-search-scope-title').trigger('click');
      searchFor('202');
      waitFor(function () { return visibleRows().length === 3; }, function () {
        assert(tableHas('NAVADMIN 2024 subject') && tableHas('NAVADMIN 2022 subject'), 'Title search missed another year');
        assert(select('#msg-year-dropdown-label').text() === '2025', 'Title search changed the selected year');
        clickMenu('msg-type', 'ALNAV');
        waitFor(function () { return visibleRows().length === 4 && tableHas('ALNAV 2022 subject'); }, function () {
          assert(!tableHas('NAVADMIN 2022 subject'), 'Title search retained a different message type');
          searchFor('');
          assert(visibleRows().length === 1 && tableHas('ALNAV 2025 subject'), 'Clearing search did not restore the selected year');
          recordRequests('crossyearsearch', function (requests) {
            assert(listMessageBodyRequests(requests).every(function (request) { return request.form.year === '2025'; }),
              'Title search downloaded message bodies from other years');
            open('main', '', function () { return tableHas('First [Campaign]'); }, done);
          });
        });
      });
    });
  }]);

  steps.push(['Keep the latest year selected when older requests finish last', function (done) {
    clickMenu('msg-year', '2024');
    clickMenu('msg-year', '2023');
    waitFor(function () { return tableHas('NAVADMIN 2023 subject'); }, function () {
      setTimeout(function () {
        assert(tableHas('NAVADMIN 2023 subject'), 'A stale response replaced the selected table');
        assert(app.location.search.indexOf('year=2023') >= 0, 'A stale response replaced the selected URL');
        done();
      }, 500);
    });
  }]);

  steps.push(['Restore list history in both directions', function (done) {
    app.history.back();
    waitFor(function () { return tableHas('NAVADMIN 2024 subject'); }, function () {
      assertCanonical('?type=NAVADMIN&year=2024');
      app.history.forward();
      waitFor(function () { return tableHas('NAVADMIN 2023 subject'); }, function () {
        assertCanonical('?type=NAVADMIN&year=2023');
        clickMenu('msg-year', '2025');
        waitFor(function () { return tableHas('First [Campaign]'); }, done);
      });
    });
  }]);

  steps.push(['Reuse metadata in flight when returning to a year', function (done) {
    open('pending', '', function () { return tableHas('First [Campaign]'); }, function () {
      clickMenu('msg-year', '2022');
      clickMenu('msg-year', '2023');
      clickMenu('msg-year', '2022');
      waitFor(function () { return tableHas('NAVADMIN 2022 subject'); }, function () {
        recordRequests('pending', function (requests) {
          var requestsForYear = requests.filter(function (row) {
            return row.endpoint === 'messages' && row.form.yearsMetadata === '2022';
          });
          assert(requestsForYear.length === 1, 'Returning to the pending year sent multiple requests');
          open('main', '', function () { return tableHas('First [Campaign]'); }, done);
        });
      });
    });
  }]);

  steps.push(['Show a selectable read-only message and preserve modal focus and history', function (done) {
    var opener = messageLink('First [Campaign]')[0];
    focus(opener);
    opener.click();
    waitFor(function () { return modalShown() && modalText() === linkedMessageBody; }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=1');
      assertTitle(app.document, firstMessageTitle);
      var trail = [['NAVADMIN', '?type=NAVADMIN'], ['2025', '?type=NAVADMIN&year=2025'],
        ['NAVADMIN 001/25', '?type=NAVADMIN&year=2025&number=1']];
      assertBreadcrumbStructuredData(trail);
      assert(!app.document.querySelector('nav[aria-label="Breadcrumb"], #archive-breadcrumbs, #message-breadcrumbs'),
        'The message route rendered breadcrumb navigation');
      var modalBody = select('#message-body-modal .modal-body');
      var heading = select('#message-body-modal .modal-title')[0];
      assert(isFocused(heading), 'Opening a message did not focus its heading');
      assert(modalBody.find('.spinner-border').length === 0, 'The spinner stayed after the message loaded');
      var fields = modalBody.find('textarea');
      assert(fields.length === 1 && modalBody.children().length === 1, 'Expected one field for the message body');
      assert(fields.val() === linkedMessageBody, 'Literal markup, line breaks, or reference text changed');
      var field = fields[0];
      assert(field.textContent === linkedMessageBody, 'The message text should be present in the rendered HTML');
      assert(field.readOnly && !field.disabled, 'The message field should be selectable and read-only');
      assert(fields.attr('aria-label') === 'Message text' && field.tabIndex === 0, 'The message field should be named and in the tab order');
      focus(field);
      field.select();
      assert(field.selectionStart === 0 && field.selectionEnd === field.value.length, 'The field did not select the full message');

      var shared = '';
      app.prompt = function (label, link) { shared = link; };
      select('#message-body-modal .modal-share-link').trigger('click');
      assert(/\/view-message\/\?type=NAVADMIN&year=2025&number=1$/.test(shared), 'Share URL did not match the visible message');
      app.jQuery(field).trigger(app.jQuery.Event('keydown', { which: 27, keyCode: 27 }));
      waitFor(function () { return !modalShown() && !messageRoute(1) && isFocused(opener); }, function () {
        assertCanonical();
        assertHomeMetadata(app.document);
        assertNoBreadcrumbStructuredData();
        app.history.forward();
        waitFor(function () { return modalShown() && messageRoute(1) && modalText() === linkedMessageBody && isFocused(heading); }, function () {
          assertCanonical('?type=NAVADMIN&year=2025&number=1');
          assertBreadcrumbStructuredData(trail);
          app.history.back();
          waitFor(function () { return !modalShown() && !messageRoute(1) && isFocused(opener); }, function () {
            assertCanonical();
            assertNoBreadcrumbStructuredData();
            done();
          });
        });
      });
    });
  }]);

  steps.push(['Show a missing message body error without marking the row as offline', function (done) {
    open('modal', '', function () { return tableHas('Missing body'); }, function () {
      var opener = messageLink('Missing body')[0];
      focus(opener);
      opener.click();
      var modalBody = select('#message-body-modal .modal-body');
      assert(app.jQuery(modalBody[0].firstChild).hasClass('spinner-border'), 'The spinner should precede the loading text');
      assert(modalBody.text() === 'Retrieving message\u2026', 'The modal should show its loading text');
      assert(modalBody.find('textarea').length === 0, 'The loading text should remain outside the message field');
      waitFor(function () { return modalShown() && modalText() === 'Message text is not publicly released.'; }, function () {
        assertCanonical('?type=NAVADMIN&year=2025&number=3');
        assertNoBreadcrumbStructuredData();
        assert(modalBody.find('.spinner-border').length === 0, 'The spinner stayed after the request failed');
        assert(modalBody.find('textarea').length === 0, 'The error should remain outside the message field');
        var missing = messageLink('Missing body').closest('tr');
        assert(!missing.find('th').hasClass('offline-enabled'), 'A failed response was marked available offline');
        closeModal();
        waitFor(function () { return !modalShown() && !messageRoute(3) && isFocused(missing.find('a')[0]); }, done);
      });
    });
  }]);

  steps.push(['Ignore the earlier modal error after another message opens', function (done) {
    clickRow('Slow missing body');
    app.prepareAndShowMessageModal(0, 2025, 2, null);
    waitFor(function () { return modalShown() && modalText() === 'Body of message 2'; }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=2');
      waitFor(function () { return yearComplete('2025'); }, function () {
        assert(modalText() === 'Body of message 2' && messageRoute(2), 'A stale error changed the visible message');
        assertCanonical('?type=NAVADMIN&year=2025&number=2');
        done();
      });
    });
  }]);

  steps.push(['Open a redirected shared message before its skeleton exists', function (done) {
    open('direct', 'view-message/?type=NAVADMIN&year=2025&number=9', function () {
      return modalShown() && messageRoute(9) && modalText() === 'Body of message 9';
    }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=9');
      closeModal();
      waitFor(function () {
        return !modalShown() && !messageRoute(9) && tableHas('First [Campaign]') && isFocused(select('#msg-year-dropdown')[0]);
      }, function () {
        assertCanonical('?type=NAVADMIN&year=2025');
        assertTitle(app.document, 'NAVADMIN 2025 Message Archive | NAVADMIN Viewer App');
        assertBreadcrumbStructuredData([['NAVADMIN', '?type=NAVADMIN'], ['2025', '?type=NAVADMIN&year=2025']]);
        done();
      });
    });
  }]);

  steps.push(['Canonicalize reordered message parameters and a zero-padded number', function (done) {
    open('canonical', '?number=001&year=2025&type=NAVADMIN', function () {
      return modalShown() && modalText() === linkedMessageBody;
    }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=1');
      assertTitle(app.document, firstMessageTitle);
      assertBreadcrumbStructuredData([['NAVADMIN', '?type=NAVADMIN'], ['2025', '?type=NAVADMIN&year=2025'],
        ['NAVADMIN 001/25', '?type=NAVADMIN&year=2025&number=1']]);
      var description = app.document.querySelector('meta[name="description"]').getAttribute('content');
      assert(description.indexOf('source text') !== -1, 'The message description should summarize the loaded body');
      assertOpenGraphMetadata(app.document, description);
      done();
    });
  }]);

  steps.push(['Use the archive title and canonical for an explicit message type', function (done) {
    open('metadata', '?type=MARADMIN', function () {
      return /MARADMIN \d+ subject/.test(select('#msg-list-table-body').text());
    }, function () {
      assertTitle(app.document, 'MARADMIN Message Archive | NAVADMIN Viewer App');
      assertCanonical('?type=MARADMIN');
      assertNoBreadcrumbStructuredData();
      done();
    });
  }]);

  steps.push(['Use the cached message body after reopening with a failing endpoint', function (done) {
    open('offline', '?type=NAVADMIN&year=2025&number=1', function () {
      return modalShown() && modalText() === linkedMessageBody;
    }, function () {
      recordRequests('offline', function (requests) {
        assert(!listMessageBodyRequests(requests).some(function (request) { return request.form.number === '1'; }),
          'Offline reopen fetched the migrated message body');
        app.getYearsForMsgType(0, [2025], function (result) {
          assert(result.requestOutcome === 'error' && result.errorText, 'A failed metadata request did not report an error');
          done();
        });
      });
    });
  }]);

  steps.push(['Read a message and record its view before Firebase loads in order', function (done) {
    var sdkApp = 'firebase-app-compat.js';
    var sdkAnalytics = 'firebase-analytics-compat.js';
    openFirebaseMessage('firebaseorder', function () { return firebaseScripts(sdkApp).length === 1; }, function () {
      assert(firebaseScripts(sdkApp)[0].async, 'The Firebase app SDK script should load asynchronously');
      assert(!app.fixtureFirebaseTrace.length && !firebaseScripts(sdkAnalytics).length,
        'Firebase initialized or requested Analytics before its app SDK loaded');
      releaseFirebase('firebaseorder', sdkApp, function () {
        waitFor(function () { return firebaseScripts(sdkAnalytics).length === 1; }, function () {
          assert(firebaseScripts(sdkAnalytics)[0].async, 'The Firebase Analytics SDK script should load asynchronously');
          assert(app.fixtureFirebaseTrace.join(',') === 'app-sdk', 'Firebase initialized before the Analytics SDK loaded');
          releaseFirebase('firebaseorder', sdkAnalytics, function () {
            waitFor(function () { return app.fixtureFirebaseTrace.length >= 4; }, function () {
              assert(app.fixtureFirebaseTrace.join(',') === 'app-sdk,analytics-sdk,initializeApp,analytics',
                'Firebase initialized out of order, more than once, or logged a new event');
              app.Navadmin.startFirebaseAnalytics();
              assert(firebaseScripts(sdkApp).length === 1 && firebaseScripts(sdkAnalytics).length === 1,
                'Starting Firebase again inserted duplicate SDK scripts');
              assert(!app.fixtureFirebaseFailures.length && !app.fixtureFirebaseErrors.length, 'Firebase caused a viewer error');
              done();
            });
          });
        });
      });
    });
  }]);

  [
    ['firebasecorefailure', 'firebase-app-compat.js', ''],
    ['firebaseanalyticsfailure', 'firebase-analytics-compat.js', 'app-sdk']
  ].forEach(function (failure) {
    steps.push(['Keep reading and recording views when ' + failure[1] + ' is unavailable', function (done) {
      openFirebaseMessage(failure[0], function () { return app.fixtureFirebaseFailures.length; }, function () {
        assert(app.fixtureFirebaseFailures.join(',') === failure[1], 'Unexpected Firebase SDK failures');
        assert(app.fixtureFirebaseTrace.join(',') === failure[2], 'Firebase initialized after an SDK failed');
        assert(!app.fixtureFirebaseErrors.length, 'A blocked Firebase SDK caused an uncaught viewer error');
        done();
      });
    }]);
  });

  steps.push(['Coalesce concurrent message body requests and retry view registration', function (done) {
    open('activity', '', function () { return tableHas('First [Campaign]'); }, function () {
      var results = [];
      function remember(messageBody) { results.push(messageBody); }
      app.getMessageBody(0, 2025, 8, remember);
      app.getMessageBody(0, 2025, 8, remember);
      waitFor(function () { return results.length === 2; }, function () {
        assert(results[0] === 'Body of message 8' && results[1] === results[0], 'Concurrent callers received different message bodies');
        app.sendViewActivity(0, 2025, 1);
        setTimeout(function () {
          app.sendViewActivity(0, 2025, 2);
          app.sendViewActivity(0, 2025, 3);
          setTimeout(function () {
            recordRequests('activity', function (requests) {
              var messageBodyRequests = listMessageBodyRequests(requests).filter(function (row) { return row.form.number === '8'; });
              var registrations = requests.filter(function (row) { return row.endpoint === 'updateUserInfo'; });
              var views = requests.filter(function (row) { return row.endpoint === 'updateUserActivity'; });
              assert(messageBodyRequests.length === 1, 'Concurrent callers sent multiple message body requests');
              assert(registrations.length === 2, 'Expected one failed registration and one shared retry');
              assert(views.some(function (row) { return row.form.activityMsgNumber === '2'; }), 'Second message view was lost');
              assert(views.some(function (row) { return row.form.activityMsgNumber === '3'; }), 'Third message view was lost');
              done();
            });
          }, 500);
        }, 100);
      });
    });
  }]);

  steps.push(['Browse all four message types and update the search placeholder', function (done) {
    var names = ['ALNAV', 'MARADMIN', 'ALMAR', 'NAVADMIN'];
    function assertSearchPlaceholder(name) {
      assert(select('#msg-search-input').attr('placeholder') === 'Search ' + name + ' messages across downloaded years',
        'The search placeholder did not name ' + name);
    }
    function nextType() {
      var name = names.shift();
      clickMenu('msg-type', name);
      waitFor(function () {
        return tableHas(name === 'NAVADMIN' ? 'First [Campaign]' : name + ' 2025 subject');
      }, function () {
        assertCanonical('?type=' + name);
        assertSearchPlaceholder(name);
        if (names.length) return nextType();
        app.history.back();
        waitFor(function () { return tableHas('ALMAR 2025 subject'); }, function () {
          assertSearchPlaceholder('ALMAR');
          app.history.forward();
          waitFor(function () { return tableHas('First [Campaign]'); }, function () {
            assertSearchPlaceholder('NAVADMIN');
            done();
          });
        });
      });
    }
    assertSearchPlaceholder('NAVADMIN');
    nextType();
  }]);

  steps.push(['Compare rendered row values when metadata is on cooldown', function (done) {
    open('cooldown', '', function () {
      return tableHas('First [Campaign]') && app.jQuery.active === 0;
    }, function () {
      var getYears = app.getYearsForMsgType;
      var editedTitle = 'Edited cached subject';

      function refreshDuringCooldown(editCachedMessage) {
        var settled = false;
        app.getYearsForMsgType = function (type, years, complete, background) {
          if (type !== 0 || years.length !== 1 || years[0] !== 2025) {
            return getYears(type, years, complete, background);
          }

          // Change the same store object after the initial render and before the refresh settles.
          var renderedRow = select('#msg-list-table-body tr').last()[0];
          focus(app.jQuery(renderedRow).find('a')[0]);
          if (editCachedMessage) {
            var message = app.Navadmin.messageStore.findMessage(0, 2025, 1);
            message.title = editedTitle;
            message.actSum[0].actNumber = 73;
          }

          return getYears(type, years, function (result) {
            complete(result);
            var currentRow = select('#msg-list-table-body tr').last();
            assert(currentRow.find('a').text() === editedTitle, 'The table did not apply the edited cached title');
            assert(currentRow.text().indexOf('73') !== -1, 'The table did not apply the edited cached count');
            assert((currentRow[0] !== renderedRow) === editCachedMessage, 'The table replaced rows unexpectedly or skipped a redraw');
            assert(isFocused(currentRow.find('a')[0]), 'A table refresh lost the focused message link');
            assert(result.requestOutcome === 'cooldown' && result.errorText === null, 'The metadata request did not report its cooldown');
            settled = true;
          }, background);
        };

        try {
          clickMenu('msg-year', '2025');
          assert(settled, 'The cooled-down refresh did not settle from cache');
        } finally {
          app.getYearsForMsgType = getYears;
        }
      }

      getYears(0, [2023], function (result) {
        assert(result.requestOutcome === 'network' && result.errorText === null, 'The metadata response did not report its network outcome');
        refreshDuringCooldown(true);
        refreshDuringCooldown(false);
        recordRequests('cooldown', function (requests) {
          var requestsForYear = requests.filter(function (request) {
            return request.endpoint === 'messages' && request.form.type === 'NAVADMIN' && request.form.yearsMetadata === '2025';
          });
          assert(requestsForYear.length === 1, 'The cooled-down refresh sent another metadata request');
          done();
        });
      });
    });
  }]);

  steps.push(['Show a single placeholder when the selected year has no messages', function (done) {
    function emptyListShown() {
      return tableHas('No messages available') && !select('#loading-progress').is(':visible');
    }

    function checkEmptyRow() {
      var rows = select('#msg-list-table-body tr');
      assert(rows.length === 1, 'Expected one placeholder row');
      assert(rows.find('td').eq(1).text() === 'No messages available', 'Expected the placeholder in the Title column');
      assert(rows.find('a').length === 0, 'The placeholder should not contain a message link');
    }

    open('empty', '?type=NAVADMIN&year=2026', emptyListShown, function () {
      checkEmptyRow();
      clickMenu('msg-year', '2027');
      assert(!tableHas('No messages available'), 'The previous placeholder stayed while the next year was loading');
      waitFor(emptyListShown, function () {
        checkEmptyRow();
        clickMenu('msg-year', '2025');
        waitFor(function () { return tableHas('First [Campaign]'); }, function () {
          assert(!tableHas('No messages available'), 'The placeholder stayed in a populated year');
          done();
        });
      });
    });
  }]);

  steps.push(['Use the in-memory store after an IndexedDB startup read throws', function (done) {
    var subject = 'NAVADMIN 2023 subject';
    open('cacheread', '?type=NAVADMIN&year=2023', function () {
      return tableHas(subject) && warningProgress('2023', '1/1');
    }, function () {
      assert(app.cacheReadAttempts, 'The viewer did not encounter the simulated cache read error');
      clickRow(subject);
      waitFor(function () { return modalShown() && modalText() === linkedMessageBody; }, done);
    });
  }]);

  steps.push(['Download the selected year automatically and keep failures partial', function (done) {
    open('bulk', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && yearProgress('2025') === '0/4';
    }, function () {
      assertYearButtonProgress('2025');
      select('#msg-year-dropdown')[0].click();
      var active = menuItem('msg-year', '2025').find('.message-year-progress-active')[0];
      assert(active && yearProgress('2025') === '0/4', 'The progress bar did not animate when the download started');
      var reducedMotion = app.matchMedia && app.matchMedia('(prefers-reduced-motion: reduce)').matches;
      assert(app.getComputedStyle(active, ':after').animationName === (reducedMotion ? 'none' : 'progress-bar-stripes'),
        'The progress animation did not honor the motion preference');
      select('#msg-search-scope-full-message').trigger('click');
      searchFor('[needle]+');
      assert(!visibleRows().find('mark').length, 'Full Message search matched an unprocessed message');
      waitFor(function () {
        return yearProgress('2025') === '3/4' && visibleRows().length === 1 &&
          menuItem('msg-year', '2025').find('.message-year-download-note').text() === 'Select year to retry';
      }, function () {
        assertYearButtonProgress('2025');
        assert(!yearComplete('2025'), 'A transient failure marked the year complete');
        assert(!menuItem('msg-year', '2025').find('.message-year-progress-active').length, 'A paused download kept animating');
        assert(menuItem('msg-year', '2025').find('.message-year-progress')[0] === active, 'The progress bar was replaced during the download');
        assert(menuItem('msg-year', '2025').find('.message-year-label').text() === '2025', 'Progress changed the year label');
        assert(!menuItem('msg-year', '2024').find('.message-year-progress').length, 'An unselected year showed download progress');
        assert(visibleRows().find('a').text() === 'Second [Campaign]', 'Full Message results did not update after caching');
        recordRequests('bulk', function (requests) {
          var messageBodyRequests = listMessageBodyRequests(requests);
          assert(messageBodyRequests.length === 4 && messageBodyRequests.every(function (request) {
            return request.form.type === 'NAVADMIN' && request.form.year === '2025';
          }), 'Background requests did not target exactly the selected year');
          assert(messageBodyRequests.some(function (request) { return request.form.number === '3' && request.httpStatus === 404; }),
            'Download progress did not include the unavailable message');
          done();
        });
      });
    });
  }]);

  steps.push(['Search and highlight literal message body text without rendering markup', function (done) {
    var snippet = visibleRows().find('.message-search-snippet');
    assert(snippet.find('mark').text() === '[Needle]+', 'The result did not highlight the literal message body match');
    assert(snippet.text().indexOf('<img') >= 0 && !snippet.find('img').length, 'The snippet interpreted message body markup');
    clickRow('Second [Campaign]');
    waitFor(function () { return modalShown() && modalText() === searchMessageBody; }, function () {
      var modalBody = select('#message-body-modal .modal-body');
      assert(!modalBody.find('img').length && !app.fixtureMarkupRan, 'The modal interpreted message body markup');
      closeModal();
      waitFor(function () { return !modalShown() && !messageRoute(2); }, function () {
        select('#msg-search-scope-title').trigger('click');
        waitFor(function () { return visibleRows().length === 0; }, function () {
          searchFor('[campaign]');
          waitFor(function () { return visibleRows().length === 2; }, function () {
            select('#msg-search-scope-full-message').trigger('click');
            waitFor(function () { return visibleRows().length === 0; }, function () {
              searchFor('');
              assert(visibleRows().length === 4 && !visibleRows().find('.message-search-snippet').length,
                'Clearing Full Message search did not restore the complete list');
              done();
            });
          });
        });
      });
    });
  }]);

  steps.push(['Find typos in offline cached message bodies and keep exact results first', function (done) {
    var exactTitle = 'Exact cross-year result';
    var fuzzyTitle = 'Approximate cross-year result';
    var useFuzzySearch = supportsFuzzySearch();
    var years = [
      { year: 2024, messages: [{ type: 0, year: 2024, number: 1, title: exactTitle, Body: 'Read the INSTRUCTION.' }] },
      { year: 2025, messages: [{ type: 0, year: 2025, number: 1, title: fuzzyTitle, Body: 'Read the INSTRUCION.' }] }
    ];
    seedMessageDatabase('fuzzyoffline', 2, years, function () {
      open('fuzzyoffline', '?type=NAVADMIN&year=2025', function () {
        return tableHas(fuzzyTitle) && yearComplete('2024') && yearComplete('2025');
      }, function () {
        searchFor('instruction');
        waitFor(function () { return !searchSpinnerVisible() && visibleRows().find('mark').length; }, function () {
          var rows = visibleRows();
          assert(rows.first().find('a').text() === exactTitle && rows.first().find('mark').text() === 'INSTRUCTION',
            'The older exact result did not rank first with its original spelling highlighted');
          if (!useFuzzySearch) {
            assert(rows.length === 1, 'The browser did not use the literal search fallback');
          } else {
            assert(rows.length === 2 && rows.last().find('a').text() === fuzzyTitle &&
              rows.last().find('mark').text() === 'INSTRUCION', 'The fuzzy result did not highlight the actual message body text');
          }
          searchFor('instructon');
          waitFor(function () { return !searchSpinnerVisible(); }, function () {
            if (!useFuzzySearch) {
              assert(!visibleRows().length, 'The literal fallback returned a result for a typo without a literal match');
            } else {
              assert(messageLink(exactTitle).closest('tr').find('mark').text() === 'INSTRUCTION',
                'A misspelled query did not find the cached message offline');
            }
            recordRequests('fuzzyoffline', function (requests) {
              assert(!listMessageBodyRequests(requests).length, 'Offline search requested a cached message body from the API');
              if (!useFuzzySearch) return done();

              clickRow(exactTitle);
              waitFor(function () { return modalShown() && modalText() === 'Read the INSTRUCTION.'; }, function () {
                assertCanonical('?type=NAVADMIN&year=2024&number=1');
                assertBreadcrumbStructuredData([['NAVADMIN', '?type=NAVADMIN'],
                  ['2024', '?type=NAVADMIN&year=2024'], ['NAVADMIN 001/24', '?type=NAVADMIN&year=2024&number=1']]);
                closeModal();
                waitFor(function () { return !modalShown() && app.location.search === '?type=NAVADMIN&year=2025'; }, function () {
                  assertCanonical('?type=NAVADMIN&year=2025');
                  assertBreadcrumbStructuredData([['NAVADMIN', '?type=NAVADMIN'],
                    ['2025', '?type=NAVADMIN&year=2025']]);
                  done();
                });
              });
            });
          });
        });
      });
    });
  }]);

  if (supportsFuzzySearch()) {
    steps.push(['Warm Full Message search on focus without changing the list', function (done) {
      open('fuzzyoffline', '?type=NAVADMIN&year=2025', function () {
        return app.MiniSearch && tableHas('Approximate cross-year result') && yearComplete('2024') && yearComplete('2025');
      }, function () {
        var input = select('#msg-search-input')[0];
        var spinner = select('#message-search-spinner')[0];
        var spinnerShown = false;
        var observer = new app.MutationObserver(function (records) {
          spinnerShown = spinnerShown || !spinner.hidden || records.some(function (record) { return record.oldValue === null; });
        });
        observer.observe(spinner, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
        var originalRow = visibleRows()[0];
        var miniSearchPrototype = app.MiniSearch.prototype;
        var add = miniSearchPrototype.add;
        var indexedMessageCount = 0;
        miniSearchPrototype.add = function () {
          var result = add.apply(this, arguments);
          indexedMessageCount++;
          return result;
        };

        focus(input);
        waitFor(function () {
          var rows = visibleRows();
          assert(!spinnerShown && !searchSpinnerVisible(), 'Focusing the search input showed the spinner');
          assert(!input.value && rows.length === 1 && rows[0] === originalRow && !rows.find('mark').length,
            'Focusing the search input changed the displayed messages');
          assert(indexedMessageCount <= 2, 'The warmup indexed cached messages more than once');
          return indexedMessageCount === 2;
        }, function () {
          observer.disconnect();
          searchFor('instructon');
          waitFor(function () { return !searchSpinnerVisible() && visibleRows().find('mark').length; }, function () {
            assert(messageLink('Exact cross-year result').closest('tr').find('mark').text() === 'INSTRUCTION',
              'The typo query missed the message warmed from an older year');
            assert(indexedMessageCount === 2, 'The typo query indexed the warmed messages again');
            miniSearchPrototype.add = add;
            done();
          });
        });
      });
    }]);

    steps.push(['Refresh active Full Message results when the fuzzy library finishes loading', function (done) {
      open('fuzzylateload', '?type=NAVADMIN&year=2025', function () {
        return app.fixtureReleaseMiniSearch && tableHas('Approximate cross-year result') && yearComplete('2025');
      }, function () {
        searchFor('instruction');
        waitFor(function () { return !searchSpinnerVisible() && visibleRows().find('mark').length; }, function () {
          var rows = visibleRows();
          assert(!app.MiniSearch && rows.length === 1 && rows.find('a').text() === 'Exact cross-year result',
            'The exact result did not appear while the fuzzy library was held');
          app.fixtureReleaseMiniSearch();
          waitFor(function () {
            assert(!searchSpinnerVisible(), 'Loading the fuzzy library showed the user-input spinner');
            return visibleRows().find('mark').length === 2;
          }, function () {
            var rows = visibleRows();
            assert(select('#msg-search-input').val() === 'instruction' && rows.first().find('mark').text() === 'INSTRUCTION' &&
              rows.last().find('mark').text() === 'INSTRUCION', 'The active query did not refresh in exact-first order');
            done();
          });
        });
      });
    }]);
  }

  steps.push(['Keep literal Full Message search when the optional fuzzy module is unavailable', function (done) {
    open('fuzzyunavailable', '?type=NAVADMIN&year=2025', function () {
      return tableHas('Approximate cross-year result') && yearComplete('2025');
    }, function () {
      searchFor('instruction');
      waitFor(function () { return !searchSpinnerVisible() && visibleRows().find('mark').length; }, function () {
        var rows = visibleRows();
        assert(rows.length === 1 && rows.find('a').text() === 'Exact cross-year result' &&
          rows.find('mark').text() === 'INSTRUCTION', 'The viewer lost literal search when the fuzzy module failed to load');
        done();
      });
    });
  }]);

  steps.push(['Keep cross-year search and year progress stable on a warm year switch', function (done) {
    var currentSubject = 'NAVADMIN 2023 subject';
    var refreshedSubject = 'NAVADMIN 2024 subject';
    var cachedSubject = 'Previously cached 2024 subject';
    open('warmyearswitch', '?type=NAVADMIN&year=2023', function () {
      return tableHas(currentSubject) && yearComplete('2023') && app.jQuery.active === 0;
    }, function () {
      clickMenu('msg-year', '2024');
      waitFor(function () {
        return tableHas(refreshedSubject) && yearComplete('2024') && app.jQuery.active === 0;
      }, function () {
        var store = app.Navadmin.messageStore;
        store.findMessage(0, 2024, 1).title = cachedSubject;
        searchFor('source text');
        waitFor(function () {
          var search = app.activeSearch;
          return tableHas(currentSubject) && tableHas(cachedSubject) && search && !search.timer && !search.running &&
            !app.yearStatusTimer;
        }, function () {
          var search = app.activeSearch;
          var getMessageBodyStatus = store.getMessageBodyStatus;
          var unrelatedChecks = 0;
          store.getMessageBodyStatus = function (type, year, number) {
            if (type === 0 && year === 2024) {
              unrelatedChecks++;
              return null;
            }
            return getMessageBodyStatus(type, year, number);
          };

          clickMenu('msg-year', '2023');
          assert(select('#msg-year-dropdown-label').text() === '2023', 'The cached year switch did not settle');
          assert(app.activeSearch === search && !search.timer && !search.running && tableHas(cachedSubject),
            'An unchanged year switch reran the cross-year search');
          assert(!unrelatedChecks && yearComplete('2024'), 'The year switch recalculated unrelated progress');

          var yearButton = select('#msg-year-dropdown')[0];
          yearButton.click();
          assert(unrelatedChecks > 0 && yearProgress('2024') === '0/1', 'Opening the year menu did not refresh progress');
          store.getMessageBodyStatus = getMessageBodyStatus;
          yearButton.click();

          var metadataKey = 'type=NAVADMIN&yearsMetadata=2024';
          app.requestThrottleByKey.delete(metadataKey);
          clickMenu('msg-year', '2024');
          assert(app.pendingCallbacksByRequestKey.has(metadataKey), 'The changed title request did not start');
          clickMenu('msg-year', '2023');
          waitFor(function () { return tableHas(refreshedSubject) && !tableHas(cachedSubject); }, function () {
            assert(select('#msg-year-dropdown-label').text() === '2023', 'Late cross-year metadata changed the selected year');
            done();
          });
        });
      });
    });
  }]);

  steps.push(['Search restored text silently during startup and background updates', function (done) {
    var scenario = 'restoredsearch';
    var cachedSubject = 'Cached 2024 subject';
    var refreshedSubject = 'NAVADMIN 2024 subject';
    var years = [
      { year: 2025, messages: firstCacheMessages() },
      { year: 2024, messages: [{ type: 0, year: 2024, number: 1, title: cachedSubject, Body: linkedMessageBody }] }
    ];
    function assertSilentSearch(message) {
      assert(app.fixtureSearchSpinnerShows === 0 && !searchSpinnerVisible(), message);
    }
    seedMessageDatabase(scenario, 2, years, function () {
      open(scenario, '?type=NAVADMIN&year=2025', function () {
        var search = app.activeSearch;
        return app.fixtureFinishMessageBodyRead && search && !search.timer && !search.running;
      }, function () {
        assertSilentSearch('Restored text showed a search spinner while reading the cache');
        var writes = app.fixtureHeldMessageBodyWrites;
        app.fixtureFinishMessageBodyRead();
        waitFor(function () {
          return tableHas(cachedSubject) && visibleRows().find('mark').length === 2 && writes[2] && writes[3];
        }, function () {
          assertSilentSearch('Finishing the restored search showed a spinner');
          app.getYearsForMsgType(0, [2024], null, true);
          waitFor(function () { return tableHas(refreshedSubject) && !tableHas(cachedSubject); }, function () {
            assertSilentSearch('Refreshing metadata showed a search spinner');
            writes[2]();
            waitFor(function () { return visibleRows().find('mark').length === 3 && tableHas('Second [Campaign]'); }, function () {
              assertSilentSearch('The first background message body showed a search spinner');
              writes[3]();
              waitFor(function () { return visibleRows().find('mark').length === 4 && tableHas('Missing body'); }, function () {
                assertSilentSearch('The second background message body showed a search spinner');
                done();
              });
            });
          });
        });
      });
    });
  }]);

  steps.push(['Continue Full Message search with memory and other years after a read fails', function (done) {
    var scenario = 'searchreadfailure';
    var readableSubject = 'NAVADMIN 2023 subject';
    var unreadableSubject = 'Unreadable cached subject';
    var memorySubject = 'In-memory cached subject';
    var years = [
      { year: 2025, messages: [
        { type: 0, year: 2025, number: 1, title: unreadableSubject, Body: linkedMessageBody },
        { type: 0, year: 2025, number: 2, title: memorySubject }
      ] },
      { year: 2023, messages: [{ type: 0, year: 2023, number: 1, title: readableSubject, Body: linkedMessageBody }] }
    ];
    seedMessageDatabase(scenario, 2, years, function () {
      open(scenario, '?type=NAVADMIN&year=2023', function () {
        return tableHas(readableSubject) && yearComplete('2023');
      }, function () {
        var prototype = app.IDBObjectStore.prototype;
        var openCursor = prototype.openCursor;
        var put = prototype.put;
        var failedReads = 0;
        prototype.openCursor = function (range) {
          if (this.name === 'bodies' && range && range.lower === 'NAVADMIN/2025/') {
            failedReads++;
            throw new Error('Test interrupted message body cursor');
          }
          return openCursor.apply(this, arguments);
        };
        prototype.put = function () {
          if (this.name === 'bodies') throw new Error('Test denied message body write');
          return put.apply(this, arguments);
        };

        var store = app.Navadmin.messageStore;
        store.saveMessageBodyResult(0, 2025, 2, linkedMessageBody, 200, function () {
          prototype.put = put;
          var listMessageBodyRecords = store.listMessageBodyRecords;
          var finishRead;
          store.listMessageBodyRecords = function (type, year, callback) {
            listMessageBodyRecords.call(store, type, year, function (records) {
              finishRead = function () { callback(records); };
            });
          };
          searchFor('source text');
          waitFor(function () {
            return finishRead && !app.activeSearch.timer && !app.activeSearch.running;
          }, function () {
            assertSearchLoading();
            store.listMessageBodyRecords = listMessageBodyRecords;
            finishRead();
            waitFor(function () {
              return !searchSpinnerVisible() && visibleRows().find('mark').length >= 2;
            }, function () {
              assert(failedReads === 1, 'Search attempted to read the failed year again');
              assert(!store.getMessageBodyStatus(0, 2025, 2).persistent, 'The fixture message body was saved to IndexedDB');
              assert(tableHas(memorySubject) && tableHas(readableSubject) && !tableHas(unreadableSubject),
                'Search missed available matches after the interrupted read');
              prototype.openCursor = openCursor;
              done();
            });
          });
        });
      });
    });
  }]);

  steps.push(['Yield to typing during a large full-message search after switching years', function (done) {
    var messagesPerYear = 300;
    var messageBody = Array(61).join('Cached text with line breaks\r\nand irregular   spacing. ') + 'cross-year hit';
    var years = [2025, 2023].map(function (year) {
      var messages = [];
      for (var number = 1; number <= messagesPerYear; number++) {
        messages.push({ type: 0, year: year, number: number, title: 'Cross-year message ' + year + '/' + number,
          Body: year === 2025 && number === messagesPerYear ? messageBody + ' and final cross-year hit' : messageBody });
      }
      return { year: year, messages: messages };
    });
    seedMessageDatabase('searchburst', 2, years, function () {
      open('searchburst', '?type=NAVADMIN&year=2025', function () {
        return tableHas('Cross-year message 2025/300') && select('#msg-year-dropdown-menu [data-message-year="2024"]').length;
      }, function () {
        var originalCreate = app.createMessageRow;
        var table = select('#msg-list-table-body')[0];
        var created = 0;
        var typedDuringSearch = false;
        app.createMessageRow = function (message) {
          if (message.year === 2025 && message.snippet && ++created === 1) {
            setTimeout(function () {
              typedDuringSearch = table.querySelectorAll('mark').length < messagesPerYear;
              assertSearchLoading();
              searchFor('final cross-year hit');
            }, 0);
          }
          return originalCreate(message);
        };
        clickMenu('msg-year', '2024');
        searchFor('a');
        searchFor('arch');
        searchFor('cross-year hit');
        assert(!created, 'Typing synchronously constructed search result rows');
        waitFor(function () {
          var mark = table.querySelector('mark');
          return !searchSpinnerVisible() && mark && mark.textContent === 'final cross-year hit' && table.rows.length === 1;
        }, function () {
          assert(typedDuringSearch, 'The result builder did not yield before committing the large result set');
          assert(tableHas('Cross-year message 2025/300'), 'The latest query lost a result outside the selected year');
          searchFor('cross-year hit');
          waitFor(function () {
            return !searchSpinnerVisible() && table.rows.length === 2 * messagesPerYear + 1 && yearComplete('2024');
          }, function () {
            assert(tableHas('Cross-year message 2023/300') && tableHas('NAVADMIN 2024 subject'), 'Search missed cached or newly downloaded text');
            assert(select('#msg-year-dropdown-label').text() === '2024', 'Search changed the selected year');
            searchFor('');
            assert(table.rows.length === 1 && !table.querySelector('mark'), 'Clearing search did not restore the selected year');
            done();
          });
        });
      });
    });
  }]);

  steps.push(['Keep slots busy and prefer the selected year once its downloads are queued', function (done) {
    open('priority', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && menuItem('msg-year', '2025').find('.message-year-progress-active').length;
    }, function () {
      clickMenu('msg-year', '2024');
      assert(menuItem('msg-year', '2025').find('.message-year-progress-active').length,
        'Switching years stopped the downloads already in progress');
      waitFor(function () { return yearComplete('2024') && yearComplete('2025'); }, function () {
        recordRequests('priority', function (requests) {
          var fetched = listMessageBodyRequests(requests).map(function (request) {
            return request.form.year + '/' + request.form.number;
          });
          var starts = app.fixtureQueueStarts;
          assert(app.fixtureQueuePeak === 4, 'The download queue did not limit concurrency to four');
          var oldWorkWhileLoading = starts.filter(function (request) {
            return request.selectedYear === '2024' && !request.selectedListReady && request.key.indexOf('2025/') === 0;
          });
          var workAfterList = starts.filter(function (request) { return request.selectedListReady; });
          var expected = ['2024/1'];
          for (var number = 1; number <= 11; number++) expected.push('2025/' + number);
          assert(fetched.sort().join(',') === expected.sort().join(','),
            'Switching years lost or repeated a download');
          assert(oldWorkWhileLoading.length, 'The previous year could not start a queued download while the selected list was loading');
          assert(workAfterList.length > 1 && workAfterList[0].key === '2024/1',
            'The selected year did not get the first free slot once its list was ready. Starts after readiness: ' +
            workAfterList.map(function (request) { return request.key; }).join(', '));
          assert(select('#msg-year-dropdown-label').text() === '2024', 'Download completion changed the selected year');
          done();
        });
      });
    });
  }]);

  steps.push(['Keep a previously started year animating while its remaining downloads wait', function (done) {
    open('waitinganimation', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && menuItem('msg-year', '2025').find('.message-year-progress-active').length;
    }, function () {
      var bar = menuItem('msg-year', '2025').find('.message-year-progress')[0];
      var strip = select('#msg-year-dropdown-progress');
      clickMenu('msg-year', '2024');
      assert(strip.prop('hidden') && !strip.is(':visible'), 'The year toggle kept showing the previous year while the new list loaded');
      waitFor(function () {
        var earlierYear = app.fixtureQueueStarts.filter(function (request) { return request.key.indexOf('2025/') === 0; });
        var currentYear = app.fixtureQueueStarts.filter(function (request) { return request.key.indexOf('2024/') === 0; });
        return earlierYear.length > 0 && earlierYear.length < 11 &&
          earlierYear.every(function (request) { return request.settled; }) &&
          currentYear.some(function (request) { return !request.settled; });
      }, function () {
        var previous = menuItem('msg-year', '2025').find('.message-year-progress-active');
        assert(previous.length, 'The earlier year stopped animating while its queued work was waiting');
        assert(previous[0] === bar, 'Changing years replaced the earlier year\'s progress bar');
        assertYearButtonProgress('2024');
        waitFor(function () { return yearComplete('2025') && yearComplete('2024'); }, function () {
          assert(strip.prop('hidden') && !strip.is(':visible'), 'The year toggle showed a strip after a persistent download completed');
          var checkmark = select('#msg-year-dropdown #msg-year-dropdown-complete');
          var description = select('#msg-year-dropdown-progress-description');
          assert(!checkmark.prop('hidden') && checkmark.is('.message-year-complete:visible') && checkmark.text() === '\u2713',
            'The year toggle did not show the download-complete checkmark');
          assert(description.text() === 'Download complete', 'The year toggle did not describe the completed download');
          clickMenu('msg-year', '2023');
          assert(checkmark.prop('hidden') && !checkmark.is(':visible') && description.text() !== 'Download complete',
            'The year toggle kept the previous year\'s completion after selecting an incomplete year');
          done();
        });
      });
    });
  }]);

  steps.push(['Reuse saved message bodies and retry an unresolved year through Download all years', function (done) {
    open('bulkresume', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && yearProgress('2025') === '3/4';
    }, function () {
      recordRequests('bulkresume', function (requests) {
        assert(listMessageBodyRequests(requests).every(function (request) { return request.form.number === '4'; }),
          'A reload requested settled message bodies again');
        clickMenu('msg-year', '2024');
        waitFor(function () { return tableHas('NAVADMIN 2024 subject') && yearComplete('2024'); }, function () {
          select('#msg-search-scope-full-message').trigger('click');
          searchFor('source text');
          waitFor(function () {
            return visibleRows().length === 2 && tableHas('First [Campaign]') && tableHas('NAVADMIN 2024 subject') &&
              menuItem('msg-year', '2025').find('.message-year-download-note').text() === 'Select year to retry';
          }, startBulkDownload);
        });
        function startBulkDownload() {
          var route = app.location.href;
          var historyLength = app.history.length;
          var button = select('#msg-download-all-years');
          assert(button.text().trim() === 'Download all years', 'The bulk action was not labeled');
          var menu = select('#msg-year-dropdown-menu');
          assert(menu.find('a, button').last()[0] === button[0], 'The bulk action was not the last year menu entry');
          button.trigger('click');
          waitFor(function () {
            return ['2022', '2023', '2024', '2025'].every(yearComplete) && visibleRows().length === 4;
          }, function () {
            assert(app.location.href === route && app.history.length === historyLength, 'The bulk action changed browser history');
            assert(select('#msg-year-dropdown-label').text() === '2024' && select('#msg-search-input').val() === 'source text',
              'Bulk completion changed the selected year or search query');
            assert(tableHas('NAVADMIN 2022 subject') && tableHas('NAVADMIN 2024 subject'), 'Full Message did not include newly saved years');
            recordRequests('bulkresume', function (bulkRequests) {
              var messageBodyRequests = listMessageBodyRequests(bulkRequests);
              var retried = messageBodyRequests.filter(function (request) {
                return request.form.year === '2025' && request.form.number === '4';
              });
              assert(retried.length === 2 && retried[0].httpStatus === 503 && retried[1].httpStatus === 200,
                'All-year downloading did not retry the unresolved message body');
              assert(messageBodyRequests.every(function (request) { return request.form.type === 'NAVADMIN'; }),
                'All-year downloading fetched an unselected message type');
              searchFor('');
              app.history.back();
              waitFor(function () { return tableHas('First [Campaign]') && app.location.search.indexOf('year=2025') >= 0; }, done);
            });
          });
        }
      });
    });
  }]);

  steps.push(['Reopen downloaded years and unavailable messages offline', function (done) {
    open('bulkoffline', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && yearComplete('2025') && yearComplete('2023');
    }, function () {
      clickRow('Missing body');
      waitFor(function () { return modalShown() && modalText() === 'Message text is not publicly released.'; }, function () {
        closeModal();
        waitFor(function () { return !modalShown() && !messageRoute(3); }, function () {
          clickMenu('msg-year', '2023');
          waitFor(function () { return tableHas('NAVADMIN 2023 subject'); }, function () {
            clickRow('NAVADMIN 2023 subject');
            waitFor(function () { return modalShown() && modalText() === linkedMessageBody; }, function () {
              recordRequests('bulkoffline', function (requests) {
                assert(!listMessageBodyRequests(requests).length, 'The offline reopen fetched already settled message bodies');
                done();
              });
            });
          });
        });
      });
    });
  }]);

  steps.push(['Keep viewed years searchable in memory with yellow progress when IndexedDB is disabled', function (done) {
    var oldMessages = [{ type: 0, year: 2025, number: 1, title: 'Old localStorage title', Body: 'Old localStorage body' }];
    localStorage.setItem(cacheKey, JSON.stringify(['window.Map', [[0, ['window.Map', [[2025, oldMessages]]]]]]));
    open('sessioncache', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && warningProgress('2025', '0/4') &&
        menuItem('msg-year', '2025').find('.message-year-progress-active').length;
    }, function () {
      clickMenu('msg-year', '2024');
      searchFor('source text');
      waitFor(function () {
        return warningProgress('2025', '4/4') && warningProgress('2024', '1/1') &&
          tableHas('First [Campaign]') && tableHas('NAVADMIN 2024 subject');
      }, function () {
        assert(!yearComplete('2025') && !yearComplete('2024'), 'In-memory downloads showed a persistent checkmark');
        var current = menuItem('msg-year', '2024').find('.message-year-progress');
        assert(!current.hasClass('message-year-progress-active') && /until reload/.test(current.attr('aria-valuetext')),
          'The completed session bar did not describe its temporary cache');
        assertYearButtonProgress('2024');
        var fill = select('#msg-year-dropdown-progress .message-year-progress-fill');
        assert(fill.hasClass('bg-warning') && fill[0].style.width === '100%',
          'The year toggle did not show a full yellow strip for a completed session download');
        searchFor('');
        clickMenu('msg-year', '2025');
        clickRow('Missing body');
        waitFor(function () { return modalShown() && modalText() === 'Message text is not publicly released.'; }, function () {
          recordRequests('sessioncache', function (requests) {
            assert(listMessageBodyRequests(requests).length === 5, 'Revisiting a session-cached year fetched a message body again');
            assert(localStorage.getItem(cacheKey) && localStorage.getItem('nv-messageCache:bodies:NAVADMIN/2025/1') === null,
              'The viewer accessed the legacy cache or wrote a new localStorage body');
            localStorage.removeItem(cacheKey);
            open('sessioncache', '?type=NAVADMIN&year=2025', function () {
              return tableHas('First [Campaign]') && warningProgress('2025', '0/4');
            }, function () {
              assert(!yearComplete('2025') && !yearProgress('2024'), 'Reload kept the previous tab cache');
              waitFor(function () { return warningProgress('2025', '4/4'); }, done);
            });
          });
        });
      });
    });
  }]);

  steps.push(['Keep all quota-evicted years searchable and openable in memory', function (done) {
    var scenario = 'quotaeviction';
    var olderSubjects = ['Retained older subject 2023', 'Retained older subject 2024'];
    var olderMessageBodies = [linkedMessageBody + '\n2023 session-only fixture', linkedMessageBody + '\n2024 session-only fixture'];
    var years = [{ year: 2022, messages: [{ type: 0, year: 2022, number: 1, title: 'NAVADMIN 2022 subject', Body: linkedMessageBody }] }];
    [2023, 2024].forEach(function (year, index) {
      years.push({ year: year, messages: [{ type: 0, year: year, number: 1, title: olderSubjects[index], Body: olderMessageBodies[index] }] });
    });
    years.push({ year: 2025, messages: [
      { type: 0, year: 2025, number: 1, title: 'First recent subject' },
      { type: 0, year: 2025, number: 2, title: 'Second recent subject' },
      { type: 0, year: 2025, number: 3, title: 'Third recent subject' }
    ] });

    seedMessageDatabase(scenario, 2, years, function () {
      open(scenario, '?type=NAVADMIN&year=2022', function () {
        return tableHas('NAVADMIN 2022 subject') && yearComplete('2022') && yearComplete('2023') && yearComplete('2024');
      }, function () {
        var store = app.Navadmin.messageStore;
        var prototype = app.IDBObjectStore.prototype;
        var put = prototype.put;
        var failedWrites = {};
        var completed = 0;
        prototype.put = function (record, key) {
          if (this.name === 'bodies' && key.indexOf('NAVADMIN/2025/') === 0 && !failedWrites[key]) {
            failedWrites[key] = true;
            var error = new Error('Test IndexedDB cache is full');
            error.name = 'QuotaExceededError';
            throw error;
          }
          return put.apply(this, arguments);
        };

        function recordSaved(record) {
          app.Navadmin.messageDownloads.recordAvailable(record);
          completed++;
        }

        function verifyOfflineReopen() {
          open('quotaevictionoffline', '?type=NAVADMIN&year=2022', function () {
            return tableHas('NAVADMIN 2022 subject') && yearComplete('2025');
          }, function () {
            var reloadedStore = app.Navadmin.messageStore;
            assert(!yearProgress('2023') && !yearProgress('2024') && !yearComplete('2023') && !yearComplete('2024'),
              'A year stored only in memory was still marked downloaded after reload');
            reloadedStore.getMessageBodyRecord(0, 2023, 1, function (firstRecord) {
              assert(!firstRecord, 'The first evicted message body was still stored in IndexedDB');
              reloadedStore.getMessageBodyRecord(0, 2024, 1, function (secondRecord) {
                assert(!secondRecord, 'The second evicted message body was still stored in IndexedDB');
                select('#msg-search-scope-title').trigger('click');
                searchFor('Retained older subject');
                waitFor(function () { return olderSubjects.every(tableHas); }, done);
              });
            });
          });
        }

        function verifyOpeningEvictedMessageBody(index, next) {
          clickRow(olderSubjects[index]);
          waitFor(function () { return modalShown() && modalText() === olderMessageBodies[index]; }, function () {
            closeModal();
            waitFor(function () { return !modalShown() && !messageRoute(1); }, next);
          });
        }

        searchFor('source text');
        waitFor(function () { return olderSubjects.every(tableHas); }, function () {
          store.saveMessageBodyResult(0, 2025, 1, linkedMessageBody, 200, recordSaved);
          store.saveMessageBodyResult(0, 2025, 2, linkedMessageBody, 200, recordSaved);
          waitFor(function () {
            return completed === 2 && yearProgress('2025') === '2/3' && warningProgress('2023', '1/1') &&
              tableHas('First recent subject');
          }, function () {
            assert(Object.keys(failedWrites).length === 2, 'Both concurrent writes should encounter quota');
            assert(yearComplete('2022'), 'Quota recovery removed the selected year');
            assert(yearComplete('2024'), 'Concurrent quota errors evicted a second year');
            assert(tableHas(olderSubjects[0]), 'The active search lost the first evicted year');

            store.saveMessageBodyResult(0, 2025, 3, linkedMessageBody, 200, recordSaved);
            waitFor(function () {
              return completed === 3 && yearComplete('2025') && warningProgress('2024', '1/1') &&
                tableHas('Third recent subject');
            }, function () {
              prototype.put = put;
              assert(Object.keys(failedWrites).length === 3, 'The third message body did not trigger a new quota recovery');
              assert(yearComplete('2022') && warningProgress('2023', '1/1') && !yearComplete('2023') && !yearComplete('2024'),
                'The year indicators did not distinguish message bodies in the persistent and in-memory stores');
              searchFor('session-only fixture');
              waitFor(function () { return olderSubjects.every(tableHas) && visibleRows().length === 2; }, function () {
                verifyOpeningEvictedMessageBody(0, function () {
                  verifyOpeningEvictedMessageBody(1, function () {
                    recordRequests(scenario, function (requests) {
                      assert(!listMessageBodyRequests(requests).some(function (request) {
                        return request.form.year === '2023' || request.form.year === '2024';
                      }), 'Opening an evicted message fetched it again');
                      verifyOfflineReopen();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  }]);

  steps.push(['Complete downloads in memory when IndexedDB reaches quota', function (done) {
    var newerYear = { year: 2026, messages: [
      { type: 0, year: 2026, number: 1, title: 'Newer retained subject', Body: linkedMessageBody }
    ] };
    seedMessageDatabase('quota', 2, [newerYear], function () {
      open('quota', '?type=NAVADMIN&year=2025', function () {
        return tableHas('First [Campaign]') && warningProgress('2025', '4/4');
      }, function () {
        assert(!yearComplete('2025'), 'A year with message bodies stored only in memory showed a checkmark');
        assert(yearComplete('2026'), 'Quota recovery removed a newer year');
        assert([1, 2, 3, 4].filter(function (number) {
          return app.Navadmin.messageStore.getMessageBodyStatus(0, 2025, number).persistent;
        }).length === 2, 'The quota error changed the status of the earlier writes');
        open('quotaoffline', '?type=NAVADMIN&year=2025', function () {
          return tableHas('First [Campaign]') && yearProgress('2025') === '2/4';
        }, function () {
          assert(!warningProgress('2025', '2/4'), 'The reloaded year marked its persisted messages temporary');
          assert(yearComplete('2026'), 'The newer year was missing after reload');
          done();
        });
      });
    });
  }]);

  steps.push(['Keep IndexedDB reads and cache new downloads in memory when writes abort', function (done) {
    open('writefallbackseed', '?type=NAVADMIN&year=2023', function () {
      return tableHas('NAVADMIN 2023 subject') && yearComplete('2023');
    }, function () {
      open('writefallback', '?type=NAVADMIN&year=2025', function () {
        return tableHas('First [Campaign]') && warningProgress('2025', '4/4');
      }, function () {
        assert(app.deniedDatabaseMessageBodyWrites > 0, 'The simulated IndexedDB message body write did not fail');
        assert(yearComplete('2023') && !yearComplete('2025'), 'The two years did not show their different storage states');
        searchFor('source text');
        waitFor(function () {
          return tableHas('First [Campaign]') && tableHas('NAVADMIN 2023 subject') && visibleRows().length === 2;
        }, function () {
          open('writefallbackoffline', '?type=NAVADMIN&year=2023&number=1', function () {
            return tableHas('NAVADMIN 2023 subject') && yearComplete('2023') && modalShown() && modalText() === linkedMessageBody;
          }, function () {
            assert(!app.Navadmin.messageStore.getMessageBodyStatus(0, 2025, 1), 'An aborted write persisted a message body across reload');
            recordRequests('writefallbackoffline', function (requests) {
              assert(!listMessageBodyRequests(requests).length, 'Offline reopen requested a message body already stored in IndexedDB');
              done();
            });
          });
        });
      });
    });
  }]);

  steps.push(['Keep reading and searching in memory when browser storage is disabled', function (done) {
    var subject = 'NAVADMIN 2023 subject';
    open('nostorage', '?type=NAVADMIN&year=2023', function () {
      return tableHas(subject) && warningProgress('2023', '1/1');
    }, function () {
      select('#msg-search-scope-full-message').trigger('click');
      searchFor('<tag>');
      waitFor(function () { return visibleRows().find('a').text() === subject; }, function () {
        clickRow(subject);
        waitFor(function () { return modalShown() && modalText() === linkedMessageBody; }, done);
      });
    });
  }]);

  steps.push(['Keep keyboard focus through filter refresh and selection', function (done) {
    open('focus', '', function () {
      return tableHas('First [Campaign]') && app.jQuery.active === 0;
    }, function () {
      var yearButton = select('#msg-year-dropdown')[0];
      yearButton.click();
      focus(menuItem('msg-year', '2024')[0]);
      app.setFilterMsgYearDropdown(0, 2025);
      var year = menuItem('msg-year', '2024')[0];
      assert(isFocused(year), 'Refreshing the year menu lost the focused year');
      year.click();
      assert(isFocused(yearButton), 'Selecting a year did not focus its dropdown button');
      waitFor(function () { return tableHas('NAVADMIN 2024 subject'); }, function () {
        assert(isFocused(yearButton), 'Loading the selected year moved focus away from its dropdown button');
        var typeButton = select('#msg-type-dropdown')[0];
        typeButton.click();
        var type = menuItem('msg-type', 'ALNAV')[0];
        focus(type);
        type.click();
        assert(isFocused(typeButton), 'Selecting a type did not focus its dropdown button');
        waitFor(function () { return tableHas('ALNAV 2025 subject'); }, done);
      });
    });
  }]);

  steps.push(['Anchor and wrap the filter menus and fit the message field within the viewport', function (done) {
    var fillClass = 'message-filters-buttons-fill';
    frame.style.width = '320px';
    open('reflow', '', function () {
      return tableHas('First [Campaign]') && app.jQuery.active === 0 && select('.message-filters').hasClass(fillClass);
    }, function () {
      var viewport = app.document.documentElement;
      var typeButton = select('#msg-type-dropdown')[0];
      var yearButton = select('#msg-year-dropdown')[0];
      var scopeButton = select('#msg-search-scope-dropdown')[0];
      var filters = select('.message-filters')[0];
      var filterButtons = select('.message-filter-buttons')[0];
      var search = select('#msg-search-input')[0];

      function naturalSearchLayout() {
        var filled = filters.classList.contains(fillClass);
        if (filled) filters.classList.remove(fillClass);
        var buttonBounds = filterButtons.getBoundingClientRect();
        var layout = {
          inlineSpace: filters.getBoundingClientRect().right - buttonBounds.right,
          wrapped: search.getBoundingClientRect().top >= buttonBounds.bottom - 1
        };
        if (filled) filters.classList.add(fillClass);
        return layout;
      }

      function checkSearchWrap(expectedWrapped) {
        var inlineSpace = naturalSearchLayout().inlineSpace;
        var filterBounds = filters.getBoundingClientRect();
        var buttonBounds = filterButtons.getBoundingClientRect();
        var searchBounds = search.getBoundingClientRect();
        var wrapped = searchBounds.top >= buttonBounds.bottom - 1;
        var halfViewport = app.innerWidth / 2;
        if (Math.abs(inlineSpace - halfViewport) > 2) {
          assert(wrapped === (inlineSpace < halfViewport),
            'Search used the wrong row with ' + inlineSpace + 'px remaining in a ' + app.innerWidth + 'px viewport');
        }
        if (expectedWrapped !== undefined) {
          assert(wrapped === expectedWrapped, 'Unexpected search row at ' + app.innerWidth + 'px');
        }
        if (wrapped) {
          var typeBounds = typeButton.getBoundingClientRect();
          var yearBounds = yearButton.getBoundingClientRect();
          var scopeBounds = scopeButton.getBoundingClientRect();
          assert(Math.abs(typeBounds.top - yearBounds.top) <= 1 && Math.abs(typeBounds.top - scopeBounds.top) <= 1,
            'The dropdown buttons did not fit together above the search field');
          assert(Math.abs(typeBounds.left - filterBounds.left) <= 2 && Math.abs(typeBounds.right - yearBounds.left) <= 2 &&
            Math.abs(yearBounds.right - scopeBounds.left) <= 2 && Math.abs(scopeBounds.right - filterBounds.right) <= 2,
            'The dropdown buttons did not fill the row above the search field');
          assert(Math.abs(searchBounds.left - filterBounds.left) <= 2 &&
            Math.abs(searchBounds.right - filterBounds.right) <= 2, 'Wrapped search did not fill the filter row');
        } else {
          assert(searchBounds.right - searchBounds.left >= halfViewport - 2,
            'Inline search occupied less than half the viewport');
        }
        assert(searchBounds.left >= -1 && searchBounds.right <= viewport.clientWidth + 1,
          'Search extended outside the viewport');
      }

      function checkSearchWidths(next) {
        var widths = [375, 640, 704, 768, 991, 992, 1120, 1280, 1600];
        function checkNextWidth() {
          if (!widths.length) return next();
          var width = widths.shift();
          frame.style.width = width + 'px';
          waitFor(function () {
            return app.innerWidth === width && filters.classList.contains(fillClass) === naturalSearchLayout().wrapped;
          }, function () {
            checkSearchWrap(width === 375 ? true : width === 1600 ? false : undefined);
            checkNextWidth();
          });
        }
        checkNextWidth();
      }

      function checkFilterMenu(button) {
        var menu = app.jQuery(button).next('.dropdown-menu')[0];
        button.click();
        var menuBounds = menu.getBoundingClientRect();
        var buttonBounds = button.getBoundingClientRect();
        var expectedLeft = Math.max(0, Math.min(buttonBounds.left, viewport.clientWidth - menuBounds.width));
        assert(Math.abs(menuBounds.top - buttonBounds.bottom) <= 4 && Math.abs(menuBounds.left - expectedLeft) <= 1,
          'The filter menu did not open under its own button');
        assert(menuBounds.left >= -1 && menuBounds.right <= viewport.clientWidth + 1,
          'The open filter menu extended outside the viewport');
        assert(menu.scrollWidth <= menu.clientWidth + 1 && viewport.scrollWidth <= viewport.clientWidth + 1,
          'Opening the filter menu introduced horizontal scrolling');
        return menu;
      }

      function checkLongOption(button, option) {
        checkFilterMenu(button);
        var height = option.offsetHeight;
        button.click();
        var label = option.textContent;
        option.textContent = label + ' ' + new Array(24).join('UnbrokenText');
        var expandedMenu = checkFilterMenu(button);
        assert(expandedMenu.offsetWidth > button.offsetWidth, 'A long option could not expand the menu beyond its button');
        assert(option.offsetHeight > height && option.scrollWidth <= option.clientWidth + 1,
          'The long filter option did not wrap inside its menu');
        button.click();
        option.textContent = label;
      }

      assert(app.innerWidth === 320, 'Expected a 320 CSS pixel viewport');
      checkSearchWrap(true);
      var scope = app.jQuery(scopeButton);
      var scopeIcon = scope.find('.message-search-scope-icon')[0];
      var scopeLabel = scope.find('.message-search-scope-label')[0];
      var scopeOptions = select('#msg-search-scope-menu');
      assert(scopeIcon && scopeLabel && select('.message-search-scope-icon').length === 1 &&
        !scopeOptions.find('svg').length, 'The search icon should appear only on the scope toggle');
      scopeOptions.find('.dropdown-item').each(function () {
        var label = this.textContent;
        app.jQuery(this).trigger('click');
        assert(scope.find('.message-search-scope-icon')[0] === scopeIcon && scopeLabel.textContent === label &&
          scopeButton.getAttribute('aria-label') === 'Search scope: ' + label,
          'Changing search scope did not preserve the icon and update its label');
        var iconBounds = scopeIcon.getBoundingClientRect();
        assert(iconBounds.right > iconBounds.left && iconBounds.right <= scopeLabel.getBoundingClientRect().left + 1,
          'The search icon was hidden or did not precede the scope label');
        checkSearchWrap(true);
      });
      checkLongOption(yearButton, select('#msg-download-all-years')[0]);
      checkLongOption(scopeButton, select('#msg-search-scope-full-message')[0]);
      clickRow('First [Campaign]');
      waitFor(function () { return modalShown() && modalText() === linkedMessageBody; }, function () {
        var modal = select('#message-body-modal')[0];
        var dialog = select('#message-body-modal .modal-dialog')[0];
        var content = select('#message-body-modal .modal-content')[0];
        var modalBody = select('#message-body-modal .modal-body')[0];
        var heading = select('#message-body-modal .modal-title');
        var field = select('#message-body-modal .modal-body textarea')[0];
        var close = select('#message-body-modal .modal-header .close')[0];
        var footerButtons = select('#message-body-modal .modal-footer button');
        var normalHeading = heading.text();
        var longWord = new Array(24).join('UnbrokenText');
        var longMessageBody = 'First line\n' + longWord + '\n' + new Array(50).join('More message text\n') + 'Last line';
        app.jQuery(field).val(longMessageBody);

        function checkDialogWidth() {
          var modalBounds = modal.getBoundingClientRect();
          var closeBounds = close.getBoundingClientRect();
          assert(modal.scrollWidth <= modal.clientWidth + 1 && field.scrollWidth <= field.clientWidth + 1,
            'Long message text introduced horizontal scrolling');
          assert(closeBounds.left >= modalBounds.left && closeBounds.right <= modalBounds.right + 1,
            'The modal Close button extended outside the dialog');
        }

        function checkViewingSpace() {
          var margins = app.getComputedStyle(dialog);
          var modalBodyStyle = app.getComputedStyle(modalBody);
          var contentBounds = content.getBoundingClientRect();
          var fieldBounds = field.getBoundingClientRect();
          var availableHeight = app.innerHeight - parseFloat(margins.marginTop) - parseFloat(margins.marginBottom);
          var modalBodyHeight = modalBody.clientHeight - parseFloat(modalBodyStyle.paddingTop) - parseFloat(modalBodyStyle.paddingBottom);
          var contentHeight = contentBounds.bottom - contentBounds.top;
          var fieldHeight = fieldBounds.bottom - fieldBounds.top;
          assert(Math.abs(contentHeight - availableHeight) <= 2,
            'The dialog used ' + contentHeight + 'px of ' + availableHeight + 'px available');
          assert(modalBodyHeight > 0 && Math.abs(fieldHeight - modalBodyHeight) <= 2,
            'The message field used ' + fieldHeight + 'px of ' + modalBodyHeight + 'px inside the modal body');
          assert(field.scrollHeight > field.clientHeight, 'The long message should scroll inside the field');
          footerButtons.each(function () {
            var bounds = this.getBoundingClientRect();
            assert(bounds.top >= 0 && bounds.bottom > bounds.top && bounds.bottom <= app.innerHeight + 1,
              'A footer button extended outside the viewport');
          });
        }

        function checkLayout() {
          checkDialogWidth();
          checkViewingSpace();
          heading.text('Long subject ' + longWord);
          checkDialogWidth();
          heading.text(normalHeading);
        }

        assert(modalText() === longMessageBody, 'Message line breaks were not preserved');
        checkLayout();
        frame.style.width = '1200px';
        waitFor(function () { return app.innerWidth === 1200; }, function () {
          checkLayout();
          frame.style.height = '320px';
          waitFor(function () { return app.innerHeight === 320; }, function () {
            checkLayout();
            close.click();
            waitFor(function () { return !select(modal).is(':visible') && !messageRoute(1); }, function () {
              checkFilterMenu(yearButton);
              yearButton.click();
              checkFilterMenu(scopeButton);
              scopeButton.click();
              checkSearchWidths(function () {
                frame.style.width = '100%';
                frame.style.height = '560px';
                done();
              });
            });
          });
        });
      });
    });
  }]);

  var currentStep;
  function runNext() {
    if (!steps.length) {
      report('PASS: ' + passed.length + ' browser regression checks');
      return;
    }
    var step = steps.shift();
    currentStep = step[0];
    try {
      step[1](function () {
        passed.push('PASS: ' + currentStep);
        output.textContent = passed.join('\n');
        runNext();
      });
    } catch (error) {
      report('FAIL: ' + currentStep + ': ' + error.message);
    }
  }

  runNext();
}());
