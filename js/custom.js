var availableMsgTypes = [
  MsgType.NAVADMIN,
  MsgType.ALNAV,
  MsgType.MARADMIN,
  MsgType.ALMAR
];

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
  
  setFilterMsgTypeDropdown(availableMsgTypes);
  setUIInLoadingStatus(true, "Getting available messages");

  function getMessageYearsAndMetadata() {
    return function() {
      getYearsForMsgType(
        userSelectedMsgType, 
        [], 
        userSelectedMsgYear == -1 , 
        userSelectedMsgYear > -1 ? function() {
          getYearsForMsgType(userSelectedMsgType, userSelectedMsgYear > -1 ? [userSelectedMsgYear] : [], false, null)
        } : null
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
});

function setUIInLoadingStatus(disable, statusText) {
  if (disable) {
    loadingProgress.removeClass('bg-warning');
    loadingProgress.show(loadingProgressHideShowDuration);
    loadingProgress.find('div').text(statusText);
  } else {
    if (statusText && statusText.length > 0) {
      loadingProgress.add('bg-warning');
    } else {
      loadingProgress.removeClass('bg-warning');
      loadingProgress.hide(loadingProgressHideShowDuration);
    }
    loadingProgress.find('div').text(statusText);
  }
}

/**
 * Set the message table contents.
 * @param {MsgType[]} msgTypes Array of message types to set in the message type filter dropdown menu. 
 */
function setFilterMsgTypeDropdown(msgTypes) {
  $('#msg-type-dropdown-menu').empty();

  //Create click handler for filter msg type
  function createHandler(msgType) {
    return function(e) {
      e.preventDefault(); // cancel the link behaviour
      $("#msg-type-dropdown").text(msgTypeToString(msgType));
      userSelectedMsgType = msgType;
      setFilterMsgYearDropdown(msgType, userSelectedMsgYear);
      $("#msg-search-input").val('');
      setTableMessages(msgType, userSelectedMsgYear);
    };
  }

  for (var i = 0; i < msgTypes.length; i++) {
    var a = $('<a>', { 'class': 'dropdown-item' });
    a.text(msgTypeToString(msgTypes[i]));
    a.click(createHandler(msgTypes[i]));
    $('#msg-type-dropdown-menu').append(a);
  }

  $("#msg-type-dropdown").text(msgTypeToString(userSelectedMsgType));
}

/**
 * Set the msg year filter dropdown elements and dropdown button title.
 * @param {MsgType} msgType The message type to add dropdown menu year elements for. 
 * @param {number} msgYear The message year to set as the dropdown button title. Pass -1 to set title to latest message year.
 */
function setFilterMsgYearDropdown(msgType, msgYear) {
  $('#msg-year-dropdown-menu').empty();

  var cachedMessageTypeYears = cachedMessages.get(msgType);

  //Create click handler for filter msg year
  function createHandler(msgType, msgYear) {
    return function(e) {
      e.preventDefault(); // cancel the link behaviour
      userSelectedMsgType = msgType;
      userSelectedYear = msgYear;
      $("#msg-year-dropdown").text(msgYear);
      $("#msg-type-dropdown").text(msgTypeToString(msgType));
      $("#msg-search-input").val('');
      setTableMessages(msgType, msgYear);
    };
  }

  if (cachedMessageTypeYears)
    cachedMessages.get(msgType).forEach(function(v, k) {
      var a = $('<a>', { 'class': 'dropdown-item', 'href': createYearDirectLink(msgType, k) });
      a.text(k);
      a.click(createHandler(msgType, k));
      $('#msg-year-dropdown-menu').append(a);

      //Save latest msgYear to set it as the dropdown button title later
      if (msgYear == -1)
        msgYear = k;
    });
  else {
    getYearsForMsgType(msgType, [], true, null);
    setUIInLoadingStatus(true, null);
  }

  userSelectedYear = msgYear;
  $("#msg-year-dropdown").text(msgYear);
}

/**
 * Set the message table contents.
 * @param {MsgType} msgType The message type to show. 
 * @param {number} msgYear The message year to show. Pass -1 to set title to latest message year.
 */
function setTableMessages(msgType, msgYear) {
  //If msgYear is -1, set the msgYear to the latest year for the message type.
  if (msgYear == -1) {
    if (!cachedMessages.get(msgType)) {
      getYearsForMsgType(msgType, [msgYear], false, null);
      setUIInLoadingStatus(true, null);
      return;
    }
    cachedMessages.get(msgType).forEach(function(v, k) {
      if (msgYear == -1)
        msgYear = k;
    });
  }
  msg = cachedMessages.get(msgType).get(msgYear);

  $('#msg-list-table-body').empty();

  if (!msg) {
    console.log('No msg array found for ' + msgTypeToString(msgType) + ' ' + msgYear + '. Creating new network request.');
    getYearsForMsgType(msgType, [msgYear], false, null);
    setUIInLoadingStatus(true, null);
    return;
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
        if (cachedMsg && cachedMsg.body && cachedMsg.body.length > 0)
          showMessageModal(msgType, msgYear, msgNumber, cachedMsg.title, cachedMsg.body);
        else
          getMsgBody(msgType, msgYear, msgNumber, createCompletionHandler(tr));
      };
    }
    tr.click(createHandler(m.type, m.year, m.number));

    $('#msg-list-table-body').append(tr);

    //Store reference to tr element in message object inside global message cache
    m.tr = tr;
  };
}

function msgFilterSearchInputChanged(e) {
  var searchTerm = $(this).val().toUpperCase();
  var searchRE = new RegExp('.*?' + searchTerm + '.*?\\s?', 'g');
  var currentSearchArray = cachedMessages.get(userSelectedMsgType).get(userSelectedYear);
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
  var messageSelectorText = msgTypeToString(msgType) + ' ' + pad(msgNumber, 3) + '/' + (msgYear % 1000).toString();
  msgModalTitle.text(messageSelectorText + (title ? ' - ' + title : '')); //TODO: Do regex search in message body to find SUBJ if not metadata not downloaded from server
  msgModalBody.text(body);
  msgModal.modal('show');

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
