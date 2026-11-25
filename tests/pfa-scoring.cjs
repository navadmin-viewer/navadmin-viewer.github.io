const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const scoring = require('../pfa-calculator/js/scoring.js');
const current = require('../pfa-calculator/data/bca-2026-cycle-2.json');
const historical = require('../pfa-calculator/data/bca-2025.json');
const prt = require('../pfa-calculator/data/prt-standards.json');
const bikes = require('../pfa-calculator/data/bike-profiles.json');

test('the local-file bundle contains the same tables as the hosted JSON', () => {
  const source = readFileSync(require.resolve('../pfa-calculator/data/local-tables.js'), 'utf8');
  const window = {};
  runInNewContext(source, { window });
  const bundle = JSON.parse(JSON.stringify(window.PfaLocalTables));
  assert.deepEqual(bundle, { current, historical, prt, bike: bikes }, 'Regenerate with node tests/generate-pfa-local-tables.cjs');
});

test('current BCA uses the ratio boundary before looking up body fat', () => {
  const baseline = { sex: 'Male', height: 70, waist: 38, weight: 191 };
  assert.deepEqual(scoring.scoreCurrentBca(baseline, current), {
    status: 'pass', waistStep: 'pass', fatStep: 'not-required', ratio: 0.5428
  });
  const exact = scoring.scoreCurrentBca({ height: 70, waist: 38.5 }, current);
  assert.equal(exact.ratio, 0.55);
  assert.equal(exact.fatStep, 'need-weight');
  assert.equal(scoring.scoreCurrentBca({ height: 70, waist: 38 }, current).status, 'record-weight');
  assert.equal(scoring.scoreCurrentBca({ height: 70, weight: 200, waist: 38.5 }, current).fatStep, 'need-sex');
});

test('June 2026 body-fat limits are inclusive and a missing cell needs PRIMS', () => {
  const male = { sex: 'Male', height: 70, waist: 40 };
  const female = { sex: 'Female', height: 70, waist: 38.5 };
  [
    [male, 271, 26, 'pass'], [male, 271.5, 27, 'fail'], [male, 300, 28, 'fail'],
    [female, 213, 36, 'pass'], [female, 214, 37, 'fail']
  ].forEach(([input, weight, fatPercent, status]) => {
    const score = scoring.scoreCurrentBca({ ...input, weight }, current);
    assert.equal(score.fatPercent, fatPercent);
    assert.equal(score.status, status);
  });
  assert.equal(scoring.scoreCurrentBca({ ...male, weight: 380 }, current).status, 'prims');
  assert.equal(scoring.scoreCurrentBca({ ...male, weight: 381 }, current).status, 'prims');
});

test('a measured weight that rounds to zero cannot complete either BCA', () => {
  const input = { sex: 'Male', height: 70, waist: 38, weight: 0.49 };
  assert.equal(scoring.scoreCurrentBca(input, current).status, 'record-weight');
  assert.equal(scoring.scoreCurrentBca({ ...input, waist: 40 }, current).fatStep, 'need-weight');
  assert.equal(scoring.scoreHistoricalBca(input, historical).weighIn, 'pending');
});

test('current BCA placeholders follow the ratio and published body-fat boundaries', () => {
  assert.deepEqual(scoring.currentBcaTargets({ height: 70 }, current), { waist: { maximum: 38 } });
  assert.deepEqual(scoring.currentBcaTargets({ waist: 38.5 }, current), { height: { minimum: 70.5 } });
  assert.deepEqual(scoring.currentBcaTargets({ height: 70, waist: 38, sex: 'Male' }, current).weight, undefined);
  assert.deepEqual(scoring.currentBcaTargets({ height: 70, waist: 60, sex: 'Male' }, current).weight, undefined);
  assert.deepEqual(scoring.currentBcaTargets({ sex: 'Male', height: 200, weight: 200 }, current), {
    waist: { maximum: 109.5 }
  });
  assert.deepEqual(scoring.currentBcaTargets({ height: 70 }), {});

  for (const [sex, waist, minWeight, maxWeight, minHeight, maxWaist] of [
    ['Male', 40, 101, 271, 66.5, 43.5],
    ['Female', 38.5, 61, 213, 68.5, 40]
  ]) {
    const input = { sex, height: 70, waist, weight: 200 };
    assert.deepEqual(scoring.currentBcaTargets(input, current), {
      height: { minimum: minHeight }, waist: { maximum: maxWaist }, weight: { minimum: minWeight, maximum: maxWeight }
    });
    for (const [field, passes, misses] of [
      ['height', minHeight, minHeight - 0.5], ['waist', maxWaist, maxWaist + 0.5],
      ['weight', minWeight, minWeight - 1], ['weight', maxWeight, maxWeight + 1]
    ]) {
      assert.equal(scoring.scoreCurrentBca({ ...input, [field]: passes }, current).status, 'pass');
      assert.notEqual(scoring.scoreCurrentBca({ ...input, [field]: misses }, current).status, 'pass');
    }
  }
});

