var availableMsgTypes = [
  MsgType.NAVADMIN,
  MsgType.ALNAV,
  MsgType.MARADMIN,
  MsgType.ALMAR
];

var cachedMessagesLocalStorageKey = 'nv-cachedMessages'
var cachedBroadcastLocalStorageKey = 'nv-cachedBroadcast'

var urlParamMsgType = MsgType.UNKNOWN;
var urlParamMsgYear = -1;
var urlParamMsgNumber = -1;

// msg-type -> {msg-year:[]msg} 
var cachedMessages;
// postData -> 1 | not set
var activeMetadataRequests = new Map();

var userSelectedMsgType = MsgType.NAVADMIN;
var userSelectedMsgYear = -1;
var userSelectedMsgNumber = -1;

var navAppLink;

var loadingProgress;
var loadingProgressHideShowDuration = 100;

var msgModal;
var msgModalTitle;
var msgModalBody;
var msgModalShare;

$(document).ready(function() {
  //Set callback for setting wait cursor
  $(document).ajaxStart(function () { $("html").addClass("wait"); });
  $(document).ajaxStop(function () { $("html").removeClass("wait"); });

  navAppLink = $('#nav-app-link');

  loadingProgress = $('#loading-progress');

  msgModal = $('#msg-body-modal');
  msgModalTitle = $('#msg-body-modal .modal-title');
  msgModalBody = $('#msg-body-modal .modal-body');
  msgModalShare = $('#msg-body-modal .modal-share-link');

  urlParamMsgType = stringToMsgType(getUrlParameter(window.location.href, 'type'));
  urlParamMsgYear = parseInt(getUrlParameter(window.location.href, 'year'));
  urlParamMsgNumber = parseInt(getUrlParameter(window.location.href, 'number'));

  //Use url parameter msg type as the default selected msg type in the UI filter. 
  if (urlParamMsgType != MsgType.UNKNOWN) {
    userSelectedMsgType = urlParamMsgType;
    //Only prefill url param msg year if the url param msg type is valid.
    if (urlParamMsgYear > -1) {
      userSelectedMsgYear = urlParamMsgYear;
    }
  } 
  
  //Load previously stored messages from local storage
  if (isLocalStorageSupported()) {
    cachedMessages = deserializeMapString(localStorage.getItem(cachedMessagesLocalStorageKey))
  }

  // Increment visits in cookie
  var visits = getCookie(COOKIE_VISITS);
  if (visits.length == 0) {
    visits = 1;
  } else {
    visits += 1;
  }
  setCookie(COOKIE_VISITS, visits);

  try {
    //Attach visibilitychange handler for triggering storage of messages to local storage
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === 'hidden') {
        console.log('save')
        saveCachedMessagesToLocalStorage()
      }
    });
  } catch (e) {
    console.log('Could not add event listener for visibilitychange', e);
  }

  setFilterMsgTypeDropdown(availableMsgTypes);
  setFilterMsgYearDropdown(userSelectedMsgType, userSelectedMsgYear);
  setTableMessages(userSelectedMsgType, userSelectedMsgYear);
  setUIInLoadingStatus(true, "Getting available messages");


  function getMessageYearsAndMetadata() {
    return function() {
      getYearsForMsgType( // Get years for message type
        userSelectedMsgType, 
        [], 
        userSelectedMsgYear == -1, 
        function() {
          if (!setFilterMsgYearDropdown(userSelectedMsgType, userSelectedMsgYear)) { console.log("getMessageYearsAndMetadata > fetch > completionHandler > setFilterMsgYearDropdown did not have data to complete.") }
          
          getYearsForMsgType( //Get message metadata for the user selected year or latest year
            userSelectedMsgType, 
            [userSelectedMsgYear > -1 ? userSelectedMsgYear : latestYearForMsgType(userSelectedMsgType)], 
            false, 
            function() {
              if (!setTableMessages(userSelectedMsgType, userSelectedMsgYear)) { console.log("getMessageYearsAndMetadata > fetch > completionHandler > fetch > completionHandler > setTableMessages did not have data to complete.")}
            }
          )
        }
      );
    }
  }

  //Use url params to start loading a message to view if the url params are valid. 
  if (urlParamMsgType != MsgType.UNKNOWN && urlParamMsgYear > -1 && urlParamMsgNumber > -1) {
    getMsgBody(urlParamMsgType, urlParamMsgYear, urlParamMsgNumber, getMessageYearsAndMetadata());

    //Log launch with parameter
    if (typeof analytics !== 'undefined') {
      analytics.logEvent('LaunchParameter', {
        messageNumber: msgTypeToString(urlParamMsgType) + ' ' + pad(m.number, 3) + '/' + pad((m.year % 1000), 2)
      });
    }
  } else {
    //No completely prefilled message selector found in url parameters.
    getMessageYearsAndMetadata()();
  }

  $("#msg-search-input").on('keyup paste', msgFilterSearchInputChanged);

  navAppLink.click(navigateToAppStore)

  msgModalShare.click(shareUserSelectedMessageLink);

  // Check for broadcast
  getBroadcast(null)
});

