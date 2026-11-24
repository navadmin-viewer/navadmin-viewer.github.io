window.Navadmin = window.Navadmin || {};

window.Navadmin.messageStore = (function() {
  var databaseName = 'nv-messageCache';
  var metadataStore = 'metadata';
  var bodyStore = 'bodies';
  var statusStore = 'statuses';
  var cachedMessages = new Map();
  var bodyStatuses = new Map();
  var sessionBodies = new Map();
  var database;
  var databaseWritesUnavailable = false;
  var quotaLimitedYears = new Set();
  var bodyWritesByYear = new Map();
  var quotaRecovery;
  var protectYear;
  var onEvicted;
  var loaded = false;
  var loadCallbacks = [];

  function yearKey(type, year) {
    return msgTypeToString(type) + '/' + year;
  }

  function bodyKey(type, year, number) {
    return yearKey(type, year) + '/' + number;
  }

  function bodyStatus(record) {
    return { status: record.status, savedAt: record.savedAt };
  }

  function hasBodyText(body) {
    return typeof body === 'string' && /\S/.test(body);
  }

  function bodyRecord(type, year, number, body, status, savedAt) {
    return { type: type, year: year, number: number, body: body, status: status, savedAt: savedAt };
  }

  function withoutBody(message) {
    if (!Object.prototype.hasOwnProperty.call(message, 'Body')) return message;
    var metadata = {};
    Object.keys(message).forEach(function(key) {
      if (key !== 'Body') metadata[key] = message[key];
    });
    return metadata;
  }

  /**
   * Merge one year's metadata by message number. Bodies are stored separately.
   * @param {Object[]|null|undefined} cached The previously cached messages, when available.
   * @param {Object[]|null} incoming The supplied message metadata, if any.
   * @returns {{messages: (Object[]|null), changed: boolean}} The sorted list and whether the metadata changed.
   */
  function mergeYearMessages(cached, incoming) {
    if (!incoming) return { messages: cached || null, changed: !cached };
    var messagesByNumber = Object.create(null);
    var changed = !cached;
    (cached || []).forEach(function(message) {
      if (message) messagesByNumber[message.number] = message;
    });
    incoming.forEach(function(message) {
      if (!message) return;
      var previous = messagesByNumber[message.number];
      if (!previous || previous.title !== message.title || previous.cancelled !== message.cancelled ||
          JSON.stringify(previous.actSum) !== JSON.stringify(message.actSum)) {
        changed = true;
      }
      messagesByNumber[message.number] = withoutBody(message);
    });
    var merged = Object.keys(messagesByNumber).map(function(number) {
      return messagesByNumber[number];
    });
    merged.sort(function(a, b) { return a.number - b.number; });
    return { messages: merged, changed: changed };
  }

  function setYear(record) {
    var cachedYears = cachedMessages.get(record.type);
    if (!cachedYears) {
      cachedYears = new Map();
      cachedMessages.set(record.type, cachedYears);
    }
    var existing = cachedYears.get(record.year);
    var result = mergeYearMessages(existing, record.messages);
    cachedYears.set(record.year, result.messages);
    return result;
  }

  function preferSessionBody(saved, session) {
    return session && (!saved || saved.status !== 200 && (session.status === 200 || session.savedAt > saved.savedAt));
  }

  /**
   * Check whether IndexedDB writes are enabled, optionally for a particular year.
   * @param {MsgType} [type] The message type.
   * @param {number} [year] The message year.
   * @returns {boolean} Whether the cache can attempt to persist a write.
   */
  function canPersist(type, year) {
    return !!database && !databaseWritesUnavailable &&
      (type === undefined || !quotaLimitedYears.has(yearKey(type, year)));
  }

  function isQuotaError(error) {
    return error && error.name === 'QuotaExceededError';
  }

  function handleWriteError(error) {
    if (error && !isQuotaError(error) && !databaseWritesUnavailable) {
      databaseWritesUnavailable = true;
      console.log('Unable to write to IndexedDB. New messages will be cached in this tab only.', error.name);
    }
  }

  function transact(stores, mode, work, callback) {
    var transaction;
    var workError;
    try {
      transaction = database.transaction(stores, mode);
    } catch (error) {
      setTimeout(function() { callback(error); }, 0);
      return;
    }
    transaction.oncomplete = function() { callback(null); };
    transaction.onabort = function() {
      callback(workError || transaction.error || new Error('The message cache transaction was aborted.'));
    };
    function run(step) {
      try {
        step();
      } catch (error) {
        workError = error;
        transaction.abort();
      }
    }
    run(function() { work(transaction, run); });
  }

  /**
   * Let the viewer protect years in use and update its UI after eviction.
   * @param {function} isProtected Receives the message type and year and returns whether to keep them.
   * @param {function} didEvict Receives the message type, year, and records moved to memory after eviction.
   */
  function setEvictionHandlers(isProtected, didEvict) {
    protectYear = isProtected;
    onEvicted = didEvict;
  }

  function isProtectedYear(type, year) {
    return bodyWritesByYear.has(yearKey(type, year)) || (protectYear && protectYear(type, year));
  }

  function oldestEvictionCandidate(incomingYear) {
    var oldest;
    bodyStatuses.forEach(function(status, key) {
      if (status.status !== 200) return;
      var separator = key.indexOf('/');
      var year = Number(key.slice(separator + 1, key.lastIndexOf('/')));
      if (year <= 0 || year >= incomingYear || (oldest && year >= oldest.year)) return;
      var type = stringToMsgType(key.slice(0, separator));
      if (!isProtectedYear(type, year)) oldest = { type: type, year: year };
    });
    return oldest;
  }

  function evictYear(victim, callback) {
    var prefix = yearKey(victim.type, victim.year) + '/';
    var records = new Map();
    var hasText = false;
    var processed = false;
    transact([bodyStore, statusStore], 'readwrite', function(transaction, run) {
      var bodies = transaction.objectStore(bodyStore);
      var range = window.IDBKeyRange.bound(prefix, prefix + '\uffff');
      var request = bodies.openCursor(range);
      request.onsuccess = function() {
        run(function() {
          if (!canPersist() || isProtectedYear(victim.type, victim.year)) return;
          var cursor = request.result;
          if (cursor) {
            var record = cursor.value;
            records.set(cursor.key, record);
            hasText = hasText || record.status === 200;
            cursor.continue();
            return;
          }
          // Another tab can evict this year before this transaction starts.
          if (hasText) {
            bodies.delete(range);
            transaction.objectStore(statusStore).delete(range);
          }
          processed = true;
        });
      };
    }, function(error) {
      if (error || !processed) return callback(false);
      bodyStatuses.forEach(function(status, key) {
        if (key.indexOf(prefix) === 0) bodyStatuses.delete(key);
      });
      var movedRecords = [];
      if (hasText) {
        records.forEach(function(record, key) {
          var session = sessionBodies.get(key);
          if (preferSessionBody(record, session)) record = session;
          sessionBodies.set(key, record);
          movedRecords.push(record);
        });
      } else {
        records.forEach(rememberSavedStatus);
      }
      try {
        if (onEvicted) onEvicted(victim.type, victim.year, movedRecords);
      } finally {
        callback(true);
      }
    });
  }

  function writeWithEviction(year, stores, work, callback) {
    var previousRecovery = quotaRecovery;
    var recoveryWasRunning = previousRecovery && previousRecovery.waiting;
    transact(stores, 'readwrite', work, function(error) {
      if (!isQuotaError(error) || !year || !canPersist()) return callback(error);

      function retry(recovery) {
        if (!recovery.succeeded || recovery.victim.year >= year || !canPersist()) return callback(error);
        transact(stores, 'readwrite', work, callback);
      }

      // Writes that already started share the result of a single eviction.
      if (quotaRecovery && (quotaRecovery.waiting || quotaRecovery !== previousRecovery || recoveryWasRunning)) {
        if (quotaRecovery.waiting) quotaRecovery.waiting.push(retry);
        else retry(quotaRecovery);
        return;
      }

      var victim = oldestEvictionCandidate(year);
      if (!victim) return callback(error);
      var recovery = { victim: victim, waiting: [retry], succeeded: false };
      quotaRecovery = recovery;
      evictYear(victim, function(succeeded) {
        recovery.succeeded = succeeded;
        var waiting = recovery.waiting;
        recovery.waiting = null;
        waiting.forEach(function(resume) { resume(recovery); });
      });
    });
  }

  function writeDatabaseBody(transaction, key, record) {
    transaction.objectStore(bodyStore).put(record, key);
    transaction.objectStore(statusStore).put(bodyStatus(record), key);
  }

  function readCursor(request, read) {
    request.onsuccess = function() {
      var cursor = request.result;
      if (cursor) {
        read(cursor.value, cursor.key);
        cursor.continue();
      }
    };
  }

  function loadDatabase(callback) {
    transact([metadataStore, statusStore], 'readonly', function(transaction) {
      readCursor(transaction.objectStore(metadataStore).openCursor(), setYear);
      readCursor(transaction.objectStore(statusStore).openCursor(), rememberSavedStatus);
    }, callback);
  }

  function openDatabase(callback) {
    var request;
    try {
      var indexedDB = window.indexedDB || window.msIndexedDB;
      if (indexedDB) request = indexedDB.open(databaseName, 2);
    } catch (error) {
      console.log('Unable to open the IndexedDB message cache.', error.name);
    }
    if (!request) return callback();

    var unavailable = false;
    request.onupgradeneeded = function(event) {
      if (event.oldVersion === 0) {
        request.result.createObjectStore(metadataStore);
        request.result.createObjectStore(bodyStore);
        request.result.createObjectStore(statusStore);
        return;
      }
      // Version 1 imported empty legacy Body fields as completed downloads.
      var bodies = request.transaction.objectStore(bodyStore);
      var statuses = request.transaction.objectStore(statusStore);
      readCursor(bodies.openCursor(), function(record, key) {
        if (record.status === 200 && !hasBodyText(record.body)) {
          bodies.delete(key);
          statuses.delete(key);
        }
      });
    };
    request.onerror = request.onblocked = function() {
      if (unavailable) return;
      unavailable = true;
      callback();
    };
    request.onsuccess = function() {
      var opened = request.result;
      if (unavailable) return opened.close();
      opened.onversionchange = function() { opened.close(); };
      callback(opened);
    };
  }

  /**
   * Restore message metadata and download statuses from IndexedDB.
   * Keep using the in-memory cache if IndexedDB cannot be opened or read.
   * @param {function} callback Called when the cache is ready for use.
   */
  function load(callback) {
    if (loaded) return setTimeout(callback, 0);
    loadCallbacks.push(callback);
    if (loadCallbacks.length > 1) return;
    setTimeout(function() {
      openDatabase(function(opened) {
        if (!opened) return finishLoad();
        database = opened;
        loadDatabase(function(error) {
          if (error) {
            database.close();
            database = null;
            cachedMessages.clear();
            bodyStatuses.clear();
          }
          finishLoad();
        });
      });
    }, 0);
  }

  function finishLoad() {
    loaded = true;
    var callbacks = loadCallbacks;
    loadCallbacks = [];
    callbacks.forEach(function(callback) { callback(); });
  }

  /**
   * Get the cached years for a message type, newest first.
   * @param {MsgType} type The message type.
   * @returns {number[]} The cached years.
   */
  function years(type) {
    var cachedYears = cachedMessages.get(type);
    var yearNumbers = [];
    if (cachedYears) cachedYears.forEach(function(_, year) { yearNumbers.push(year); });
    return yearNumbers.sort(function(a, b) { return b - a; });
  }

  /**
   * Look up the latest cached year for a message type.
   * @param {MsgType} type The message type.
   * @returns {number} The latest cached year, or -1 when no year is cached.
   */
  function latestYear(type) {
    var yearNumbers = years(type);
    for (var i = 0; i < yearNumbers.length; i++) {
      if (yearNumbers[i] !== -1) return yearNumbers[i];
    }
    return -1;
  }

  /**
   * Read the current cached list for a year. The table copies the fields it displays.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @returns {Object[]|null} The cached list in message-number order, or null if metadata is unavailable.
   */
  function messages(type, year) {
    var cachedYears = cachedMessages.get(type);
    return (cachedYears && cachedYears.get(year)) || null;
  }

  /**
   * Find a message in the cached list for its type and year.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @returns {Object|null} The cached message, or null if it is absent.
   */
  function findMessage(type, year, number) {
    var yearMessages = messages(type, year) || [];
    for (var i = 0; i < yearMessages.length; i++) {
      if (yearMessages[i].number === number) return yearMessages[i];
    }
    return null;
  }

  /**
   * Save refreshed year lists to IndexedDB for offline use.
   * @param {Object[]} records The updated year records already cached in memory.
   */
  function persistMetadata(records) {
    if (!canPersist()) return;
    var newestYearWithMessages = records.reduce(function(year, record) {
      return record.messages && record.messages.length ? Math.max(year, record.year) : year;
    }, 0);
    writeWithEviction(newestYearWithMessages, [metadataStore], function(transaction, run) {
      var store = transaction.objectStore(metadataStore);
      records.forEach(function(record) {
        var key = yearKey(record.type, record.year);
        var read = store.get(key);
        read.onsuccess = function() {
          run(function() {
            if (read.result) {
              record.messages = mergeYearMessages(read.result.messages, record.messages).messages;
            }
            store.put(record, key);
          });
        };
      });
    }, handleWriteError);
  }

  /**
   * Add listed years and merge supplied metadata, keeping cached lists for omitted years.
   * @param {MsgType} type The message type.
   * @param {Object} responseYears The server response keyed by year.
   * @returns {boolean} Whether the cached years or message details changed.
   */
  function mergeMetadata(type, responseYears) {
    var records = [];
    Object.keys(responseYears).forEach(function(key) {
      var year = Number(key);
      var incoming = responseYears[key].msgSkeletons;
      var record = { type: type, year: year, messages: Array.isArray(incoming) ? incoming : null };
      var cachedYears = cachedMessages.get(type);
      if (!record.messages && cachedYears && cachedYears.has(year)) return;
      var result = setYear(record);
      if (result.changed) {
        record.messages = result.messages;
        records.push(record);
      }
    });
    if (records.length) persistMetadata(records);
    return records.length > 0;
  }

  function rememberSavedStatus(record, key) {
    var status = bodyStatus(record);
    status.persistent = true;
    bodyStatuses.set(key, status);
  }

  /**
   * Look up a cached download outcome without reading the body text.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @returns {{status: number, savedAt: number, persistent: boolean}|null} The outcome, timestamp,
   *   and whether the outcome is stored in IndexedDB, or null if the message has no cached outcome.
   */
  function getBodyStatus(type, year, number) {
    var key = bodyKey(type, year, number);
    var saved = bodyStatuses.get(key);
    var session = sessionBodies.get(key);
    if (preferSessionBody(saved, session)) {
      var status = bodyStatus(session);
      // A newer 404 can refresh the retry timer while an older 404 is still on disk.
      status.persistent = !!saved && saved.status === session.status;
      return status;
    }
    return saved || null;
  }

  /**
   * List years with cached body text, including bodies held only in memory.
   * @param {MsgType} type The message type.
   * @returns {number[]} The searchable years, newest first.
   */
  function bodyYears(type) {
    var prefix = msgTypeToString(type) + '/';
    var found = new Set();
    bodyStatuses.forEach(function(record, key) {
      if (record.status === 200 && key.indexOf(prefix) === 0) {
        found.add(Number(key.slice(prefix.length, key.lastIndexOf('/'))));
      }
    });
    sessionBodies.forEach(function(record) {
      if (record.type === type && record.status === 200) found.add(record.year);
    });
    var years = [];
    found.forEach(function(year) { years.push(year); });
    return years.sort(function(a, b) { return b - a; });
  }

  /**
   * Read a cached body or 404 outcome, including messages whose list metadata is pending.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @param {function} callback Receives the record from IndexedDB or memory, or null if unavailable.
   */
  function getBodyRecord(type, year, number, callback) {
    var key = bodyKey(type, year, number);
    var record;
    function finish() {
      var session = sessionBodies.get(key);
      callback((preferSessionBody(record, session) ? session : record) || null);
    }
    if (database) {
      transact([bodyStore], 'readonly', function(transaction) {
        var read = transaction.objectStore(bodyStore).get(key);
        read.onsuccess = function() { record = read.result; };
      }, finish);
    } else {
      setTimeout(finish, 0);
    }
  }

  /**
   * Read a year's cached body records from IndexedDB and memory.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {function} callback Receives the records read so far and any in-memory records for the year.
   */
  function listBodyRecords(type, year, callback) {
    var prefix = yearKey(type, year) + '/';
    var records = new Map();
    function finish() {
      sessionBodies.forEach(function(record, key) {
        if (key.indexOf(prefix) === 0 && preferSessionBody(records.get(key), record)) records.set(key, record);
      });
      var result = [];
      records.forEach(function(record) { result.push(record); });
      callback(result);
    }
    if (database) {
      transact([bodyStore], 'readonly', function(transaction) {
        var keyRange = window.IDBKeyRange.bound(prefix, prefix + '\uffff');
        readCursor(transaction.objectStore(bodyStore).openCursor(keyRange), function(record, key) {
          records.set(key, record);
        });
      }, finish);
    } else {
      setTimeout(finish, 0);
    }
  }

  /**
   * Cache a downloaded body or 404 outcome. Recover space on quota errors or keep the outcome in memory.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @param {string|null} body The downloaded message text, or null for a 404.
   * @param {number} status The HTTP status, either 200 or 404.
   * @param {function} callback Receives the resulting cached record.
   */
  function saveBodyResult(type, year, number, body, status, callback) {
    var groupKey = yearKey(type, year);
    var key = bodyKey(type, year, number);
    var record = bodyRecord(type, year, number, status === 200 ? body : null, status, Date.now());
    function saveInSession() {
      var previous = sessionBodies.get(key);
      if (status === 404 && previous && previous.status === 200) {
        record = previous;
      } else {
        sessionBodies.set(key, record);
      }
      callback(record);
    }
    if (!canPersist(type, year)) return setTimeout(saveInSession, 0);

    bodyWritesByYear.set(groupKey, (bodyWritesByYear.get(groupKey) || 0) + 1);
    writeWithEviction(year, [bodyStore, statusStore], function(transaction, run) {
      if (status === 200) {
        writeDatabaseBody(transaction, key, record);
      } else {
        var read = transaction.objectStore(bodyStore).get(key);
        read.onsuccess = function() {
          run(function() {
            if (read.result && read.result.status === 200) record = read.result;
            else writeDatabaseBody(transaction, key, record);
          });
        };
      }
    }, function(error) {
      var remaining = bodyWritesByYear.get(groupKey) - 1;
      if (remaining) bodyWritesByYear.set(groupKey, remaining);
      else bodyWritesByYear.delete(groupKey);
      if (error) {
        if (isQuotaError(error)) quotaLimitedYears.add(groupKey);
        handleWriteError(error);
        saveInSession();
      } else {
        rememberSavedStatus(record, key);
        sessionBodies.delete(key);
        callback(record);
      }
    });
  }

  return {
    load: load,
    years: years,
    latestYear: latestYear,
    messages: messages,
    findMessage: findMessage,
    mergeMetadata: mergeMetadata,
    hasBodyText: hasBodyText,
    canPersist: canPersist,
    setEvictionHandlers: setEvictionHandlers,
    getBodyStatus: getBodyStatus,
    bodyYears: bodyYears,
    getBodyRecord: getBodyRecord,
    listBodyRecords: listBodyRecords,
    saveBodyResult: saveBodyResult
  };
})();
