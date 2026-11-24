var server = 'https://navadmin-server.runs.io';

// Only successful metadata and broadcast requests have a cooldown.
var serverRequestCooldownSeconds = 600;
var requestThrottleByKey = new Map();
var pendingCallbacksByRequestKey = new Map();

/**
 * Record the start of a cooldown or clear the throttle after a failed request.
 * @param {string} data The key in the request throttle.
 * @param {boolean} success Whether the request succeeded.
 */
function releaseActiveMetadataRequest(data, success) {
  if (success) {
    requestThrottleByKey.set(data, Date.now() + serverRequestCooldownSeconds * 1000);
  } else {
    requestThrottleByKey.delete(data);
  }
}

/**
 * Mark a request as in progress in the throttle.
 * @param {string} data The key in the request throttle.
 */
function setActiveMetadataRequest(data) {
  requestThrottleByKey.set(data, -1);
}

/**
 * Check whether the throttle allows a request for the given key.
 * @param {string} data The key in the request throttle.
 * @returns {boolean} True when the key has no throttle entry or its cooldown has expired.
 */
function checkIfActiveMetadataRequestAllowed(data) {
  var nextTimeRequestAllowed = requestThrottleByKey.get(data);
  if (nextTimeRequestAllowed === -1) {
    console.log('Skipping request for ' + data + ' because it is already in progress.');
    return false;
  }

  var remaining = nextTimeRequestAllowed - Date.now();
  if (remaining > 0) {
    console.log('Skipping request for ' + data + ' because its cooldown has ' + Math.ceil(remaining / 1000) + ' seconds left.');
    return false;
  }
  return true;
}

/**
 * Register a request or join an identical request already in progress.
 * @param {string} key The form data identifying the request.
 * @param {function} [completionHandler] Receives the shared result.
 * @returns {boolean} True when the caller should send a new network request.
 */
function startMessageRequest(key, completionHandler) {
  var callbacks = pendingCallbacksByRequestKey.get(key);
  if (callbacks) {
    console.log('Joining the pending request for ' + key + '.');
    if (completionHandler) {
      callbacks.push(completionHandler);
    }
    return false;
  }

  pendingCallbacksByRequestKey.set(key, completionHandler ? [completionHandler] : []);
  console.log('Starting a network request for ' + key + '.');
  return true;
}

/**
 * Remove the pending request and notify its callers so a callback can retry a failure.
 * @param {string} key The form data identifying the request.
 * @param {Array} result The arguments to pass to each waiting callback.
 */
function finishMessageRequest(key, result) {
  var callbacks = pendingCallbacksByRequestKey.get(key);
  pendingCallbacksByRequestKey.delete(key);
  callbacks.forEach(function(callback) {
    callback.apply(null, result);
  });
}

/**
 * Build the form parameters for a message body request.
 * @param {MsgType} msgType The message type.
 * @param {number} msgYear The message year.
 * @param {number} msgNumber The message number.
 * @returns {string} The form data used to identify the request.
 */
function messageBodyKey(msgType, msgYear, msgNumber) {
  return 'type=' + msgTypeToString(msgType) + '&year=' + msgYear + '&number=' + msgNumber;
}

/**
 * Refresh a message type's year list and requested message metadata in the cache.
 * @param {MsgType} msgType The message type to fetch.
 * @param {number[]} yearsToGetMetadata The years whose message metadata should be included. Pass an empty array for the year list alone.
 * @param {boolean} getLatestYearMetadata Whether to start a follow-up metadata request for the latest year after success.
 * @param {function} [completionHandler] Receives an object with requestOutcome and errorText.
 *   The outcome is network after a successful response, cooldown when a recent success is reused,
 *   or error when the request fails. The error text is null on success.
 */