/**
 * Set UI loading status
 * @param {boolean} disable Show UI as loading. 
 * @param {string} statusText Status text.
 */
function setUIInLoadingStatus(disable, statusText) {
  console.log(disable, statusText)
  if (disable) {
    loadingProgress.removeClass('bg-warning');
    loadingProgress.show(loadingProgressHideShowDuration);
    loadingProgress.find('div').text(statusText);
  } else {
    if (statusText && statusText.length > 0) {
      loadingProgress.find('div').addClass('bg-danger');
      console.log('run')
    } else {
      loadingProgress.find('div').removeClass('bg-warning');
      loadingProgress.hide(loadingProgressHideShowDuration);
    }
    loadingProgress.find('div').text(statusText);
  }
}

/**
 * Set the message type filter dropdown menu contents.
 * @param {MsgType[]} msgTypes Array of message types to set in the message type filter dropdown menu. 
 */
function setFilterMsgTypeDropdown(msgTypes) {
  console.log('setFilterMsgTypeDropdown' + String(msgTypes));

  //Create click handler for filter msg type
  function createHandler(msgType) {
    return function filterMsgTypeClickHandler(e) {
      e.preventDefault(); // cancel the link behaviour
      userSelectedMsgType = msgType;
      userSelectedMsgYear = -1;
      $("#msg-type-dropdown").text(msgTypeToString(msgType));
      $("#msg-search-input").val('');

      // Call this if we need to get message metadata
      function getMessageMetadata() {
        console.log('Calling getYearsForMsgType from ' + arguments.callee.name);
        var ly = latestYearForMsgType(msgType)
        if (ly == -1) {
          console.log('No latest year for ' + msgTypeToString(msgType));
          return;
        }
        getYearsForMsgType(
          msgType, 
          [ly], 
          false, 
          function () {
            if (userSelectedMsgType == msgType && userSelectedMsgYear == ly) {
              console.log('Calling setTableMessages from setFilterMsgTypeDropdown > clickHandler > fetch > completionHandler > fetch > completionHandler');
              setTableMessages(msgType, userSelectedMsgYear);
            }
          }
        );
      }

      console.log('Calling setFilterMsgYearDropdown from ' + arguments.callee.name);
      var cachedYearDataExists = setFilterMsgYearDropdown(msgType, userSelectedMsgYear);
      if (!cachedYearDataExists) {
        getYearsForMsgType(
          msgType, 
          [], 
          false, 
          function() {
            getMessageMetadata();
            console.log('Calling setFilterMsgYearDropdown from setFilterMsgTypeDropdown > clickHandler > fetch > completionHandler');
            setFilterMsgYearDropdown(msgType, userSelectedMsgYear);
          }
        )
        setUIInLoadingStatus(true, null);
        return;
      }
      

      console.log('Calling setTableMessages from ' + arguments.callee.name);
      var cachedMessageDataExists = setTableMessages(msgType, userSelectedMsgYear);
      if (!cachedMessageDataExists) {
        getMessageMetadata();
        setUIInLoadingStatus(true, null);
        return;
      }

      var cachedYearCount = cachedMessages.get(msgType).size;

      // Get updated years in background. Only update years dropdown if user has still selected this message type.
      getYearsForMsgType(
        msgType, 
        [], 
        false, 
        function() {
          if (userSelectedMsgType == msgType && cachedYearCount != cachedMessages.get(msgType).size) {
            console.log('Calling setFilterMsgYearDropdown from setFilterMsgTypeDropdown > clickHandler > fetch > completionHandler');
            setFilterMsgYearDropdown(msgType, userSelectedMsgYear);
          }

          if (!cachedMessageDataExists) {
            getMessageMetadata()
          }
        }
      );
    };
  }

  $('#msg-type-dropdown-menu').empty();

  for (var i = 0; i < msgTypes.length; i++) {
    var a = $('<a>', { 'class' : 'dropdown-item', 'href' : createMsgTypeDirectLink(msgTypes[i])});
    a.text(msgTypeToString(msgTypes[i]));
    a.click(createHandler(msgTypes[i]));
    $('#msg-type-dropdown-menu').append(a);
  }

  $("#msg-type-dropdown").text(msgTypeToString(userSelectedMsgType));
}