test('2025 legacy neck tape opens after both gates and uses the sex-specific table', () => {
  const male = { sex: 'Male', height: 70, weight: 192, abdomen: 39.25, neck: 16, circumference: 42, age: 27 };
  assert.equal(scoring.scoreHistoricalBca({ ...male, weight: 191 }, historical).fatStep, 'not-required');
  assert.equal(scoring.scoreHistoricalBca({ ...male, abdomen: 39 }, historical).fatStep, 'not-required');
  assert.equal(scoring.scoreHistoricalBca({ ...male, neck: null }, historical).fatStep, 'required');
  const maleResult = scoring.scoreHistoricalBca(male, historical);
  assert.equal(maleResult.fatPercent, 29);
  assert.equal(maleResult.status, 'fail');
  assert.equal(scoring.scoreHistoricalBca({ ...male, circumference: 40 }, historical).status, 'pass');
  const femaleResult = scoring.scoreHistoricalBca({
    sex: 'Female', height: 64, weight: 180, abdomen: 35.75, neck: 14, circumference: 29, hips: 37, age: 22
  }, historical);
  assert.equal(femaleResult.fatPercent, 26);
  assert.equal(femaleResult.status, 'pass');
  assert.deepEqual(femaleResult.ageAdjusted, { limit: 34, status: 'pass' });
  const bound = scoring.scoreHistoricalBca({ ...male, neck: 18, circumference: 29 }, historical);
  assert.match(bound.fatPercent, /^(?:<|≤)/);
  assert.equal(bound.status, 'pass');
});

test('historical BCA placeholders follow weigh-in, abdomen, and tape in order', () => {
  const male = { sex: 'Male', height: 70, weight: 192, abdomen: 39.25, neck: 16, circumference: 42 };
  assert.deepEqual(scoring.historicalBcaTargets({ sex: 'Male', height: 70 }, historical), { weight: { maximum: 191 } });
  assert.deepEqual(scoring.historicalBcaTargets({ sex: 'Male', weight: 192 }, historical), { height: { minimum: 71 } });
  assert.deepEqual(scoring.historicalBcaTargets({ ...male, weight: 191 }, historical), {
    height: { minimum: 70 }, weight: { maximum: 191 }
  });
  assert.deepEqual(scoring.historicalBcaTargets({ ...male, abdomen: 39 }, historical), {
    height: { minimum: 71 }, weight: { maximum: 191 }, abdomen: { maximum: 39 }
  });
  assert.deepEqual(scoring.historicalBcaTargets({ ...male, neck: null }, historical), {
    height: { minimum: 71 }, weight: { maximum: 191 }, abdomen: { maximum: 39 }, neck: { minimum: 18 }
  });

  const female = { sex: 'Female', height: 64, weight: 180, abdomen: 35.75, neck: 14, circumference: 29, hips: 37 };
  for (const [input, expected] of [
    [male, { neck: { minimum: 18 }, circumference: { maximum: 40 } }],
    [female, { neck: { minimum: 5.5 }, circumference: { maximum: 37.5 }, hips: { maximum: 45.5 } }]
  ]) {
    const targets = scoring.historicalBcaTargets(input, historical);
    for (const [field, boundary] of Object.entries(expected)) {
      assert.deepEqual(targets[field], boundary);
      const value = boundary.minimum ?? boundary.maximum;
      const beyondLimit = value + (boundary.minimum === undefined ? 0.5 : -0.5);
      assert.equal(scoring.scoreHistoricalBca({ ...input, [field]: value }, historical).status, 'pass');
      assert.notEqual(scoring.scoreHistoricalBca({ ...input, [field]: beyondLimit }, historical).status, 'pass');
    }
  }
  const missingHips = scoring.historicalBcaTargets({ ...female, hips: null }, historical);
  assert.equal(missingHips.neck, undefined);
  assert.equal(missingHips.circumference, undefined);
  assert.deepEqual(missingHips.hips, { maximum: 45.5 });
});