function getYearsForMsgType(msgType, yearsToGetMetadata, getLatestYearMetadata, completionHandler) {
  var postData = 'type=' + msgTypeToString(msgType);
  (yearsToGetMetadata || []).forEach(function(year) {
    postData += '&yearsMetadata=' + year;
  });

  function complete(requestOutcome, errorText) {
    if (requestOutcome !== 'error' && getLatestYearMetadata) {
      var latestYear = Navadmin.messageStore.latestYear(msgType);
      if (latestYear > -1) {
        console.log('Requesting metadata for the latest ' + msgTypeToString(msgType) + ' year, ' + latestYear + '.');
        getYearsForMsgType(msgType, [latestYear], false, null);
      }
    }
    if (completionHandler) {
      completionHandler({ requestOutcome: requestOutcome, errorText: errorText });
    }
  }

  if (!pendingCallbacksByRequestKey.has(postData) && !checkIfActiveMetadataRequestAllowed(postData)) {
    console.log('Using cached metadata for ' + postData + '.');
    complete('cooldown', null);
    return;
  }

  if (!startMessageRequest(postData, complete)) {
    return;
  }

  var request = $.ajax({
    url: server + '/messages',
    method: 'POST',
    data: postData,
    dataType: 'json'
  });
  request.done(function(data) {
    if (!data || data.status !== 0 || !data.years || typeof data.years !== 'object') {
      console.log('The response for ' + postData + ' did not contain a successful year list.');
      finishMessageRequest(postData, ['error', 'Unable to get the message list.']);
      return;
    }
    var metadataChangedByMerge = Navadmin.messageStore.mergeMetadata(msgType, data.years);
    var yearCount = Object.keys(data.years).length;
    console.log('Received ' + yearCount + ' year entries for ' + postData + '. ' +
      (metadataChangedByMerge ? 'Updated the cache.' : 'Cached message details match the response.'));
    releaseActiveMetadataRequest(postData, true);
    finishMessageRequest(postData, ['network', null]);
  });
  request.fail(function(jqXHR, textStatus) {
    console.log('Metadata request failed for ' + postData + ' with status ' + textStatus + ' and HTTP status ' + jqXHR.status + '.');
    finishMessageRequest(postData, ['error', 'Unable to get the message list.']);
  });
}

/**
 * Read a message body from the cache or fetch it independently of its list metadata.
 * @param {MsgType} msgType The message type.
 * @param {number} msgYear The message year.
 * @param {number} msgNumber The message number.
 * @param {function} [completionHandler] Receives (body, errorText). The body is null on failure and the error text is null on success.
 */
function getMsgBody(msgType, msgYear, msgNumber, completionHandler) {
  var postData = messageBodyKey(msgType, msgYear, msgNumber);
  var body = Navadmin.messageStore.getBody(msgType, msgYear, msgNumber);
  if (body) {
    console.log('Using the cached body for ' + postData + '.');
    if (completionHandler) {
      completionHandler(body, null);
    }
    return;
  }
  if (!startMessageRequest(postData, completionHandler)) {
    return;
  }
  var request = $.ajax({
    url: server + '/message',
    method: 'POST',
    data: postData,
    dataType: 'text'
  });
  request.done(function(data) {
    if (!data) {
      console.log('The server returned an empty body for ' + postData + '.');
      finishMessageRequest(postData, [null, 'Message not found.']);
      return;
    }
    Navadmin.messageStore.saveBody(msgType, msgYear, msgNumber, data);
    finishMessageRequest(postData, [data, null]);
  });
  request.fail(function(jqXHR, textStatus) {
    console.log('Message request failed for ' + postData + ' with status ' + textStatus + ' and HTTP status ' + jqXHR.status + '.');
    var errorText = jqXHR.status === 404 ?
      'Message text is not publicly released.' :
      'Unable to get the message.';
    finishMessageRequest(postData, [null, errorText]);
  });
}

/**
 * Fetch and display a new broadcast when visits and local storage allow it.
 * @param {function} [completionHandler] Called after the request settles or is skipped by the throttle.
 */