/**
 * Set the msg year filter dropdown elements and dropdown button title.
 * This should be followed by setTableMessages() if the message metadata for that year exists.
 * @param {MsgType} msgType The message type to add dropdown menu year elements for. 
 * @param {number} msgYear The message year to set as the dropdown button title. Pass -1 to set title to latest message year.
 * @returns {bool} Return if message year data was available.
 */
function setFilterMsgYearDropdown(msgType, msgYear) {
  console.log('setFilterMsgYearDropdown' + msgTypeToString(msgType) + ' ' + msgYear);

  //Create click handler for filter msg year
  function createHandler(msgType, msgYear) {
    return function filterMsgYearClickHandler(e) {
      e.preventDefault(); // cancel the link behaviour
      userSelectedMsgType = msgType;
      userSelectedMsgYear = msgYear;
      $("#msg-year-dropdown").text(msgYear);
      $("#msg-type-dropdown").text(msgTypeToString(msgType));
      $("#msg-search-input").val('');

      console.log('Calling setTableMessages from ' + arguments.callee.name);
      if (!setTableMessages(msgType, msgYear)) {
        getYearsForMsgType(
          msgType, 
          [msgYear], 
          false, 
          function filterMsgYearClickHandlerFetchCompletionHandler() {
            console.log('Calling setTableMessages from ' + arguments.callee.name);
            setTableMessages(msgType, msgYear);
          }
        );
        setUIInLoadingStatus(true, null);
        return;
      }

      // Get updated message metadata in background. Only update messages table if user has still selected this message type and year and number of messages has changed.
      var cachedYearMessageCount = cachedMessages.get(msgType).get(msgYear).length;
      getYearsForMsgType(
        msgType, 
        [msgYear], 
        false, 
        function filterMsgYearClickHandlerFetchCompletionHandler() {
          if (userSelectedMsgType == msgType && userSelectedMsgYear == msgYear && cachedYearMessageCount != cachedMessages.get(msgType).get(msgYear).length) {
            console.log('Calling setTableMessages from ' + arguments.callee.name);
            setTableMessages(msgType, msgYear);
          }
        });
    };
  }

  $('#msg-year-dropdown-menu').empty();

  if (cachedMessages.get(msgType)) {
    cachedMessages.get(msgType).forEach(function(v, k) {
      var a = $('<a>', { 'class': 'dropdown-item', 'href': createYearDirectLink(msgType, k) });
      a.text(k);
      a.click(createHandler(msgType, k));
      $('#msg-year-dropdown-menu').append(a);

      //Save latest msgYear to set it as the dropdown button title later
      if (msgYear == -1)
        msgYear = k;
    });
  } else {
    // getYearsForMsgType(msgType, [], true, null);
    // setUIInLoadingStatus(true, null);
    return false;
  }

  userSelectedMsgYear = msgYear;
  $("#msg-year-dropdown").text(msgYear);
  return true;
}