test('historical tape overflow asks for corrected measurements instead of throwing or scoring', () => {
  const input = { sex: 'Male', height: 70, weight: 192, abdomen: 39.25, neck: 16, circumference: 42 };
  for (const overflow of [{ circumference: 1e308 }, { neck: 1e308, circumference: 1e308 }]) {
    const result = scoring.scoreHistoricalBca({ ...input, ...overflow }, historical);
    assert.equal(result.fatStep, 'check-tape');
    assert.equal(result.fatPercent, undefined);
  }
  assert.equal(scoring.scoreHistoricalBca(input, historical).fatPercent, 29);
});

function thresholdPoints(value, thresholds, higherIsBetter = false) {
  const index = thresholds.findIndex(threshold => higherIsBetter ? value >= threshold : value <= threshold);
  return index < 0 ? 0 : prt.points[index];
}

test('all PRT bands score correctly at and on both sides of every threshold', () => {
  let cells = 0;
  Object.entries(prt.standards).forEach(([altitude, sexes]) => {
    Object.entries(sexes).forEach(([sex, groups]) => {
      Object.entries(groups).forEach(([group, events]) => {
        Object.entries(events).forEach(([name, thresholds]) => {
          const higherIsBetter = name === 'pushups' || name === 'plank';
          thresholds.forEach((threshold, index) => {
            const profile = { altitude, sex, age: Number.parseInt(group, 10), cardio: 'run' };
            for (const value of [threshold - 1, threshold, threshold + 1]) {
              const expected = value === threshold ? prt.points[index] : thresholdPoints(value, thresholds, higherIsBetter);
              const result = scoring.scorePrt({ ...profile, [name]: value }, prt, bikes);
              assert.equal(result.events[name].points, expected, `${altitude} ${sex} ${group} ${name} ${value}`);
              if (name === 'run') {
                const treadmill = scoring.scorePrt({ ...profile, treadmill: value }, prt, bikes);
                assert.equal(treadmill.events.treadmill.points, expected, `${altitude} ${sex} ${group} treadmill ${value}`);
              }
            }
            cells += 1;
          });
        });
      });
    });
  });
  assert.equal(cells, 3168);
});

test('PRT averages the two strength scores and the chosen cardio only', () => {
  const input = { age: 27, sex: 'Male', altitude: 'standard', pushups: 60, plank: 137, run: 683, row: 520, swimYd: 900 };
  let result = scoring.scorePrt({ ...input, cardio: 'run' }, prt, bikes);
  assert.equal(result.average, 70);
  assert.equal(result.category, 'Good High');
  assert.equal(result.events.swimYd.points, 0);
  result = scoring.scorePrt({ ...input, cardio: 'row' }, prt, bikes);
  assert.equal(result.average, 205 / 3);
  assert.equal(result.category, 'Good Medium');
  assert.equal(scoring.scorePrt({ ...input, cardio: 'swimYd' }, prt, bikes).status, 'fail');
  assert.equal(scoring.scorePrt({ ...input, cardio: 'swimM' }, prt, bikes).status, 'pending');
  assert.equal(scoring.scorePrt({ ...input, cardio: 'run', run: -1 }, prt, bikes).events.run.status, 'pending');
  assert.equal(scoring.scorePrt({ ...input, cardio: 'pushups' }, prt, bikes).status, 'pending');
});

