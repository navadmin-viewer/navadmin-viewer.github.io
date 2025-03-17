var server = 'https://navadmin-server.runs.io';
var shareServer = 'https://navadmin-viewer.github.io';

// Server request throttling
var serverRequestCooldownSeconds = 600

function releaseActiveMetadataRequest(data, success) {
  if (success) {
    var d = new Date()
    activeMetadataRequests.set(data, d.getTime() + serverRequestCooldownSeconds * 1000) //Save the next time this request will be allowed
  } else {
    activeMetadataRequests.delete(data); // Or clear it so next request is always allowed
  }
}

function setActiveMetadataRequest(data) {
  activeMetadataRequests.set(data, -1) // -1 means a request is in progress
}

/**
 * Check if there is an active network request for specified data.
 * @param {string} data The requested metadata
 * @param {boolean} forceUpdate Should we 
 * @returns {boolean} completionHandler Completion handler to run after request completes.
 */
function checkIfActiveMetadataRequestAllowed(data, forceUpdate) {
  var nextTimeRequestAllowed = activeMetadataRequests.get(data)
  if (!nextTimeRequestAllowed) {
    return true
  } else if (nextTimeRequestAllowed == -1) {
    console.log('Identical fetch request for ' + data + ' already in progress. ')
    return false
  }

  var d = new Date()
  if (d.getTime() < nextTimeRequestAllowed) {
    console.log('Fetch request for ' + data + ' will be allowed to next run in ' + (nextTimeRequestAllowed - d.getTime()) + 'ms')
    return false
  }

  return true
}

/**
 * Get years info for a MsgType. Set the msg year filter dropdown elements and dropdown button title.
 * @param {MsgType} msgType The message type to years for. 
 * @param {number[]} yearsToGetMetadata The message years to get metadata for and year to set the table contents to on request completion.
 * @param {boolean} getLatestYearMetadata Indicate whether another request should be initiated to get the latest retrieved year metadata from server.
 * @param {function} completionHandler Completion handler to run after request completes.
 */