/**
 * Set the message table contents.
 * @param {MsgType} msgType The message type to show. 
 * @param {number} msgYear The message year to show. Pass -1 to set title to latest message year.
 * @returns {bool} Return if message table data was available.
 */
function setTableMessages(msgType, msgYear) {
  console.log('setTableMessages' + msgTypeToString(msgType) + ' ' + msgYear);

  document.title = shortNameForMessage(msgType, msgYear) + ' - ' + NAVADMIN_VIEWER_TITLE;
  window.history.pushState(document.title, NAVADMIN_VIEWER_TITLE, createURLParameters(msgType, msgYear));

  //If msgYear is -1, set the msgYear to the latest year for the message type.
  if (msgYear == -1) {
    msgYear = latestYearForMsgType(msgType);
    if (msgYear == -1) {
      console.log('setTableMessages found no cached messsage data to use for -1 msgYear')
      return false;
    }
  }

  msg = null;
  if (cachedMessages && cachedMessages.get(msgType)) {
    msg = cachedMessages.get(msgType).get(msgYear);
  }
  
  $('#msg-list-table-body').empty();

  if (!msg) {
    console.log('No msg array found for ' + msgTypeToString(msgType) + ' ' + msgYear + '. Should create new network request.');
    // getYearsForMsgType(msgType, [msgYear], false, null);
    // setUIInLoadingStatus(true, null);
    return false;
  } else {
    console.log('Cached msg array found for ' + msgTypeToString(msgType) + ' ' + msgYear + '.');
    // getYearsForMsgType(msgType, [msgYear], false, null);
    // setUIInLoadingStatus(false, null);
  }

  for (var i = msg.length - 1; i >= 0; i--) {
    m = msg[i];
    var tr = $("<tr>", {});
    var th = $("<th>", {});
    var td = $("<td>", {});
    var tdStats = $("<td>", {});
    th.text(pad(m.number, 3) + '/' + (m.year % 1000).toString());

    var messageTitle = m.title;
    if (m.title.length == 0) {
      messageTitle = 'No subject found';
    } 
    if (m.cancelled) {
      messageTitle = m.title.length > 0 ? m.title : 'N/A';
      tr.addClass('table-danger');
      tr.css('cursor', 'not-allowed');
    }

    var subjectLink = $("<a>", { 'href': createMessageDirectLink(m.type, m.year, m.number, false) });
    subjectLink.text(messageTitle);
    td.append(subjectLink);

    //Setup stats box
    var actStarCount = -1;
    var actViewCount = -1;
    if (m.actSum && m.actSum.length > 0) {
      m.actSum.forEach(function(v) {
        if (v.actType == 'star')
          actStarCount = v.actNumber;
        else if (v.actType == 'view')
          actViewCount = v.actNumber;
      });
    }
    if (actStarCount > -1 && actViewCount > -1) {
      var divStats = $("<div>", { 'class': 'stats-box' });
      var pStars = $("<p>", {});
      var pViews = $("<p>", {});
      pStars.text('\u2605\u00a0' + actStarCount);
      pViews.text('\u00a0' + actViewCount);
      pViews.prepend($("<img>", { 'src': 'assets/eye.svg' }));
      divStats.append(pStars, pViews);
      tdStats.append(divStats);
    }

    tr.append(th, td, tdStats);
    tr.css('cursor', 'pointer');
    tr.attr('msg-type', msgTypeToString(m.type));

    //Create click handler for table row
    function createHandler(msgType, msgYear, msgNumber) {
      return function(e) {
        e.preventDefault(); // cancel the link behaviour
        //tr.css('cursor', 'progress');
        userSelectedMsgType = msgType;
        userSelectedMsgYear = msgYear;
        userSelectedMsgNumber = msgNumber;

        //Create completion handler to reset table row progress indicator when done
        function createCompletionHandler(tr) {
          return function() {
            tr.css('cursor', 'pointer');
          }
        }

        //Check if current message exists in cache
        var cachedMsg = cachedMessages ? cachedMessages.get(msgType).get(msgYear)[msgNumber - 1] : null;
        if (cachedMsg && cachedMsg.Body && cachedMsg.Body.length > 0)
          showMessageModal(msgType, msgYear, msgNumber, cachedMsg.title, cachedMsg.Body);
        else
          getMsgBody(msgType, msgYear, msgNumber, createCompletionHandler(tr));
      };
    }
    tr.click(createHandler(m.type, m.year, m.number));

    $('#msg-list-table-body').append(tr);

    //Store reference to tr element in message object inside global message cache
    m.tr = tr;
  };

  setUIInLoadingStatus(false, null);
  return true;
}

