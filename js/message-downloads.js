(function(window) {
  var Navadmin = window.Navadmin;
  var store = Navadmin.messageStore;
  var jobs = new Map();
  var evictedYears = new Set();
  var preferredKey;
  var activeMetadataJob;
  var bodiesInProgress = 0;
  var maxConcurrentBodies = 4;
  var onChange;
  var pumping = false;

  function yearKey(type, year) {
    return type + '/' + year;
  }

  function getJob(type, year) {
    var key = yearKey(type, year);
    var job = jobs.get(key);
    if (!job) {
      job = { type: type, year: year, pending: [], active: new Set(), failed: new Set() };
      jobs.set(key, job);
    }
    return job;
  }

  function changed(job, record, metadataReady) {
    if (onChange) {
      onChange(job.type, job.year, record, metadataReady);
    }
  }

  function offline() {
    return window.navigator.onLine === false;
  }

  function progress(type, year) {
    var messages = store.messages(type, year);
    var job = jobs.get(yearKey(type, year));
    if (!messages && !job) {
      return null;
    }
    var total = messages ? 0 : null;
    var completed = 0;
    var hasSessionBodies = false;
    if (messages) {
      messages.forEach(function(message) {
        if (message) {
          total++;
          var status = store.getBodyStatus(type, year, message.number);
          if (status) {
            completed++;
            hasSessionBodies = hasSessionBodies || !status.persistent;
          }
        }
      });
    }
    var incomplete = completed !== total;
    var hasBodyWork = !!job && (job.active.size > 0 || job.pending.length > 0);
    var reason = null;
    if (job && incomplete) {
      if (offline()) {
        reason = 'Offline';
      } else if (!hasBodyWork && !job.metadataQueued && activeMetadataJob !== job) {
        reason = job.metadataError || (job.failed.size ? 'Select year to retry' : null);
      }
    }
    return {
      total: total,
      completed: completed,
      temporary: hasSessionBodies || (!!job && incomplete && !store.canPersist(type, year)),
      requested: !!job,
      active: hasBodyWork && job.started === true && !reason,
      reason: reason
    };
  }

  function refreshPendingBodies(job) {
    job.pending = [];
    if (evictedYears.has(yearKey(job.type, job.year))) return;
    var messages = store.messages(job.type, job.year) || [];
    // The store orders messages by number. Pop the highest numbers first.
    messages.forEach(function(message) {
      if (!message) return;
      var number = message.number;
      if (!job.active.has(number) && !job.failed.has(number) &&
          !isCurrentBodyRecord(store.getBodyStatus(job.type, job.year, number))) {
        job.pending.push(number);
      }
    });
  }

  function nextJob(matches) {
    var preferred = jobs.get(preferredKey);
    // Prefer the selected year when it has work ready. Other years can use free slots.
    if (preferred && matches(preferred)) {
      return preferred;
    }
    var next;
    jobs.forEach(function(job) {
      if (!next && matches(job)) {
        next = job;
      }
    });
    return next;
  }

  function loadMetadata(job) {
    job.metadataQueued = false;
    activeMetadataJob = job;
    getYearsForMsgType(job.type, [job.year], function(result) {
      activeMetadataJob = null;
      job.metadataError = !store.messages(job.type, job.year) ?
        (result.errorText || 'Message list unavailable') : null;
      refreshPendingBodies(job);
      changed(job, null, true);
      pump();
    }, true);
  }

  function downloadBody(job, number) {
    job.started = true;
    job.active.add(number);
    bodiesInProgress++;
    if (job.active.size === 1) {
      changed(job);
    }
    getMsgBody(job.type, job.year, number, function(body, errorText, result) {
      job.active.delete(number);
      bodiesInProgress--;
      if (result.status !== 200 && result.status !== 404) {
        job.failed.add(number);
      }
      changed(job);
      pump();
    }, true);
  }

  function pump() {
    if (pumping || offline()) {
      return;
    }
    pumping = true;
    try {
      var job;
      while (!activeMetadataJob && (job = nextJob(needsMetadata))) {
        loadMetadata(job);
      }
      while (bodiesInProgress < maxConcurrentBodies && (job = nextJob(hasPendingBodies))) {
        var number = job.pending.pop();
        if (!isCurrentBodyRecord(store.getBodyStatus(job.type, job.year, number))) {
          downloadBody(job, number);
        }
      }
    } finally {
      pumping = false;
    }
  }

  function needsMetadata(job) {
    return job.metadataQueued;
  }

  function hasPendingBodies(job) {
    return job.pending.length > 0;
  }

  function queueYear(type, year, userSelection) {
    if (userSelection) {
      preferredKey = yearKey(type, year);
      evictedYears.delete(preferredKey);
    }
    if (year > 0 && store.messages(type, year)) {
      var job = getJob(type, year);
      if (userSelection) {
        job.failed.clear();
      }
      refreshPendingBodies(job);
      changed(job);
    }
    pump();
  }

  function queueAll(type) {
    store.years(type).forEach(function(year) {
      if (year > 0) {
        var job = getJob(type, year);
        evictedYears.delete(yearKey(type, year));
        job.failed.clear();
        job.metadataQueued = activeMetadataJob !== job;
        refreshPendingBodies(job);
        changed(job);
      }
    });
    pump();
  }

  Navadmin.messageDownloads = {
    init: function(handler, onEvicted, isOpenMessageYear) {
      onChange = handler;
      store.setEvictionHandlers(function(type, year) {
        var key = yearKey(type, year);
        var job = jobs.get(key);
        return key === preferredKey || isOpenMessageYear(type, year) ||
          !!job && (job.active.size > 0 || job.started && job.pending.length > 0);
      }, function(type, year, movedRecords) {
        var key = yearKey(type, year);
        var job = jobs.get(key);
        // Keep automatic retries from refilling the space freed by this eviction.
        if (key === preferredKey) {
          if (job) refreshPendingBodies(job);
        } else {
          evictedYears.add(key);
          if (job) {
            job.pending = [];
            job.metadataQueued = false;
          }
        }
        onEvicted(type, year, movedRecords);
        if (key === preferredKey) pump();
      });
      window.addEventListener('offline', function() {
        jobs.forEach(function(job) { changed(job); });
      });
      window.addEventListener('online', function() {
        jobs.forEach(function(job) {
          if (evictedYears.has(yearKey(job.type, job.year))) return;
          job.failed.clear();
          if (job.metadataError && activeMetadataJob !== job) {
            job.metadataQueued = true;
          }
          refreshPendingBodies(job);
          changed(job);
        });
        pump();
      });
    },
    progress: progress,
    queueYear: queueYear,
    queueAll: queueAll,
    recordAvailable: function(record) {
      changed(record, record);
    }
  };
})(window);
