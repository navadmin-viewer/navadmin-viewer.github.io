window.Navadmin = window.Navadmin || {};

window.Navadmin.messageStore = (function() {
  var persistentDatabaseName = 'nv-messageCache';
  var persistentMetadataStoreName = 'metadata';
  var persistentMessageBodyRecordStoreName = 'bodies';
  var persistentMessageBodyStatusStoreName = 'statuses';
  var inMemoryMetadataStore = new Map();
  var persistedMessageBodyStatuses = new Map();
  var inMemoryMessageBodyRecordStore = new Map();
  var persistentDatabase;
  var persistentWritesUnavailable = false;
  var quotaLimitedYears = new Set();
  var messageBodyWritesByYear = new Map();
  var quotaRecovery;
  var protectYear;
  var onEvicted;
  var loaded = false;
  var loadCallbacks = [];

  function yearKey(type, year) {
    return msgTypeToString(type) + '/' + year;
  }

  function messageBodyRecordKey(type, year, number) {
    return yearKey(type, year) + '/' + number;
  }

  function messageBodyStatus(record) {
    return { status: record.status, savedAt: record.savedAt };
  }

  function hasMessageBodyText(messageBody) {
    return typeof messageBody === 'string' && /\S/.test(messageBody);
  }

  function createMessageBodyRecord(type, year, number, messageBody, status, savedAt) {
    return { type: type, year: year, number: number, body: messageBody, status: status, savedAt: savedAt };
  }

  function withoutMessageBody(message) {
    if (!Object.prototype.hasOwnProperty.call(message, 'Body')) return message;
    var metadata = {};
    Object.keys(message).forEach(function(key) {
      if (key !== 'Body') metadata[key] = message[key];
    });
    return metadata;
  }

  /**
   * Merge one year's metadata by message number. Message bodies are stored separately.
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
      messagesByNumber[message.number] = withoutMessageBody(message);
    });
    var merged = Object.keys(messagesByNumber).map(function(number) {
      return messagesByNumber[number];
    });
    merged.sort(function(a, b) { return a.number - b.number; });
    return { messages: merged, changed: changed };
  }

  function setYear(record) {
    var cachedYears = inMemoryMetadataStore.get(record.type);
    if (!cachedYears) {
      cachedYears = new Map();
      inMemoryMetadataStore.set(record.type, cachedYears);
    }
    var existing = cachedYears.get(record.year);
    var result = mergeYearMessages(existing, record.messages);
    cachedYears.set(record.year, result.messages);
    return result;
  }

  function preferInMemoryMessageBodyRecord(saved, inMemoryRecord) {
    return inMemoryRecord && (!saved ||
      saved.status !== 200 && (inMemoryRecord.status === 200 || inMemoryRecord.savedAt > saved.savedAt));
  }

  /**
   * Check whether the persistent store can accept writes, optionally for a particular year.
   * @param {MsgType} [type] The message type.
   * @param {number} [year] The message year.
   * @returns {boolean} Whether a persistent store write can be attempted.
   */
  function canPersist(type, year) {
    return !!persistentDatabase && !persistentWritesUnavailable &&
      (type === undefined || !quotaLimitedYears.has(yearKey(type, year)));
  }

  function isQuotaError(error) {
    return error && error.name === 'QuotaExceededError';
  }

  function handleWriteError(error) {
    if (error && !isQuotaError(error) && !persistentWritesUnavailable) {
      persistentWritesUnavailable = true;
      console.log('Unable to write to the persistent store. New messages will use the in-memory store for this tab.', error.name);
    }
  }

  function transact(stores, mode, work, callback) {
    var transaction;
    var workError;
    try {
      transaction = persistentDatabase.transaction(stores, mode);
    } catch (error) {
      setTimeout(function() { callback(error); }, 0);
      return;
    }
    transaction.oncomplete = function() { callback(null); };
    transaction.onabort = function() {
      callback(workError || transaction.error || new Error('The persistent store transaction was aborted.'));
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
   * @param {function} didEvict Receives the message type, year, and message body records moved to the in-memory store.
   */
  function setEvictionHandlers(isProtected, didEvict) {
    protectYear = isProtected;
    onEvicted = didEvict;
  }

  function isProtectedYear(type, year) {
    return messageBodyWritesByYear.has(yearKey(type, year)) || (protectYear && protectYear(type, year));
  }

  function oldestEvictionCandidate(incomingYear) {
    var oldest;
    persistedMessageBodyStatuses.forEach(function(status, key) {
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
    var hasPublishedMessageBody = false;
    var processed = false;
    transact([persistentMessageBodyRecordStoreName, persistentMessageBodyStatusStoreName], 'readwrite', function(transaction, run) {
      var messageBodyRecords = transaction.objectStore(persistentMessageBodyRecordStoreName);
      var range = window.IDBKeyRange.bound(prefix, prefix + '\uffff');
      var request = messageBodyRecords.openCursor(range);
      request.onsuccess = function() {
        run(function() {
          if (!canPersist() || isProtectedYear(victim.type, victim.year)) return;
          var cursor = request.result;
          if (cursor) {
            var record = cursor.value;
            records.set(cursor.key, record);
            hasPublishedMessageBody = hasPublishedMessageBody || record.status === 200;
            cursor.continue();
            return;
          }
          // Another tab can evict this year before this transaction starts.
          if (hasPublishedMessageBody) {
            messageBodyRecords.delete(range);
            transaction.objectStore(persistentMessageBodyStatusStoreName).delete(range);
          }
          processed = true;
        });
      };
    }, function(error) {
      if (error || !processed) return callback(false);
      persistedMessageBodyStatuses.forEach(function(status, key) {
        if (key.indexOf(prefix) === 0) persistedMessageBodyStatuses.delete(key);
      });
      var movedRecords = [];
      if (hasPublishedMessageBody) {
        records.forEach(function(record, key) {
          var inMemoryRecord = inMemoryMessageBodyRecordStore.get(key);
          if (preferInMemoryMessageBodyRecord(record, inMemoryRecord)) record = inMemoryRecord;
          inMemoryMessageBodyRecordStore.set(key, record);
          movedRecords.push(record);
        });
      } else {
        records.forEach(rememberPersistentMessageBodyStatus);
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

  function writePersistentMessageBodyRecord(transaction, key, record) {
    transaction.objectStore(persistentMessageBodyRecordStoreName).put(record, key);
    transaction.objectStore(persistentMessageBodyStatusStoreName).put(messageBodyStatus(record), key);
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
    transact([persistentMetadataStoreName, persistentMessageBodyStatusStoreName], 'readonly', function(transaction) {
      readCursor(transaction.objectStore(persistentMetadataStoreName).openCursor(), setYear);
      readCursor(transaction.objectStore(persistentMessageBodyStatusStoreName).openCursor(), rememberPersistentMessageBodyStatus);
    }, callback);
  }

  function openDatabase(callback) {
    var request;
    try {
      var indexedDB = window.indexedDB || window.msIndexedDB;
      if (indexedDB) request = indexedDB.open(persistentDatabaseName, 2);
    } catch (error) {
      console.log('Unable to open the persistent store (IndexedDB).', error.name);
    }
    if (!request) return callback();

    var unavailable = false;
    request.onupgradeneeded = function(event) {
      if (event.oldVersion === 0) {
        request.result.createObjectStore(persistentMetadataStoreName);
        request.result.createObjectStore(persistentMessageBodyRecordStoreName);
        request.result.createObjectStore(persistentMessageBodyStatusStoreName);
        return;
      }
      // Version 1 imported empty legacy Body fields as completed downloads.
      var messageBodyRecords = request.transaction.objectStore(persistentMessageBodyRecordStoreName);
      var messageBodyStatuses = request.transaction.objectStore(persistentMessageBodyStatusStoreName);
      readCursor(messageBodyRecords.openCursor(), function(record, key) {
        if (record.status === 200 && !hasMessageBodyText(record.body)) {
          messageBodyRecords.delete(key);
          messageBodyStatuses.delete(key);
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
   * Restore message metadata and message body download statuses from the persistent store.
   * Use the in-memory store alone if the persistent store cannot be opened or read.
   * @param {function} callback Called when the message store is ready for use.
   */
  function load(callback) {
    if (loaded) return setTimeout(callback, 0);
    loadCallbacks.push(callback);
    if (loadCallbacks.length > 1) return;
    setTimeout(function() {
      openDatabase(function(opened) {
        if (!opened) return finishLoad();
        persistentDatabase = opened;
        loadDatabase(function(error) {
          if (error) {
            persistentDatabase.close();
            persistentDatabase = null;
            inMemoryMetadataStore.clear();
            persistedMessageBodyStatuses.clear();
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
    var cachedYears = inMemoryMetadataStore.get(type);
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
    var cachedYears = inMemoryMetadataStore.get(type);
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
   * Save refreshed year lists to the persistent store for offline use.
   * @param {Object[]} records The updated year records already in the in-memory store.
   */
  function persistMetadata(records) {
    if (!canPersist()) return;
    var newestYearWithMessages = records.reduce(function(year, record) {
      return record.messages && record.messages.length ? Math.max(year, record.year) : year;
    }, 0);
    writeWithEviction(newestYearWithMessages, [persistentMetadataStoreName], function(transaction, run) {
      var store = transaction.objectStore(persistentMetadataStoreName);
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
      var cachedYears = inMemoryMetadataStore.get(type);
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

  function rememberPersistentMessageBodyStatus(record, key) {
    var status = messageBodyStatus(record);
    status.persistent = true;
    persistedMessageBodyStatuses.set(key, status);
  }

  /**
   * Look up a message body download outcome without reading the text.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @returns {{status: number, savedAt: number, persistent: boolean}|null} The outcome, timestamp,
   *   and whether the outcome is in the persistent store, or null if the message has no stored outcome.
   */
  function getMessageBodyStatus(type, year, number) {
    var key = messageBodyRecordKey(type, year, number);
    var saved = persistedMessageBodyStatuses.get(key);
    var inMemoryRecord = inMemoryMessageBodyRecordStore.get(key);
    if (preferInMemoryMessageBodyRecord(saved, inMemoryRecord)) {
      var status = messageBodyStatus(inMemoryRecord);
      // A newer 404 can refresh the retry timer while an older 404 is still on disk.
      status.persistent = !!saved && saved.status === inMemoryRecord.status;
      return status;
    }
    return saved || null;
  }

  /**
   * List years with message body text in the persistent or in-memory store.
   * @param {MsgType} type The message type.
   * @returns {number[]} The searchable years, newest first.
   */
  function messageBodyYears(type) {
    var prefix = msgTypeToString(type) + '/';
    var found = new Set();
    persistedMessageBodyStatuses.forEach(function(record, key) {
      if (record.status === 200 && key.indexOf(prefix) === 0) {
        found.add(Number(key.slice(prefix.length, key.lastIndexOf('/'))));
      }
    });
    inMemoryMessageBodyRecordStore.forEach(function(record) {
      if (record.type === type && record.status === 200) found.add(record.year);
    });
    var years = [];
    found.forEach(function(year) { years.push(year); });
    return years.sort(function(a, b) { return b - a; });
  }

  /**
   * Read a stored message body or 404 outcome, including messages whose list metadata is pending.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @param {function} callback Receives the record from either store, or null if unavailable.
   */
  function getMessageBodyRecord(type, year, number, callback) {
    var key = messageBodyRecordKey(type, year, number);
    var record;
    function finish() {
      var inMemoryRecord = inMemoryMessageBodyRecordStore.get(key);
      callback((preferInMemoryMessageBodyRecord(record, inMemoryRecord) ? inMemoryRecord : record) || null);
    }
    if (persistentDatabase) {
      transact([persistentMessageBodyRecordStoreName], 'readonly', function(transaction) {
        var read = transaction.objectStore(persistentMessageBodyRecordStoreName).get(key);
        read.onsuccess = function() { record = read.result; };
      }, finish);
    } else {
      setTimeout(finish, 0);
    }
  }

  /**
   * Read a year's message body records from the persistent and in-memory stores.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {function} callback Receives the records from both stores for the year.
   */
  function listMessageBodyRecords(type, year, callback) {
    var prefix = yearKey(type, year) + '/';
    var records = new Map();
    function finish() {
      inMemoryMessageBodyRecordStore.forEach(function(record, key) {
        if (key.indexOf(prefix) === 0 && preferInMemoryMessageBodyRecord(records.get(key), record)) records.set(key, record);
      });
      var result = [];
      records.forEach(function(record) { result.push(record); });
      callback(result);
    }
    if (persistentDatabase) {
      transact([persistentMessageBodyRecordStoreName], 'readonly', function(transaction) {
        var keyRange = window.IDBKeyRange.bound(prefix, prefix + '\uffff');
        readCursor(transaction.objectStore(persistentMessageBodyRecordStoreName).openCursor(keyRange), function(record, key) {
          records.set(key, record);
        });
      }, finish);
    } else {
      setTimeout(finish, 0);
    }
  }

  /**
   * Store a downloaded message body or 404 outcome. Recover space on quota errors or use the in-memory store.
   * @param {MsgType} type The message type.
   * @param {number} year The message year.
   * @param {number} number The message number.
   * @param {string|null} messageBody The downloaded message body text, or null for a 404.
   * @param {number} status The HTTP status, either 200 or 404.
   * @param {function} callback Receives the resulting cached record.
   */
  function saveMessageBodyResult(type, year, number, messageBody, status, callback) {
    var groupKey = yearKey(type, year);
    var key = messageBodyRecordKey(type, year, number);
    var record = createMessageBodyRecord(type, year, number, status === 200 ? messageBody : null, status, Date.now());
    function saveInMemory() {
      var previous = inMemoryMessageBodyRecordStore.get(key);
      if (status === 404 && previous && previous.status === 200) {
        record = previous;
      } else {
        inMemoryMessageBodyRecordStore.set(key, record);
      }
      callback(record);
    }
    if (!canPersist(type, year)) return setTimeout(saveInMemory, 0);

    messageBodyWritesByYear.set(groupKey, (messageBodyWritesByYear.get(groupKey) || 0) + 1);
    writeWithEviction(year, [persistentMessageBodyRecordStoreName, persistentMessageBodyStatusStoreName], function(transaction, run) {
      if (status === 200) {
        writePersistentMessageBodyRecord(transaction, key, record);
      } else {
        var read = transaction.objectStore(persistentMessageBodyRecordStoreName).get(key);
        read.onsuccess = function() {
          run(function() {
            if (read.result && read.result.status === 200) record = read.result;
            else writePersistentMessageBodyRecord(transaction, key, record);
          });
        };
      }
    }, function(error) {
      var remaining = messageBodyWritesByYear.get(groupKey) - 1;
      if (remaining) messageBodyWritesByYear.set(groupKey, remaining);
      else messageBodyWritesByYear.delete(groupKey);
      if (error) {
        if (isQuotaError(error)) quotaLimitedYears.add(groupKey);
        handleWriteError(error);
        saveInMemory();
      } else {
        rememberPersistentMessageBodyStatus(record, key);
        inMemoryMessageBodyRecordStore.delete(key);
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
    hasMessageBodyText: hasMessageBodyText,
    canPersist: canPersist,
    setEvictionHandlers: setEvictionHandlers,
    getMessageBodyStatus: getMessageBodyStatus,
    messageBodyYears: messageBodyYears,
    getMessageBodyRecord: getMessageBodyRecord,
    listMessageBodyRecords: listMessageBodyRecords,
    saveMessageBodyResult: saveMessageBodyResult
  };
})();
