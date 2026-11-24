window.Navadmin = window.Navadmin || {};

window.Navadmin.messageStore = (function() {
  var storageKey = 'nv-cachedMessages';
  var cachedMessages;
  var bodiesWithoutMetadata = new Map();

  /**
   * Restore the saved message cache when browser storage is available.
   * Keep using the in-memory cache if the saved cache cannot be read.
   */
  function load() {
    if (!isLocalStorageSupported()) {
      console.log('Local storage is unavailable. The viewer will keep messages in memory for this page.');
      return;
    }

    var savedCache;
    try {
      savedCache = localStorage.getItem(storageKey);
    } catch (error) {
      console.log('Unable to read the saved message cache. Continuing with messages in memory.', error.name);
      return;
    }

    cachedMessages = deserializeMapString(savedCache);
    console.log(cachedMessages ? 'Loaded the saved message cache.' : 'No saved message cache was found.');
  }

  /**
   * Save the cached message lists and their downloaded bodies for offline use.
   * @returns {boolean} Whether the cache was written to browser storage.
   */
  function save() {
    if (!cachedMessages) {
      console.log('Skipping the offline cache save because there is no message cache.');
      return false;
    }

    try {
      localStorage.setItem(storageKey, serializeMap(cachedMessages));
      console.log('Saved the message cache for offline use.');
      return true;
    } catch (error) {
      console.log('Unable to save the message cache for offline use.', error.name);
      return false;
    }
  }

  /**
   * Get the cached years for a message type in display order.
   * @param {MsgType} msgType The message type.
   * @returns {number[]} The cached years.
   */
  function years(msgType) {
    var cachedYears = cachedMessages && cachedMessages.get(msgType);
    var yearNumbers = [];
    if (cachedYears) {
      cachedYears.forEach(function(_, year) {
        yearNumbers.push(year);
      });
    }
    return yearNumbers;
  }

  /**
   * Look up the latest cached year for a message type.
   * @param {MsgType} msgType The message type.
   * @returns {number} The latest cached year, or -1 when no year is cached.
   */
  function latestYear(msgType) {
    var yearNumbers = years(msgType);
    for (var i = 0; i < yearNumbers.length; i++) {
      if (yearNumbers[i] != -1) {
        return yearNumbers[i];
      }
    }
    return -1;
  }

  /**
   * Read the current cached list for a year. The table copies the fields it displays.
   * @param {MsgType} msgType The message type.
   * @param {number} msgYear The message year.
   * @returns {Object[]|null} The cached list, or null if metadata is unavailable.
   */
  function messages(msgType, msgYear) {
    var cachedYears = cachedMessages && cachedMessages.get(msgType);
    return (cachedYears && cachedYears.get(msgYear)) || null;
  }

  /**
   * Find a message in the cached list for its type and year.
   * @param {MsgType} msgType The message type.
   * @param {number} msgYear The message year.
   * @param {number} msgNumber The message number.
   * @returns {Object|null} The cached message, or null if it is absent.
   */
  function findMessage(msgType, msgYear, msgNumber) {
    var yearMessages = messages(msgType, msgYear) || [];
    for (var i = 0; i < yearMessages.length; i++) {
      if (yearMessages[i] && yearMessages[i].number === msgNumber) {
        return yearMessages[i];
      }
    }
    return null;
  }

  function bodyKey(msgType, msgYear, msgNumber) {
    return msgTypeToString(msgType) + '/' + msgYear + '/' + msgNumber;
  }

  /**
   * Read a cached message body, including bodies whose list metadata is pending.
   * @param {MsgType} msgType The message type.
   * @param {number} msgYear The message year.
   * @param {number} msgNumber The message number.
   * @returns {string|null} The cached body, or null if it is absent.
   */
  function getBody(msgType, msgYear, msgNumber) {
    var message = findMessage(msgType, msgYear, msgNumber);
    return (message && message.Body) ||
      bodiesWithoutMetadata.get(bodyKey(msgType, msgYear, msgNumber)) ||
      null;
  }

  /**
   * Cache a downloaded body with its metadata or keep it in memory until metadata arrives.
   * @param {MsgType} msgType The message type.
   * @param {number} msgYear The message year.
   * @param {number} msgNumber The message number.
   * @param {string} body The downloaded message text.
   */
  function saveBody(msgType, msgYear, msgNumber, body) {
    var message = findMessage(msgType, msgYear, msgNumber);
    var name = shortNameForMessage(msgType, msgYear, msgNumber);
    if (message) {
      message.Body = body;
      console.log('Cached the downloaded body with the metadata for ' + name + '.');
    } else {
      bodiesWithoutMetadata.set(bodyKey(msgType, msgYear, msgNumber), body);
      console.log('Keeping the downloaded body in memory because the metadata for ' + name + ' is missing.');
    }
  }

  /**
   * Merge one year of metadata by message number while keeping downloaded bodies.
   * @param {MsgType} msgType The message type.
   * @param {number} msgYear The message year.
   * @param {Object[]|null} cached The previously cached messages, when available.
   * @param {Object[]} incoming The message metadata from the server.
   * @returns {{messages: Object[], changed: boolean}} The sorted messages and whether their details changed.
   */
  function mergeYearMessages(msgType, msgYear, cached, incoming) {
    var messagesByNumber = Object.create(null);
    var changed = !cached;
    (cached || []).forEach(function(message) {
      if (message) {
        messagesByNumber[message.number] = message;
      }
    });

    incoming.forEach(function(message) {
      var previous = messagesByNumber[message.number];
      var key = bodyKey(msgType, msgYear, message.number);
      var cachedBody = (previous && previous.Body) || bodiesWithoutMetadata.get(key);
      if (cachedBody) {
        message.Body = cachedBody;
        bodiesWithoutMetadata.delete(key);
      }
      if (!previous || previous.title !== message.title ||
          previous.cancelled !== message.cancelled || previous.Body !== message.Body ||
          JSON.stringify(previous.actSum) !== JSON.stringify(message.actSum)) {
        changed = true;
      }
      messagesByNumber[message.number] = message;
    });

    var mergedMessages = Object.keys(messagesByNumber).map(function(number) {
      return messagesByNumber[number];
    });
    mergedMessages.sort(function(a, b) { return a.number - b.number; });
    return { messages: mergedMessages, changed: changed };
  }

  /**
   * Add listed years and merge supplied metadata, keeping cached lists for omitted years.
   * @param {MsgType} msgType The message type.
   * @param {Object} responseYears The server response keyed by year.
   * @returns {boolean} Whether the cached years or message details changed.
   */
  function mergeMetadata(msgType, responseYears) {
    var cachedYears = cachedMessages && cachedMessages.get(msgType);
    var mergedYears = new Map();
    var changed = false;
    if (cachedYears) {
      cachedYears.forEach(function(yearMessages, year) {
        mergedYears.set(year, yearMessages);
      });
    }

    Object.keys(responseYears).forEach(function(yearKey) {
      var year = Number(yearKey);
      var incoming = responseYears[yearKey].msgSkeletons;
      if (Array.isArray(incoming)) {
        var merged = mergeYearMessages(msgType, year, mergedYears.get(year), incoming);
        mergedYears.set(year, merged.messages);
        changed = changed || merged.changed;
      } else if (!mergedYears.has(year)) {
        mergedYears.set(year, null);
        changed = true;
      }
    });

    var yearNumbers = [];
    mergedYears.forEach(function(_, year) { yearNumbers.push(year); });
    yearNumbers.sort(function(a, b) { return b - a; });

    var sortedYears = new Map();
    yearNumbers.forEach(function(year) { sortedYears.set(year, mergedYears.get(year)); });
    if (!cachedMessages) {
      cachedMessages = new Map();
    }
    cachedMessages.set(msgType, sortedYears);
    return changed;
  }

  return { // The returned object literal. The variables and closures defined in the function are captured by this constructed object.
    load: load,
    save: save,
    years: years,
    latestYear: latestYear,
    messages: messages,
    findMessage: findMessage,
    getBody: getBody,
    saveBody: saveBody,
    mergeMetadata: mergeMetadata
  };
})();
