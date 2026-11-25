(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PfaScoring = factory();
  }
}(this, function () {
  'use strict';

  var cardioEvents = ['run', 'treadmill', 'row', 'swimYd', 'swimM', 'bike'];
  var eventNames = ['pushups', 'plank'].concat(cardioEvents);
  var categories = [
    'Outstanding High', 'Outstanding Medium', 'Outstanding Low',
    'Excellent High', 'Excellent Medium', 'Excellent Low',
    'Good High', 'Good Medium', 'Good Low',
    'Satisfactory High', 'Satisfactory Medium', 'Probationary'
  ];

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function isPositive(value) {
    return isNumber(value) && value > 0;
  }

  function roundedWeight(value) {
    return isPositive(value) ? Math.round(value) : 0;
  }

  function isWholeResult(value, minimum) {
    return isNumber(value) && value >= minimum && Math.floor(value) === value;
  }

  function isKnownSex(sex) {
    return sex === 'Male' || sex === 'Female';
  }

  function parseTime(value) {
    if (typeof value !== 'string') return null;
    var time = value.trim();
    var match = /^(\d{1,3}):([0-5]\d)$/.exec(time);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    if (!/^\d{1,5}$/.test(time)) return null;
    var seconds = Number(time.slice(-2));
    return seconds < 60 ? Number(time.slice(0, -2)) * 60 + seconds : null;
  }

  function ageGroup(age) {
    if (!isNumber(age) || age < 17 || Math.floor(age) !== age) return null;
    if (age < 20) return '17-19';
    if (age >= 65) return '65+';
    var start = Math.floor(age / 5) * 5;
    return start + '-' + (start + 4);
  }

  function findBand(bands, firstColumnKey, column) {
    for (var i = 0; i < bands.length; i += 1) {
      var first = bands[i][firstColumnKey];
      if (column >= first && column < first + bands[i].rows[0].length) return bands[i];
    }
    return null;
  }

  function scoreCurrentBca(input, data) {
    var result = { status: 'pending', waistStep: 'pending', fatStep: 'waiting' };
    if (!isPositive(input.height) || !isPositive(input.waist)) return result;

    var height = Math.ceil(input.height * 2);
    var waist = Math.floor(input.waist * 2);
    if (!isPositive(height) || !isPositive(waist)) return result;

    var ratio = Math.floor(waist * 10000 / height);
    if (!isNumber(ratio)) return result;

    var weight = roundedWeight(input.weight);
    result.ratio = ratio / 10000;
    result.waistStep = ratio < data.waistToHeightThreshold ? 'pass' : 'over';
    if (result.waistStep === 'pass') {
      result.fatStep = 'not-required';
      result.status = weight > 0 ? 'pass' : 'record-weight';
      return result;
    }

    result.status = 'fat-required';
    if (weight === 0) {
      result.fatStep = 'need-weight';
      return result;
    }
    if (!isKnownSex(input.sex)) {
      result.fatStep = 'need-sex';
      return result;
    }

    var band = findBand(data.bodyFatTables[input.sex], 'minWeight', weight);
    var row = band && band.rows[height - waist - band.minDifferenceHalfInches];
    if (!row) {
      result.fatStep = 'outside-table';
      result.status = 'prims';
      return result;
    }

    result.fatPercent = row[weight - band.minWeight];
    result.fatLimit = data.bodyFatLimits[input.sex];
    result.status = result.fatPercent <= result.fatLimit ? 'pass' : 'fail';
    result.fatStep = 'scored';
    return result;
  }

  function currentPassingDifference(ratioDifference, band, weight, limit) {
    if (!band) return ratioDifference;
    var column = weight - band.minWeight;
    var row = ratioDifference - band.minDifferenceHalfInches - 1;

    // Extend the ratio cutoff only through adjacent passing body fat rows.
    while (band.rows[row] && band.rows[row][column] <= limit) {
      row -= 1;
      ratioDifference -= 1;
    }
    return ratioDifference;
  }

  function currentPassingWeights(bands, difference, limit) {
    var range;
    bands.forEach(function (band) {
      var row = band.rows[difference - band.minDifferenceHalfInches];
      if (!row) return;
      row.forEach(function (percent, column) {
        if (percent > limit) return;
        var weight = band.minWeight + column;
        if (!range) range = { minimum: weight, maximum: weight };
        else range.maximum = weight;
      });
    });
    return range;
  }

  function currentBcaTargets(input, data) {
    var targets = {};
    if (!data) return targets;

    var height = Math.ceil(input.height * 2);
    var waist = Math.floor(input.waist * 2);
    var weight = roundedWeight(input.weight);
    var bands = isKnownSex(input.sex) ? data.bodyFatTables[input.sex] : null;
    var fatBand = bands && findBand(bands, 'minWeight', weight);
    var limit = data.bodyFatLimits[input.sex];
    var ratioThreshold = data.waistToHeightThreshold;

    if (isPositive(height)) {
      var ratioWaist = Math.ceil(height * ratioThreshold / 10000) - 1;
      var maxWaist = height - currentPassingDifference(height - ratioWaist, fatBand, weight, limit);
      if (isPositive(maxWaist)) targets.waist = { maximum: maxWaist / 2 };
    }
    if (isPositive(waist)) {
      var ratioHeight = Math.floor(waist * 10000 / ratioThreshold) + 1;
      var minHeight = waist + currentPassingDifference(ratioHeight - waist, fatBand, weight, limit);
      if (isPositive(minHeight)) targets.height = { minimum: minHeight / 2 };
    }
    if (bands && isPositive(height) && isPositive(waist)) {
      var ratio = Math.floor(waist * 10000 / height);
      if (isNumber(ratio) && ratio >= ratioThreshold) {
        var weights = currentPassingWeights(bands, height - waist, limit);
        if (weights) targets.weight = weights;
      }
    }
    return targets;
  }

  // Keep the published legacy bounds when the table does not supply a point value.
  function estimateHistoricalFat(bands, height, circumference) {
    var lastBand = bands[bands.length - 1];
    var maxHeight = lastBand.minHeightHalfInches + lastBand.rows[0].length - 1;
    var lookupHeight = Math.min(height, maxHeight);
    var band = findBand(bands, 'minHeightHalfInches', lookupHeight);
    if (!band) return null;

    var row = circumference - band.minCircumferenceHalfInches;
    var column = lookupHeight - band.minHeightHalfInches;
    var lastRow = band.rows.length - 1;
    var value = band.rows[Math.min(Math.max(row, 0), lastRow)][column];
    if (typeof value === 'number') {
      if (row < 0) value = '≤' + value;
      if (row > lastRow) value = '≥' + value;
    }
    return { percent: value, usesTallestColumn: height > maxHeight };
  }

  function historicalFatStatus(value, limit) {
    if (typeof value === 'number') return value <= limit ? 'pass' : 'fail';

    var bound = Number(value.slice(1));
    switch (value.charAt(0)) {
    case '<': return bound <= limit + 1 ? 'pass' : 'prims';
    case '≤': return bound <= limit ? 'pass' : 'prims';
    case '>': return bound >= limit ? 'fail' : 'prims';
    case '≥': return bound > limit ? 'fail' : 'prims';
    default: return 'prims';
    }
  }

  function scoreHistoricalBca(input, data) {
    var result = { status: 'pending', weighIn: 'pending', abdomenStep: 'wait-weigh-in', fatStep: 'wait-weigh-in' };
    var weight = roundedWeight(input.weight);
    if (!isPositive(input.height) || weight === 0) return result;
    if (!isKnownSex(input.sex)) {
      result.weighIn = 'need-sex';
      return result;
    }

    var female = input.sex === 'Female';
    var row = data.weightForHeight.rows[Math.ceil(input.height) - data.weightForHeight.minHeight];
    if (!row) {
      result.weighIn = 'outside-table';
      result.status = 'prims';
      return result;
    }

    result.weightLimit = row[female ? 1 : 0];
    result.abdomenLimit = data.singleSiteLimits[input.sex];
    if (weight <= result.weightLimit) {
      result.status = 'pass';
      result.weighIn = 'pass';
      result.abdomenStep = result.fatStep = 'not-required';
      return result;
    }

    result.weighIn = 'over';
    result.status = 'abdomen-required';
    result.abdomenStep = 'required';
    result.fatStep = 'wait-abdomen';
    if (!isPositive(input.abdomen)) return result;
    if (input.abdomen <= result.abdomenLimit) {
      result.status = 'pass';
      result.abdomenStep = 'pass';
      result.fatStep = 'not-required';
      return result;
    }

    result.abdomenStep = 'over';
    result.status = 'tape-required';
    result.fatStep = 'required';
    if (!isPositive(input.neck) || !isPositive(input.circumference) || (female && !isPositive(input.hips))) return result;
    var circumference = Math.floor(input.circumference * 2) - Math.ceil(input.neck * 2);
    if (female) circumference += Math.floor(input.hips * 2);
    if (!isPositive(circumference)) {
      result.fatStep = 'check-tape';
      return result;
    }

    var estimate = estimateHistoricalFat(data.bodyFatTables[input.sex], Math.ceil(input.height * 2), circumference);
    if (!estimate) {
      result.fatStep = 'outside-table';
      result.status = 'prims';
      return result;
    }

    result.fatStep = 'scored';
    result.fatPercent = estimate.percent;
    result.fatLimit = data.bodyFatLimits[input.sex];
    result.fatStatus = historicalFatStatus(result.fatPercent, result.fatLimit);
    result.usesTallestColumn = estimate.usesTallestColumn;
    result.status = estimate.usesTallestColumn ? 'prims' : result.fatStatus;
    if (ageGroup(input.age)) {
      var ageLimit = data.ageAdjustedBodyFatLimits.filter(function (entry) {
        return entry.maxAge === null || input.age <= entry.maxAge;
      })[0][input.sex];
      result.ageAdjusted = { limit: ageLimit, status: historicalFatStatus(result.fatPercent, ageLimit) };
    }
    return result;
  }

  function historicalTapeLimit(input, data) {
    var height = Math.ceil(input.height * 2);
    var bands = data.bodyFatTables[input.sex];
    var band = findBand(bands, 'minHeightHalfInches', height);
    if (!band) return null;

    var lastDifference = band.minCircumferenceHalfInches + band.rows.length - 1;
    for (var difference = lastDifference; difference > 0; difference -= 1) {
      var estimate = estimateHistoricalFat(bands, height, difference);
      if (historicalFatStatus(estimate.percent, data.bodyFatLimits[input.sex]) === 'pass') return difference;
    }
    return null;
  }

  function roundedTape(value, round) {
    if (!isPositive(value)) return null;
    var halfInches = round(value * 2);
    return isNumber(halfInches) ? halfInches : null;
  }

  function historicalBcaTargets(input, data, result) {
    var targets = {};
    if (!data || !isKnownSex(input.sex)) return targets;

    var female = input.sex === 'Female';
    var weightColumn = female ? 1 : 0;
    var table = data.weightForHeight;
    var row = table.rows[Math.ceil(input.height) - table.minHeight];
    if (row) targets.weight = { maximum: row[weightColumn] };

    var weight = roundedWeight(input.weight);
    if (weight > 0) {
      for (var index = 0; index < table.rows.length; index += 1) {
        if (weight <= table.rows[index][weightColumn]) {
          targets.height = { minimum: table.minHeight + index };
          break;
        }
      }
    }

    var bca = result || scoreHistoricalBca(input, data);
    if (bca.weighIn === 'over') targets.abdomen = { maximum: bca.abdomenLimit };
    if (bca.abdomenStep !== 'over') return targets;

    var limit = historicalTapeLimit(input, data);
    if (limit === null) return targets;

    var waist = roundedTape(input.circumference, Math.floor);
    var neck = roundedTape(input.neck, Math.ceil);
    var hips = female ? roundedTape(input.hips, Math.floor) : 0;
    if (waist !== null && hips !== null && waist + hips > 1) {
      var minNeck = Math.max(1, waist + hips - limit);
      if (isPositive(minNeck)) targets.neck = { minimum: minNeck / 2 };
    }
    if (neck !== null && hips !== null) {
      var maxWaist = limit + neck - hips;
      if (isPositive(maxWaist)) targets.circumference = { maximum: maxWaist / 2 };
    }
    if (female && neck !== null && waist !== null) {
      var maxHips = limit + neck - waist;
      if (isPositive(maxHips)) targets.hips = { maximum: maxHips / 2 };
    }
    return targets;
  }

  function scoreThreshold(value, thresholds, points, higherIsBetter) {
    for (var i = 0; i < thresholds.length; i += 1) {
      if (higherIsBetter ? value >= thresholds[i] : value <= thresholds[i]) {
        return { status: 'scored', points: points[i], category: categories[i] };
      }
    }
    return { status: 'scored', points: 0, category: 'Fail' };
  }

  function bikeCalorieFloor(edition) {
    return edition === 'historical' ? 0 : 20;
  }

  function scoreBike(input, scores, points, data) {
    // Guide 6 (June 2026) uses fewer than 20 calories for an incomplete bike event.
    // An explicit failed completion status also covers the 20-calorie entry in earlier guides.
    var currentIncomplete = isWholeResult(input.bike, 0) && input.bike < bikeCalorieFloor(input.edition);
    if (input.bikeIncomplete === true || currentIncomplete) {
      return { status: 'scored', points: 0, category: 'Fail', incomplete: true };
    }
    if (!data) return { status: 'unavailable' };

    var model = data.models.filter(function (entry) { return entry.id === input.bikeModel; })[0];
    if (!model) return { status: 'need-model' };
    if (!isNumber(model.calorieOffset) || model.verification !== 'mynavy-portal') return { status: 'unavailable' };
    if (!isWholeResult(input.bike, 0)) return { status: 'pending' };
    if (!isPositive(input.weight)) return { status: 'need-weight' };

    var conversion = data.conversion;
    var weight = roundedWeight(input.weight);
    if (weight < conversion.minimumWeightLb || weight > conversion.maximumWeightLb) {
      return { status: 'weight-range', min: conversion.minimumWeightLb, max: conversion.maximumWeightLb };
    }
    if (!scores) return { status: 'need-profile' };

    // MyNavy Portal converts 12-minute calories to a run time and discards fractional seconds.
    var denominator = input.bike + model.calorieOffset;
    if (denominator <= 0) denominator = conversion.nonpositiveDenominator;
    var time = conversion.weightCoefficient * weight / denominator + conversion.interceptMinutes[input.sex.toLowerCase()];
    var minutes = Math.floor(time);
    var seconds = minutes * 60 + Math.floor((time - minutes) * 60);
    var result = scoreThreshold(seconds, scores[conversion.referenceEvent], points, false);
    result.runEquivalentSeconds = seconds;
    return result;
  }

  function passingBikeCalories(input, scores, points, bikes, goalPoints) {
    if (input.bikeIncomplete === true) return null;

    var ride = {
      edition: input.edition,
      bikeModel: input.bikeModel,
      weight: input.weight,
      sex: input.sex,
      bike: bikeCalorieFloor(input.edition)
    };
    var first = scoreBike(ride, scores, points, bikes);
    if (first.status !== 'scored') return null;
    if (first.points >= goalPoints) return ride.bike;

    function passesAt(calories) {
      ride.bike = calories;
      return scoreBike(ride, scores, points, bikes).points >= goalPoints;
    }

    // Find an entry that reaches the goal, then locate the first whole calorie that does.
    var lower = ride.bike + 1;
    var upper = lower;
    var largestExactInteger = Math.pow(2, 53) - 1;
    while (!passesAt(upper)) {
      if (upper === largestExactInteger) return null;
      lower = upper + 1;
      upper = Math.min(upper * 2, largestExactInteger);
    }
    while (lower < upper) {
      var middle = lower + Math.floor((upper - lower) / 2);
      if (passesAt(middle)) upper = middle;
      else lower = middle + 1;
    }
    return lower;
  }

  function prtThresholds(input, data) {
    var group = ageGroup(input.age);
    var standard = data.standards[input.altitude];
    return isKnownSex(input.sex) && group && standard ? standard[input.sex][group] : null;
  }

  function prtGoalOptions(data) {
    if (!data) return [];
    return data.points.map(function (points, index) {
      return { points: points, category: categories[index] };
    });
  }

  function passingPrtTargets(input, data, bikes, goalPoints) {
    var targets = {};
    var thresholds = data && prtThresholds(input, data);
    if (!thresholds) return targets;

    var goalIndex = data.points.indexOf(goalPoints);
    if (goalIndex < 0) goalIndex = data.points.length - 1;
    eventNames.forEach(function (event) {
      if (event === 'bike') return;
      var table = event === 'treadmill' ? 'run' : event;
      targets[event] = thresholds[table][goalIndex];
    });
    var calories = passingBikeCalories(input, thresholds, data.points, bikes, data.points[goalIndex]);
    if (calories !== null) targets.bike = calories;
    return targets;
  }

  function scorePrt(input, data, bikes) {
    var thresholds = prtThresholds(input, data);
    var results = {};
    eventNames.forEach(function (event) {
      var higherIsBetter = event === 'pushups' || event === 'plank';
      if (event === 'bike') {
        results[event] = scoreBike(input, thresholds, data.points, bikes);
      } else if (!isWholeResult(input[event], higherIsBetter ? 0 : 1)) {
        results[event] = { status: 'pending' };
      } else if (!thresholds) {
        results[event] = { status: 'need-profile' };
      } else {
        var table = event === 'treadmill' ? 'run' : event;
        results[event] = scoreThreshold(input[event], thresholds[table], data.points, higherIsBetter);
      }
    });

    var cardio = cardioEvents.indexOf(input.cardio) >= 0 ? results[input.cardio] : null;
    var modalities = [results.pushups, results.plank, cardio];
    var result = { status: 'pending', events: results, modalities: modalities };
    if (modalities.some(function (event) { return event && event.points === 0; })) {
      result.status = 'fail';
      return result;
    }
    if (modalities.every(function (event) { return event && event.status === 'scored'; })) {
      result.status = 'pass';
      result.average = (modalities[0].points + modalities[1].points + modalities[2].points) / 3;
      result.category = categories[data.points.indexOf(Math.floor(result.average / 5) * 5)];
    }
    return result;
  }

  function scorePfa(bca, prt, edition) {
    if (prt.status === 'fail') return 'fail';
    if (bca.status === 'prims') return 'prims';
    if (prt.status !== 'pass') return bca.status === 'fail' ? 'awaiting-exemption' : 'pending';
    if (bca.status === 'pass') return 'pass';
    if (bca.status !== 'fail') return 'pending';

    var exemption = edition === 'historical' ? prt.average >= 75 : prt.average >= 90 &&
      prt.modalities.every(function (event) { return event.points >= 80; });
    return exemption ? 'pass-exemption' : 'fail';
  }

  return {
    eventNames: eventNames,
    parseTime: parseTime,
    scoreCurrentBca: scoreCurrentBca,
    currentBcaTargets: currentBcaTargets,
    scoreHistoricalBca: scoreHistoricalBca,
    historicalBcaTargets: historicalBcaTargets,
    prtGoalOptions: prtGoalOptions,
    passingPrtTargets: passingPrtTargets,
    scorePrt: scorePrt,
    scorePfa: scorePfa
  };
}));