function getYearsForMsgType(msgType, yearsToGetMetadata, getLatestYearMetadata, completionHandler) {
  console.log('Network fetch request received for ' + msgTypeToString(msgType) + ' ' + (yearsToGetMetadata ? yearsToGetMetadata : '[]') + ' ' + getLatestYearMetadata + ' ' + (completionHandler ? 'completionHandler' : 'no completionHander'));
  var postData = '';
  postData += 'type=';
  postData += msgTypeToString(msgType);
  if (yearsToGetMetadata)
    yearsToGetMetadata.forEach(function(year, index) {
      postData += '&';
      postData += 'yearsMetadata=';
      postData += year;
    });

  //Check if we have an active request for the same data in progress already. 
  if (checkIfActiveMetadataRequestAllowed(postData)) {
    setActiveMetadataRequest(postData);
  } else {
    if (completionHandler)
      completionHandler();
    return;
  }

  var request = $.ajax({
    url: server + '/messages',
    method: "POST",
    data: postData,
    dataType: "json",
    complete: function(jqXHR, textStatus) {
      if (completionHandler)
        completionHandler();
    }
  });
  request.done(function(data, textStatus, jqXHR) {
    releaseActiveMetadataRequest(postData, true);
    var dataObj = data;
    //Define alerting format for errors
    function parseMessagesError(error) {
      alert('Unable to get message list. ' + error ? error : '' + '\nStatus: ' + textStatus + '\nServer returned error ' + dataObj.status + ' ' + dataObj.error);
    }

    if ('status' in dataObj) {
      if (dataObj.status != 0) {
        parseMessagesError();
      }
    } else {
      parseMessagesError();
    }

    var yearInts = [];

    var dataObj = data;
    yearsMsgs = new Map();
    if ('years' in dataObj) {
      //Show error if no years returned
      if (dataObj.years.length == 0)
        parseMessagesError('Zero years found.');

      for (var year in dataObj.years) {
        var yearInt = parseInt(year);
        if (yearInt != NaN) {
          yearInts.push(yearInt);
          yearsMsgs.set(yearInt, dataObj.years[year].msgSkeletons)
        }
      };
    } else {
      parseMessagesError('No years key found.');
    }

    //Sort year ints DESC order
    yearInts.sort(function(a, b) {
      return b - a;
    });

    //Create new map and set elements in map based on DESC sorted yearInts array order
    var yearsMsgsDesc = new Map();
    for (var i = 0; i < yearInts.length; i++) {
      yearsMsgsDesc.set(yearInts[i], yearsMsgs.get(yearInts[i]));
    }

    // Cached year count does not match retrieved year count
    if (cachedMessages && cachedMessages.get(msgType) && cachedMessages.get(msgType).size != yearsMsgsDesc.size) {
      // TODO: Add only the missing years
      console.log('Cached ' + msgTypeToString(msgType) + ' year count ' + cachedMessages.get(msgType).size + ' does not match server year count ' + yearsMsgsDesc.size + '. Reset cache for that message type.')

      // Add missing years to cache (we go the other way around because the other map is sorted)
      cachedMessages.get(msgType).forEach(function(v, k) {
        console.log('Move year ' + k + ' data from cache to sorted map');
        yearsMsgsDesc.set(k, v)
      });

      // Overwrite entire year cache from the sorted map
      console.log('Overwrite ' + msgTypeToString(msgType) + ' from sorted map');
      cachedMessages.set(msgType, yearsMsgsDesc);
    }

    // Cached data does not have this message type. Set years for the message type
    if (cachedMessages && !cachedMessages.get(msgType)) {
      console.log('Cache new map entry for ' + msgTypeToString(msgType))
      cachedMessages.set(msgType, yearsMsgsDesc);
    }

    // Update message metadata for each year of the retrieved message type
    if (cachedMessages && cachedMessages.get(msgType)) {
      cachedMessages.get(msgType).forEach(function(_, y) {
        if ((!cachedMessages.get(msgType).get(y) && yearsMsgsDesc.get(y)) || (cachedMessages.get(msgType).get(y) && yearsMsgsDesc.get(y) && cachedMessages.get(msgType).get(y).length < yearsMsgsDesc.get(y).length)) {
          console.log('Cached ' + msgTypeToString(msgType) + ' ' + y +' msg count ' + (cachedMessages.get(msgType).get(y) ? cachedMessages.get(msgType).get(y).length : 'null') + ' does not match server year count ' + yearsMsgsDesc.get(y).length + '.');
          if (cachedMessages.get(msgType).get(y)) {
            for (var i = cachedMessages.get(msgType).get(y).length; i < yearsMsgsDesc.get(y).length; i++) {
              console.log('Push message ' + i + ' metadata to cache');
              cachedMessages.get(msgType).get(y).push(yearsMsgsDesc.get(y)[i]);
            }
          } else {
            cachedMessages.get(msgType).set(y, yearsMsgsDesc.get(y));
          }
          
        }
      });
    }

    if (!cachedMessages) {
      console.log('Create new cached messages variable')
      cachedMessages = new Map();
      cachedMessages.set(msgType, yearsMsgsDesc);
    }

    /*
    //Unsupported DESC sort in IE 11 :(
    //Sort yearsMsgs map in descending order by key (year number)
    yearsMsgs = new Map([...yearsMsgs.entries()].sort(function(a, b) {
      return b[0]>a[0]; 
    }));
    cachedMessages.set(msgType, yearsMsgs);
    */

    //If getLatestYearMetadata is true, make another request to the server for the latest year metadata
    if (getLatestYearMetadata && yearInts.length > 0) {
      console.log("Make follow up network request for message metadata for " + msgTypeToString(msgType) + ' ' + yearInts[0]);
      setUIInLoadingStatus(true, 'Getting messages data');
      getYearsForMsgType(msgType, [yearInts[0]], false, null);
    } else {
      //setUIInLoadingStatus(false, null);
    }

    
    // if (userSelectedMsgType == msgType) {
    //   setInterfaceYear = userSelectedMsgYear == -1 ? (yearsToGetMetadata.length ? yearsToGetMetadata[0] : -1) : userSelectedMsgYear
    //   console.log('calling setFilterMsgYearDropdown' + (setInterfaceYear)+ ' from getYearsForMsgType' + msgTypeToString(msgType) + ' ' + yearsToGetMetadata + ' ' + getLatestYearMetadata + ' ' + completionHandler);
    //   setFilterMsgYearDropdown(msgType, setInterfaceYear);
    //   //setTableMessages will actually start another msg metadata fetch for the latest year on first load because the data is not stored in memory yet,
    //   //but this second request will not conflict with the previous follow up network request for metadata because it will be detected as duplicate
    //   console.log('calling setTableMessages' + (setInterfaceYear)+ ' from getYearsForMsgType' + msgTypeToString(msgType) + ' ' + yearsToGetMetadata + ' ' + getLatestYearMetadata + ' ' + completionHandler);
    //   setTableMessages(msgType, setInterfaceYear); 

    //   /*
    //   //All years
    //   cachedMessages.get(msgType).forEach(function (v, k) {
    //     setTableMessages(cachedMessages.get(msgType).get(k))
    //   });
    //   */
    // }
  });
  request.fail(function(jqXHR, textStatus, errorThrown) {
    console.log("Request failed\nStatus: " + textStatus + '\nHTTP error: ' + errorThrown);
    releaseActiveMetadataRequest(postData, false);
    setUIInLoadingStatus(false, "Request failed\nStatus: " + textStatus + '\nHTTP error: ' + errorThrown);
  });
}