function msgFilterSearchInputChanged(e) {
  var searchTerm = $(this).val().toUpperCase();
  var searchRE = new RegExp('.*?' + searchTerm + '.*?\\s?', 'g');
  var currentSearchArray = cachedMessages.get(userSelectedMsgType).get(userSelectedMsgYear);
  currentSearchArray.forEach(function(v) {
    if (!searchRE.test(v.title))
      v.tr.hide();
    else
      v.tr.show();
  });
}

function navigateToAppStore(e) {
  e.preventDefault(); // cancel the link behaviour
  var appLink;
  var detectedOS = getMobileOperatingSystem();
  if (detectedOS == 'android') {
    appLink = 'https://play.google.com/store/apps/details?id=com.ansonliu.navadmin';
  } else {
    appLink = 'https://apps.apple.com/us/app/navadmin-viewer/id1345135985';
  }
  location.assign(appLink);
}

function showMessageModal(msgType, msgYear, msgNumber, title, body) {
  var messageViewText = shortNameForMessage(msgType, msgYear, msgNumber);
  msgModalTitle.text(messageViewText + (title ? ' - ' + title : '')); //TODO: Do regex search in message body to find SUBJ if not metadata not downloaded from server
  msgModalBody.text(body);
  msgModal.modal('show');

  //Set page title to reflect current contents
  document.title = msgModalTitle.text() + ' - ' + NAVADMIN_VIEWER_TITLE;

  //Set window url to new message direct link parameters
  window.history.pushState(document.title, title, createURLParameters(msgType, msgYear, msgNumber));

  msgModal.on('hide.bs.modal', function (e) {
    document.title = shortNameForMessage(userSelectedMsgType, userSelectedMsgYear) + ' - ' + NAVADMIN_VIEWER_TITLE;
    window.history.pushState(document.title, NAVADMIN_VIEWER_TITLE, createURLParameters(userSelectedMsgType, userSelectedMsgYear, -1));
  })

  if (typeof analytics !== 'undefined') {
    //Log Viewed Message event
    analytics.logEvent('ViewedMessage', {
      messageNumber: msgTypeToString(urlParamMsgType) + ' ' + pad(m.number, 3) + '/' + pad((m.year % 1000), 2)
    });
  }

  sendViewActivity(msgType, msgYear, msgNumber);
}

function shareUserSelectedMessageLink(e) {
  e.preventDefault(); // cancel the link behaviour
  var shareLink = createMessageDirectLink(userSelectedMsgType, userSelectedMsgYear, userSelectedMsgNumber, true);
  window.prompt("Copy the below share link to clipboard (\u229e Ctrl+C / \uf8ff \u2318+C)", shareLink);
}