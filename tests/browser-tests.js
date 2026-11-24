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

  function open(scenario, url, ready, next) {
    frame.onload = function () {
      app = frame.contentWindow;
      if (!app.jQuery) return;
      frame.onload = null;
      app.onerror = function (message) { report('FAIL: ' + currentStep + ': ' + message); };
      waitFor(ready, next);
    };
    frame.src = '/case/' + scenario + runId + '/' + url;
  }

  function select(selector) {
    return app.jQuery(selector);
  }

  function clickMenu(id, label) {
    var item = select('#' + id + '-dropdown-menu a').filter(function () {
      return app.jQuery(this).text() === label;
    });
    assert(item.length === 1, 'Expected one menu item for ' + label);
    item.trigger('click');
  }

  function clickRow(title) {
    var link = select('#msg-list-table-body a').filter(function () {
      return app.jQuery(this).text() === title;
    });
    assert(link.length === 1, 'Expected one message titled ' + title);
    link.trigger('click');
  }

  function tableHas(title) {
    return select('#msg-list-table-body').text().indexOf(title) !== -1;
  }

  function modalShown() {
    var modal = select('#msg-body-modal');
    var controller = modal.data('bs.modal');
    return modal.hasClass('show') && controller && !controller._isTransitioning;
  }

  function modalText() {
    return select('#msg-body-modal .modal-body').text();
  }

  function closeModal() {
    select('#msg-body-modal button[data-dismiss="modal"]').last().trigger('click');
  }

  function messageRoute(number) {
    return app.location.search.indexOf('&number=' + number) !== -1;
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

  function firstCache() {
    var messages = ['Old subject', 'Second [Campaign]', 'Missing body', 'Slow missing body'].map(function (title, index) {
      return { type: 0, year: 2025, number: index + 1, title: title, cancelled: false, actSum: [] };
    });
    messages[0].Body = linkedBody;
    localStorage.setItem(cacheKey, JSON.stringify(['window.Map', [[0, ['window.Map', [[2025, messages]]]]]]));
  }

  steps.push(['Refresh existing metadata and preserve an old offline cache', function (done) {
    firstCache();
    open('main', '', function () { return tableHas('First [Campaign]'); }, function () {
      var row = select('#msg-list-table-body tr').last();
      assert(row.hasClass('table-danger'), 'Cancellation was not refreshed');
      assert(row.text().indexOf('37') >= 0, 'View count was not refreshed');
      assert(row.find('th').hasClass('offline-enabled'), 'Existing offline body was lost');
      done();
    });
  }]);

  steps.push(['Search titles literally and clear the filter', function (done) {
    var search = select('#msg-search-input');
    search.val('[campaign]').trigger('paste');
    waitFor(function () { return select('#msg-list-table-body tr:visible').length === 2; }, function () {
      search.val('[').trigger('input').trigger('keyup');
      assert(select('#msg-list-table-body tr:visible').length === 2, 'Single bracket was not treated literally');
      search.val('').trigger('input').trigger('keyup');
      assert(select('#msg-list-table-body tr:visible').length === 4, 'Clearing search did not restore all rows');
      done();
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
      app.history.forward();
      waitFor(function () { return tableHas('NAVADMIN 2023 subject'); }, function () {
        clickMenu('msg-year', '2025');
        waitFor(function () { return tableHas('First [Campaign]'); }, done);
      });
    });
  }]);

  steps.push(['Reuse metadata in flight when returning to a year', function (done) {
    clickMenu('msg-year', '2022');
    clickMenu('msg-year', '2023');
    clickMenu('msg-year', '2022');
    waitFor(function () { return tableHas('NAVADMIN 2022 subject'); }, function () {
      recordRequests('main', function (requests) {
        var requestsForYear = requests.filter(function (row) {
          return row.endpoint === 'messages' && row.form.yearsMetadata === '2022';
        });
        assert(requestsForYear.length === 1, 'Returning to the pending year sent multiple requests');
        clickMenu('msg-year', '2025');
        waitFor(function () { return tableHas('First [Campaign]'); }, done);
      });
    });
  }]);

  steps.push(['Render literal message text, references and nested message history', function (done) {
    clickRow('First [Campaign]');
    waitFor(function () { return modalShown() && modalText() === linkedBody; }, function () {
      var body = select('#msg-body-modal .modal-body');
      assert(body.find('.spinner-border').length === 0, 'The spinner stayed after the message loaded');
      assert(body.find('tag').length === 0, 'Literal markup became a DOM element');
      assert(body.find('a').length === 2, 'Expected a message link and a document link');
      assert(body.find('a').eq(1).attr('href').indexOf('https://www.google.com/') === 0, 'Document search link was lost');
      body.find('a').first()[0].click();
      waitFor(function () { return modalText() === 'Body of message 2' && messageRoute(2); }, function () {
        var shared = '';
        app.prompt = function (label, link) { shared = link; };
        select('#msg-body-modal .modal-share-link').trigger('click');
        assert(/\/view-message\/\?type=NAVADMIN&year=2025&number=2$/.test(shared), 'Share URL did not match the visible message');
        app.history.back();
        waitFor(function () { return modalText() === linkedBody && messageRoute(1); }, function () {
          app.history.forward();
          waitFor(function () { return modalText() === 'Body of message 2' && messageRoute(2); }, function () {
            closeModal();
            waitFor(function () { return !modalShown() && !messageRoute(1) && !messageRoute(2); }, done);
          });
        });
      });
    });
  }]);

  steps.push(['Show a missing-body error without marking the row as offline', function (done) {
    clickRow('Missing body');
    var body = select('#msg-body-modal .modal-body');
    assert(app.jQuery(body[0].firstChild).hasClass('spinner-border'), 'The spinner should precede the loading text');
    assert(body.text() === 'Retrieving message\u2026', 'The modal should show its loading text');
    waitFor(function () { return modalShown() && modalText() === 'Message text is not publicly released.'; }, function () {
      assert(body.find('.spinner-border').length === 0, 'The spinner stayed after the request failed');
      var missing = select('#msg-list-table-body tr').filter(function () {
        return app.jQuery(this).find('a').text() === 'Missing body';
      });
      assert(!missing.find('th').hasClass('offline-enabled'), 'A failed response was marked available offline');
      closeModal();
      waitFor(function () { return !modalShown() && !messageRoute(3); }, done);
    });
  }]);

  steps.push(['Ignore the earlier modal error after another message opens', function (done) {
    clickRow('Slow missing body');
    app.prepareAndShowMessageModal(0, 2025, 2, null);
    waitFor(function () { return modalShown() && modalText() === 'Body of message 2'; }, function () {
      setTimeout(function () {
        assert(modalText() === 'Body of message 2' && messageRoute(2), 'A stale error changed the visible message');
        app.Navadmin.messageStore.save();
        done();
      }, 550);
    });
  }]);

  steps.push(['Open a redirected shared message before its skeleton exists', function (done) {
    open('direct', 'view-message/?type=NAVADMIN&year=2025&number=9', function () {
      return modalShown() && messageRoute(9) && modalText() === 'Body of message 9';
    }, function () {
      closeModal();
      waitFor(function () { return !modalShown() && !messageRoute(9) && tableHas('First [Campaign]'); }, done);
    });
  }]);

  steps.push(['Use the cached body after reopening with a failing endpoint', function (done) {
    open('offline', '?type=NAVADMIN&year=2025&number=1', function () {
      return modalShown() && modalText() === linkedBody;
    }, function () {
      recordRequests('offline', function (requests) {
        assert(!requests.some(function (row) { return row.endpoint === 'message'; }), 'Offline reopen fetched the saved body');
        app.getYearsForMsgType(0, [2025], false, function (result) {
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
              var bodyRequests = requests.filter(function (row) { return row.endpoint === 'message'; });
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
        app.getYearsForMsgType = function (type, years, latest, complete) {
          if (type !== 0 || years.length !== 1 || years[0] !== 2025) {
            return getYears(type, years, latest, complete);
          }

          // Change the same store object after the initial render and before the refresh settles.
          var renderedRow = select('#msg-list-table-body tr').last()[0];
          if (editCachedMessage) {
            var message = app.Navadmin.messageStore.findMessage(0, 2025, 1);
            message.title = editedTitle;
            message.actSum[0].actNumber = 73;
          }

          return getYears(type, years, latest, function (result) {
            complete(result);
            var currentRow = select('#msg-list-table-body tr').last();
            assert(currentRow.find('a').text() === editedTitle, 'The table did not apply the edited cached title');
            assert(currentRow.text().indexOf('73') !== -1, 'The table did not apply the edited cached count');
            assert((currentRow[0] !== renderedRow) === editCachedMessage, 'The table replaced rows unexpectedly or skipped a redraw');
            assert(result.requestOutcome === 'cooldown' && result.errorText === null, 'The metadata request did not report its cooldown');
            settled = true;
          });
        };

        try {
          clickMenu('msg-year', '2025');
          assert(settled, 'The cooled-down refresh did not settle from cache');
        } finally {
          app.getYearsForMsgType = getYears;
        }
      }

      getYears(0, [2023], false, function (result) {
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

  steps.push(['Load and save messages after the saved cache read throws', function (done) {
    var subject = 'NAVADMIN 2023 subject';
    open('cacheread', '?type=NAVADMIN&year=2023', function () { return tableHas(subject); }, function () {
      assert(app.cacheReadAttempts === 1, 'The viewer did not encounter the simulated cache read error');
      clickRow(subject);
      waitFor(function () { return modalShown() && modalText() === linkedBody; }, function () {
        firstCache();
        assert(app.Navadmin.messageStore.save() === true, 'The store did not save the new cache after the read error');
        var savedCache = app.deserializeMapString(localStorage.getItem(cacheKey));
        var years = savedCache && savedCache.get(0);
        var messages = years && years.get(2023);
        assert(messages && messages[0] && messages[0].title === subject && messages[0].Body === linkedBody,
          'The new cache did not contain the downloaded message');
        done();
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