function getBroadcast(completionHandler) {
  var requestKey = 'broadcast';
  var storageKey = 'nv-cachedBroadcast';
  if (!checkIfActiveMetadataRequestAllowed(requestKey)) {
    if (completionHandler) {
      completionHandler();
    }
    return;
  }

  setActiveMetadataRequest(requestKey);
  var request = $.ajax({
    url: server + '/broadcast',
    method: 'GET',
    dataType: 'text',
    complete: function() {
      if (completionHandler) {
        completionHandler();
      }
    }
  });
  request.done(function(data) {
    releaseActiveMetadataRequest(requestKey, true);
    if (!data) {
      console.log('No broadcast is available.');
      return;
    }
    if (!(getCookie(COOKIE_VISITS) > 1)) {
      console.log('Skipping the broadcast on this visit because the visit count is below two.');
      return;
    }
    if (!isLocalStorageSupported()) {
      console.log('Skipping the broadcast because local storage is unavailable.');
      return;
    }
    if (getKeyValueFromLocalStorage(storageKey) == data) {
      console.log('Skipping the broadcast because it was already displayed.');
      return;
    }

    console.log('Saving the new broadcast before displaying it in an alert.');
    saveKeyValueToLocalStorage(storageKey, data);
    alert(data);
  });

  request.fail(function(jqXHR, textStatus) {
    releaseActiveMetadataRequest(requestKey, false);
    console.log('Broadcast request failed with status ' + textStatus + ' and HTTP status ' + jqXHR.status + '.');
  });
}

var viewActivityUUID;
var viewRegistrationPending = false;
var viewRegistrationSucceeded = false;
var pendingViews = [];

/**
 * Submit one view after device registration succeeds.
 * @param {string} postData The form data identifying the browser and message.
 */
function postViewActivity(postData) {
  var request = $.ajax({
    url: server + '/updateUserActivity',
    method: 'POST',
    data: postData
  });
  request.fail(function(jqXHR, textStatus) {
    console.log('View activity request failed with status ' + textStatus + ' and HTTP status ' + jqXHR.status + '.');
  });
}

/**
 * Record a message view for the browser. Views wait for device registration to succeed.
 * @param {MsgType} msgType The message type.
 * @param {number} msgYear The message year.
 * @param {number} msgNumber The message number.
 */
function sendViewActivity(msgType, msgYear, msgNumber) {
  if (!viewActivityUUID) {
    viewActivityUUID = getCookie('uuid');
    if (!viewActivityUUID) {
      viewActivityUUID = uuidv4();
      setCookie('uuid', viewActivityUUID);
    }
  }

  var deviceData = 'deviceUUID=' + encodeURIComponent(viewActivityUUID);
  var activityData = deviceData + '&activityType=view' +
    '&activityMsgType=' + msgTypeToString(msgType) +
    '&activityMsgYear=' + msgYear +
    '&activityMsgNumber=' + msgNumber;

  if (viewRegistrationSucceeded) {
    postViewActivity(activityData);
    return;
  }
  pendingViews.push(activityData);
  if (viewRegistrationPending) {
    console.log('Queued the message view because device registration is already in progress.');
    return;
  }

  console.log('Registering the browser before sending queued message views.');
  viewRegistrationPending = true;
  var request = $.ajax({
    url: server + '/updateUserInfo',
    method: 'POST',
    data: deviceData +
      '&deviceOS=' + encodeURIComponent(window.navigator.platform || 'web') +
      '&deviceName=none',
    dataType: 'json'
  });
  request.done(function(data) {
    viewRegistrationPending = false;
    if (!data || data.status !== 0) {
      console.log('Device registration was rejected. Views remain queued until a later view retries registration.');
      return;
    }

    viewRegistrationSucceeded = true;
    var views = pendingViews;
    pendingViews = [];
    console.log('Device registration succeeded. Sending ' + views.length + ' queued message views.');
    views.forEach(postViewActivity);
  });
  request.fail(function(jqXHR, textStatus) {
    viewRegistrationPending = false;
    console.log('Device registration failed with status ' + textStatus + ' and HTTP status ' + jqXHR.status + '.');
  });
}