test('timed PRT inputs accept compact and colon-separated minutes and seconds', () => {
  const valid = [
    ['236', 156], ['2:36', 156], [' 1123 ', 683], [' 11:23 ', 683],
    ['9', 9], ['59', 59], ['059', 59], ['000', 0], ['0:00', 0],
    ['99959', 59999], ['999:59', 59999]
  ];
  for (const [input, seconds] of valid) assert.equal(scoring.parseTime(input), seconds, JSON.stringify(input));

  const invalid = ['', '60', '160', '11:60', '2:6', '100000', '236.5', '-236', null, 683];
  for (const input of invalid) assert.equal(scoring.parseTime(input), null, JSON.stringify(input));
});

test('PRT targets match the limits for each profile and goal', () => {
  const goals = scoring.prtGoalOptions(prt);
  assert.deepEqual(goals.map(({ points }) => points), prt.points);
  assert.deepEqual(goals[0], { points: 100, category: 'Outstanding High' });
  assert.deepEqual(goals.at(-1), { points: 45, category: 'Probationary' });
  assert.deepEqual(scoring.prtGoalOptions(), []);

  for (const [altitude, sexes] of Object.entries(prt.standards)) {
    for (const [sex, groups] of Object.entries(sexes)) {
      for (const [group, thresholds] of Object.entries(groups)) {
        const input = { altitude, sex, age: Number.parseInt(group, 10) };
        prt.points.forEach((goal, index) => {
          const expected = Object.fromEntries(Object.entries(thresholds).map(([event, results]) => [event, results[index]]));
          expected.treadmill = expected.run;
          assert.deepEqual(scoring.passingPrtTargets(input, prt, bikes, goal), expected);

          for (const [event, target] of Object.entries(expected)) {
            const oneShort = target + (event === 'pushups' || event === 'plank' ? -1 : 1);
            assert.ok(scoring.scorePrt({ ...input, [event]: target }, prt, bikes).events[event].points >= goal);
            assert.ok(scoring.scorePrt({ ...input, [event]: oneShort }, prt, bikes).events[event].points < goal);
          }
        });
      }
    }
  }
  const profile = { age: 27, sex: 'Male', altitude: 'standard' };
  const defaultTargets = scoring.passingPrtTargets(profile, prt, bikes, 45);
  assert.deepEqual(scoring.passingPrtTargets(profile, prt, bikes), defaultTargets);
  assert.deepEqual(scoring.passingPrtTargets(profile, prt, bikes, 99), defaultTargets);
  assert.deepEqual(scoring.passingPrtTargets(profile), {});
  for (const key of Object.keys(profile)) {
    assert.deepEqual(scoring.passingPrtTargets({ ...profile, [key]: null }, prt, bikes), {});
  }
});

test('bike goal targets are the first whole calorie meeting each goal for both standards', () => {
  for (const [altitude, sexes] of Object.entries(prt.standards)) {
    for (const [sex, groups] of Object.entries(sexes)) {
      for (const group of Object.keys(groups)) {
        for (const { id: bikeModel } of bikes.models) {
          for (const weight of [49.5, 175.49, 175.5, 400.49]) {
            for (const edition of ['current', 'historical']) {
              const input = { altitude, sex, age: Number.parseInt(group, 10), weight, bikeModel, edition };
              for (const goal of prt.points) {
                const target = scoring.passingPrtTargets(input, prt, bikes, goal).bike;
                assert.ok(Number.isInteger(target) && target > 0, JSON.stringify(input));
                assert.ok(scoring.scorePrt({ ...input, bike: target }, prt, bikes).events.bike.points >= goal);
                assert.ok(scoring.scorePrt({ ...input, bike: target - 1 }, prt, bikes).events.bike.points < goal);
              }
            }
          }
        }
      }
    }
  }
  const input = { age: 65, sex: 'Female', altitude: 'high', weight: 80, bikeModel: bikes.models[0].id };
  assert.equal(scoring.passingPrtTargets(input, prt, bikes).bike, 20);
  assert.equal(scoring.passingPrtTargets({ ...input, edition: 'historical' }, prt, bikes).bike, 19);
  assert.equal(scoring.passingPrtTargets(input, prt, null).bike, undefined);
  for (const missing of [{ weight: null }, { weight: 49.49 }, { weight: 400.5 }, { bikeModel: '' }, { bikeIncomplete: true }]) {
    assert.equal(scoring.passingPrtTargets({ ...input, ...missing }, prt, bikes).bike, undefined);
  }
});