/**
 * Get message body text. 
 * @param {MsgType} msgType The message type. 
 * @param {number} msgYear The message year.
 * @param {number} msgNumber The message number.
 */
function getMsgBody(msgType, msgYear, msgNumber, completionHandler) {
  var postData = '';
  postData += 'type=';
  postData += msgTypeToString(msgType);
  postData += '&year=';
  postData += msgYear;
  postData += '&number=';
  postData += msgNumber;

  //Check if we have an active request for the same data in progress already. 
  if (checkIfActiveMetadataRequestAllowed(postData)) {
    setActiveMetadataRequest(postData);
  } else {
    if (completionHandler)
      completionHandler();
    return;
  }

  var messageSelectorText = msgTypeToString(msgType) + ' ' + pad(msgNumber, 3) + '/' + (msgYear % 1000).toString();

  var request = $.ajax({
    url: server + '/message',
    method: "POST",
    data: postData,
    dataType: "text",
    complete: function(jqXHR, textStatus) {
      if (completionHandler)
        completionHandler();
    }
  });
  request.done(function(data, textStatus, jqXHR) {
    //Check request HTTP status
    if (jqXHR.status == 404 || data.length == 0) {
      releaseActiveMetadataRequest(postData, false);
      msgModalTitle.text(messageSelectorText);
      msgModalBody.text('Message not found');
    } else if (jqXHR.status == 503) {
      releaseActiveMetadataRequest(postData, false);
      msgModalTitle.text(messageSelectorText);
      msgModalBody.text('Data is unavailable.' + '\nStatus: ' + textStatus + '\nServer returned error ' + dataObj.status + ' ' + dataObj.error);
    } else {
      releaseActiveMetadataRequest(postData, true);
      var cachedMsgType = cachedMessages ? cachedMessages.get(msgType) : null;
      var cachedMsgYear = cachedMsgType ? cachedMsgType.get(msgYear) : null;
      var cachedMsg = cachedMsgYear ? cachedMsgYear[msgNumber - 1] : null;
      if (cachedMsg)
        cachedMsg.Body = data;
      //If the retrieved msg type is the currently the user selected message type or url passed message, show it.
      if (
        (userSelectedMsgType == msgType && userSelectedMsgYear == msgYear && userSelectedMsgNumber == msgNumber) ||
        (urlParamMsgType == msgType && urlParamMsgYear == msgYear && urlParamMsgNumber == msgNumber)
      ) {
        showMessageModal(
          msgType,
          msgYear,
          msgNumber,
          (cachedMsg && cachedMsg.title.length > 0 ? cachedMsg.title : ''),
          data
        );
      }
    }
  });

  request.fail(function(jqXHR, textStatus, errorThrown) {
    releaseActiveMetadataRequest(postData, false);
    msgModalTitle.text(messageSelectorText);
    msgModalBody.text("Request failed\nStatus: " + textStatus + '\nHTTP error: ' + errorThrown);
  });
}

/**
 * Get server broadcast and store/show it.
 * @param {function} completionHandler Completion handler to run after request completes.
 */
