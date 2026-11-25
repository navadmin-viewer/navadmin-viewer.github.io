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
  var linkedBody = 'Literal <tag> & source text\nSee NAVADMIN 002/25 and OPNAVINST 10126.5.';
  var searchBody = 'A literal [Needle]+ <img src=x onerror="window.fixtureMarkupRan=true"> & more.\nSecond line.';

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
    return select('#msg-list-table-body tr:visible').not('#message-search-loading-row');
  }

  function searchLoadingRow() {
    return select('#msg-list-table-body tr[id="message-search-loading-row"]');
  }

  function assertSearchLoading() {
    var row = searchLoadingRow();
    assert(row.length === 1 && row[0] === row.parent()[0].firstElementChild && row.is(':visible'),
      'Expected one visible search loading row at the top of the table');
    assert(row[0].cells.length === 3 && row.find('.spinner-border').length === 1 &&
      app.jQuery(row[0].cells[1]).find('.spinner-border[role="status"]').length === 1,
      'Expected one search spinner in the Title column');
  }

  function searchFor(query) {
    select('#msg-search-input').val(query).trigger('input');
  }

  function messageRequests(requests) {
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

  function modalShown() {
    var modal = select('#msg-body-modal');
    var controller = modal.data('bs.modal');
    return modal.hasClass('show') && controller && !controller._isTransitioning;
  }

  function modalText() {
    var body = select('#msg-body-modal .modal-body');
    var field = body.find('textarea');
    return field.length ? field.val() : body.text();
  }

  function closeModal() {
    select('#msg-body-modal button[data-dismiss="modal"]').last().trigger('click');
  }

  function messageRoute(number) {
    return app.location.search.indexOf('&number=' + number) !== -1;
  }

  function assertCanonical(query) {
    var links = app.document.querySelectorAll('link[rel="canonical"]');
    var expected = query ? 'https://navadmin-viewer.github.io/' + query : null;
    assert(links.length === (expected ? 1 : 0),
      'Unexpected canonical link count for ' + app.location.search + ': ' + links.length);
    if (expected) {
      assert(links[0].parentNode === app.document.head && links[0].getAttribute('href') === expected,
        'Expected canonical ' + expected + ' but found ' + links[0].getAttribute('href'));
    }
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

  function firstCacheMessages() {
    var messages = ['Old subject', 'Second [Campaign]', 'Missing body', 'Slow missing body'].map(function (title, index) {
      return { type: 0, year: 2025, number: index + 1, title: title, cancelled: false, actSum: [] };
    });
    messages[0].Body = linkedBody;
    return messages;
  }

  function messagesWithBlankCacheBodies() {
    var bodies = [linkedBody, '', '\r\n \t'];
    return ['First [Campaign]', 'Second [Campaign]', 'Missing body'].map(function (title, index) {
      return { type: 0, year: 2025, number: index + 1, title: title, Body: bodies[index] };
    });
  }

  function seedMessageDatabase(scenario, version, years, done) {
    var database = window.indexedDB || window.msIndexedDB;
    var request = database.open(scenario + runId + ':nv-messageCache', version);
    request.onupgradeneeded = function () {
      var db = request.result;
      var metadata = db.createObjectStore('metadata');
      var bodies = db.createObjectStore('bodies');
      var statuses = db.createObjectStore('statuses');
      var now = Date.now();
      years.forEach(function (entry) {
        entry.messages.forEach(function (message) {
          if (typeof message.Body !== 'string') return;
          var key = 'NAVADMIN/' + entry.year + '/' + message.number;
          bodies.put({ type: 0, year: entry.year, number: message.number, status: 200, body: message.Body, savedAt: now }, key);
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
      assert(isDownloaded('First [Campaign]'), 'Repair lost a valid cached body');
      assert(!isDownloaded('Second [Campaign]') && !isDownloaded('Missing body'), 'A blank body was marked downloaded');
      clickRow('Second [Campaign]');
      waitFor(function () {
        return modalShown() && modalText() === 'Body of message 2' && yearComplete('2025');
      }, function () {
        assert(isDownloaded('Second [Campaign]') && !isDownloaded('Missing body'), 'Body and 404 statuses were confused');
        recordRequests(scenario, function (requests) {
          var bodies = messageRequests(requests);
          assert(!bodies.some(function (request) { return request.form.number === '1'; }), 'Repair redownloaded valid text');
          assert(bodies.some(function (request) { return request.form.number === '2' && request.httpStatus === 200; }) &&
            bodies.some(function (request) { return request.form.number === '3' && request.httpStatus === 404; }),
            'An invalid cached body did not trigger a fresh request');
          done();
        });
      });
    });
  }

  steps.push(['Repair blank entries already stored by IndexedDB version 1', function (done) {
    seedMessageDatabase('blankidb', 1, [{ year: 2025, messages: messagesWithBlankCacheBodies() }], function () {
      verifyBlankCacheRepair('blankidb', done);
    });
  }]);

  steps.push(['Reload the repaired IndexedDB cache and search the preserved message text', function (done) {
    closeModal();
    waitFor(function () { return !modalShown() && !messageRoute(2); }, function () {
      recordRequests('blankidb', function (initialRequests) {
        watchViewerLoad(function () { return tableHas('First [Campaign]') && yearComplete('2025'); }, function () {
          assert(messageLink('First [Campaign]').closest('tr').find('th').hasClass('offline-enabled'),
            'The saved download indicator was lost on reload');
          assert(messageLink('Second [Campaign]').closest('tr').find('th').hasClass('offline-enabled'),
            'The downloaded replacement body was lost on reload');
          assert(!messageLink('Missing body').closest('tr').find('th').hasClass('offline-enabled'),
            'Reload marked an unavailable body downloaded');
          assert(select('#msg-search-scope-dropdown .message-search-scope-label').text() === 'Full Message' &&
            select('#msg-search-scope-full-message').attr('aria-checked') === 'true', 'Full Message was not selected by default');
          searchFor('SOURCE TEXT');
          waitFor(function () { return visibleRows().find('.message-search-snippet mark').text() === 'source text'; }, function () {
            assert(visibleRows().length === 1 && visibleRows().find('a').text() === 'First [Campaign]',
              'Full Message did not match the preserved body after reload');
            recordRequests('blankidb', function (requests) {
              assert(messageRequests(requests).length === messageRequests(initialRequests).length,
                'Reload or Full Message search re-requested a settled body');
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
        var row = select('#msg-list-table-body tr').last();
        assert(row.hasClass('table-danger'), 'Cancellation was not refreshed');
        assert(row.text().indexOf('37') >= 0, 'View count was not refreshed');
        assert(row.find('th').hasClass('offline-enabled'), 'Existing offline body was lost');
        done();
      });
    });
  }]);

  steps.push(['Search titles literally and clear the filter', function (done) {
    select('#msg-search-scope-title').trigger('click');
    var search = select('#msg-search-input');
    var existingRow = messageLink('First [Campaign]').closest('tr')[0];
    search.val('[campaign]').trigger('paste');
    waitFor(function () { return searchLoadingRow().length; }, function () {
      assertSearchLoading();
      assert(visibleRows().length === 4 && messageLink('First [Campaign]').closest('tr')[0] === existingRow,
        'Showing the search spinner replaced the existing message rows');
      waitFor(function () { return !searchLoadingRow().length && visibleRows().length === 2; }, function () {
        search.val('').trigger('input').trigger('keyup');
        assert(visibleRows().length === 4, 'Clearing search did not restore all rows');
        search.val('[').trigger('input').trigger('keyup');
        assertSearchLoading();
        searchFor('');
        assert(!searchLoadingRow().length && visibleRows().length === 4,
          'Clearing a pending search did not immediately restore the complete list');
        searchFor('[');
        waitFor(function () { return !searchLoadingRow().length && visibleRows().length === 2; }, function () {
          searchFor('');
          done();
        });
      });
    });
  }]);

  steps.push(['Search titles in every year of the selected message type', function (done) {
    open('archivesearch', '?type=NAVADMIN&year=2025', function () { return tableHas('First [Campaign]'); }, function () {
      select('#msg-search-scope-title').trigger('click');
      searchFor('202');
      waitFor(function () { return visibleRows().length === 3; }, function () {
        assert(tableHas('NAVADMIN 2024 subject') && tableHas('NAVADMIN 2022 subject'), 'Title search missed another year');
        assert(select('#msg-year-dropdown').text() === '2025', 'Title search changed the selected year');
        clickMenu('msg-type', 'ALNAV');
        waitFor(function () { return visibleRows().length === 4 && tableHas('ALNAV 2022 subject'); }, function () {
          assert(!tableHas('NAVADMIN 2022 subject'), 'Title search retained a different message type');
          searchFor('');
          assert(visibleRows().length === 1 && tableHas('ALNAV 2025 subject'), 'Clearing search did not restore the selected year');
          recordRequests('archivesearch', function (requests) {
            assert(messageRequests(requests).every(function (request) { return request.form.year === '2025'; }),
              'Title search downloaded bodies from other years');
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
    waitFor(function () { return modalShown() && modalText() === linkedBody; }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=1');
      var body = select('#msg-body-modal .modal-body');
      var heading = select('#msg-body-modal .modal-title')[0];
      assert(isFocused(heading), 'Opening a message did not focus its heading');
      assert(body.find('.spinner-border').length === 0, 'The spinner stayed after the message loaded');
      var fields = body.find('textarea');
      assert(fields.length === 1 && body.children().length === 1, 'Expected one field for the message body');
      assert(fields.val() === linkedBody, 'Literal markup, line breaks, or reference text changed');
      var field = fields[0];
      assert(field.textContent === linkedBody, 'The message text should be present in the rendered HTML');
      assert(field.readOnly && !field.disabled, 'The message field should be selectable and read-only');
      assert(fields.attr('aria-label') === 'Message text' && field.tabIndex === 0, 'The message field should be named and in the tab order');
      focus(field);
      field.select();
      assert(field.selectionStart === 0 && field.selectionEnd === field.value.length, 'The field did not select the full message');

      var shared = '';
      app.prompt = function (label, link) { shared = link; };
      select('#msg-body-modal .modal-share-link').trigger('click');
      assert(/\/view-message\/\?type=NAVADMIN&year=2025&number=1$/.test(shared), 'Share URL did not match the visible message');
      app.jQuery(field).trigger(app.jQuery.Event('keydown', { which: 27, keyCode: 27 }));
      waitFor(function () { return !modalShown() && !messageRoute(1) && isFocused(opener); }, function () {
        assertCanonical();
        app.history.forward();
        waitFor(function () { return modalShown() && messageRoute(1) && modalText() === linkedBody && isFocused(heading); }, function () {
          assertCanonical('?type=NAVADMIN&year=2025&number=1');
          app.history.back();
          waitFor(function () { return !modalShown() && !messageRoute(1) && isFocused(opener); }, function () {
            assertCanonical();
            done();
          });
        });
      });
    });
  }]);

  steps.push(['Show a missing-body error without marking the row as offline', function (done) {
    open('modal', '', function () { return tableHas('Missing body'); }, function () {
      var opener = messageLink('Missing body')[0];
      focus(opener);
      opener.click();
      var body = select('#msg-body-modal .modal-body');
      assert(app.jQuery(body[0].firstChild).hasClass('spinner-border'), 'The spinner should precede the loading text');
      assert(body.text() === 'Retrieving message\u2026', 'The modal should show its loading text');
      assert(body.find('textarea').length === 0, 'The loading text should remain outside the message field');
      waitFor(function () { return modalShown() && modalText() === 'Message text is not publicly released.'; }, function () {
        assertCanonical('?type=NAVADMIN&year=2025&number=3');
        assert(body.find('.spinner-border').length === 0, 'The spinner stayed after the request failed');
        assert(body.find('textarea').length === 0, 'The error should remain outside the message field');
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
        done();
      });
    });
  }]);

  steps.push(['Canonicalize reordered message parameters and a zero-padded number', function (done) {
    open('canonical', '?number=001&year=2025&type=NAVADMIN', function () {
      return modalShown() && modalText() === linkedBody;
    }, function () {
      assertCanonical('?type=NAVADMIN&year=2025&number=1');
      done();
    });
  }]);

  steps.push(['Use the cached body after reopening with a failing endpoint', function (done) {
    open('offline', '?type=NAVADMIN&year=2025&number=1', function () {
      return modalShown() && modalText() === linkedBody;
    }, function () {
      recordRequests('offline', function (requests) {
        assert(!messageRequests(requests).some(function (request) { return request.form.number === '1'; }),
          'Offline reopen fetched the migrated body');
        app.getYearsForMsgType(0, [2025], function (result) {
          assert(result.requestOutcome === 'error' && result.errorText, 'A failed metadata request did not report an error');
          done();
        });
      });
    });
  }]);

  steps.push(['Coalesce concurrent body requests and retry view registration', function (done) {
    open('activity', '', function () { return tableHas('First [Campaign]'); }, function () {
      var results = [];
      function remember(body) { results.push(body); }
      app.getMsgBody(0, 2025, 8, remember);
      app.getMsgBody(0, 2025, 8, remember);
      waitFor(function () { return results.length === 2; }, function () {
        assert(results[0] === 'Body of message 8' && results[1] === results[0], 'Concurrent callers received different bodies');
        app.sendViewActivity(0, 2025, 1);
        setTimeout(function () {
          app.sendViewActivity(0, 2025, 2);
          app.sendViewActivity(0, 2025, 3);
          setTimeout(function () {
            recordRequests('activity', function (requests) {
              var bodyRequests = messageRequests(requests).filter(function (row) { return row.form.number === '8'; });
              var registrations = requests.filter(function (row) { return row.endpoint === 'updateUserInfo'; });
              var views = requests.filter(function (row) { return row.endpoint === 'updateUserActivity'; });
              assert(bodyRequests.length === 1, 'Concurrent callers sent multiple body requests');
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

  steps.push(['Browse all four message types', function (done) {
    var names = ['ALNAV', 'MARADMIN', 'ALMAR', 'NAVADMIN'];
    function nextType() {
      var name = names.shift();
      clickMenu('msg-type', name);
      waitFor(function () {
        return tableHas(name === 'NAVADMIN' ? 'First [Campaign]' : name + ' 2025 subject');
      }, function () {
        assertCanonical('?type=' + name);
        if (names.length) nextType();
        else done();
      });
    }
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

  steps.push(['Use the session cache after an IndexedDB startup read throws', function (done) {
    var subject = 'NAVADMIN 2023 subject';
    open('cacheread', '?type=NAVADMIN&year=2023', function () {
      return tableHas(subject) && warningProgress('2023', '1/1');
    }, function () {
      assert(app.cacheReadAttempts, 'The viewer did not encounter the simulated cache read error');
      clickRow(subject);
      waitFor(function () { return modalShown() && modalText() === linkedBody; }, done);
    });
  }]);

  steps.push(['Download the selected year automatically and keep failures partial', function (done) {
    open('bulk', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && yearProgress('2025') === '0/4';
    }, function () {
      select('#msg-year-dropdown')[0].click();
      var active = menuItem('msg-year', '2025').find('.message-year-progress-active')[0];
      assert(active && yearProgress('2025') === '0/4', 'The progress bar did not animate when the download started');
      var reducedMotion = app.matchMedia && app.matchMedia('(prefers-reduced-motion: reduce)').matches;
      assert(app.getComputedStyle(active, ':after').animationName === (reducedMotion ? 'none' : 'progress-bar-stripes'),
        'The progress animation did not honor the motion preference');
      select('#msg-search-scope-full-message').trigger('click');
      searchFor('[needle]+');
      assert(!visibleRows().find('mark').length, 'Body search matched an unprocessed message');
      waitFor(function () {
        return yearProgress('2025') === '3/4' && visibleRows().length === 1 &&
          menuItem('msg-year', '2025').find('.message-year-download-note').text() === 'Select year to retry';
      }, function () {
        assert(!yearComplete('2025'), 'A transient failure marked the year complete');
        assert(!menuItem('msg-year', '2025').find('.message-year-progress-active').length, 'A paused download kept animating');
        assert(menuItem('msg-year', '2025').find('.message-year-progress')[0] === active, 'The progress bar was replaced during the download');
        assert(menuItem('msg-year', '2025').find('.message-year-label').text() === '2025', 'Progress changed the year label');
        assert(!menuItem('msg-year', '2024').find('.message-year-progress').length, 'An unselected year showed download progress');
        assert(visibleRows().find('a').text() === 'Second [Campaign]', 'Body results did not update after caching');
        recordRequests('bulk', function (requests) {
          var bodies = messageRequests(requests);
          assert(bodies.length === 4 && bodies.every(function (request) {
            return request.form.type === 'NAVADMIN' && request.form.year === '2025';
          }), 'Background requests did not target exactly the selected year');
          assert(bodies.some(function (request) { return request.form.number === '3' && request.httpStatus === 404; }),
            'Download progress did not include the unavailable message');
          done();
        });
      });
    });
  }]);

  steps.push(['Search and highlight literal body text without rendering markup', function (done) {
    var snippet = visibleRows().find('.message-search-snippet');
    assert(snippet.find('mark').text() === '[Needle]+', 'The result did not highlight the literal body match');
    assert(snippet.text().indexOf('<img') >= 0 && !snippet.find('img').length, 'The snippet interpreted body markup');
    clickRow('Second [Campaign]');
    waitFor(function () { return modalShown() && modalText() === searchBody; }, function () {
      var body = select('#msg-body-modal .modal-body');
      assert(!body.find('img').length && !app.fixtureMarkupRan, 'The modal interpreted body markup');
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
                'Clearing body search did not restore the complete list');
              done();
            });
          });
        });
      });
    });
  }]);

  steps.push(['Keep archive search and year progress stable on a warm year switch', function (done) {
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
          var getBodyStatus = store.getBodyStatus;
          var unrelatedChecks = 0;
          store.getBodyStatus = function (type, year, number) {
            if (type === 0 && year === 2024) {
              unrelatedChecks++;
              return null;
            }
            return getBodyStatus(type, year, number);
          };

          clickMenu('msg-year', '2023');
          assert(select('#msg-year-dropdown').text() === '2023', 'The cached year switch did not settle');
          assert(app.activeSearch === search && !search.timer && !search.running && tableHas(cachedSubject),
            'An unchanged year switch reran the archive search');
          assert(!unrelatedChecks && yearComplete('2024'), 'The year switch recalculated unrelated progress');

          var yearButton = select('#msg-year-dropdown')[0];
          yearButton.click();
          assert(unrelatedChecks > 0 && yearProgress('2024') === '0/1', 'Opening the year menu did not refresh progress');
          store.getBodyStatus = getBodyStatus;
          yearButton.click();

          var metadataKey = 'type=NAVADMIN&yearsMetadata=2024';
          app.requestThrottleByKey.delete(metadataKey);
          clickMenu('msg-year', '2024');
          assert(app.pendingCallbacksByRequestKey.has(metadataKey), 'The changed title request did not start');
          clickMenu('msg-year', '2023');
          waitFor(function () { return tableHas(refreshedSubject) && !tableHas(cachedSubject); }, function () {
            assert(select('#msg-year-dropdown').text() === '2023', 'Late archive metadata changed the selected year');
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
      { year: 2024, messages: [{ type: 0, year: 2024, number: 1, title: cachedSubject, Body: linkedBody }] }
    ];
    function assertSilentSearch(message) {
      assert(!app.fixtureSearchSpinnerInsertions && !searchLoadingRow().length, message);
    }
    seedMessageDatabase(scenario, 2, years, function () {
      open(scenario, '?type=NAVADMIN&year=2025', function () {
        var search = app.activeSearch;
        return app.fixtureFinishCacheRead && search && !search.timer && !search.running;
      }, function () {
        assertSilentSearch('Restored text showed a search spinner while reading the cache');
        var writes = app.fixtureHeldBodyWrites;
        app.fixtureFinishCacheRead();
        waitFor(function () {
          return tableHas(cachedSubject) && visibleRows().find('mark').length === 2 && writes[2] && writes[3];
        }, function () {
          assertSilentSearch('Finishing the restored search showed a spinner');
          app.getYearsForMsgType(0, [2024], null, true);
          waitFor(function () { return tableHas(refreshedSubject) && !tableHas(cachedSubject); }, function () {
            assertSilentSearch('Refreshing metadata showed a search spinner');
            writes[2]();
            waitFor(function () { return visibleRows().find('mark').length === 3 && tableHas('Second [Campaign]'); }, function () {
              assertSilentSearch('The first background body showed a search spinner');
              writes[3]();
              waitFor(function () { return visibleRows().find('mark').length === 4 && tableHas('Missing body'); }, function () {
                assertSilentSearch('The second background body showed a search spinner');
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
    var unreadableSubject = 'Unreadable archive subject';
    var memorySubject = 'In-memory archive subject';
    var years = [
      { year: 2025, messages: [
        { type: 0, year: 2025, number: 1, title: unreadableSubject, Body: linkedBody },
        { type: 0, year: 2025, number: 2, title: memorySubject }
      ] },
      { year: 2023, messages: [{ type: 0, year: 2023, number: 1, title: readableSubject, Body: linkedBody }] }
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
            throw new Error('Test interrupted body cursor');
          }
          return openCursor.apply(this, arguments);
        };
        prototype.put = function () {
          if (this.name === 'bodies') throw new Error('Test denied body write');
          return put.apply(this, arguments);
        };

        var store = app.Navadmin.messageStore;
        store.saveBodyResult(0, 2025, 2, linkedBody, 200, function () {
          prototype.put = put;
          var listBodyRecords = store.listBodyRecords;
          var finishRead;
          store.listBodyRecords = function (type, year, callback) {
            listBodyRecords.call(store, type, year, function (records) {
              finishRead = function () { callback(records); };
            });
          };
          searchFor('source text');
          waitFor(function () {
            return finishRead && !app.activeSearch.timer && !app.activeSearch.running;
          }, function () {
            assertSearchLoading();
            store.listBodyRecords = listBodyRecords;
            finishRead();
            waitFor(function () {
              return !searchLoadingRow().length && visibleRows().find('mark').length >= 2;
            }, function () {
              assert(failedReads === 1, 'Search attempted to read the failed year again');
              assert(!store.getBodyStatus(0, 2025, 2).persistent, 'The fixture body was saved to IndexedDB');
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
    var body = Array(61).join('Cached text with line breaks\r\nand irregular   spacing. ') + 'archive hit';
    var years = [2025, 2023].map(function (year) {
      var messages = [];
      for (var number = 1; number <= messagesPerYear; number++) {
        messages.push({ type: 0, year: year, number: number, title: 'Archive ' + year + '/' + number,
          Body: year === 2025 && number === messagesPerYear ? body + ' and final archive hit' : body });
      }
      return { year: year, messages: messages };
    });
    seedMessageDatabase('searchburst', 2, years, function () {
      open('searchburst', '?type=NAVADMIN&year=2025', function () {
        return tableHas('Archive 2025/300') && select('#msg-year-dropdown-menu [data-message-year="2024"]').length;
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
              searchFor('final archive hit');
            }, 0);
          }
          return originalCreate(message);
        };
        clickMenu('msg-year', '2024');
        searchFor('a');
        searchFor('arch');
        searchFor('archive hit');
        assert(!created, 'Typing synchronously constructed search result rows');
        waitFor(function () {
          var mark = table.querySelector('mark');
          return !searchLoadingRow().length && mark && mark.textContent === 'final archive hit' && table.rows.length === 1;
        }, function () {
          assert(typedDuringSearch, 'The result builder did not yield before committing the large result set');
          assert(tableHas('Archive 2025/300'), 'The latest query lost a result outside the selected year');
          searchFor('archive hit');
          waitFor(function () {
            return !searchLoadingRow().length && table.rows.length === 2 * messagesPerYear + 1 && yearComplete('2024');
          }, function () {
            assert(tableHas('Archive 2023/300') && tableHas('NAVADMIN 2024 subject'), 'Search missed cached or newly downloaded text');
            assert(select('#msg-year-dropdown').text() === '2024', 'Search changed the selected year');
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
          var fetched = messageRequests(requests).map(function (request) {
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
          assert(select('#msg-year-dropdown').text() === '2024', 'Download completion changed the selected year');
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
      clickMenu('msg-year', '2024');
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
        waitFor(function () { return yearComplete('2025') && yearComplete('2024'); }, done);
      });
    });
  }]);

  steps.push(['Reuse saved bodies and retry an unresolved year through Download all years', function (done) {
    open('bulkresume', '?type=NAVADMIN&year=2025', function () {
      return tableHas('First [Campaign]') && yearProgress('2025') === '3/4';
    }, function () {
      recordRequests('bulkresume', function (requests) {
        assert(messageRequests(requests).every(function (request) { return request.form.number === '4'; }),
          'A reload requested settled bodies again');
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
            assert(select('#msg-year-dropdown').text() === '2024' && select('#msg-search-input').val() === 'source text',
              'Bulk completion changed the selected year or search query');
            assert(tableHas('NAVADMIN 2022 subject') && tableHas('NAVADMIN 2024 subject'), 'Full Message did not include newly saved years');
            recordRequests('bulkresume', function (bulkRequests) {
              var bodies = messageRequests(bulkRequests);
              var retried = bodies.filter(function (request) {
                return request.form.year === '2025' && request.form.number === '4';
              });
              assert(retried.length === 2 && retried[0].httpStatus === 503 && retried[1].httpStatus === 200,
                'All-year downloading did not retry the unresolved body');
              assert(bodies.every(function (request) { return request.form.type === 'NAVADMIN'; }),
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
            waitFor(function () { return modalShown() && modalText() === linkedBody; }, function () {
              recordRequests('bulkoffline', function (requests) {
                assert(!messageRequests(requests).length, 'The offline reopen fetched already settled bodies');
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
        assert(!yearComplete('2025') && !yearComplete('2024'), 'Session downloads showed a persistent checkmark');
        var current = menuItem('msg-year', '2024').find('.message-year-progress');
        assert(!current.hasClass('message-year-progress-active') && /until reload/.test(current.attr('aria-valuetext')),
          'The completed session bar did not describe its temporary cache');
        searchFor('');
        clickMenu('msg-year', '2025');
        clickRow('Missing body');
        waitFor(function () { return modalShown() && modalText() === 'Message text is not publicly released.'; }, function () {
          recordRequests('sessioncache', function (requests) {
            assert(messageRequests(requests).length === 5, 'Revisiting a session-cached year fetched a body again');
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
    var olderSubjects = ['Retained older archive subject 2023', 'Retained older archive subject 2024'];
    var olderBodies = [linkedBody + '\n2023 session-only fixture', linkedBody + '\n2024 session-only fixture'];
    var years = [{ year: 2022, messages: [{ type: 0, year: 2022, number: 1, title: 'NAVADMIN 2022 subject', Body: linkedBody }] }];
    [2023, 2024].forEach(function (year, index) {
      years.push({ year: year, messages: [{ type: 0, year: year, number: 1, title: olderSubjects[index], Body: olderBodies[index] }] });
    });
    years.push({ year: 2025, messages: [
      { type: 0, year: 2025, number: 1, title: 'First recent archive subject' },
      { type: 0, year: 2025, number: 2, title: 'Second recent archive subject' },
      { type: 0, year: 2025, number: 3, title: 'Third recent archive subject' }
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
              'A session-only year was still marked downloaded after reload');
            reloadedStore.getBodyRecord(0, 2023, 1, function (firstRecord) {
              assert(!firstRecord, 'The first evicted body was still stored in IndexedDB');
              reloadedStore.getBodyRecord(0, 2024, 1, function (secondRecord) {
                assert(!secondRecord, 'The second evicted body was still stored in IndexedDB');
                select('#msg-search-scope-title').trigger('click');
                searchFor('Retained older archive subject');
                waitFor(function () { return olderSubjects.every(tableHas); }, done);
              });
            });
          });
        }

        function verifyOpeningEvictedBody(index, next) {
          clickRow(olderSubjects[index]);
          waitFor(function () { return modalShown() && modalText() === olderBodies[index]; }, function () {
            closeModal();
            waitFor(function () { return !modalShown() && !messageRoute(1); }, next);
          });
        }

        searchFor('source text');
        waitFor(function () { return olderSubjects.every(tableHas); }, function () {
          store.saveBodyResult(0, 2025, 1, linkedBody, 200, recordSaved);
          store.saveBodyResult(0, 2025, 2, linkedBody, 200, recordSaved);
          waitFor(function () {
            return completed === 2 && yearProgress('2025') === '2/3' && warningProgress('2023', '1/1') &&
              tableHas('First recent archive subject');
          }, function () {
            assert(Object.keys(failedWrites).length === 2, 'Both concurrent writes should encounter quota');
            assert(yearComplete('2022'), 'Quota recovery removed the selected year');
            assert(yearComplete('2024'), 'Concurrent quota errors evicted a second year');
            assert(tableHas(olderSubjects[0]), 'The active search lost the first evicted year');

            store.saveBodyResult(0, 2025, 3, linkedBody, 200, recordSaved);
            waitFor(function () {
              return completed === 3 && yearComplete('2025') && warningProgress('2024', '1/1') &&
                tableHas('Third recent archive subject');
            }, function () {
              prototype.put = put;
              assert(Object.keys(failedWrites).length === 3, 'The third body did not trigger a new quota recovery');
              assert(yearComplete('2022') && warningProgress('2023', '1/1') && !yearComplete('2023') && !yearComplete('2024'),
                'The year indicators did not distinguish persistent and session-only bodies');
              searchFor('session-only fixture');
              waitFor(function () { return olderSubjects.every(tableHas) && visibleRows().length === 2; }, function () {
                verifyOpeningEvictedBody(0, function () {
                  verifyOpeningEvictedBody(1, function () {
                    recordRequests(scenario, function (requests) {
                      assert(!messageRequests(requests).some(function (request) {
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
      { type: 0, year: 2026, number: 1, title: 'Newer retained archive subject', Body: linkedBody }
    ] };
    seedMessageDatabase('quota', 2, [newerYear], function () {
      open('quota', '?type=NAVADMIN&year=2025', function () {
        return tableHas('First [Campaign]') && warningProgress('2025', '4/4');
      }, function () {
        assert(!yearComplete('2025'), 'A year with session-only bodies showed a checkmark');
        assert(yearComplete('2026'), 'Quota recovery removed a newer year');
        assert([1, 2, 3, 4].filter(function (number) {
          return app.Navadmin.messageStore.getBodyStatus(0, 2025, number).persistent;
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
        assert(app.deniedDatabaseBodyWrites > 0, 'The simulated IndexedDB body write did not fail');
        assert(yearComplete('2023') && !yearComplete('2025'), 'The two years did not show their different storage states');
        searchFor('source text');
        waitFor(function () {
          return tableHas('First [Campaign]') && tableHas('NAVADMIN 2023 subject') && visibleRows().length === 2;
        }, function () {
          open('writefallbackoffline', '?type=NAVADMIN&year=2023&number=1', function () {
            return tableHas('NAVADMIN 2023 subject') && yearComplete('2023') && modalShown() && modalText() === linkedBody;
          }, function () {
            assert(!app.Navadmin.messageStore.getBodyStatus(0, 2025, 1), 'An aborted write persisted a body across reload');
            recordRequests('writefallbackoffline', function (requests) {
              assert(!messageRequests(requests).length, 'Offline reopen attempted to fetch an IndexedDB body');
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
        waitFor(function () { return modalShown() && modalText() === linkedBody; }, done);
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
      waitFor(function () { return modalShown() && modalText() === linkedBody; }, function () {
        var modal = select('#msg-body-modal')[0];
        var dialog = select('#msg-body-modal .modal-dialog')[0];
        var content = select('#msg-body-modal .modal-content')[0];
        var body = select('#msg-body-modal .modal-body')[0];
        var heading = select('#msg-body-modal .modal-title');
        var field = select('#msg-body-modal .modal-body textarea')[0];
        var close = select('#msg-body-modal .modal-header .close')[0];
        var footerButtons = select('#msg-body-modal .modal-footer button');
        var normalHeading = heading.text();
        var longWord = new Array(24).join('UnbrokenText');
        var longBody = 'First line\n' + longWord + '\n' + new Array(50).join('More message text\n') + 'Last line';
        app.jQuery(field).val(longBody);

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
          var bodyStyle = app.getComputedStyle(body);
          var contentBounds = content.getBoundingClientRect();
          var fieldBounds = field.getBoundingClientRect();
          var availableHeight = app.innerHeight - parseFloat(margins.marginTop) - parseFloat(margins.marginBottom);
          var bodyHeight = body.clientHeight - parseFloat(bodyStyle.paddingTop) - parseFloat(bodyStyle.paddingBottom);
          var contentHeight = contentBounds.bottom - contentBounds.top;
          var fieldHeight = fieldBounds.bottom - fieldBounds.top;
          assert(Math.abs(contentHeight - availableHeight) <= 2,
            'The dialog used ' + contentHeight + 'px of ' + availableHeight + 'px available');
          assert(bodyHeight > 0 && Math.abs(fieldHeight - bodyHeight) <= 2,
            'The message field used ' + fieldHeight + 'px of ' + bodyHeight + 'px inside the body');
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

        assert(modalText() === longBody, 'Message line breaks were not preserved');
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