test('official MyNavy Portal bike conversions match calorie boundaries', () => {
  const cybex = 'cybex-625c-750c-770c';
  const sl = 'life-fitness-aspc-sl-inc-sl';
  const cases = [
    ['Male', 175, 'standard', cybex, 96, 811, 0], ['Male', 175, 'standard', cybex, 97, 806, 45],
    ['Male', 175, 'standard', sl, 127, 721, 55], ['Male', 175, 'standard', sl, 128, 718, 60],
    ['Female', 150, 'standard', cybex, 79, 932, 0], ['Female', 150, 'standard', cybex, 80, 927, 45],
    ['Female', 150, 'standard', sl, 100, 859, 55], ['Female', 150, 'standard', sl, 101, 855, 60],
    ['Male', 175, 'high', sl, 86, 888, 0], ['Male', 175, 'high', sl, 87, 882, 45],
    ['Female', 150, 'high', sl, 71, 1017, 0], ['Female', 150, 'high', sl, 72, 1009, 45]
  ];
  cases.forEach(([sex, weight, altitude, bikeModel, bike, seconds, points]) => {
    const result = scoring.scorePrt({ age: 22, cardio: 'bike', sex, weight, altitude, bikeModel, bike }, prt, bikes);
    assert.equal(result.events.bike.runEquivalentSeconds, seconds);
    assert.equal(result.events.bike.points, points);
  });
  const minimum = { age: 22, cardio: 'bike', sex: 'Male', weight: 50, altitude: 'standard', bikeModel: sl, bike: 0 };
  assert.equal(scoring.scorePrt(minimum, prt, bikes).events.bike.points, 0);
  assert.equal(scoring.scorePrt({ ...minimum, weight: 49, bike: 100 }, prt, bikes).events.bike.status, 'weight-range');
});

test('an incomplete bike event cannot pass or affect a different selected cardio', () => {
  const input = {
    sex: 'Female', age: 65, altitude: 'high', weight: 80, bikeModel: 'cybex-625c-750c-770c',
    pushups: 9, plank: 108, bike: 19, cardio: 'bike'
  };
  const legacy = scoring.scorePrt({ ...input, edition: 'historical' }, prt, bikes);
  assert.equal(legacy.events.bike.points, 45);
  const incomplete = scoring.scorePrt(input, prt, bikes);
  assert.equal(incomplete.events.bike.points, 0);
  assert.equal(incomplete.events.bike.incomplete, true);
  assert.equal(incomplete.status, 'fail');
  assert.equal(scoring.scorePfa({ status: 'pass' }, incomplete, 'current'), 'fail');

  for (const edition of ['current', 'historical']) {
    const completed = scoring.scorePrt({ ...input, edition, bike: 20 }, prt, bikes);
    const failed = scoring.scorePrt({ ...input, edition, bike: 20, bikeIncomplete: true }, prt, bikes);
    const otherCardio = scoring.scorePrt({ ...input, edition, bikeIncomplete: true, cardio: 'run', run: 900 }, prt, bikes);
    assert.equal(completed.events.bike.points, 50);
    assert.equal(failed.events.bike.points, 0);
    assert.equal(otherCardio.status, 'pass');
  }
});

test('missing bike data leaves other PRT events available', () => {
  const input = { age: 27, sex: 'Male', altitude: 'standard', pushups: 60, plank: 137, run: 683 };
  const result = scoring.scorePrt({ ...input, cardio: 'run' }, prt, null);
  assert.equal(result.status, 'pass');
  assert.equal(result.events.bike.status, 'unavailable');
  assert.equal(scoring.scorePrt({ ...input, cardio: 'bike' }, prt, null).status, 'pending');
});