function getBroadcast(completionHandler) {
  activeRequestBroadcastKey = 'broadcast'

  //Check if we have an active request for the same data in progress already. 
  if (checkIfActiveMetadataRequestAllowed(activeRequestBroadcastKey)) {
    setActiveMetadataRequest(activeRequestBroadcastKey);
  } else {
    if (completionHandler)
      completionHandler();
    return;
  }

  var request = $.ajax({
    url: server + '/broadcast',
    method: "GET",
    data: null,
    dataType: "text",
    complete: function(jqXHR, textStatus) {
      if (completionHandler)
        completionHandler();
    }
  });
  request.done(function(data, textStatus, jqXHR) {
    //Check request HTTP status
    if (jqXHR.status == 404 || data.length == 0) {
      console.log('Broadcast - 404 or no data');
      releaseActiveMetadataRequest(activeRequestBroadcastKey, true);
    } else if (jqXHR.status == 503) {
      console.log('Broadcast - Data is unavailable.' + '\nStatus: ' + textStatus + '\nServer returned error ' + dataObj.status + ' ' + dataObj.error);
      releaseActiveMetadataRequest(activeRequestBroadcastKey, false);
    } else {
      releaseActiveMetadataRequest(activeRequestBroadcastKey, true);
      if (getCookie(COOKIE_VISITS) > 1 && isLocalStorageSupported() && getKeyValueFromLocalStorage(cachedBroadcastLocalStorageKey) != data) {
        if (data.length > 0) {
          alert(data);
        }
        console.log('Saving new broadcast.')
        saveKeyValueToLocalStorage(cachedBroadcastLocalStorageKey, data);
      } else {
        console.log('Suppressing broadcast because no cookie or localstorage support or user has already seen this broadcast.')
      }
    }
  });

  request.fail(function(jqXHR, textStatus, errorThrown) {
    releaseActiveMetadataRequest(activeRequestBroadcastKey, false);
    console.log("Broadcast - Request failed\nStatus: " + textStatus + '\nHTTP error: ' + errorThrown);
  });
}

function createMsgTypeDirectLink(msgType, redirection) {
  var shareLink = shareServer + (redirection ? '/view-message/' : '/');
  shareLink += '?type=';
  shareLink += msgTypeToString(msgType);
  return shareLink;
}

function createYearDirectLink(msgType, msgYear, redirection) {
  var shareLink = shareServer + (redirection ? '/view-message/' : '/');
  shareLink += '?type=';
  shareLink += msgTypeToString(msgType);
  shareLink += '&year=';
  shareLink += msgYear;
  return shareLink;
}

function createMessageDirectLink(msgType, msgYear, msgNumber, redirection) {
  var shareLink = shareServer + (redirection ? '/view-message/' : '/');
  shareLink += createURLParameters(msgType, msgYear, msgNumber);
  return shareLink;
}

function createURLParameters(msgType, msgYear, msgNumber) {
  var params = '?type=';
  params += msgTypeToString(msgType);
  if (msgYear >= 0) {
    params += '&year=';
    params += msgYear;
  }
  if (msgNumber >= 0) {
    params += '&number=';
    params += msgNumber;
  }
  return params;
}

/**
 * Send message view activity for view stats.
 * @param {MsgType} msgType The message type. 
 * @param {number} msgYear The message year.
 * @param {number} msgNumber The message number.
 */
function sendViewActivity(msgType, msgYear, msgNumber) {
  var uuid = getCookie('uuid');
  if (uuid.length == 0) {
    uuid = uuidv4();
    setCookie('uuid', uuid);
  }
  var postData = '';
  postData += 'deviceUUID=';
  postData += uuid;
  postData += '&deviceOS=';
  postData += window.navigator.platform ? window.navigator.platform : 'web';
  postData += '&deviceName=';
  postData += 'none';

  //Check if we have an active request for the same data in progress already. 
  if (activeMetadataRequests.get(postData))
    return;
  else
    activeMetadataRequests.set(postData, 1);

  var request = $.ajax({
    url: server + '/updateUserInfo',
    method: "POST",
    data: postData,
    dataType: "json"
  });
  request.done(function(data, textStatus, jqXHR) {
    if ('status' in data) {
      if (data.status == 0) {
        var actPostData = '';
        actPostData += 'deviceUUID=';
        actPostData += uuid;
        actPostData += '&activityType=';
        actPostData += 'view';
        actPostData += '&activityMsgType=';
        actPostData += msgTypeToString(msgType);
        actPostData += '&activityMsgYear=';
        actPostData += msgYear;
        actPostData += '&activityMsgNumber=';
        actPostData += msgNumber;

        var actRequest = $.ajax({
          url: server + '/updateUserActivity',
          method: "POST",
          data: actPostData
        });
      }
    }
  });

  request.fail(function(jqXHR, textStatus, errorThrown) {
    console.log(errorThrown);
  });
}
