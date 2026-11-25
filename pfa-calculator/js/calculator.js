(function ($, scoring) {
  'use strict';

  var $form = $('#pfa-form');
  var $result = $('[data-result]');
  var $dataStatus = $('#pfa-data-status');
  var $eventStatus = $('#pfa-event-status');
  var $prtSummary = $result.filter('[data-result="prt-summary"]');
  var $goalScore = $('#pfa-goal-score');
  var $bikeModel = $('#pfa-bike-model');
  var $cardioCards = $('[data-cardio]');
  var main = document.getElementById('pfa-main');
  var resultsPanel = document.getElementById('pfa-results');
  var resultsFrame;
  var revealFocusedField = false;
  var resultsHeight = 0;
  var tables = {};
  var bcaFields = ['height', 'weight', 'waist', 'abdomen', 'neck', 'circumference', 'natural-waist', 'hips'];
  var tableNames = { current: '2026 BCA', historical: '2025 BCA', prt: 'PRT', bike: 'bike' };
  var eventLabels = {
    pushups: 'Push-ups', plank: 'Forearm plank', run: 'Run/walk', treadmill: 'Treadmill',
    row: 'Row', swimYd: '500-yard swim', swimM: '450-meter swim', bike: 'Stationary bike'
  };

  var bcaLabels = {
    pending: 'Awaiting measurements',
    'record-weight': 'Within ratio · enter weight',
    'fat-required': 'Body fat required',
    'abdomen-required': 'Abdomen required',
    'tape-required': 'Tape required',
    pass: 'Within standards',
    fail: 'Outside standards',
    prims: 'Check PRIMS'
  };
  var pfaLabels = {
    pending: 'Pending',
    'awaiting-exemption': 'Awaiting PRT',
    pass: 'Pass',
    'pass-exemption': 'Pass · BCA exemption',
    fail: 'Fail',
    prims: 'Check PRIMS'
  };
  var bcaSummaryLabels = {
    pending: 'Pending', 'record-weight': 'Enter weight', 'fat-required': 'Body fat needed',
    'abdomen-required': 'Enter abdomen', 'tape-required': 'Enter tape', pass: 'Pass', fail: 'Fail', prims: 'Check PRIMS'
  };
  var tones = {
    pass: 'success', 'pass-exemption': 'success', fail: 'danger', prims: 'warning',
    'fat-required': 'warning', 'abdomen-required': 'warning', 'tape-required': 'warning'
  };

  function field(name) {
    return document.getElementById('pfa-' + name);
  }

  function queueResultsLayout(reveal) {
    revealFocusedField = revealFocusedField || reveal === true;
    if (resultsFrame !== undefined) return;
    resultsFrame = window.requestAnimationFrame(function () {
      resultsFrame = undefined;
      var viewport = window.visualViewport;
      var offset = viewport && Math.abs(viewport.scale - 1) < 0.01 ?
        Math.max(0, Math.round(document.documentElement.clientHeight - viewport.height - viewport.offsetTop)) : 0;
      resultsPanel.style.bottom = offset ? offset + 'px' : '';
      // When raised above the keyboard, the home indicator no longer overlaps the strip.
      resultsPanel.style.paddingBottom = offset ? '0' : '';

      var rect = resultsPanel.getBoundingClientRect();
      var height = Math.ceil(rect.height);
      var clearance = height + offset;
      main.style.paddingBottom = clearance + 24 + 'px';
      document.documentElement.style.scrollPaddingBottom = clearance + 8 + 'px';

      var active = document.activeElement;
      if ((revealFocusedField || height > resultsHeight) && active && main.contains(active)) {
        var covered = Math.ceil(active.getBoundingClientRect().bottom - rect.top + 8);
        if (covered > 0) window.scrollBy(0, covered);
      }
      revealFocusedField = false;
      resultsHeight = height;
    });
  }

  function reportValidation(input) {
    if (typeof input.reportValidity !== 'function' || input !== document.activeElement ||
      !input.willValidate || input.validity.valid) return;
    input.reportValidity();
  }

  function number(name) {
    var input = field(name);
    var raw = input.value.trim();
    var value = Number(raw);
    var validity = input.validity;
    var invalidNumber = raw !== '' && (!/^\d*\.?\d+$/.test(raw) || !isFinite(value));
    var nativeError = validity.badInput || validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch;
    input.setCustomValidity(invalidNumber && !nativeError ? 'Enter a number using digits and a decimal point if needed.' : '');
    return raw === '' || !input.validity.valid ? null : value;
  }

  function formatTime(value) {
    var seconds = value % 60;
    return Math.floor(value / 60) + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  function eventTime(name, leaving) {
    var input = field(name);
    var raw = input.value.trim();
    var value = scoring.parseTime(raw);
    var invalid = raw !== '' && (value === null || (value === 0 && name !== 'plank'));
    input.setCustomValidity(invalid ? input.getAttribute('data-invalid-message') : '');
    if (input === leaving && !invalid && value !== null && raw.indexOf(':') === -1) {
      input.value = formatTime(value);
    }
    return invalid ? null : value;
  }

  function draw(name, text, tone) {
    var changed = false;
    $result.filter('[data-result="' + name + '"]').each(function () {
      var $element = $(this);
      if (this.textContent !== text) {
        this.textContent = text;
        changed = true;
      }
      if ($element.hasClass('badge')) {
        $element.removeClass('badge-secondary badge-success badge-warning badge-danger')
          .addClass('badge-' + (tone || 'secondary')).toggleClass('text-body', tone === 'success');
      } else {
        $element.toggleClass('font-weight-bold', Boolean(tone));
      }
    });
    return changed;
  }

  function fatText(percent, limit, status) {
    var label = status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Check PRIMS';
    return percent + '% · ' + label + ' (limit ' + limit + '%)';
  }

  function drawBcaPlaceholders(targets) {
    bcaFields.forEach(function (name) {
      var input = field(name);
      var bounds = targets[name === 'natural-waist' ? 'circumference' : name];
      var placeholder = '';
      if (bounds && !input.disabled) {
        if (bounds.minimum === undefined) placeholder = '≤ ' + bounds.maximum;
        else if (bounds.maximum === undefined) placeholder = '≥ ' + bounds.minimum;
        else placeholder = bounds.minimum === bounds.maximum ? String(bounds.minimum) : bounds.minimum + '–' + bounds.maximum;
      }
      if (input.placeholder !== placeholder) input.placeholder = placeholder;
    });
  }

  function drawCurrentBca(bca) {
    var steps = {
      waiting: 'Waiting for waist-to-height result',
      'not-required': 'Not required',
      'need-weight': 'Required · enter weight',
      'need-sex': 'Required · select sex',
      'outside-table': 'Outside published table · Check PRIMS'
    };
    var ratioText = bca.waistStep === 'pending' ? 'Enter height and waist' :
      bca.ratio.toFixed(4) + ' · ' + (bca.waistStep === 'pass' ? 'Within limit' : 'Over limit');
    draw('ratio', ratioText);
    draw('current-fat', bca.fatStep === 'scored' ? fatText(bca.fatPercent, bca.fatLimit, bca.status) : steps[bca.fatStep], tones[bca.status]);
  }

  function drawHistoricalBca(bca, female) {
    var weighIn = {
      pending: 'Waiting for weigh-in',
      'need-sex': 'Select sex for the weight limit',
      'outside-table': 'Outside published height range · Check PRIMS',
      pass: 'Within weight limit (' + bca.weightLimit + ' lb)',
      over: 'Over ' + bca.weightLimit + ' lb · abdomen required'
    };
    var abdomen = {
      'wait-weigh-in': 'Waiting for weigh-in',
      'not-required': 'Not required',
      required: 'Required · limit ' + bca.abdomenLimit + ' in',
      pass: 'Within ' + bca.abdomenLimit + ' in limit',
      over: 'Over ' + bca.abdomenLimit + ' in · tape required'
    };
    var tape = {
      'wait-weigh-in': 'Waiting for weigh-in',
      'wait-abdomen': 'Waiting for abdomen result',
      'not-required': 'Not required',
      required: 'Required · enter tape measurements',
      'check-tape': 'Check entered tape measurements',
      'outside-table': 'Outside published table · Check PRIMS'
    };

    field('abdomen-stage').disabled = bca.weighIn !== 'over';
    field('tape-stage').disabled = bca.abdomenStep !== 'over';
    field('navel-field').hidden = female;
    field('circumference').disabled = female;
    field('natural-waist-field').hidden = !female;
    field('natural-waist').disabled = !female;
    field('hips-field').hidden = !female;
    field('hips').disabled = !female;

    draw('weigh-in', weighIn[bca.weighIn]);
    draw('abdomen', abdomen[bca.abdomenStep]);
    var fat = tape[bca.fatStep];
    if (bca.fatStep === 'scored') {
      fat = fatText(bca.fatPercent, bca.fatLimit, bca.fatStatus);
      if (bca.usesTallestColumn) fat = 'Estimated ' + fat + ' · Tallest table column used. Check PRIMS.';
    }
    draw('historical-fat', fat, tones[bca.status]);

    var ageAdjusted = '';
    if (bca.fatStep === 'scored') {
      if (bca.ageAdjusted) {
        var status = bca.ageAdjusted.status === 'pass' ? 'within' :
          bca.ageAdjusted.status === 'fail' ? 'outside' : 'check PRIMS';
        ageAdjusted = 'Age-adjusted limit ' + bca.ageAdjusted.limit + '% · ' + status;
      } else {
        ageAdjusted = 'Enter age below to check the age-adjusted limit.';
      }
    }
    draw('age-adjusted', ageAdjusted);
  }

  function drawPrt(prt, editedEvent) {
    scoring.eventNames.forEach(function (name) {
      var event = prt.events[name];
      var labels = {
        pending: '- pts',
        'need-profile': 'Enter sex and age to score',
        'need-model': 'Choose a bike model',
        'need-weight': 'Enter weight in BCA',
        'weight-range': 'Bike scoring supports ' + event.min + '–' + event.max + ' lb',
        unavailable: !tables.bike ? tableMessage('bike') : 'Score unavailable · see Navy PFA calculator'
      };
      var scored = event.status === 'scored';
      var text = scored ? event.points + ' pts · ' + event.category : labels[event.status];
      if (event.incomplete) text += ' (incomplete event)';
      var changed = draw(name, text, scored ? (event.points === 0 ? 'danger' : 'success') : '');
      if (name === editedEvent && changed) $eventStatus.text(eventLabels[name] + '. ' + text);
    });

    var summary = 'Awaiting results';
    var average = prt.status === 'pass' ? Number(prt.average.toFixed(1)) + ' avg pts' : '';
    if (prt.status === 'pass') summary = average + ' · ' + prt.category;
    if (prt.status === 'fail') summary = 'Fail · below event minimum';
    var tone = prt.category === 'Probationary' ? 'warning' : tones[prt.status];
    draw('prt', summary, tone);
    draw('prt-summary', average || (prt.status === 'fail' ? 'Fail' : 'Pending'), tone);
    $prtSummary.toggleClass('bg-success', tone === 'success').toggleClass('bg-warning', tone === 'warning')
      .toggleClass('rounded px-1', Boolean(average));
    draw('prt-summary-category', prt.category || '');
  }

  function drawPrtPlaceholders(targets) {
    scoring.eventNames.forEach(function (name) {
      var input = field(name);
      var target = targets[name];
      var placeholder = '';
      if (target !== undefined && !input.disabled) {
        var untimed = name === 'pushups' || name === 'bike';
        var comparison = untimed || name === 'plank' ? '≥ ' : '≤ ';
        placeholder = comparison + (untimed ? target : formatTime(target));
      }
      if (input.placeholder !== placeholder) input.placeholder = placeholder;
    });
  }

  function tableMessage(name) {
    return tables[name] === null ? tableNames[name] + ' standards unavailable' : 'Loading ' + tableNames[name] + ' standards…';
  }

  function drawDataStatus(edition) {
    var relevant = [edition, 'prt', 'bike'];
    var failed = relevant.filter(function (name) { return tables[name] === null; });
    var loading = relevant.some(function (name) { return tables[name] === undefined; });
    var message = failed.length ? 'Could not load ' + failed.map(function (name) {
      return tableNames[name];
    }).join(', ') + ' scoring tables. Reload this page to try again.' : 'Loading Navy scoring tables…';
    if ($dataStatus.text() !== message) $dataStatus.text(message);
    $dataStatus.toggleClass('alert-info', !failed.length).toggleClass('alert-danger', Boolean(failed.length));
    $dataStatus.prop('hidden', !failed.length && !loading);
  }

  function update(editedInput, leaving) {
    var edition = field('edition').value;
    var historical = edition === 'historical';
    var selected = $form.find('input[name="pfa-cardio"]:checked').val();
    var bikeIncompleteCheckbox = field('bike-incomplete');
    var bikeIncomplete = historical && bikeIncompleteCheckbox.checked;
    var input = {
      edition: edition,
      sex: field('sex').value,
      height: number('height'),
      weight: number('weight'),
      age: number('age'),
      altitude: field('altitude').value,
      cardio: selected,
      bikeModel: $bikeModel.val(),
      bike: bikeIncomplete ? null : number('bike'),
      bikeIncomplete: bikeIncomplete,
      pushups: number('pushups')
    };

    field('current-waist').hidden = historical;
    field('waist').disabled = historical;
    field('current-bca').hidden = historical;
    field('historical-bca').hidden = !historical;
    field('bike-incomplete-field').hidden = !historical;
    bikeIncompleteCheckbox.disabled = !historical;
    field('bike').disabled = bikeIncomplete;
    field('bike-model').disabled = bikeIncomplete || !tables.bike;
    if (bikeIncomplete) field('bike').setCustomValidity('');
    drawDataStatus(edition);

    var bca;
    var bcaTargets;
    if (historical) {
      input.abdomen = number('abdomen');
      input.neck = number('neck');
      input.circumference = number(input.sex === 'Female' ? 'natural-waist' : 'circumference');
      input.hips = input.sex === 'Female' ? number('hips') : null;
      bca = tables.historical ? scoring.scoreHistoricalBca(input, tables.historical) :
        { status: 'pending', weighIn: 'pending', abdomenStep: 'wait-weigh-in', fatStep: 'wait-weigh-in' };
      bcaTargets = scoring.historicalBcaTargets(input, tables.historical, bca);
      drawHistoricalBca(bca, input.sex === 'Female');
    } else {
      input.waist = number('waist');
      bca = tables.current ? scoring.scoreCurrentBca(input, tables.current) :
        { status: 'pending', waistStep: 'pending', fatStep: 'waiting' };
      bcaTargets = scoring.currentBcaTargets(input, tables.current);
      drawCurrentBca(bca);
    }
    drawBcaPlaceholders(bcaTargets);
    draw('bca', tables[edition] ? bcaLabels[bca.status] : tableMessage(edition), tones[bca.status]);
    var bcaSummary = bcaSummaryLabels[bca.status];
    if (bca.fatStep === 'scored') {
      bcaSummary = (bca.usesTallestColumn ? 'Est. ' : '') + bca.fatPercent + '% · ' + bcaSummary;
    }
    if (!tables[edition]) bcaSummary = tables[edition] === null ? 'Unavailable' : 'Loading…';
    draw('bca-summary', bcaSummary, tones[bca.status]);

    scoring.eventNames.forEach(function (name) {
      if (name !== 'pushups' && name !== 'bike') input[name] = eventTime(name, leaving);
    });
    $cardioCards.each(function () {
      $(this).toggleClass('border-primary bg-light', this.getAttribute('data-cardio') === selected);
    });
    var prt = tables.prt ? scoring.scorePrt(input, tables.prt, tables.bike) : { status: 'pending' };
    drawPrtPlaceholders(scoring.passingPrtTargets(input, tables.prt, tables.bike, Number($goalScore.val())));
    if (tables.prt) {
      var edited = editedInput && editedInput.id.slice(4);
      if (edited === 'bike-model' || edited === 'bike-incomplete') edited = 'bike';
      drawPrt(prt, edited);
    } else {
      draw('prt', tableMessage('prt'));
      draw('prt-summary', tables.prt === null ? 'Unavailable' : 'Loading…');
      draw('prt-summary-category', '');
    }
    var pfa = scoring.scorePfa(bca, prt, edition);
    var overallText = pfaLabels[pfa];
    if (pfa === 'pending' && bca.status === 'pass') overallText = 'Awaiting PRT';
    if (pfa === 'pending' && prt.status === 'pass') overallText = 'Awaiting BCA';
    draw('pfa', overallText, tones[pfa]);
    queueResultsLayout();
  }

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function hasSexData(data, valid) {
    return data && valid(data.Male) && valid(data.Female);
  }

  function validFatTables(data, column, row, validCell) {
    return data && hasSexData(data.bodyFatLimits, finiteNumber) && hasSexData(data.bodyFatTables, function (bands) {
      return Array.isArray(bands) && bands.length > 0 && bands.every(function (band) {
        return band && finiteNumber(band[column]) && finiteNumber(band[row]) && Array.isArray(band.rows) &&
          band.rows.length > 0 && band.rows.every(function (cells) {
            return Array.isArray(cells) && cells.length === 20 && cells.every(validCell);
          });
      });
    });
  }

  function validCurrent(data) {
    return data && finiteNumber(data.waistToHeightThreshold) &&
      validFatTables(data, 'minWeight', 'minDifferenceHalfInches', finiteNumber);
  }

  function validHistorical(data) {
    return validFatTables(data, 'minHeightHalfInches', 'minCircumferenceHalfInches', function (value) {
      return finiteNumber(value) || (typeof value === 'string' && /^[<>]\d+$/.test(value));
    }) && hasSexData(data.singleSiteLimits, finiteNumber) && data.weightForHeight &&
      finiteNumber(data.weightForHeight.minHeight) && Array.isArray(data.weightForHeight.rows) &&
      data.weightForHeight.rows.length > 0 && data.weightForHeight.rows.every(function (weights) {
        return Array.isArray(weights) && weights.length === 2 && weights.every(finiteNumber);
      }) && Array.isArray(data.ageAdjustedBodyFatLimits) && data.ageAdjustedBodyFatLimits.length > 0 &&
      data.ageAdjustedBodyFatLimits[data.ageAdjustedBodyFatLimits.length - 1] &&
      data.ageAdjustedBodyFatLimits[data.ageAdjustedBodyFatLimits.length - 1].maxAge === null &&
      data.ageAdjustedBodyFatLimits.every(function (band) {
        return band && (band.maxAge === null || finiteNumber(band.maxAge)) && hasSexData(band, finiteNumber);
      });
  }

  function validPrt(data) {
    var groups = ['17-19', '20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65+'];
    var events = ['pushups', 'plank', 'run', 'row', 'swimYd', 'swimM'];
    return data && Array.isArray(data.points) && data.points.length === 12 && data.points.every(finiteNumber) &&
      data.standards && ['standard', 'high'].every(function (altitude) {
        return hasSexData(data.standards[altitude], function (byAge) {
          return byAge && groups.every(function (group) {
            return byAge[group] && events.every(function (event) {
              var thresholds = byAge[group][event];
              return Array.isArray(thresholds) && thresholds.length === data.points.length && thresholds.every(finiteNumber);
            });
          });
        });
      });
  }

  function validBike(data) {
    var conversion = data && data.conversion;
    return conversion && conversion.referenceEvent === 'run' && conversion.interceptMinutes &&
      [conversion.interceptMinutes.male, conversion.interceptMinutes.female, conversion.weightCoefficient,
        conversion.minimumWeightLb, conversion.maximumWeightLb, conversion.nonpositiveDenominator].every(finiteNumber) &&
      Array.isArray(data.models) && data.models.length > 0 && data.models.every(function (model) {
        return model && typeof model.id === 'string' && typeof model.name === 'string' &&
          (model.calorieOffset === null || finiteNumber(model.calorieOffset));
      });
  }

  function setTable(source, data) {
    tables[source.name] = source.valid(data) ? data : null;
    if (source.name === 'prt' && tables.prt) {
      var goals = scoring.prtGoalOptions(tables.prt);
      $goalScore.empty();
      goals.forEach(function (goal) {
        $goalScore.append($('<option>').val(goal.points).text(goal.category + ' (' + goal.points + ')'));
      });
      $goalScore.val(goals[goals.length - 1].points).prop('disabled', false);
    }
    if (source.name === 'bike' && tables.bike) {
      tables.bike.models.forEach(function (model) {
        $bikeModel.append($('<option>').val(model.id).text(model.name));
      });
    }
  }

  function loadTable(source) {
    $.ajax({ url: 'data/' + source.file, dataType: 'json', timeout: 15000 }).done(function (data) {
      setTable(source, data);
      update();
    }).fail(function () {
      setTable(source, null);
      update();
    });
  }

  function loadLocalTables(sources) {
    function install() {
      var bundle = window.PfaLocalTables || {};
      sources.forEach(function (source) { setTable(source, bundle[source.name]); });
      update();
    }

    // A classic script can load alongside a file URL when XHR cannot load local JSON.
    var script = document.createElement('script');
    script.src = 'data/local-tables.js';
    script.onload = install;
    script.onerror = install;
    document.head.appendChild(script);
  }

  $form.on('submit', function (event) { event.preventDefault(); });
  $form.on('input change focusout', 'input, select', function (event) {
    update(this, event.type === 'focusout' ? this : null);
    if (event.type === 'input') reportValidation(this);
  });
  $(main).on('focusin', function () { queueResultsLayout(true); });
  $(window).on('resize', function () { queueResultsLayout(true); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () { queueResultsLayout(true); });
    window.visualViewport.addEventListener('scroll', function () { queueResultsLayout(); });
  }
  if (window.ResizeObserver) {
    new window.ResizeObserver(function () { queueResultsLayout(); }).observe(resultsPanel);
  }
  $(window).on('pageshow', function () { update(); });
  update();
  var tableSources = [
    { name: 'current', file: 'bca-2026-cycle-2.json', valid: validCurrent },
    { name: 'historical', file: 'bca-2025.json', valid: validHistorical },
    { name: 'prt', file: 'prt-standards.json', valid: validPrt },
    { name: 'bike', file: 'bike-profiles.json', valid: validBike }
  ];
  if (window.location.protocol === 'file:') loadLocalTables(tableSources);
  else tableSources.forEach(loadTable);
}(window.jQuery, window.PfaScoring));