test('PFA preserves BCA failure and applies edition-specific exemption rules', () => {
  const bca = { status: 'fail' };
  const great = { status: 'pass', average: 90, modalities: [{ points: 80 }, { points: 90 }, { points: 100 }] };
  const uneven = { status: 'pass', average: 90, modalities: [{ points: 75 }, { points: 95 }, { points: 100 }] };
  assert.equal(scoring.scorePfa(bca, great, 'current'), 'pass-exemption');
  assert.equal(scoring.scorePfa(bca, uneven, 'current'), 'fail');
  assert.equal(scoring.scorePfa(bca, uneven, 'historical'), 'pass-exemption');
  assert.equal(scoring.scorePfa({ status: 'prims' }, great, 'current'), 'prims');
});

function* inputSubsets(values) {
  const keys = Object.keys(values);
  for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
    const input = {};
    keys.forEach((key, index) => {
      if (mask & (1 << index)) input[key] = values[key];
    });
    yield input;
  }
}

test('current BCA checks every screening height and combination of completed inputs', () => {
  for (const measurements of [{ height: Number.MAX_VALUE }, { waist: Number.MAX_VALUE }, { waist: 1e305 }]) {
    const input = { height: 70, waist: 40, weight: 190, sex: 'Male', ...measurements };
    const result = scoring.scoreCurrentBca(input, current);
    assert.equal(result.status, 'pending');
    assert.equal(result.ratio, undefined);
  }
  for (let heightHalfInches = 96; heightHalfInches <= 167; heightHalfInches += 1) {
    const height = heightHalfInches / 2;
    const firstOver = Math.ceil(heightHalfInches * 11 / 20);
    const pass = scoring.scoreCurrentBca({ height, waist: (firstOver - 1) / 2, weight: 190 }, current);
    const over = scoring.scoreCurrentBca({ height, waist: firstOver / 2, weight: 190 }, current);
    assert.equal(pass.status, 'pass', `${height} inches`);
    assert.equal(over.fatStep, 'need-sex', `${height} inches`);
  }

  for (const sex of ['Male', 'Female']) {
    for (const waist of [38, 40]) {
      for (const input of inputSubsets({ sex, height: 70, weight: 190, waist })) {
        let expected = 'waiting';
        if (input.height && input.waist) {
          if (waist === 38) expected = 'not-required';
          else if (!input.weight) expected = 'need-weight';
          else if (!input.sex) expected = 'need-sex';
          else expected = 'scored';
        }
        assert.equal(scoring.scoreCurrentBca(input, current).fatStep, expected, JSON.stringify(input));
      }
    }
  }
});

test('current BCA resolves all 18,700 body-fat cells and rejects adjacent missing rows', () => {
  let count = 0;
  for (const [sex, bands] of Object.entries(current.bodyFatTables)) {
    const limit = current.bodyFatLimits[sex];
    for (const band of bands) {
      function scoreAt(difference, weight) {
        const heightHalfInches = Math.max(140, 3 * difference);
        const waist = (heightHalfInches - difference) / 2;
        return scoring.scoreCurrentBca({ sex, height: heightHalfInches / 2, waist, weight }, current);
      }
      band.rows.forEach((row, index) => {
        const difference = band.minDifferenceHalfInches + index;
        row.forEach((percent, column) => {
          const weight = band.minWeight + column;
          const actual = scoreAt(difference, weight);
          assert.equal(actual.fatPercent, percent, `${sex} ${weight} lb, ${difference / 2} in difference`);
          assert.equal(actual.status, percent <= limit ? 'pass' : 'fail');
          count += 1;
        });
      });
      band.rows[0].forEach((_, index) => {
        const weight = band.minWeight + index;
        assert.equal(scoreAt(band.minDifferenceHalfInches - 1, weight).status, 'prims');
        assert.equal(scoreAt(band.minDifferenceHalfInches + band.rows.length, weight).status, 'prims');
      });
    }
  }
  assert.equal(count, 18700);
});

