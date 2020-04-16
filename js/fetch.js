var server = 'https://admin-message.herokuapp.com';
var shareServer = 'https://navadmin-viewer.github.io';

/**
 * Get years info for a MsgType. Set the msg year filter dropdown elements and dropdown button title.
 * @param {MsgType} msgType The message type to years for. 
 * @param {number[]} yearsToGetMetadata The message years to get metadata for and year to set the table contents to on request completion.
 * @param {boolean} getLatestYearMetadata Indicate whether another request should be initiated to get the latest retrieved year metadata from server.
 */
function getYearsForMsgType(msgType, yearsToGetMetadata, getLatestYearMetadata) {
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
  if (activeMetadataRequests.get(postData))
    return;
  else 
    activeMetadataRequests.set(postData, 1);
  
  var request = $.ajax({
    url: server + '/messages',
    method: "POST",
    data: postData,
    dataType: "json",
    complete: function( jqXHR, textStatus ) {
      activeMetadataRequests.delete(postData);
    }
  });
  request.done(function( data, textStatus, jqXHR ) {
    var dataObj = data;
    //Define alerting format for errors
    function parseMessagesError (error) {
      alert('Unable to get message list. ' + error ? error : '' + '\nStatus: '  + textStatus + '\nServer returned error ' + dataObj.status + ' '+ dataObj.error);
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
      return b[0]>a[0];
    });

    //Create new map and set elements in map based on DESC sorted yearInts array order
    var yearsMsgsDesc = new Map();
    for (var i = 0; i < yearInts.length; i++) {
      yearsMsgsDesc.set(yearInts[i], yearsMsgs.get(yearInts[i]));
    }

    cachedMessages.set(msgType, yearsMsgsDesc);

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
      getYearsForMsgType(msgType, [yearInts[0]], false);
    } else {
      setUIInLoadingStatus(false);
    }

    if (userSelectedMsgType == msgType) {
      setFilterMsgYearDropdown(msgType, yearsToGetMetadata.length ? yearsToGetMetadata[0] : -1);
      setTableMessages(msgType, yearsToGetMetadata.length ? yearsToGetMetadata[0] : -1);

      /*
      //All years
      cachedMessages.get(msgType).forEach(function (v, k) {
        setTableMessages(cachedMessages.get(msgType).get(k))
      });
      */
    }
  });
  request.fail(function( jqXHR, textStatus, errorThrown) {
    setUIInLoadingStatus(false);
    alert( "Request failed\nStatus: " + textStatus + '\nHTTP error: ' + errorThrown);
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
  if (activeMetadataRequests.get(postData))
    return;
  else 
    activeMetadataRequests.set(postData, 1);
  
  var messageSelectorText = msgTypeToString(msgType) + ' ' + pad(m.number.toString(), 3) + '/' + (m.year % 1000).toString();

  var request = $.ajax({
    url: server + '/message',
    method: "POST",
    data: postData,
    dataType: "text",
    complete: function( jqXHR, textStatus ) {
      activeMetadataRequests.delete(postData);
      msgModal.modal('show');
      completionHandler();
    }
  });
  request.done(function( data, textStatus, jqXHR ) {
    

    //Check request HTTP status
    if (jqXHR.status == 404 || data.length == 0) {
      msgModalTitle.text(messageSelectorText);
      msgModalBody.text('Message not found');
    } else if (jqXHR.status == 503) {
      msgModalTitle.text(messageSelectorText);
      msgModalBody.text('Data is unavailable.' + '\nStatus: '  + textStatus + '\nServer returned error ' + dataObj.status + ' '+ dataObj.error);
    } else {
      var cachedMsg = cachedMessages.get(msgType).get(msgYear)[msgNumber-1];
      if (cachedMsg)
        cachedMsg.body = data;
      if (userSelectedMsgType == msgType && userSelectedMsgYear == msgYear && userSelectedMsgNumber == msgNumber) {
        msgModalTitle.text(messageSelectorText + (cachedMsg.title ? ' - ' + cachedMsg.title : '')); //TODO: Do regex search in message body to find SUBJ if not metadata not downloaded from server
        msgModalBody.text(data);
      }
    }
  });

  request.fail(function( jqXHR, textStatus, errorThrown) {
    msgModalTitle.text(messageSelectorText);
    msgModalBody.text( "Request failed\nStatus: " + textStatus + '\nHTTP error: ' + errorThrown);
  });
}

function createMessageShareLink(msgType, msgYear, msgNumber) {
  var shareLink = shareServer + '/view-message/?';
  shareLink += 'type=';
  shareLink += msgTypeToString(msgType);
  shareLink += '&year=';
  shareLink += msgYear;
  shareLink += '&number=';
  shareLink += msgNumber;
  return shareLink;
}