test('historical BCA verifies every weigh-in and tape cutoff and combination of completed inputs', () => {
  for (const [column, sex] of ['Male', 'Female'].entries()) {
    const abdomen = historical.singleSiteLimits[sex];
    historical.weightForHeight.rows.forEach((row, index) => {
      const height = historical.weightForHeight.minHeight + index;
      const weight = row[column];
      const within = scoring.scoreHistoricalBca({ sex, height, weight: weight + 0.49 }, historical);
      const over = scoring.scoreHistoricalBca({ sex, height, weight: weight + 0.50 }, historical);
      const atAbdomenLimit = scoring.scoreHistoricalBca({ sex, height, weight: weight + 1, abdomen }, historical);
      const overAbdomen = scoring.scoreHistoricalBca({ sex, height, weight: weight + 1, abdomen: abdomen + 0.25 }, historical);
      assert.equal(within.status, 'pass', `${sex} ${height} in`);
      assert.equal(over.status, 'abdomen-required', `${sex} ${height} in`);
      assert.equal(atAbdomenLimit.status, 'pass', `${sex} ${height} in`);
      assert.equal(overAbdomen.status, 'tape-required', `${sex} ${height} in`);
    });

    const full = { sex, height: 70, weight: 250, abdomen: abdomen + 0.25, neck: 16, circumference: 40 };
    if (sex === 'Female') full.hips = 36;
    for (const input of inputSubsets(full)) {
      let expected = 'wait-weigh-in';
      if (input.height && input.weight && input.sex) {
        if (!input.abdomen) expected = 'wait-abdomen';
        else if (!input.neck || !input.circumference || (sex === 'Female' && !input.hips)) expected = 'required';
        else expected = 'scored';
      }
      assert.equal(scoring.scoreHistoricalBca(input, historical).fatStep, expected, JSON.stringify(input));
    }
  }
});

test('historical BCA resolves all 2,140 tape table cells and applies age-adjusted limits at their boundaries', () => {
  const ageCases = [[17, 0], [21, 0], [22, 1], [29, 1], [30, 2], [39, 2], [40, 3], [65, 3]];
  let count = 0;
  for (const [sex, bands] of Object.entries(historical.bodyFatTables)) {
    const female = sex === 'Female';
    for (const band of bands) {
      band.rows.forEach((row, index) => {
        const difference = (band.minCircumferenceHalfInches + index) / 2;
        const hips = female ? 36 : 0;
        row.forEach((fatPercent, column) => {
          const height = (band.minHeightHalfInches + column) / 2;
          const circumference = difference + 16 - hips;
          const tape = { sex, height, weight: 300, abdomen: 40, neck: 16, circumference, hips };
          for (const [age, ageBand] of ageCases) {
            const actual = scoring.scoreHistoricalBca({ ...tape, age }, historical);
            assert.equal(actual.fatPercent, fatPercent, `${sex} ${height} in, circumference value ${difference}`);
            assert.equal(actual.ageAdjusted.limit, historical.ageAdjustedBodyFatLimits[ageBand][sex]);
          }
          count += 1;
        });
      });
    }
  }
  assert.equal(count, 2140);
});

function equivalentRunSeconds(weight, calories, sex, offset) {
  const adjustedCalories = calories + offset;
  const intercept = sex === 'Male' ? 6.296 : 8.066;
  return Math.floor(60 * (4.087 * weight / (adjustedCalories > 0 ? adjustedCalories : 1) + intercept));
}

test('every bike model scores both sides of each calorie cutoff in every PRT profile', () => {
  let count = 0;
  for (const [altitude, sexes] of Object.entries(prt.standards)) {
    for (const [sex, groups] of Object.entries(sexes)) {
      for (const [group, { run }] of Object.entries(groups)) {
        const age = Number.parseInt(group, 10);
        const intercept = sex === 'Male' ? 6.296 : 8.066;
        for (const model of bikes.models) {
          for (const weight of [50, 175, 400]) {
            for (const threshold of run) {
              const cutoff = Math.floor(4.087 * weight / ((threshold + 1) / 60 - intercept) - model.calorieOffset) + 1;
              for (const bike of [cutoff - 1, cutoff, cutoff + 1]) {
                const seconds = equivalentRunSeconds(weight, bike, sex, model.calorieOffset);
                const input = { sex, age, altitude, weight, bike, bikeModel: model.id, cardio: 'bike', edition: 'historical' };
                const result = scoring.scorePrt(input, prt, bikes).events.bike;
                assert.equal(result.runEquivalentSeconds, seconds);
                assert.equal(result.points, thresholdPoints(seconds, run));
                count += 1;
              }
            }
          }
        }
      }
    }
  }
  assert.equal(count, 33264);
});

test('every combination of PRT bands, missing and failed results uses only the chosen cardio', () => {
  const profile = { age: 27, sex: 'Male', altitude: 'standard', weight: 300, bikeModel: bikes.models[0].id };
  const thresholds = prt.standards.standard.Male['25-29'];
  const bands = [null, 0, ...prt.points];
  const bikeCalories = new Map([[null, null]]);
  for (let calories = 0; calories <= 2000 && bikeCalories.size < bands.length; calories += 1) {
    const seconds = equivalentRunSeconds(profile.weight, calories, profile.sex, bikes.models[0].calorieOffset);
    const points = thresholdPoints(seconds, thresholds.run);
    if (!bikeCalories.has(points)) bikeCalories.set(points, calories);
  }
  assert.equal(bikeCalories.size, bands.length);

  function resultFor(event, points) {
    if (event === 'bike') return bikeCalories.get(points);
    if (points === null) return null;
    const values = thresholds[event === 'treadmill' ? 'run' : event];
    if (points > 0) return values[prt.points.indexOf(points)];
    return values.at(-1) + (event === 'pushups' || event === 'plank' ? -1 : 1);
  }

  let count = 0;
  for (const cardio of ['run', 'treadmill', 'row', 'swimYd', 'swimM', 'bike']) {
    for (const pushups of bands) {
      for (const plank of bands) {
        for (const points of bands) {
          const input = {
            ...profile, cardio, run: 3600, pushups: resultFor('pushups', pushups), plank: resultFor('plank', plank),
            [cardio]: resultFor(cardio, points)
          };
          const result = scoring.scorePrt(input, prt, bikes);
          const events = [pushups, plank, points];
          const expected = events.includes(0) ? 'fail' : events.includes(null) ? 'pending' : 'pass';
          assert.equal(result.status, expected, `${cardio}: ${events.join(', ')}`);
          if (expected === 'pass') assert.equal(result.average, (pushups + plank + points) / 3);
          count += 1;
        }
      }
    }
  }
  assert.equal(count, 16464);
});

test('every BCA status combines with every PRT score band under both PFA policies', () => {
  // Columns represent a failed, pending, ordinary passing, or exempting PRT.
  const outcomes = {
    pending: ['fail', 'pending', 'pending', 'pending'],
    'record-weight': ['fail', 'pending', 'pending', 'pending'],
    'fat-required': ['fail', 'pending', 'pending', 'pending'],
    'abdomen-required': ['fail', 'pending', 'pending', 'pending'],
    'tape-required': ['fail', 'pending', 'pending', 'pending'],
    pass: ['fail', 'pending', 'pass', 'pass'],
    fail: ['fail', 'awaiting-exemption', 'fail', 'pass-exemption'],
    prims: ['fail', 'prims', 'prims', 'prims']
  };
  const bands = [null, 0, ...prt.points];
  let count = 0;
  for (const pushups of bands) {
    for (const plank of bands) {
      for (const cardio of bands) {
        const scores = [pushups, plank, cardio];
        const total = pushups + plank + cardio;
        const status = scores.includes(0) ? 'fail' : scores.includes(null) ? 'pending' : 'pass';
        const result = { status, average: total / 3, modalities: scores.map(points => ({ points })) };
        for (const edition of ['historical', 'current']) {
          const qualifying = edition === 'historical' ? total >= 225 : total >= 270 && Math.min(...scores) >= 80;
          const column = status === 'fail' ? 0 : status === 'pending' ? 1 : qualifying ? 3 : 2;
          for (const [bcaStatus, expected] of Object.entries(outcomes)) {
            assert.equal(scoring.scorePfa({ status: bcaStatus }, result, edition), expected[column]);
            count += 1;
          }
        }
      }
    }
  }
  assert.equal(count, 43904);
});
